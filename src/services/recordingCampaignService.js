const mongoose = require('mongoose');
const WebinarRegistration = require('../models/WebinarRegistration');
const RecordingCampaignDelivery = require('../models/RecordingCampaignDelivery');
const defaultEmailService = require('./webinarEmailService');

const CAMPAIGN_ID = 'recording-halal-investment-retirement';
const DEFAULT_WEBINAR_ID = 'halal-wealth-nov-2026';
const PREVIOUS_WEBINAR_ID = 'halal-wealth-oct-2026';

// October 1, 2026, 00:00:00 IST = 2026-09-30T18:30:00.000Z
const OCT_START_IST = new Date('2026-10-01T00:00:00+05:30');
// November 1, 2026, 00:00:00 IST = 2026-10-31T18:30:00.000Z
const NOV_START_IST = new Date('2026-11-01T00:00:00+05:30');

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

function getEligibleQuery(webinarId = DEFAULT_WEBINAR_ID) {
  return {
    ...buildWebinarScope(webinarId),
    status: { $ne: 'Cancelled' },
  };
}

function createRecordingCampaignService({
  registrationModel = WebinarRegistration,
  deliveryModel = RecordingCampaignDelivery,
  emailService = defaultEmailService,
  delayMs = 600,
  logger = console,
} = {}) {
  let isRunning = false;
  let activeCampaignState = null;
  const inFlightRecipients = new Set();
  let cancelRequested = false;

  async function syncEligibleRegistrants({ webinarId = DEFAULT_WEBINAR_ID } = {}) {
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
        if (!bulkErr.message?.includes('duplicate key')) {
          logger.warn('[RECORDING_CAMPAIGN] bulkWrite warning during sync:', bulkErr.message);
        }
      }
    }

    return {
      synced: ops.length,
      total: eligibleRegistrations.length,
    };
  }

  async function getCampaignStats({ webinarId = DEFAULT_WEBINAR_ID } = {}) {
    await syncEligibleRegistrants({ webinarId });

    const query = getEligibleQuery(webinarId);
    let eligibleRegistrations = [];

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
      // Direct keys for frontend stat boxes
      total: totalEligible,
      pending: pendingCount,
      sent: sentCount,
      failed: failedCount,
      // Backward-compatible keys
      totalRegistrations: totalInDb,
      eligibleCount: totalEligible,
      excludedCount: Math.max(0, totalInDb - totalEligible),
      pendingCount,
      sentCount,
      failedCount,
      isRunning,
      activeState: activeCampaignState,
    };
  }

  async function previewRecipients({ page = 1, limit = 50, search = '', webinarId = DEFAULT_WEBINAR_ID } = {}) {
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

  async function sendIndividualRecordingEmail({ registrationId, forceResend = false, adminUser = 'admin' } = {}) {
    if (!registrationId) {
      throw new Error('registrationId is required for individual recording email dispatch.');
    }

    let registration = null;
    if (typeof registrationModel.findById === 'function') {
      const found = registrationModel.findById(registrationId);
      registration = (found && typeof found.lean === 'function') ? await found.lean() : await found;
    } else if (typeof registrationModel.findOne === 'function') {
      registration = await registrationModel.findOne({ _id: registrationId });
    }

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
        message: 'Recording email was already sent to this participant.',
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
      const sendResult = await emailService.sendRecordingEmail(
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
        message: `Recording email sent successfully to ${registration.email}.`,
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

  async function sendRecordingEmails({
    adminUser = 'admin',
    scope = 'pending',
    webinarId = DEFAULT_WEBINAR_ID,
    requestedDelayMs = null,
    onProgress,
  } = {}) {
    if (isRunning) {
      const error = new Error('A recording campaign email dispatch is already in progress.');
      error.code = 'CAMPAIGN_ALREADY_RUNNING';
      error.statusCode = 409;
      throw error;
    }

    isRunning = true;
    cancelRequested = false;
    const pace = requestedDelayMs !== null ? Number(requestedDelayMs) : delayMs;

    try {
      await syncEligibleRegistrants({ webinarId });

      const query = getEligibleQuery(webinarId);
      let allEligible = [];

      if (typeof registrationModel.find === 'function') {
        const q = registrationModel.find(query);
        if (q && typeof q.sort === 'function') {
          const sorted = q.sort({ createdAt: 1 });
          const selected = sorted.select ? sorted.select('fullName email whatsapp webinarId webinarVersion registrationId referenceId') : sorted;
          allEligible = (selected && typeof selected.lean === 'function') ? await selected.lean() : (await selected) || [];
        } else {
          allEligible = (await q) || [];
        }
      }

      const regIds = allEligible.map(r => normalizeId(r._id));

      const existingDeliveries = await deliveryModel.find({
        campaignId: CAMPAIGN_ID,
        registrationId: { $in: regIds },
      });
      const deliveriesList = (existingDeliveries && typeof existingDeliveries.lean === 'function')
        ? await existingDeliveries.lean()
        : (Array.isArray(existingDeliveries) ? existingDeliveries : []);

      const deliveryMap = new Map();
      deliveriesList.forEach(d => {
        deliveryMap.set(String(normalizeId(d.registrationId)), d);
      });

      let targets = allEligible;
      if (scope === 'pending') {
        targets = allEligible.filter(r => {
          const delivery = deliveryMap.get(String(normalizeId(r._id)));
          return !delivery || delivery.emailStatus !== 'sent';
        });
      } else if (scope === 'failed') {
        targets = allEligible.filter(r => {
          const delivery = deliveryMap.get(String(normalizeId(r._id)));
          return delivery && delivery.emailStatus === 'failed';
        });
      }

      const total = targets.length;
      let processed = 0;
      let accepted = 0;
      let failed = 0;
      let skipped = allEligible.length - total;

      activeCampaignState = {
        campaignId: CAMPAIGN_ID,
        adminUser,
        status: 'processing',
        webinarId,
        scope,
        total,
        processed: 0,
        accepted: 0,
        failed: 0,
        skipped,
        startTime: new Date().toISOString(),
      };

      if (total === 0) {
        activeCampaignState.status = 'completed';
        activeCampaignState.completedAt = new Date().toISOString();
        return {
          success: true,
          message: 'No recipients pending dispatch for this recording campaign.',
          state: activeCampaignState,
        };
      }

      for (const recipient of targets) {
        if (cancelRequested) {
          logger.info(`[RECORDING_CAMPAIGN] Send cancelled by admin request after ${processed}/${total} recipients.`);
          activeCampaignState.status = 'cancelled';
          activeCampaignState.completedAt = new Date().toISOString();
          break;
        }

        const normalizedRecipientId = normalizeId(recipient._id);
        const regIdStr = String(normalizedRecipientId);
        if (inFlightRecipients.has(regIdStr)) {
          continue;
        }

        inFlightRecipients.add(regIdStr);

        try {
          const existing = await deliveryModel.findOne({
            campaignId: CAMPAIGN_ID,
            registrationId: normalizedRecipientId,
          });

          if (existing && existing.emailStatus === 'sent') {
            skipped += 1;
            processed += 1;
            continue;
          }

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
              attemptCount: 0,
            });
          }

          deliveryRecord.lastAttemptAt = new Date();
          deliveryRecord.attemptCount = (deliveryRecord.attemptCount || 0) + 1;

          try {
            const sendResult = await emailService.sendRecordingEmail(
              recipient.email,
              recipient.fullName
            );

            const messageId = sendResult?.messageId || sendResult?.id || 'delivered';
            deliveryRecord.emailStatus = 'sent';
            deliveryRecord.sentAt = new Date();
            deliveryRecord.messageId = messageId;
            deliveryRecord.errorMessage = null;
            await deliveryRecord.save();

            accepted += 1;
          } catch (err) {
            deliveryRecord.emailStatus = 'failed';
            deliveryRecord.errorMessage = err?.message || 'SMTP transmission error';
            await deliveryRecord.save();

            failed += 1;
          }

          processed += 1;
          activeCampaignState.processed = processed;
          activeCampaignState.accepted = accepted;
          activeCampaignState.failed = failed;
          activeCampaignState.skipped = skipped;

          if (typeof onProgress === 'function') {
            onProgress({ ...activeCampaignState });
          }
        } finally {
          inFlightRecipients.delete(regIdStr);
        }

        if (pace > 0) {
          await sleep(pace);
        }
      }

      if (activeCampaignState.status !== 'cancelled') {
        activeCampaignState.status = 'completed';
        activeCampaignState.completedAt = new Date().toISOString();
      }

      return {
        success: true,
        message: `Campaign execution finished. ${accepted} accepted, ${failed} failed, ${skipped} skipped.`,
        state: activeCampaignState,
      };
    } finally {
      isRunning = false;
    }
  }

  async function retryFailedRecordingEmails(options = {}) {
    return sendRecordingEmails({ ...options, scope: 'failed' });
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
    DEFAULT_WEBINAR_ID,
    PREVIOUS_WEBINAR_ID,
    syncEligibleRegistrants,
    getEligibleQuery,
    getCampaignStats,
    previewRecipients,
    sendIndividualRecordingEmail,
    sendRecordingEmails,
    retryFailedRecordingEmails,
    getActiveCampaignStatus,
    cancelCampaign,
  };
}

module.exports = {
  CAMPAIGN_ID,
  DEFAULT_WEBINAR_ID,
  PREVIOUS_WEBINAR_ID,
  OCT_START_IST,
  NOV_START_IST,
  normalizeId,
  buildWebinarScope,
  getEligibleQuery,
  createRecordingCampaignService,
  defaultRecordingCampaignService: createRecordingCampaignService(),
};
