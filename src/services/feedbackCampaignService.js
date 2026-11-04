const mongoose = require('mongoose');
const WebinarRegistration = require('../models/WebinarRegistration');
const FeedbackCampaignDelivery = require('../models/FeedbackCampaignDelivery');
const defaultEmailService = require('./webinarEmailService');

const CAMPAIGN_ID = 'halal-wealth-feedback-2026';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeId(id) {
  if (!id) return '';
  if (id instanceof mongoose.Types.ObjectId) return id;
  if (typeof id === 'string') {
    if (/^[0-9a-fA-F]{24}$/.test(id)) {
      try { return new mongoose.Types.ObjectId(id); } catch (_) {}
    }
    return id;
  }
  if (typeof id === 'object') {
    const raw = id.oid || id.$oid;
    if (raw && /^[0-9a-fA-F]{24}$/.test(raw)) {
      try { return new mongoose.Types.ObjectId(raw); } catch (_) {}
    }
    if (typeof id.toString === 'function') {
      const str = id.toString();
      if (str && str !== '[object Object]' && /^[0-9a-fA-F]{24}$/.test(str)) {
        try { return new mongoose.Types.ObjectId(str); } catch (_) {}
      }
    }
  }
  return id;
}

function buildWebinarScope(webinarId) {
  if (!webinarId || webinarId === 'all') return {};
  const clean = String(webinarId).trim().toLowerCase();
  if (clean === 'halal-wealth-nov-2026' || clean.includes('november') || clean === 'nov1') {
    return {
      $or: [
        { webinarId: 'halal-wealth-nov-2026' },
        { webinarVersion: 'November 1, 2026 Webinar' },
      ],
    };
  }
  if (clean === 'halal-wealth-oct-2026' || clean.includes('october') || clean === 'previous') {
    return {
      $or: [
        { webinarId: 'halal-wealth-oct-2026' },
        { webinarVersion: 'October 2026 Webinar' },
        { webinarId: { $in: [null, undefined, ''] }, webinarVersion: { $nin: ['November 1, 2026 Webinar', 'Business Webinar 2026'] } },
      ],
    };
  }
  if (clean === 'business-webinar-2026' || clean.includes('business')) {
    return {
      $or: [
        { webinarId: 'business-webinar-2026' },
        { webinarVersion: 'Business Webinar 2026' },
      ],
    };
  }
  return { webinarId: clean };
}

function getEligibleQuery(webinarId = 'halal-wealth-nov-2026') {
  return {
    ...buildWebinarScope(webinarId),
    status: { $ne: 'Cancelled' },
  };
}

