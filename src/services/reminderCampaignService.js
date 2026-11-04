const WebinarRegistration = require('../models/WebinarRegistration');
const ReminderCampaignDelivery = require('../models/ReminderCampaignDelivery');
const defaultEmailService = require('./webinarEmailService');

const CAMPAIGN_ID = 'nov-1-2026-reminder';
const WEBINAR_ID = 'halal-wealth-nov-2026';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getEligibleQuery() {
  return {
    $and: [
      {
        $or: [
          { webinarId: WEBINAR_ID },
          { webinarVersion: 'November 1, 2026 Webinar' },
        ],
      },
      {
        webinarId: { $nin: ['halal-wealth-oct-2026', 'business-webinar-2026'] },
      },
      {
        webinarVersion: { $nin: ['October 2026 Webinar', 'Business Webinar 2026'] },
      },
      {
        status: { $ne: 'Cancelled' },
      },
    ],
  };
}

function createReminderCampaignService({
  registrationModel = WebinarRegistration,
  deliveryModel = ReminderCampaignDelivery,
  emailService = defaultEmailService,
  delayMs = 600,
  logger = console,
} = {}) {
  let isRunning = false;
  let activeCampaignState = null;
  const inFlightRecipients = new Set();
  let cancelRequested = false;

  async function getCampaignStats() {
    const query = getEligibleQuery();

    const [totalRegistrations, eligibleCount, sentCount, failedCount] = await Promise.all([
      registrationModel.countDocuments(),
      registrationModel.countDocuments(query),
      deliveryModel.countDocuments({ campaignId: CAMPAIGN_ID, emailStatus: 'sent' }),
      deliveryModel.countDocuments({ campaignId: CAMPAIGN_ID, emailStatus: 'failed' }),
    ]);

    const pendingCount = Math.max(0, eligibleCount - sentCount);
    const excludedCount = Math.max(0, totalRegistrations - eligibleCount);

    return {
      campaignId: CAMPAIGN_ID,
      webinarId: WEBINAR_ID,
      totalRegistrations,
      eligibleCount,
      excludedCount,
      sentCount,
      failedCount,
      pendingCount,
      isRunning,
      activeState: activeCampaignState,
    };
  }

  async function previewRecipients({ page = 1, limit = 50, search = '' } = {}) {
    const query = getEligibleQuery();

    const cleanSearch = String(search || '').trim();
    if (cleanSearch) {
      const regex = new RegExp(cleanSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [{ fullName: regex }, { email: regex }, { whatsapp: regex }, { registrationId: regex }, { referenceId: regex }];
    }

    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 50));
    const skip = (safePage - 1) * safeLimit;

    const [totalMatching, eligibleRecords] = await Promise.all([
      registrationModel.countDocuments(query),
      registrationModel.find(query)
        .sort({ createdAt: 1 })
        .skip(skip)
        .limit(safeLimit)
        .select('fullName email whatsapp createdAt webinarId webinarVersion registrationId referenceId')
        .lean(),
    ]);

    const regIds = eligibleRecords.map(r => r._id);
    const deliveries = await deliveryModel.find({
      campaignId: CAMPAIGN_ID,
      registrationId: { $in: regIds },
    }).lean();

    const deliveryMap = new Map();
    deliveries.forEach(d => {
      deliveryMap.set(String(d.registrationId), d);
    });

    const enrichedRecords = eligibleRecords.map(record => {
      const delivery = deliveryMap.get(String(record._id));
      return {
        _id: record._id,
        fullName: record.fullName,
        email: record.email,
        whatsapp: record.whatsapp,
        createdAt: record.createdAt,
        webinarId: record.webinarId || WEBINAR_ID,
        webinarVersion: record.webinarVersion || 'November 1, 2026 Webinar',
        registrationId: record.registrationId || record.referenceId || String(record._id).slice(-8).toUpperCase(),
        deliveryStatus: delivery ? delivery.emailStatus : 'pending',
        sentAt: delivery?.sentAt || null,
        errorMessage: delivery?.errorMessage || null,
        attemptCount: delivery?.attemptCount || 0,
      };
    });

    const stats = await getCampaignStats();

    return {
      success: true,
      data: enrichedRecords,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total: totalMatching,
        totalPages: Math.ceil(totalMatching / safeLimit) || 1,
      },
      summary: stats,
    };
  }

  async function sendReminderEmails({ adminUser = 'admin', scope = 'pending', onProgress } = {}) {
    if (isRunning) {
      throw new Error('A November 1 webinar reminder campaign send is already in progress.');
    }

    isRunning = true;
    cancelRequested = false;

    try {
      const query = getEligibleQuery();
      const allEligible = await registrationModel.find(query)
        .sort({ createdAt: 1 })
        .select('fullName email whatsapp webinarId webinarVersion registrationId referenceId')
        .lean();

      // Retrieve existing delivery statuses
      const existingDeliveries = await deliveryModel.find({
        campaignId: CAMPAIGN_ID,
      }).lean();

      const deliveryMap = new Map();
      existingDeliveries.forEach(d => {
        deliveryMap.set(String(d.registrationId), d);
      });

      // Filter recipients based on scope
      let recipientsToSend = allEligible;
      if (scope === 'pending') {
        recipientsToSend = allEligible.filter(r => {
          const delivery = deliveryMap.get(String(r._id));
          return !delivery || delivery.emailStatus !== 'sent';
        });
      }

      const total = recipientsToSend.length;
      let processed = 0;
      let sent = 0;
      let failed = 0;
      let skipped = allEligible.length - total;

      activeCampaignState = {
        campaignId: CAMPAIGN_ID,
        adminUser,
        status: 'processing',
        total,
        processed: 0,
        sent: 0,
        failed: 0,
        skipped,
        startTime: new Date().toISOString(),
      };

      for (const recipient of recipientsToSend) {
        if (cancelRequested) {
          logger.info(`[REMINDER_CAMPAIGN] Send cancelled by admin request after ${processed}/${total} recipients.`);
          break;
        }

        const regIdStr = String(recipient._id);
        if (inFlightRecipients.has(regIdStr)) {
          continue;
        }

        inFlightRecipients.add(regIdStr);

        try {
          // Check again if already sent to prevent race conditions
          const existing = await deliveryModel.findOne({
            campaignId: CAMPAIGN_ID,
            registrationId: recipient._id,
          });

          if (existing && existing.emailStatus === 'sent') {
            skipped += 1;
            processed += 1;
            continue;
          }

          // Mark in-flight / pending
          let deliveryRecord = existing;
          if (!deliveryRecord) {
            deliveryRecord = await deliveryModel.create({
              campaignId: CAMPAIGN_ID,
              registrationId: recipient._id,
              referenceId: recipient.registrationId || recipient.referenceId || '',
              recipientEmail: recipient.email,
              recipientName: recipient.fullName || '',
              webinarId: recipient.webinarId || WEBINAR_ID,
              emailStatus: 'pending',
              lastAttemptAt: new Date(),
              attemptCount: 1,
            });
          } else {
            deliveryRecord.emailStatus = 'pending';
            deliveryRecord.lastAttemptAt = new Date();
            deliveryRecord.attemptCount = (deliveryRecord.attemptCount || 0) + 1;
            await deliveryRecord.save();
          }

          // Dispatch reminder email via SMTP transporter
          let sendResult;
          try {
            sendResult = await emailService.sendNovember1ReminderEmail(
              recipient.email,
              recipient.fullName
            );
          } catch (sendErr) {
            sendResult = { success: false, error: sendErr };
          }

          const isSuccess = Boolean(sendResult && (sendResult.success === true || sendResult.messageId || sendResult.id));

          if (isSuccess) {
            sent += 1;
            deliveryRecord.emailStatus = 'sent';
            deliveryRecord.sentAt = new Date();
            deliveryRecord.messageId = sendResult?.messageId || sendResult?.id || null;
            deliveryRecord.errorMessage = null;
            await deliveryRecord.save();

            // Mark registration record as reminder sent
            await registrationModel.findByIdAndUpdate(recipient._id, {
              $set: {
                reminderEmailSent: true,
                reminderEmailSentAt: new Date(),
                reminderEmailLastError: null,
              },
            }).catch(() => {});
          } else {
            failed += 1;
            const errorMsg = String(sendResult?.error?.message || sendResult?.message || 'SMTP delivery failed.').slice(0, 500);
            deliveryRecord.emailStatus = 'failed';
            deliveryRecord.errorMessage = errorMsg;
            await deliveryRecord.save();

            await registrationModel.findByIdAndUpdate(recipient._id, {
              $set: {
                reminderEmailLastError: errorMsg,
              },
            }).catch(() => {});
          }
        } catch (itemErr) {
          failed += 1;
          logger.error(`[REMINDER_CAMPAIGN] Delivery error for ${recipient.email}:`, itemErr);
        } finally {
          processed += 1;
          inFlightRecipients.delete(regIdStr);

          if (activeCampaignState) {
            activeCampaignState.processed = processed;
            activeCampaignState.sent = sent;
            activeCampaignState.failed = failed;
            activeCampaignState.skipped = skipped;
          }

          if (typeof onProgress === 'function') {
            onProgress({ processed, total, sent, failed, skipped });
          }

          // Pacing to avoid SMTP rate-limiting
          if (delayMs > 0 && processed < total && !cancelRequested) {
            await sleep(delayMs);
          }
        }
      }

      const finalStatus = cancelRequested ? 'cancelled' : 'completed';
      const result = {
        success: true,
        status: finalStatus,
        total,
        processed,
        sent,
        failed,
        skipped,
        message: cancelRequested
          ? `Reminder campaign send cancelled. Processed: ${processed}/${total}. Sent: ${sent}, Failed: ${failed}.`
          : `Reminder campaign send completed. Sent: ${sent}, Failed: ${failed}, Skipped: ${skipped}.`,
      };

      activeCampaignState = {
        ...activeCampaignState,
        status: finalStatus,
        endTime: new Date().toISOString(),
      };

      return result;
    } finally {
      isRunning = false;
      inFlightRecipients.clear();
    }
  }

  async function retryFailedReminderEmails({ adminUser = 'admin', onProgress } = {}) {
    if (isRunning) {
      throw new Error('A reminder campaign send or retry is already in progress.');
    }

    isRunning = true;
    cancelRequested = false;

    try {
      const failedDeliveries = await deliveryModel.find({
        campaignId: CAMPAIGN_ID,
        emailStatus: 'failed',
      }).populate('registrationId').lean();

      const total = failedDeliveries.length;
      let processed = 0;
      let sent = 0;
      let failed = 0;

      activeCampaignState = {
        campaignId: CAMPAIGN_ID,
        adminUser,
        status: 'retrying',
        total,
        processed: 0,
        sent: 0,
        failed: 0,
        startTime: new Date().toISOString(),
      };

      for (const delivery of failedDeliveries) {
        if (cancelRequested) break;

        const regIdStr = String(delivery.registrationId?._id || delivery.registrationId);
        if (inFlightRecipients.has(regIdStr)) continue;
        inFlightRecipients.add(regIdStr);

        try {
          const record = await deliveryModel.findById(delivery._id);
          if (!record || record.emailStatus === 'sent') {
            processed += 1;
            continue;
          }

          record.attemptCount = (record.attemptCount || 0) + 1;
          record.lastAttemptAt = new Date();

          let sendResult;
          try {
            sendResult = await emailService.sendNovember1ReminderEmail(
              delivery.recipientEmail,
              delivery.recipientName
            );
          } catch (sendErr) {
            sendResult = { success: false, error: sendErr };
          }

          const isSuccess = Boolean(sendResult && (sendResult.success === true || sendResult.messageId || sendResult.id));

          if (isSuccess) {
            sent += 1;
            record.emailStatus = 'sent';
            record.sentAt = new Date();
            record.messageId = sendResult?.messageId || sendResult?.id || null;
            record.errorMessage = null;
            await record.save();

            await registrationModel.findByIdAndUpdate(delivery.registrationId, {
              $set: {
                reminderEmailSent: true,
                reminderEmailSentAt: new Date(),
                reminderEmailLastError: null,
              },
            }).catch(() => {});
          } else {
            failed += 1;
            const errorMsg = String(sendResult?.error?.message || sendResult?.message || 'SMTP delivery failed on retry.').slice(0, 500);
            record.emailStatus = 'failed';
            record.errorMessage = errorMsg;
            await record.save();

            await registrationModel.findByIdAndUpdate(delivery.registrationId, {
              $set: {
                reminderEmailLastError: errorMsg,
              },
            }).catch(() => {});
          }
        } catch (itemErr) {
          failed += 1;
          logger.error(`[REMINDER_CAMPAIGN_RETRY] Retry error for ${delivery.recipientEmail}:`, itemErr);
        } finally {
          processed += 1;
          inFlightRecipients.delete(regIdStr);

          if (activeCampaignState) {
            activeCampaignState.processed = processed;
            activeCampaignState.sent = sent;
            activeCampaignState.failed = failed;
          }

          if (typeof onProgress === 'function') {
            onProgress({ processed, total, sent, failed });
          }

          if (delayMs > 0 && processed < total && !cancelRequested) {
            await sleep(delayMs);
          }
        }
      }

      return {
        success: true,
        status: cancelRequested ? 'cancelled' : 'completed',
        total,
        processed,
        sent,
        failed,
        message: `Retry completed. Re-sent: ${sent}, Still Failed: ${failed}.`,
      };
    } finally {
      isRunning = false;
      inFlightRecipients.clear();
    }
  }

  function getActiveCampaignStatus() {
    return {
      isRunning,
      activeState: activeCampaignState,
    };
  }

  function cancelCampaign() {
    if (!isRunning) return false;
    cancelRequested = true;
    return true;
  }

  return {
    CAMPAIGN_ID,
    WEBINAR_ID,
    getEligibleQuery,
    getCampaignStats,
    previewRecipients,
    sendReminderEmails,
    retryFailedReminderEmails,
    getActiveCampaignStatus,
    cancelCampaign,
  };
}

module.exports = {
  CAMPAIGN_ID,
  WEBINAR_ID,
  getEligibleQuery,
  createReminderCampaignService,
  defaultReminderCampaignService: createReminderCampaignService(),
};