function createFeedbackCampaignService({
  registrationModel = WebinarRegistration,
  deliveryModel = FeedbackCampaignDelivery,
  emailService = defaultEmailService,
  delayMs = 600,
  logger = console,
} = {}) {
  let isRunning = false;
  let activeCampaignState = null;
  const inFlightRecipients = new Set();
  let cancelRequested = false;

  async function syncEligibleRegistrants({ webinarId = 'halal-wealth-nov-2026' } = {}) {
    const query = getEligibleQuery(webinarId);
    let eligibleRegistrations = [];

    if (typeof registrationModel.find === 'function') {
      const q = registrationModel.find(query);
      if (q && typeof q.sort === 'function') {
        const sorted = q.sort({ createdAt: 1 });
        const selected = (sorted && typeof sorted.select === 'function')
          ? sorted.select('_id fullName email whatsapp registrationId referenceId webinarId webinarVersion status')
          : sorted;
        eligibleRegistrations = (selected && typeof selected.lean === 'function') ? await selected.lean() : (await selected) || [];
      } else if (q && typeof q.select === 'function') {
        const sel = q.select('_id fullName email whatsapp registrationId referenceId webinarId webinarVersion status');
        eligibleRegistrations = (sel && typeof sel.lean === 'function') ? await sel.lean() : (await sel) || [];
      } else {
        const found = await q;
        eligibleRegistrations = (found && typeof found.lean === 'function') ? await found.lean() : (Array.isArray(found) ? found : []);
      }
    }

    if (!Array.isArray(eligibleRegistrations) || eligibleRegistrations.length === 0) {
      return { synced: 0, total: 0 };
    }

    const ops = [];
    for (const reg of eligibleRegistrations) {
      const rawEmail = String(reg.email || '').trim().toLowerCase();
      if (!rawEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
        continue;
      }

      const normalizedRegId = normalizeId(reg._id);

      ops.push({
        updateOne: {
          filter: {
            campaignId: CAMPAIGN_ID,
            registrationId: normalizedRegId,
          },
          update: {
            $setOnInsert: {
              campaignId: CAMPAIGN_ID,
              registrationId: normalizedRegId,
              referenceId: reg.referenceId || reg.registrationId || '',
              recipientEmail: rawEmail,
              recipientName: String(reg.fullName || '').trim() || 'Participant',
              webinarId: reg.webinarId || webinarId || '',
              webinarVersion: reg.webinarVersion || '',
              emailStatus: 'pending',
              attemptCount: 0,
              sentAt: null,
              lastAttemptAt: null,
              errorMessage: null,
              messageId: null,
            },
          },
          upsert: true,
        },
      });
    }

    if (ops.length > 0 && typeof deliveryModel.bulkWrite === 'function') {
      try {
        await deliveryModel.bulkWrite(ops, { ordered: false });
      } catch (bulkErr) {
        // Ignore duplicate key collision errors during concurrent upsert
        if (!bulkErr.message?.includes('duplicate key')) {
          logger.warn('[FEEDBACK_CAMPAIGN] bulkWrite warning during sync:', bulkErr.message);
        }
      }
    }

    return {
      synced: ops.length,
      total: eligibleRegistrations.length,
    };
  }

  async function getCampaignStats({ webinarId = 'halal-wealth-nov-2026' } = {}) {
    await syncEligibleRegistrants({ webinarId });

    const query = getEligibleQuery(webinarId);
    let eligibleRegistrations = [];
    let totalRegistrations = 0;

    if (typeof registrationModel.find === 'function') {
      const q = registrationModel.find(query);
      if (q && typeof q.sort === 'function') {
        const sorted = q.sort({ createdAt: 1 });
        const selected = (sorted && typeof sorted.select === 'function') ? sorted.select('_id') : sorted;
        eligibleRegistrations = (selected && typeof selected.lean === 'function') ? await selected.lean() : (await selected) || [];
      } else if (q && typeof q.select === 'function') {
        const sel = q.select('_id');
        eligibleRegistrations = (sel && typeof sel.lean === 'function') ? await sel.lean() : (await sel) || [];
      } else {
        const found = await q;
        eligibleRegistrations = (found && typeof found.lean === 'function') ? await found.lean() : (Array.isArray(found) ? found : []);
      }
    }

    let totalInDb = 0;
    if (typeof registrationModel.countDocuments === 'function') {
      totalInDb = await registrationModel.countDocuments();
    } else {
      totalInDb = eligibleRegistrations.length;
    }

    const totalEligible = eligibleRegistrations.length;
    const regIds = eligibleRegistrations.map(r => normalizeId(r._id));
    let sentCount = 0;
    let failedCount = 0;
    let pendingCount = 0;

    if (regIds.length > 0 && typeof deliveryModel.countDocuments === 'function') {
      const [sent, failed] = await Promise.all([
        deliveryModel.countDocuments({ campaignId: CAMPAIGN_ID, registrationId: { $in: regIds }, emailStatus: 'sent' }),
        deliveryModel.countDocuments({ campaignId: CAMPAIGN_ID, registrationId: { $in: regIds }, emailStatus: 'failed' }),
      ]);
      sentCount = sent;
      failedCount = failed;
      pendingCount = Math.max(0, totalEligible - sentCount - failedCount);
    } else if (regIds.length > 0 && typeof deliveryModel.find === 'function') {
      const dq = deliveryModel.find({ campaignId: CAMPAIGN_ID, registrationId: { $in: regIds } });
      const delivs = (dq && typeof dq.lean === 'function') ? await dq.lean() : (Array.isArray(dq) ? dq : []);
      sentCount = delivs.filter(d => d.emailStatus === 'sent').length;
      failedCount = delivs.filter(d => d.emailStatus === 'failed').length;
      pendingCount = Math.max(0, totalEligible - sentCount - failedCount);
    } else {
      pendingCount = totalEligible;
    }

    return {
      campaignId: CAMPAIGN_ID,
      webinarId,
      // Direct keys for frontend
      total: totalEligible,
      pending: pendingCount,
      sent: sentCount,
      failed: failedCount,
      // Backward-compatible keys
      totalRegistrations: totalInDb,
      eligibleCount: totalEligible,
      pendingCount,
      sentCount,
      failedCount,
      isRunning,
      activeState: activeCampaignState,
    };
  }

  async function previewRecipients({ page = 1, limit = 50, search = '', webinarId = 'halal-wealth-nov-2026' } = {}) {
    await syncEligibleRegistrants({ webinarId });

    const query = getEligibleQuery(webinarId);

    const cleanSearch = String(search || '').trim();
    if (cleanSearch) {
      const regex = new RegExp(cleanSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [
        { fullName: regex },
        { email: regex },
        { whatsapp: regex },
        { registrationId: regex },
        { referenceId: regex },
      ];
    }

    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 50));
    const skip = (safePage - 1) * safeLimit;

    let totalMatching = 0;
    let eligibleRecords = [];

    if (typeof registrationModel.countDocuments === 'function') {
      totalMatching = await registrationModel.countDocuments(query);
    }

    if (typeof registrationModel.find === 'function') {
      const q = registrationModel.find(query);
      if (q && typeof q.sort === 'function') {
        const sorted = q.sort({ createdAt: 1 });
        const skipped = sorted.skip ? sorted.skip(skip) : sorted;
        const limited = skipped.limit ? skipped.limit(safeLimit) : skipped;
        const selected = limited.select ? limited.select('fullName email whatsapp createdAt webinarId webinarVersion registrationId referenceId') : limited;
        eligibleRecords = (selected.lean ? await selected.lean() : await selected) || [];
      } else {
        eligibleRecords = (await q) || [];
      }
    }

    if (totalMatching === 0 && eligibleRecords.length > 0) {
      totalMatching = eligibleRecords.length;
    }

    const regIds = eligibleRecords.map(r => normalizeId(r._id));
    let deliveries = [];
    if (regIds.length > 0 && typeof deliveryModel.find === 'function') {
      const dq = deliveryModel.find({
        campaignId: CAMPAIGN_ID,
        registrationId: { $in: regIds },
      });
      deliveries = (dq && typeof dq.lean === 'function') ? await dq.lean() : (Array.isArray(dq) ? dq : []);
    }

    const deliveryMap = new Map();
    deliveries.forEach(d => {
      deliveryMap.set(String(normalizeId(d.registrationId)), d);
    });

    const enrichedRecords = eligibleRecords.map(record => {
      const delivery = deliveryMap.get(String(normalizeId(record._id)));
      return {
        _id: record._id,
        fullName: record.fullName,
        email: record.email,
        whatsapp: record.whatsapp,
        createdAt: record.createdAt,
        webinarId: record.webinarId || webinarId || '',
        webinarVersion: record.webinarVersion || 'Webinar Participant',
        registrationId: record.registrationId || record.referenceId || String(record._id).slice(-8).toUpperCase(),
        deliveryStatus: delivery ? delivery.emailStatus : 'pending',
        sentAt: delivery?.sentAt || null,
        errorMessage: delivery?.errorMessage || null,
        attemptCount: delivery?.attemptCount || 0,
        messageId: delivery?.messageId || null,
      };
    });

    const stats = await getCampaignStats({ webinarId });
    const totalPages = Math.ceil(totalMatching / safeLimit) || 1;

    return {
      success: true,
      data: enrichedRecords,
      recipients: enrichedRecords,
      page: safePage,
      limit: safeLimit,
      total: totalMatching,
      pages: totalPages,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total: totalMatching,
        totalPages,
      },
      summary: stats,
    };
  }

  async function sendIndividualFeedbackEmail({ registrationId, forceResend = false, adminUser = 'admin' } = {}) {
    if (!registrationId) {
      throw new Error('registrationId is required for individual feedback email dispatch.');
    }

    const registration = await registrationModel.findById(registrationId).lean();
    if (!registration) {
      throw new Error(`Participant registration not found for ID ${registrationId}.`);
    }

    const normalizedRegId = normalizeId(registration._id);

    let delivery = await deliveryModel.findOne({
      campaignId: CAMPAIGN_ID,
      registrationId: normalizedRegId,
    });

    if (delivery && delivery.emailStatus === 'sent' && !forceResend) {
      return {
        success: true,
        alreadySent: true,
        message: 'Feedback email was already sent to this participant.',
        delivery,
      };
    }

    if (!delivery) {
      delivery = await deliveryModel.create({
        campaignId: CAMPAIGN_ID,
        registrationId: normalizedRegId,
        referenceId: registration.registrationId || registration.referenceId || '',
        recipientEmail: registration.email,
        recipientName: registration.fullName || '',
        webinarId: registration.webinarId || '',
        webinarVersion: registration.webinarVersion || '',
        emailStatus: 'pending',
        attemptCount: 0,
      });
    }

    delivery.lastAttemptAt = new Date();
    delivery.attemptCount = (delivery.attemptCount || 0) + 1;

    try {
      const sendResult = await emailService.sendFeedbackCampaignEmail(
        registration.email,
        registration.fullName
      );

      const messageId = sendResult?.messageId || sendResult?.id || 'delivered';
      delivery.emailStatus = 'sent';
      delivery.sentAt = new Date();
      delivery.messageId = messageId;
      delivery.errorMessage = null;
      await delivery.save();

      return {
        success: true,
        alreadySent: false,
        message: `Feedback email sent successfully to ${registration.email}.`,
        messageId,
        delivery,
      };
    } catch (err) {
      delivery.emailStatus = 'failed';
      delivery.errorMessage = err?.message || 'SMTP transmission error';
      await delivery.save();

      throw err;
    }
  }

  async function sendFeedbackEmails({ adminUser = 'admin', scope = 'pending', webinarId = 'halal-wealth-nov-2026', onProgress } = {}) {
    if (isRunning) {
      throw new Error('A feedback email campaign send is already in progress.');
    }

    isRunning = true;
    cancelRequested = false;

    try {
      await syncEligibleRegistrants({ webinarId });

      const query = getEligibleQuery(webinarId);
      const allEligible = await registrationModel.find(query)
        .sort({ createdAt: 1 })
        .select('fullName email whatsapp webinarId webinarVersion registrationId referenceId')
        .lean();

      const regIds = allEligible.map(r => normalizeId(r._id));

      // Retrieve existing delivery statuses for these registrations
      const existingDeliveries = await deliveryModel.find({
        campaignId: CAMPAIGN_ID,
        registrationId: { $in: regIds },
      }).lean();

      const deliveryMap = new Map();
      existingDeliveries.forEach(d => {
        deliveryMap.set(String(normalizeId(d.registrationId)), d);
      });

      // Filter recipients: send to pending or failed (never resend already sent)
      let recipientsToSend = allEligible;
      if (scope === 'pending') {
        recipientsToSend = allEligible.filter(r => {
          const delivery = deliveryMap.get(String(normalizeId(r._id)));
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
        webinarId,
        total,
        processed: 0,
        sent: 0,
        failed: 0,
        skipped,
        startTime: new Date().toISOString(),
      };

      for (const recipient of recipientsToSend) {
        if (cancelRequested) {
          logger.info(`[FEEDBACK_CAMPAIGN] Send cancelled by admin request after ${processed}/${total} recipients.`);
          break;
        }

        const normalizedRecipientId = normalizeId(recipient._id);
        const regIdStr = String(normalizedRecipientId);
        if (inFlightRecipients.has(regIdStr)) {
          continue;
        }

        inFlightRecipients.add(regIdStr);

        try {
          // Check again if already sent to prevent race conditions
          const existing = await deliveryModel.findOne({
            campaignId: CAMPAIGN_ID,
            registrationId: normalizedRecipientId,
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
              registrationId: normalizedRecipientId,
              referenceId: recipient.registrationId || recipient.referenceId || '',
              recipientEmail: recipient.email,
              recipientName: recipient.fullName || '',
              webinarId: recipient.webinarId || webinarId || '',
              webinarVersion: recipient.webinarVersion || '',
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

          // Dispatch feedback email via SMTP transporter with embedded poster
          let sendResult;
          try {
            sendResult = await emailService.sendFeedbackCampaignEmail(
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
          } else {
            failed += 1;
            const errMsg = sendResult?.error?.message || 'SMTP delivery rejected or timed out.';
            deliveryRecord.emailStatus = 'failed';
            deliveryRecord.errorMessage = errMsg;
            await deliveryRecord.save();
          }
        } catch (itemErr) {
          failed += 1;
          logger.error(`[FEEDBACK_CAMPAIGN] Delivery error for ${recipient.email}:`, itemErr.message);
          try {
            await deliveryModel.findOneAndUpdate(
              { campaignId: CAMPAIGN_ID, registrationId: normalizedRecipientId },
              {
                $set: {
                  emailStatus: 'failed',
                  errorMessage: itemErr.message,
                  lastAttemptAt: new Date(),
                },
                $inc: { attemptCount: 1 },
              },
              { upsert: true }
            );
          } catch (_) {}
        } finally {
          inFlightRecipients.delete(regIdStr);
          processed += 1;

          activeCampaignState.processed = processed;
          activeCampaignState.sent = sent;
          activeCampaignState.failed = failed;

          if (typeof onProgress === 'function') {
            onProgress({ total, processed, sent, failed, skipped });
          }

          // Artificial delay between emails to pace SMTP delivery
          if (processed < total && delayMs > 0 && !cancelRequested) {
            await sleep(delayMs);
          }
        }
      }

      activeCampaignState.status = cancelRequested ? 'cancelled' : 'completed';
      activeCampaignState.endTime = new Date().toISOString();

      return {
        success: true,
        status: activeCampaignState.status,
        total,
        processed,
        sent,
        failed,
        skipped,
        message: `Feedback campaign finished. Sent: ${sent}, Failed: ${failed}, Skipped: ${skipped}.`,
      };
    } finally {
      isRunning = false;
      inFlightRecipients.clear();
    }
  }

  async function retryFailedFeedbackEmails({ adminUser = 'admin', webinarId = 'halal-wealth-nov-2026' } = {}) {
    if (isRunning) {
      throw new Error('A feedback campaign send or retry is already in progress.');
    }

    isRunning = true;
    cancelRequested = false;

    try {
      const query = getEligibleQuery(webinarId);
      let allEligible = [];
      const q = registrationModel.find(query);
      if (q && typeof q.sort === 'function') {
        const sorted = q.sort({ createdAt: 1 });
        const selected = (sorted && typeof sorted.select === 'function') ? sorted.select('_id') : sorted;
        allEligible = (selected && typeof selected.lean === 'function') ? await selected.lean() : (await selected) || [];
      } else if (q && typeof q.select === 'function') {
        const sel = q.select('_id');
        allEligible = (sel && typeof sel.lean === 'function') ? await sel.lean() : (await sel) || [];
      } else {
        const found = await q;
        allEligible = (found && typeof found.lean === 'function') ? await found.lean() : (Array.isArray(found) ? found : []);
      }
      const regIds = allEligible.map(r => normalizeId(r._id));

      const failedDeliveries = await deliveryModel.find({
        campaignId: CAMPAIGN_ID,
        registrationId: { $in: regIds },
        emailStatus: 'failed',
      }).lean();

      const total = failedDeliveries.length;
      let processed = 0;
      let sent = 0;
      let failed = 0;

      activeCampaignState = {
        campaignId: CAMPAIGN_ID,
        adminUser,
        status: 'retrying',
        webinarId,
        total,
        processed: 0,
        sent: 0,
        failed: 0,
        skipped: 0,
        startTime: new Date().toISOString(),
      };

      for (const item of failedDeliveries) {
        if (cancelRequested) break;

        const regIdStr = String(item.registrationId);
        inFlightRecipients.add(regIdStr);

        try {
          let sendResult;
          try {
            sendResult = await emailService.sendFeedbackCampaignEmail(
              item.recipientEmail,
              item.recipientName
            );
          } catch (sendErr) {
            sendResult = { success: false, error: sendErr };
          }

          const isSuccess = Boolean(sendResult && (sendResult.success === true || sendResult.messageId || sendResult.id));

          if (isSuccess) {
            sent += 1;
            await deliveryModel.findByIdAndUpdate(item._id, {
              $set: {
                emailStatus: 'sent',
                sentAt: new Date(),
                messageId: sendResult?.messageId || sendResult?.id || null,
                errorMessage: null,
                lastAttemptAt: new Date(),
              },
              $inc: { attemptCount: 1 },
            });
          } else {
            failed += 1;
            await deliveryModel.findByIdAndUpdate(item._id, {
              $set: {
                emailStatus: 'failed',
                errorMessage: sendResult?.error?.message || 'SMTP transmission failure during retry',
                lastAttemptAt: new Date(),
              },
              $inc: { attemptCount: 1 },
            });
          }
        } catch (itemErr) {
          failed += 1;
          await deliveryModel.findByIdAndUpdate(item._id, {
            $set: {
              emailStatus: 'failed',
              errorMessage: itemErr.message,
              lastAttemptAt: new Date(),
            },
            $inc: { attemptCount: 1 },
          });
        } finally {
          inFlightRecipients.delete(regIdStr);
          processed += 1;
          activeCampaignState.processed = processed;
          activeCampaignState.sent = sent;
          activeCampaignState.failed = failed;

          if (processed < total && delayMs > 0 && !cancelRequested) {
            await sleep(delayMs);
          }
        }
      }

      activeCampaignState.status = cancelRequested ? 'cancelled' : 'completed';
      activeCampaignState.endTime = new Date().toISOString();

      return {
        success: true,
        status: activeCampaignState.status,
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
    buildWebinarScope,
    getEligibleQuery,
    syncEligibleRegistrants,
    getCampaignStats,
    previewRecipients,
    sendIndividualFeedbackEmail,
    sendFeedbackEmails,
    retryFailedFeedbackEmails,
    getActiveCampaignStatus,
    cancelCampaign,
  };
}

module.exports = {
  CAMPAIGN_ID,
  buildWebinarScope,
  getEligibleQuery,
  createFeedbackCampaignService,
  defaultFeedbackCampaignService: createFeedbackCampaignService(),
};
