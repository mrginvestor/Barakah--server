const { once } = require('node:events');
const mongoose = require('mongoose');
const WebinarRegistration = require('../models/WebinarRegistration');
const Webinar = require('../models/Webinar');

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

function getWebinarTargetFilter(req = {}) {
  const targetWebinar = req.body?.webinarId || req.query?.webinarId;
  return buildWebinarScope(targetWebinar);
}

function filterRegistrationsByWebinar(registrations = [], targetWebinar) {
  if (!targetWebinar || targetWebinar === 'all') return registrations;
  const clean = String(targetWebinar).trim().toLowerCase();
  return registrations.filter(reg => {
    const regWid = String(reg.webinarId || '').trim().toLowerCase();
    const regVer = String(reg.webinarVersion || '').trim().toLowerCase();
    if (clean === 'halal-wealth-nov-2026' || clean.includes('november') || clean === 'nov1') {
      return regWid === 'halal-wealth-nov-2026' || regVer.includes('november');
    }
    if (clean === 'halal-wealth-oct-2026' || clean.includes('october') || clean === 'previous') {
      return regWid === 'halal-wealth-oct-2026' || regVer.includes('october') || (!regVer.includes('november') && !regVer.includes('business'));
    }
    if (clean === 'business-webinar-2026' || clean.includes('business')) {
      return regWid === 'business-webinar-2026' || regVer.includes('business');
    }
    return regWid === clean;
  });
}
const CampaignConfig = require('../models/CampaignConfig');
const webinarEmailService = require('../services/webinarEmailService');
const { defaultBulkEmailService } = require('../services/bulkEmailService');

const FEEDBACK_CAMPAIGN_KEY = 'post_webinar_feedback';
const REGISTRATION_STATUSES = ['Registered', 'Confirmed', 'Attended', 'Cancelled'];
const PAGE_SIZES = [10, 25, 50];

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseDate(value, endOfDay = false) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return undefined;
  if (endOfDay) date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

function buildRegistrationFilter(query = {}) {
  const filter = {};
  const search = String(query.q || '').trim().slice(0, 200);
  if (search) {
    const expression = new RegExp(escapeRegex(search), 'i');
    filter.$or = ['fullName', 'email', 'whatsapp', 'location', 'designation', 'industry', 'webinarSource', 'financialChallenge']
      .map(field => ({ [field]: expression }));
  }

  if (query.status) {
    if (!REGISTRATION_STATUSES.includes(query.status)) throw new Error('Invalid registration status.');
    filter.status = query.status === 'Registered' ? { $in: ['Registered', 'New', null] } : query.status;
  }

  if (query.emailStatus && query.emailStatus !== 'all') {
    const cleanEmailStatus = String(query.emailStatus).trim().toLowerCase();
    if (['pending', 'accepted', 'delivered', 'failed', 'bounced'].includes(cleanEmailStatus)) {
      filter.emailStatus = cleanEmailStatus;
    } else if (cleanEmailStatus === 'delivery_unknown' || cleanEmailStatus === 'unknown') {
      filter.$or = [
        { emailStatus: 'delivery_unknown' },
        { emailStatus: null },
        { emailStatus: { $exists: false } },
      ];
    } else {
      throw new Error('Invalid email status filter.');
    }
  }

  if (query.webinarId && query.webinarId !== 'all') {
    const wid = String(query.webinarId).trim().toLowerCase();
    if (wid === 'halal-wealth-nov-2026' || wid.includes('november') || wid === 'nov1') {
      filter.webinarId = 'halal-wealth-nov-2026';
    } else if (wid === 'halal-wealth-oct-2026' || wid.includes('october') || wid === 'previous') {
      filter.webinarId = 'halal-wealth-oct-2026';
    } else {
      filter.webinarId = wid;
    }
  } else if (query.edition || query.webinarVersion) {
    const edition = String(query.edition || query.webinarVersion).trim().toLowerCase();
    if (edition.includes('november') || edition === 'nov1') {
      filter.webinarVersion = 'November 1, 2026 Webinar';
    } else if (edition.includes('business')) {
      filter.webinarVersion = 'Business Webinar 2026';
    } else if (edition.includes('october') || edition === 'previous') {
      filter.webinarVersion = { $nin: ['November 1, 2026 Webinar', 'Business Webinar 2026'] };
    }
  }

  const from = parseDate(String(query.from || ''));
  const to = parseDate(String(query.to || ''), true);
  if (from === undefined || to === undefined) throw new Error('Invalid date filter.');
  if (from && to && from >= to) throw new Error('The start date must not be after the end date.');
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = from;
    if (to) filter.createdAt.$lt = to;
  }
  return filter;
}

function normalizeStatus(registration) {
  if (registration.status === 'New' || !registration.status) return { ...registration, status: 'Registered' };
  return registration;
}

function normalizeEmailStatus(registration = {}) {
  if (registration.confirmationEmailSent === true) return 'Sent';
  if (registration.confirmationEmailLastError) return 'Failed';
  return 'Not Sent';
}

function normalizeAnnouncementStatus(registration = {}) {
  if (registration.announcementEmailSent === true) return 'Sent';
  if (registration.announcementEmailLastError) return 'Failed';
  return 'Not Sent';
}

function normalizeJoiningStatus(registration = {}) {
  if (registration.joiningEmailSent === true) return 'Sent';
  if (registration.joiningEmailLastError) return 'Failed';
  return 'Not Sent';
}

function normalizeFeedbackStatus(registration = {}) {
  if (registration.feedbackEmailSent === true) return 'Sent';
  if (registration.feedbackEmailLastError) return 'Failed';
  return 'Not Sent';
}

function normalizeEmailTracking(registration = {}) {
  const normalized = { ...registration };
  if (normalized._id && typeof normalized._id === 'object') {
    if (normalized._id.oid) normalized._id = String(normalized._id.oid);
    else if (normalized._id.$oid) normalized._id = String(normalized._id.$oid);
  }
  if (!normalized.registrationId && normalized._id && typeof normalized._id === 'string') {
    normalized.registrationId = normalized._id;
  }
  normalized.referenceId = normalized.referenceId || normalized.registrationId || (normalized._id ? String(normalized._id) : '');
  if (normalized.createdAt && typeof normalized.createdAt === 'object') {
    if (normalized.createdAt.date) normalized.createdAt = new Date(normalized.createdAt.date);
    else if (normalized.createdAt.$date) normalized.createdAt = new Date(normalized.createdAt.$date);
  }
  normalized.companyName = normalized.companyName || '';
  normalized.businessWebsite = normalized.businessWebsite || '';
  normalized.country = normalized.country || '';
  normalized.city = normalized.city || '';
  normalized.additionalInfo = normalized.additionalInfo || normalized.financialChallenge || '';
  normalized.state = normalized.state || '';
  normalized.ageGroup = normalized.ageGroup || '';
  normalized.otherAgeGroup = normalized.otherAgeGroup || '';
  normalized.occupation = normalized.occupation || normalized.designation || '';
  normalized.otherOccupation = normalized.otherOccupation || '';
  normalized.otherWebinarSource = normalized.otherWebinarSource || '';
  normalized.questionsOrTopics = normalized.questionsOrTopics || normalized.additionalInfo || normalized.financialChallenge || '';
  normalized.state = normalized.state || '';
  normalized.ageGroup = normalized.ageGroup || '';
  normalized.otherAgeGroup = normalized.otherAgeGroup || '';
  normalized.occupation = normalized.occupation || normalized.designation || '';
  normalized.otherOccupation = normalized.otherOccupation || '';
  normalized.otherWebinarSource = normalized.otherWebinarSource || '';
  normalized.questionsOrTopics = normalized.questionsOrTopics || normalized.additionalInfo || normalized.financialChallenge || '';
  normalized.webinarVersion = normalized.webinarVersion || 'October 2026 Webinar';
  normalized.confirmationEmailSent = normalized.confirmationEmailSent === true;
  normalized.confirmationEmailSentAt = normalized.confirmationEmailSentAt || null;
  normalized.confirmationEmailLastError = normalized.confirmationEmailLastError || null;
  normalized.announcementEmailSent = normalized.announcementEmailSent === true;
  normalized.announcementEmailSentAt = normalized.announcementEmailSentAt || null;
  normalized.announcementEmailLastError = normalized.announcementEmailLastError || null;
  normalized.joiningEmailSent = normalized.joiningEmailSent === true;
  normalized.joiningEmailSentAt = normalized.joiningEmailSentAt || null;
  normalized.joiningEmailLastError = normalized.joiningEmailLastError || null;
  normalized.reminderEmailSent = normalized.reminderEmailSent === true;
  normalized.reminderEmailSentAt = normalized.reminderEmailSentAt || null;
  normalized.reminderEmailLastError = normalized.reminderEmailLastError || null;
  normalized.feedbackEmailSent = normalized.feedbackEmailSent === true;
  normalized.feedbackEmailSentAt = normalized.feedbackEmailSentAt || null;
  normalized.feedbackEmailLastError = normalized.feedbackEmailLastError || null;

  const validTrackingStatuses = ['pending', 'accepted', 'delivered', 'failed', 'bounced', 'delivery_unknown'];
  let resolvedEmailStatus = normalized.emailStatus;
  if (!resolvedEmailStatus || !validTrackingStatuses.includes(resolvedEmailStatus)) {
    if (resolvedEmailStatus === 'Sent' || normalized.confirmationEmailSent === true) {
      resolvedEmailStatus = 'delivery_unknown';
    } else if (resolvedEmailStatus === 'Failed' || normalized.confirmationEmailLastError) {
      resolvedEmailStatus = 'failed';
    } else {
      resolvedEmailStatus = 'pending';
    }
  }
  normalized.emailStatus = resolvedEmailStatus;
  normalized.emailMessageId = normalized.emailMessageId || null;
  normalized.emailLastAttemptAt = normalized.emailLastAttemptAt || normalized.confirmationEmailSentAt || null;
  normalized.emailDeliveredAt = normalized.emailDeliveredAt || null;
  normalized.emailAttemptCount = typeof normalized.emailAttemptCount === 'number'
    ? normalized.emailAttemptCount
    : (normalized.confirmationEmailSent ? 1 : 0);
  normalized.emailLastError = normalized.emailLastError || normalized.confirmationEmailLastError || null;
  normalized.emailProvider = normalized.emailProvider || null;

  normalized.announcementEmailStatus = normalizeAnnouncementStatus(normalized);
  normalized.joiningEmailStatus = normalizeJoiningStatus(normalized);
  normalized.feedbackEmailStatus = normalizeFeedbackStatus(normalized);
  return normalized;
}

function maybeLean(value) {
  if (!value) return value;
  if (typeof value.lean === 'function') return value.lean();
  if (typeof value.toObject === 'function') return value.toObject();
  return value;
}

function csvCell(value) {
  let text = value instanceof Date ? value.toISOString() : Array.isArray(value) ? value.join('; ') : value == null ? '' : String(value);
  if (/^[\t\r ]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function createAdminRegistrationController({
  registrationModel = WebinarRegistration,
  logger = console,
  emailService = webinarEmailService,
  campaignConfigModel = CampaignConfig,
  webinarModel = Webinar,
  bulkEmailService = defaultBulkEmailService,
} = {}) {
  const safeLogger = {
    ...console,
    ...logger,
  };
  if (typeof safeLogger.info !== 'function') safeLogger.info = () => {};
  if (typeof safeLogger.error !== 'function') safeLogger.error = () => {};

  const inFlightSends = new Set();

  function isValidId(id) {
    if (!id || typeof id !== 'string' || id === '[object Object]' || id.includes('[object')) return false;
    return mongoose.isValidObjectId(id) || /^[a-zA-Z0-9_-]+$/.test(id);
  }

  function buildRecordLookup(id) {
    const rawId = (typeof id === 'object' && id !== null && id.oid) ? String(id.oid) : id;
    const conditions = [];
    if (typeof rawId === 'string' && mongoose.isValidObjectId(rawId)) {
      try { conditions.push({ _id: new mongoose.Types.ObjectId(rawId) }); } catch (_) {}
    }
    conditions.push(
      { _id: rawId },
      { registrationId: rawId },
      { referenceId: rawId },
    );
    return conditions.length === 1 ? conditions[0] : { $or: conditions };
  }

  async function findRegistrationRecord(id) {
    if (!id) return null;
    const lookup = buildRecordLookup(id);
    if (typeof registrationModel.findOne === 'function') {
      try {
        const doc = await registrationModel.findOne(lookup);
        if (doc) return maybeLean(doc);
      } catch (_) {}
    }
    if (typeof registrationModel.findById === 'function') {
      try {
        const doc = await registrationModel.findById(id);
        if (doc) return maybeLean(doc);
      } catch (_) {}
    }
    if (registrationModel.collection) {
      try {
        const rawId = (typeof id === 'object' && id !== null && id.oid) ? String(id.oid) : id;
        const raw = await registrationModel.collection.findOne({
          $or: [
            { _id: typeof id === 'object' ? id : { oid: rawId } },
            { _id: rawId },
            { registrationId: rawId },
            { referenceId: rawId },
            { email: rawId },
          ],
        });
        if (raw) return raw;
      } catch (_) {}
    }
    return null;
  }

  async function updateRegistrationRecord(id, update, fallbackDoc = null) {
    const lookup = buildRecordLookup(id);
    const updateOp = (update && typeof update === 'object' && Object.keys(update).some(k => k.startsWith('$')))
      ? update
      : { $set: update };
    if (typeof registrationModel.findOneAndUpdate === 'function') {
      try {
        const updated = await registrationModel.findOneAndUpdate(
          lookup,
          updateOp,
          { new: true, runValidators: true },
        );
        if (updated) return maybeLean(updated);
      } catch (_) {}
    }
    if (typeof registrationModel.findByIdAndUpdate === 'function') {
      try {
        const updated = await registrationModel.findByIdAndUpdate(
          id,
          updateOp,
          { new: true, runValidators: true },
        );
        if (updated) return maybeLean(updated);
      } catch (_) {}
    }
    if (registrationModel.collection) {
      try {
        const rawId = (typeof id === 'object' && id !== null && id.oid) ? String(id.oid) : id;
        const filter = {
          $or: [
            { _id: typeof id === 'object' ? id : { oid: rawId } },
            { _id: rawId },
            { registrationId: rawId },
            { referenceId: rawId },
            ...(fallbackDoc?.email ? [{ email: fallbackDoc.email }] : []),
          ],
        };
        await registrationModel.collection.updateOne(filter, updateOp);
        const refreshed = await registrationModel.collection.findOne(filter);
        if (refreshed) return refreshed;
      } catch (_) {}
    }
    return null;
  }

  async function list(req, res) {
    try {
      const filter = buildRegistrationFilter(req.query);
      const requestedPage = Number.parseInt(req.query.page, 10);
      const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
      const requestedLimit = Number.parseInt(req.query.limit, 10);
      const limit = PAGE_SIZES.includes(requestedLimit) ? requestedLimit : PAGE_SIZES[0];
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      const effectiveStatus = { $ifNull: ['$status', 'Registered'] };
      const normalizedStatus = { $cond: [{ $eq: [effectiveStatus, 'New'] }, 'Registered', effectiveStatus] };

      const webinarScope = {};
      if (req.query.webinarId && req.query.webinarId !== 'all') {
        const wid = String(req.query.webinarId).trim().toLowerCase();
        if (wid === 'halal-wealth-nov-2026' || wid.includes('november') || wid === 'nov1') {
          webinarScope.webinarId = 'halal-wealth-nov-2026';
        } else if (wid === 'halal-wealth-oct-2026' || wid.includes('october') || wid === 'previous') {
          webinarScope.webinarId = 'halal-wealth-oct-2026';
        } else {
          webinarScope.webinarId = wid;
        }
      } else if (req.query.edition || req.query.webinarVersion) {
        const edition = String(req.query.edition || req.query.webinarVersion).trim().toLowerCase();
        if (edition.includes('november') || edition === 'nov1') {
          webinarScope.webinarVersion = 'November 1, 2026 Webinar';
        } else if (edition.includes('october') || edition === 'previous') {
          webinarScope.webinarVersion = { $nin: ['November 1, 2026 Webinar', 'Business Webinar 2026'] };
        }
      }

      const summaryMatch = Object.keys(webinarScope).length > 0 ? [{ $match: webinarScope }] : [];
      const [result = {}] = await registrationModel.aggregate([
        {
          $facet: {
            data: [
              { $match: filter },
              { $sort: { createdAt: -1, _id: -1 } },
              { $skip: (page - 1) * limit },
              { $limit: limit },
              { $addFields: { status: normalizedStatus } },
            ],
            filteredTotal: [{ $match: filter }, { $count: 'count' }],
            summary: [
              ...summaryMatch,
              {
              $group: {
                _id: null,
                total: { $sum: 1 },
                today: { $sum: { $cond: [{ $gte: ['$createdAt', today] }, 1, 0] } },
                verified: { $sum: { $cond: [{ $eq: [normalizedStatus, 'Confirmed'] }, 1, 0] } },
                pending: { $sum: { $cond: [{ $eq: [normalizedStatus, 'Registered'] }, 1, 0] } },
                joiningSent: { $sum: { $cond: [{ $eq: ['$joiningEmailSent', true] }, 1, 0] } },
                joiningPending: { $sum: { $cond: [{ $and: [{ $ne: ['$joiningEmailSent', true] }, { $eq: [{ $ifNull: ['$joiningEmailLastError', null] }, null] }] }, 1, 0] } },
                joiningFailed: { $sum: { $cond: [{ $and: [{ $ne: ['$joiningEmailSent', true] }, { $ne: [{ $ifNull: ['$joiningEmailLastError', null] }, null] }] }, 1, 0] } },
                deliveredEmails: { $sum: { $cond: [{ $eq: ['$emailStatus', 'delivered'] }, 1, 0] } },
                acceptedEmails: { $sum: { $cond: [{ $eq: ['$emailStatus', 'accepted'] }, 1, 0] } },
                failedEmails: { $sum: { $cond: [{ $in: ['$emailStatus', ['failed', 'bounced']] }, 1, 0] } },
                pendingOrUnknownEmails: {
                  $sum: {
                    $cond: [
                      {
                        $or: [
                          { $in: [{ $ifNull: ['$emailStatus', 'pending'] }, ['pending', 'delivery_unknown']] },
                          { $eq: [{ $ifNull: ['$emailStatus', null] }, null] },
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                },
              },
            }],
          },
        },
      ]);
      const summary = result.summary?.[0] || { total: 0, today: 0, verified: 0, pending: 0, joiningSent: 0, joiningPending: 0, joiningFailed: 0, deliveredEmails: 0, acceptedEmails: 0, failedEmails: 0, pendingOrUnknownEmails: 0 };
      const total = result.filteredTotal?.[0]?.count || 0;
      return res.json({
        data: (result.data || []).map(normalizeEmailTracking),
        summary: {
          total: summary.total,
          today: summary.today,
          verified: summary.verified,
          pending: summary.pending,
          joiningSent: summary.joiningSent || 0,
          joiningPending: summary.joiningPending || 0,
          joiningFailed: summary.joiningFailed || 0,
          deliveredEmails: summary.deliveredEmails || 0,
          acceptedEmails: summary.acceptedEmails || 0,
          failedEmails: summary.failedEmails || 0,
          pendingOrUnknownEmails: summary.pendingOrUnknownEmails || 0,
        },
        pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
      });
    } catch (error) {
      if (error.message.startsWith('Invalid ') || error.message.startsWith('The start date')) {
        return res.status(400).json({ message: error.message });
      }
      safeLogger.error('Admin registration listing failed.', { code: error.code || 'ADMIN_LIST_FAILED' });
      return res.status(500).json({ message: 'Registrations could not be loaded right now.' });
    }
  }

  async function getById(req, res) {
    if (!isValidId(req.params.id)) return res.status(404).json({ message: 'Registration not found.' });
    try {
      const registration = await findRegistrationRecord(req.params.id);
      if (!registration) return res.status(404).json({ message: 'Registration not found.' });
      return res.json({ data: normalizeEmailTracking(normalizeStatus(registration)) });
    } catch (error) {
      safeLogger.error('Admin registration detail lookup failed.', { code: error.code || 'ADMIN_DETAIL_FAILED' });
      return res.status(500).json({ message: 'Registration details could not be loaded right now.' });
    }
  }

  async function markConfirmationResult(registrationId, { success, errorMessage, email, fullName, messageId, provider }) {
    const isBounce = /bounce|suppressed|invalid recipient/i.test(errorMessage || '');
    const status = success ? 'accepted' : (isBounce ? 'bounced' : 'failed');
    const update = {
      $set: {
        confirmationEmailSent: Boolean(success),
        confirmationEmailSentAt: success ? new Date() : null,
        confirmationEmailLastError: success ? null : String(errorMessage || 'Email delivery failed.').slice(0, 500),
        emailStatus: status,
        emailLastAttemptAt: new Date(),
        ...(messageId ? { emailMessageId: messageId } : {}),
        ...(provider ? { emailProvider: provider } : {}),
        emailLastError: success ? null : String(errorMessage || 'Email delivery failed.').slice(0, 500),
      },
      $inc: { emailAttemptCount: 1 },
    };

    const updatedRegistration = await updateRegistrationRecord(registrationId, update, { email, fullName });

    if (!updatedRegistration) return null;
    const plainRecord = typeof updatedRegistration.toObject === 'function'
      ? updatedRegistration.toObject()
      : updatedRegistration;
    const rawId = String(registrationId && typeof registrationId === 'object' && registrationId.oid ? registrationId.oid : registrationId);
    const mergedRegistration = {
      ...(plainRecord || {}),
      _id: rawId,
      email: email || plainRecord?.email,
      fullName: fullName || plainRecord?.fullName,
      ...update.$set,
      emailAttemptCount: (plainRecord?.emailAttemptCount || 0) + 1,
    };
    return normalizeEmailTracking(normalizeStatus(mergedRegistration));
  }

  async function markAnnouncementResult(registrationId, { success, errorMessage, email, fullName }) {
    const update = success
      ? { announcementEmailSent: true, announcementEmailSentAt: new Date(), announcementEmailLastError: null }
      : { announcementEmailSent: false, announcementEmailSentAt: null, announcementEmailLastError: String(errorMessage || 'Announcement email delivery failed.').slice(0, 500) };

    const updatedRegistration = await updateRegistrationRecord(registrationId, update, { email, fullName });

    if (!updatedRegistration) return null;
    const plainRecord = typeof updatedRegistration.toObject === 'function'
      ? updatedRegistration.toObject()
      : updatedRegistration;
    const rawId = String(registrationId && typeof registrationId === 'object' && registrationId.oid ? registrationId.oid : registrationId);
    const mergedRegistration = {
      ...(plainRecord || {}),
      _id: rawId,
      email: email || plainRecord.email,
      fullName: fullName || plainRecord.fullName,
      ...update,
    };
    return normalizeEmailTracking(normalizeStatus(mergedRegistration));
  }

  async function markJoiningResult(registrationId, { success, errorMessage, email, fullName }) {
    const update = success
      ? { joiningEmailSent: true, joiningEmailSentAt: new Date(), joiningEmailLastError: null }
      : { joiningEmailSent: false, joiningEmailSentAt: null, joiningEmailLastError: String(errorMessage || 'Zoom joining email delivery failed.').slice(0, 500) };

    const updatedRegistration = await updateRegistrationRecord(registrationId, update, { email, fullName });

    if (!updatedRegistration) return null;
    const plainRecord = typeof updatedRegistration.toObject === 'function'
      ? updatedRegistration.toObject()
      : updatedRegistration;
    const rawId = String(registrationId && typeof registrationId === 'object' && registrationId.oid ? registrationId.oid : registrationId);
    const mergedRegistration = {
      ...(plainRecord || {}),
      _id: rawId,
      email: email || plainRecord.email,
      fullName: fullName || plainRecord.fullName,
      ...update,
    };
    return normalizeEmailTracking(normalizeStatus(mergedRegistration));
  }

  async function markReminderResult(registrationId, { success, errorMessage, email, fullName }) {
    const update = success
      ? { reminderEmailSent: true, reminderEmailSentAt: new Date(), reminderEmailLastError: null }
      : { reminderEmailSent: false, reminderEmailLastError: String(errorMessage || 'Webinar reminder delivery failed.').slice(0, 500) };

    const updatedRegistration = await updateRegistrationRecord(registrationId, update, { email, fullName });

    if (!updatedRegistration) return null;
    const plainRecord = typeof updatedRegistration.toObject === 'function'
      ? updatedRegistration.toObject()
      : updatedRegistration;
    const rawId = String(registrationId && typeof registrationId === 'object' && registrationId.oid ? registrationId.oid : registrationId);
    const mergedRegistration = {
      ...(plainRecord || {}),
      _id: rawId,
      email: email || plainRecord.email,
      fullName: fullName || plainRecord.fullName,
      ...update,
    };
    return normalizeEmailTracking(normalizeStatus(mergedRegistration));
  }

  async function markFeedbackResult(registrationId, { success, errorMessage, email, fullName }) {
    const update = success
      ? { feedbackEmailSent: true, feedbackEmailSentAt: new Date(), feedbackEmailLastError: null }
      : { feedbackEmailSent: false, feedbackEmailLastError: String(errorMessage || 'Feedback email delivery failed.').slice(0, 500) };

    const updatedRegistration = await updateRegistrationRecord(registrationId, update, { email, fullName });

    if (!updatedRegistration) return null;
    const plainRecord = typeof updatedRegistration.toObject === 'function'
      ? updatedRegistration.toObject()
      : updatedRegistration;
    const rawId = String(registrationId && typeof registrationId === 'object' && registrationId.oid ? registrationId.oid : registrationId);
    const mergedRegistration = {
      ...(plainRecord || {}),
      _id: rawId,
      email: email || plainRecord.email,
      fullName: fullName || plainRecord.fullName,
      ...update,
    };
    return normalizeEmailTracking(normalizeStatus(mergedRegistration));
  }

  async function sendConfirmation(req, res) {
    if (!isValidId(req.params.id)) {
      return res.status(404).json({ message: 'Registration not found.' });
    }
    const lockId = String(req.params.id);
    if (inFlightSends.has(lockId)) {
      return res.status(409).json({ success: false, message: 'An email is currently being sent to this recipient. Please wait for it to complete.' });
    }
    inFlightSends.add(lockId);

    try {
      const registration = await findRegistrationRecord(req.params.id);
      if (!registration) return res.status(404).json({ message: 'Registration not found.' });
      if (!registration.email) return res.status(400).json({ message: 'This registration does not have a valid email address.' });

      if (registration.emailStatus === 'bounced' && req.body?.force !== true) {
        return res.status(400).json({ success: false, message: 'Cannot send email to a previously bounced address. Please verify or update the email address first.' });
      }

      if (registration.emailLastAttemptAt) {
        const lastAttempt = new Date(registration.emailLastAttemptAt).getTime();
        if (!Number.isNaN(lastAttempt) && Date.now() - lastAttempt < 3000) {
          return res.status(429).json({ success: false, message: 'Please wait a moment before sending another email to this recipient.' });
        }
      }

      let sendResult = null;
      let emailError = null;

      try {
        sendResult = await emailService.sendRegistrationConfirmation(registration.email, registration.fullName);
      } catch (err) {
        emailError = err;
      }

      const regId = (registration._id && typeof registration._id === 'object' && registration._id.oid) ? String(registration._id.oid) : (registration._id || req.params.id);

      if (!emailError) {
        const messageId = sendResult?.messageId || sendResult?.id || null;
        const provider = 'smtp';
        const updatedRegistration = await markConfirmationResult(regId, {
          success: true,
          email: registration.email,
          fullName: registration.fullName,
          messageId,
          provider,
        });
        safeLogger.info('Admin confirmation email sent.', { registrationId: regId, email: registration.email, messageId });
        return res.json({ success: true, message: 'Confirmation email sent successfully.', data: updatedRegistration });
      }

      safeLogger.error('Admin confirmation email send failed.', {
        code: emailError.code || 'ADMIN_EMAIL_SEND_FAILED',
        registrationId: req.params.id,
        email: registration.email,
      });

      const updatedRegistration = await markConfirmationResult(regId, {
        success: false,
        errorMessage: emailError.message || 'Email could not be sent right now.',
        email: registration.email,
        fullName: registration.fullName,
        provider: 'smtp',
      });

      return res.status(200).json({
        success: false,
        message: 'Confirmation email could not be sent right now.',
        data: updatedRegistration,
      });
    } finally {
      inFlightSends.delete(lockId);
    }
  }

  async function getBulkEmailPreview(req, res) {
    try {
      const webinarFilter = getWebinarTargetFilter(req);
      const queryResult = typeof registrationModel.find === 'function'
        ? (Object.keys(webinarFilter).length > 0 ? registrationModel.find(webinarFilter) : registrationModel.find())
        : [];
      let registrations = Array.isArray(queryResult)
        ? queryResult
        : (queryResult && typeof queryResult.sort === 'function' ? await queryResult.sort({ createdAt: -1 }) : await queryResult) || [];
      registrations = maybeLean(registrations) || [];
      const targetWebinar = req.body?.webinarId || req.query?.webinarId;
      registrations = filterRegistrationsByWebinar(registrations, targetWebinar);

      let pending = 0;
      let failed = 0;
      let bounced = 0;
      let alreadySent = 0;

      for (const reg of registrations) {
        const isSent = reg.confirmationEmailSent === true || reg.emailStatus === 'accepted' || reg.emailStatus === 'delivered';
        if (reg.emailStatus === 'bounced') {
          bounced += 1;
        } else if (isSent) {
          alreadySent += 1;
        } else if (reg.emailStatus === 'failed' || reg.confirmationEmailLastError) {
          failed += 1;
        } else {
          pending += 1;
        }
      }

      const eligiblePendingAndFailed = pending + failed;
      const total = registrations.length;

      return res.json({
        success: true,
        counts: {
          total,
          eligible: eligiblePendingAndFailed,
          pending,
          failed,
          alreadySent,
          bounced,
        },
      });
    } catch (err) {
      safeLogger.error('Failed to compute bulk email preview.', { error: err.message });
      return res.status(500).json({ success: false, message: 'Could not load bulk email preview.' });
    }
  }

  async function startBulkEmailJob(req, res) {
    const scope = req.body?.scope === 'all' ? 'all' : 'pending_failed';
    const includeSent = req.body?.includeSent === true || scope === 'all';
    const forceBounced = req.body?.forceBounced === true;
    const targetWebinar = req.body?.webinarId || req.query?.webinarId;

    // 1. Concurrency Check
    if (bulkEmailService.isJobActive()) {
      return res.status(409).json({
        success: false,
        message: 'A bulk email job is already running. Please wait for it to finish.',
        activeJobId: bulkEmailService.getActiveJobId(),
      });
    }

    // 2. SMTP Readiness Check
    if (typeof emailService.verifyEmailService === 'function') {
      try {
        const verification = await emailService.verifyEmailService();
        const isReady = verification?.ok === true || verification?.success === true;
        if (!isReady) {
          safeLogger.error('Bulk email rejected: SMTP verification failed.', { verification });
          return res.status(503).json({
            success: false,
            message: `SMTP email service is not ready: ${verification?.errorMessage || verification?.message || 'Configuration incomplete'}. No emails were sent or modified.`,
          });
        }
      } catch (verifyErr) {
        safeLogger.error('Bulk email rejected: SMTP verification threw error.', { error: verifyErr.message });
        return res.status(503).json({
          success: false,
          message: `SMTP connection failed: ${verifyErr.message}. No emails were sent or modified.`,
        });
      }
    }

    try {
      const result = await bulkEmailService.startJob({
        webinarId: targetWebinar,
        scope,
        includeSent,
        forceBounced,
        createdBy: req.admin?.email || 'admin',
      });

      return res.status(200).json({
        success: true,
        message: result.message || 'Bulk email job started.',
        jobId: result.jobId,
        total: result.total,
        status: result.status,
      });
    } catch (err) {
      if (err.message && err.message.includes('already running')) {
        return res.status(409).json({
          success: false,
          message: err.message,
        });
      }
      safeLogger.error('Failed to start bulk email job.', { error: err.message });
      return res.status(500).json({
        success: false,
        message: err.message || 'Could not start bulk email job.',
      });
    }
  }

  async function getBulkEmailJobStatus(req, res) {
    const { jobId } = req.params;
    if (!jobId) {
      return res.status(400).json({ success: false, message: 'Job ID is required.' });
    }
    try {
      const job = await bulkEmailService.getJobStatus(jobId);
      if (!job) {
        return res.status(404).json({ success: false, message: 'Bulk email job not found.' });
      }
      return res.json({
        success: true,
        job: {
          jobId: job.jobId,
          type: job.type,
          webinarId: job.webinarId,
          scope: job.scope,
          status: job.status,
          total: job.total,
          processed: job.processed,
          accepted: job.accepted,
          failed: job.failed,
          skipped: job.skipped,
          failedRecipients: job.failedRecipients || [],
          errorMessage: job.errorMessage,
          startedAt: job.startedAt,
          completedAt: job.completedAt,
          createdAt: job.createdAt,
        },
      });
    } catch (err) {
      safeLogger.error('Failed to retrieve bulk email job status.', { error: err.message });
      return res.status(500).json({ success: false, message: 'Could not load job status.' });
    }
  }

  async function getActiveBulkEmailJob(req, res) {
    try {
      const job = await bulkEmailService.getActiveJob();
      if (!job) {
        return res.json({ success: true, active: false, job: null });
      }
      return res.json({
        success: true,
        active: job.status === 'processing' || job.status === 'queued',
        job: {
          jobId: job.jobId,
          type: job.type,
          webinarId: job.webinarId,
          scope: job.scope,
          status: job.status,
          total: job.total,
          processed: job.processed,
          accepted: job.accepted,
          failed: job.failed,
          skipped: job.skipped,
          failedRecipients: job.failedRecipients || [],
          errorMessage: job.errorMessage,
          startedAt: job.startedAt,
          completedAt: job.completedAt,
          createdAt: job.createdAt,
        },
      });
    } catch (err) {
      safeLogger.error('Failed to retrieve active bulk email job.', { error: err.message });
      return res.status(500).json({ success: false, message: 'Could not load active bulk email job.' });
    }
  }

  async function cancelBulkEmailJob(req, res) {
    const { jobId } = req.params;
    if (!jobId) {
      return res.status(400).json({ success: false, message: 'Job ID is required.' });
    }
    try {
      const cancelled = await bulkEmailService.cancelJob(jobId);
      return res.json({
        success: Boolean(cancelled),
        message: cancelled ? 'Job cancellation requested.' : 'Job could not be cancelled or was not found.',
      });
    } catch (err) {
      safeLogger.error('Failed to cancel bulk email job.', { error: err.message });
      return res.status(500).json({ success: false, message: 'Could not cancel job.' });
    }
  }

  async function sendBulkConfirmations(req, res) {
    const sendToSent = req.body && req.body.includeSent === true;
    const targetWebinar = req.body?.webinarId || req.query?.webinarId;
    const webinarFilter = getWebinarTargetFilter(req);
    const queryResult = await (typeof registrationModel.find === 'function' ? (Object.keys(webinarFilter).length > 0 ? registrationModel.find(webinarFilter) : registrationModel.find()) : []);
    let registrations = Array.isArray(queryResult)
      ? queryResult
      : maybeLean(queryResult && typeof queryResult.sort === 'function' ? queryResult.sort({ createdAt: -1 }) : queryResult) || [];
    registrations = filterRegistrationsByWebinar(registrations, targetWebinar);
    const pendingRegistrations = (registrations || []).filter(registration => sendToSent || registration.confirmationEmailSent !== true);
    const summary = { total: registrations.length, sent: 0, failed: 0, skipped: Math.max(0, registrations.length - pendingRegistrations.length) };
    const failedEmails = [];
    const sentEmails = [];

    for (const registration of pendingRegistrations) {
      const regId = (registration._id && typeof registration._id === 'object' && registration._id.oid) ? String(registration._id.oid) : registration._id;
      try {
        await emailService.sendRegistrationConfirmation(registration.email, registration.fullName);
        await markConfirmationResult(regId, { success: true, email: registration.email, fullName: registration.fullName });
        summary.sent += 1;
        sentEmails.push(registration.email);
      } catch (error) {
        await markConfirmationResult(regId, { success: false, errorMessage: error.message || 'Email delivery failed.', email: registration.email, fullName: registration.fullName });
        summary.failed += 1;
        failedEmails.push(registration.email);
        safeLogger.error('Bulk confirmation email failed.', {
          code: error.code || 'ADMIN_EMAIL_BATCH_FAILED',
          email: registration.email,
          registrationId: regId,
        });
      }
    }

    return res.json({
      success: true,
      message: 'Email sending completed.',
      summary,
      failedEmails,
      sentEmails,
    });
  }

  async function resendBulkConfirmations(req, res) {
    req.body = { ...(req.body || {}), includeSent: true };
    return sendBulkConfirmations(req, res);
  }

  async function sendPostponementAnnouncement(req, res) {
    if (!isValidId(req.params.id)) {
      return res.status(404).json({ message: 'Registration not found.' });
    }
    try {
      const registration = await findRegistrationRecord(req.params.id);
      if (!registration) return res.status(404).json({ message: 'Registration not found.' });
      if (!registration.email) return res.status(400).json({ message: 'This registration does not have a valid email address.' });

      await emailService.sendPostponementAnnouncement(registration.email, registration.fullName);
      const regId = (registration._id && typeof registration._id === 'object' && registration._id.oid) ? String(registration._id.oid) : (registration._id || req.params.id);
      const updatedRegistration = await markAnnouncementResult(regId, {
        success: true,
        email: registration.email,
        fullName: registration.fullName,
      });
      safeLogger.info('Admin postponement announcement email sent.', { registrationId: regId, email: registration.email });
      return res.json({ success: true, message: 'Postponement announcement sent successfully.', data: updatedRegistration });
    } catch (error) {
      let updatedRegistration = null;
      let email = null;
      if (isValidId(req.params.id)) {
        try {
          const reg = await findRegistrationRecord(req.params.id);
          if (reg) {
            email = reg.email;
            const regId = (reg._id && typeof reg._id === 'object' && reg._id.oid) ? String(reg._id.oid) : (reg._id || req.params.id);
            updatedRegistration = await markAnnouncementResult(regId, {
              success: false,
              errorMessage: error.message || 'Announcement email could not be sent right now.',
              email: reg.email,
              fullName: reg.fullName,
            });
          }
        } catch (dbError) {
          safeLogger.error('Admin postponement error tracking failed.', {
            code: dbError.code || 'ADMIN_ANNOUNCEMENT_TRACK_FAILED',
            registrationId: req.params.id,
          });
        }
      }
      safeLogger.error('Admin postponement announcement send failed.', {
        code: error.code || 'ADMIN_ANNOUNCEMENT_SEND_FAILED',
        registrationId: req.params.id,
        email,
      });
      return res.status(200).json({
        success: false,
        message: 'Postponement announcement could not be sent right now.',
        data: updatedRegistration,
      });
    }
  }

  async function sendBulkPostponementAnnouncements(req, res) {
    const confirmed = req.body && (req.body.confirmed === true || req.body.confirm === true);
    if (!confirmed) {
      return res.status(400).json({ message: 'Confirmation is required before sending the postponement announcement to all registered participants.' });
    }

    const retryFailed = req.body && req.body.retryFailed === true;
    const includeSent = req.body && req.body.includeSent === true;
    const delayMs = Number.isFinite(Number(req.body?.delayMs)) ? Number(req.body.delayMs) : 250;
    const targetWebinar = req.body?.webinarId || req.query?.webinarId;
    const webinarFilter = getWebinarTargetFilter(req);
    const queryResult = await (typeof registrationModel.find === 'function' ? (Object.keys(webinarFilter).length > 0 ? registrationModel.find(webinarFilter) : registrationModel.find()) : []);
    let registrations = Array.isArray(queryResult)
      ? queryResult
      : maybeLean(queryResult && typeof queryResult.sort === 'function' ? queryResult.sort({ createdAt: -1 }) : queryResult) || [];
    registrations = filterRegistrationsByWebinar(registrations, targetWebinar);

    const pendingRegistrations = (registrations || []).filter(registration => {
      if (!registration?.email) return false;
      if (includeSent || retryFailed) return true;
      return registration.announcementEmailSent !== true;
    });

    const filteredRegistrations = retryFailed
      ? pendingRegistrations.filter(registration => registration.announcementEmailSent !== true || Boolean(registration.announcementEmailLastError))
      : pendingRegistrations.filter(registration => includeSent || registration.announcementEmailSent !== true);

    const summary = { total: registrations.length, sent: 0, failed: 0, skipped: Math.max(0, registrations.length - filteredRegistrations.length) };
    const failedEmails = [];
    const sentEmails = [];

    for (const [index, registration] of filteredRegistrations.entries()) {
      const regId = (registration._id && typeof registration._id === 'object' && registration._id.oid) ? String(registration._id.oid) : registration._id;
      try {
        await emailService.sendPostponementAnnouncement(registration.email, registration.fullName);
        await markAnnouncementResult(regId, { success: true, email: registration.email, fullName: registration.fullName });
        summary.sent += 1;
        sentEmails.push(registration.email);
      } catch (error) {
        await markAnnouncementResult(regId, { success: false, errorMessage: error.message || 'Announcement delivery failed.', email: registration.email, fullName: registration.fullName });
        summary.failed += 1;
        failedEmails.push(registration.email);
        safeLogger.error('Bulk postponement announcement failed.', {
          code: error.code || 'ADMIN_ANNOUNCEMENT_BATCH_FAILED',
          email: registration.email,
          registrationId: regId,
        });
      }

      if (index < filteredRegistrations.length - 1 && delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    return res.json({
      success: true,
      message: 'Postponement announcement sending completed.',
      summary,
      failedEmails,
      sentEmails,
    });
  }

  async function resendBulkPostponementAnnouncements(req, res) {
    req.body = { ...(req.body || {}), includeSent: true, retryFailed: true, confirmed: true };
    return sendBulkPostponementAnnouncements(req, res);
  }

  async function sendSingleZoomJoiningLink(req, res) {
    if (!isValidId(req.params.id)) {
      return res.status(404).json({ message: 'Registration not found.' });
    }
    try {
      const registration = await findRegistrationRecord(req.params.id);
      if (!registration) return res.status(404).json({ message: 'Registration not found.' });
      if (!registration.email) return res.status(400).json({ message: 'This registration does not have a valid email address.' });

      await emailService.sendZoomJoiningLink(registration.email, registration.fullName);
      const regId = (registration._id && typeof registration._id === 'object' && registration._id.oid) ? String(registration._id.oid) : (registration._id || req.params.id);
      const updatedRegistration = await markJoiningResult(regId, {
        success: true,
        email: registration.email,
        fullName: registration.fullName,
      });
      safeLogger.info('Admin Zoom joining link email sent.', { registrationId: regId, email: registration.email });
      return res.json({ success: true, message: 'Zoom joining link sent successfully.', data: updatedRegistration });
    } catch (error) {
      let updatedRegistration = null;
      let email = null;
      if (isValidId(req.params.id)) {
        try {
          const reg = await findRegistrationRecord(req.params.id);
          if (reg) {
            email = reg.email;
            const regId = (reg._id && typeof reg._id === 'object' && reg._id.oid) ? String(reg._id.oid) : (reg._id || req.params.id);
            updatedRegistration = await markJoiningResult(regId, {
              success: false,
              errorMessage: error.message || 'Zoom joining link could not be sent right now.',
              email: reg.email,
              fullName: reg.fullName,
            });
          }
        } catch (dbError) {
          safeLogger.error('Admin Zoom joining link error tracking failed.', {
            code: dbError.code || 'ADMIN_JOINING_TRACK_FAILED',
            registrationId: req.params.id,
          });
        }
      }
      safeLogger.error('Admin Zoom joining link send failed.', {
        code: error.code || 'ADMIN_JOINING_SEND_FAILED',
        registrationId: req.params.id,
        email,
      });
      return res.status(200).json({
        success: false,
        message: 'Zoom joining link could not be sent right now.',
        data: updatedRegistration,
      });
    }
  }

  async function sendBulkZoomJoiningLinks(req, res) {
    const confirmed = req.body && (req.body.confirmed === true || req.body.confirm === true);
    if (!confirmed) {
      return res.status(400).json({ message: 'Confirmation is required before sending the Zoom joining link to registered participants.' });
    }

    const retryFailed = req.body && req.body.retryFailed === true;
    const includeSent = req.body && req.body.includeSent === true;
    const delayMs = Number.isFinite(Number(req.body?.delayMs)) ? Number(req.body.delayMs) : 250;

    const targetWebinar = req.body?.webinarId || req.query?.webinarId;
    const webinarFilter = getWebinarTargetFilter(req);
    const queryResult = await (typeof registrationModel.find === 'function' ? (Object.keys(webinarFilter).length > 0 ? registrationModel.find(webinarFilter) : registrationModel.find()) : []);
    let registrations = Array.isArray(queryResult)
      ? queryResult
      : maybeLean(queryResult && typeof queryResult.sort === 'function' ? queryResult.sort({ createdAt: -1 }) : queryResult) || [];
    registrations = filterRegistrationsByWebinar(registrations, targetWebinar);

    const validRegistrations = (registrations || []).filter(registration => Boolean(registration?.email));

    const filteredRegistrations = retryFailed
      ? validRegistrations.filter(registration => registration.joiningEmailSent !== true || Boolean(registration.joiningEmailLastError))
      : validRegistrations.filter(registration => includeSent || registration.joiningEmailSent !== true);

    const summary = { total: registrations.length, sent: 0, failed: 0, skipped: Math.max(0, registrations.length - filteredRegistrations.length) };
    const failedEmails = [];
    const sentEmails = [];

    for (const [index, registration] of filteredRegistrations.entries()) {
      const regId = (registration._id && typeof registration._id === 'object' && registration._id.oid) ? String(registration._id.oid) : registration._id;
      try {
        await emailService.sendZoomJoiningLink(registration.email, registration.fullName);
        await markJoiningResult(regId, { success: true, email: registration.email, fullName: registration.fullName });
        summary.sent += 1;
        sentEmails.push(registration.email);
      } catch (error) {
        await markJoiningResult(regId, { success: false, errorMessage: error.message || 'Zoom joining link delivery failed.', email: registration.email, fullName: registration.fullName });
        summary.failed += 1;
        failedEmails.push(registration.email);
        safeLogger.error('Bulk Zoom joining link send failed.', {
          code: error.code || 'ADMIN_JOINING_BATCH_FAILED',
          email: registration.email,
          registrationId: regId,
        });
      }

      if (index < filteredRegistrations.length - 1 && delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    return res.json({
      success: true,
      message: 'Zoom joining link campaign completed.',
      summary,
      failedEmails,
      sentEmails,
    });
  }

  async function resendBulkZoomJoiningLinks(req, res) {
    req.body = { ...(req.body || {}), includeSent: true, retryFailed: true, confirmed: true };
    return sendBulkZoomJoiningLinks(req, res);
  }

  async function getJoiningCampaignPreview(req, res) {
    try {
      const targetWebinar = req.body?.webinarId || req.query?.webinarId;
      const webinarFilter = getWebinarTargetFilter(req);
      const queryResult = await (typeof registrationModel.find === 'function' ? (Object.keys(webinarFilter).length > 0 ? registrationModel.find(webinarFilter) : registrationModel.find()) : []);
      let registrations = Array.isArray(queryResult)
        ? queryResult
        : maybeLean(queryResult && typeof queryResult.sort === 'function' ? queryResult.sort({ createdAt: -1 }) : queryResult) || [];
      registrations = filterRegistrationsByWebinar(registrations, targetWebinar);

      const total = registrations.length;
      const sent = registrations.filter(r => r.joiningEmailSent === true).length;
      const failed = registrations.filter(r => r.joiningEmailSent !== true && Boolean(r.joiningEmailLastError)).length;
      const pending = registrations.filter(r => r.joiningEmailSent !== true && !r.joiningEmailLastError).length;

      const previewDetails = webinarEmailService.buildZoomJoiningDetails ? webinarEmailService.buildZoomJoiningDetails('Sample Participant') : {};

      return res.json({
        success: true,
        summary: {
          total,
          sent,
          pending,
          failed,
          eligibleCount: pending + failed,
        },
        preview: {
          subject: previewDetails.subject || 'Your Zoom Joining Link – Halal Wealth Webinar | 18 October 2026',
          text: previewDetails.text || '',
          html: previewDetails.html || '',
        },
      });
    } catch (error) {
      safeLogger.error('Admin joining campaign preview failed.', { code: error.code || 'ADMIN_JOINING_PREVIEW_FAILED' });
      return res.status(500).json({ message: 'Campaign preview could not be loaded right now.' });
    }
  }

  let isReminderCampaignRunning = false;

  async function sendBulkOneHourReminders(req, res) {
    const confirmed = req.body && (req.body.confirmed === true || req.body.confirm === true);
    if (!confirmed) {
      return res.status(400).json({ message: 'Confirmation is required before sending the one-hour webinar reminder to registered participants.' });
    }

    if (isReminderCampaignRunning) {
      return res.status(409).json({ message: 'A webinar reminder campaign is already in progress. Please wait for it to complete.' });
    }

    isReminderCampaignRunning = true;
    const delayMs = Number.isFinite(Number(req.body?.delayMs)) ? Math.max(50, Number(req.body.delayMs)) : 250;
    const includeSent = req.body && req.body.includeSent === true;

    try {
      const targetWebinar = req.body?.webinarId || req.query?.webinarId;
      const webinarFilter = getWebinarTargetFilter(req);
      const queryResult = await (typeof registrationModel.find === 'function' ? (Object.keys(webinarFilter).length > 0 ? registrationModel.find(webinarFilter) : registrationModel.find()) : []);
      let registrations = Array.isArray(queryResult)
        ? queryResult
        : maybeLean(queryResult && typeof queryResult.sort === 'function' ? queryResult.sort({ createdAt: -1 }) : queryResult) || [];
      registrations = filterRegistrationsByWebinar(registrations, targetWebinar);

      // Validate emails and deduplicate identical emails
      const seenEmails = new Set();
      const eligibleRegistrations = [];

      for (const reg of registrations) {
        const rawEmail = String(reg?.email || '').trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail) || rawEmail.length > 254) {
          continue;
        }
        const normalized = rawEmail.toLowerCase();
        if (seenEmails.has(normalized)) {
          continue;
        }
        seenEmails.add(normalized);

        if (!includeSent && reg.reminderEmailSent === true) {
          continue;
        }

        eligibleRegistrations.push(reg);
      }

      const summary = {
        total: registrations.length,
        eligible: eligibleRegistrations.length,
        sent: 0,
        failed: 0,
        skipped: Math.max(0, registrations.length - eligibleRegistrations.length),
      };
      const failedEmails = [];
      const sentEmails = [];

      for (const [index, registration] of eligibleRegistrations.entries()) {
        const regId = (registration._id && typeof registration._id === 'object' && registration._id.oid)
          ? String(registration._id.oid)
          : registration._id;
        try {
          await emailService.sendOneHourReminder(registration.email, registration.fullName);
          await markReminderResult(regId, { success: true, email: registration.email, fullName: registration.fullName });
          summary.sent += 1;
          sentEmails.push(registration.email);
        } catch (error) {
          const errMsg = error.message || 'One-hour reminder delivery failed.';
          await markReminderResult(regId, { success: false, errorMessage: errMsg, email: registration.email, fullName: registration.fullName });
          summary.failed += 1;
          failedEmails.push({ email: registration.email, error: errMsg });
          safeLogger.error('Bulk one-hour reminder send failed.', {
            code: error.code || 'ADMIN_REMINDER_BATCH_FAILED',
            email: registration.email,
            registrationId: regId,
          });
        }

        if (index < eligibleRegistrations.length - 1 && delayMs > 0) {
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      }

      const hasFailures = summary.failed > 0;
      return res.json({
        success: !hasFailures,
        message: hasFailures
          ? `One-hour webinar reminder completed with ${summary.sent} sent and ${summary.failed} failed.`
          : `One-hour webinar reminder sent successfully to ${summary.sent} registered participants.`,
        summary,
        failedEmails,
        sentEmails,
      });
    } catch (err) {
      safeLogger.error('Bulk one-hour reminder campaign failed.', { code: err.code || 'ADMIN_REMINDER_CAMPAIGN_FAILED' });
      return res.status(500).json({ message: 'One-hour webinar reminder campaign could not be completed.' });
    } finally {
      isReminderCampaignRunning = false;
    }
  }

  async function resendBulkOneHourReminders(req, res) {
    req.body = { ...(req.body || {}), includeSent: true, confirmed: true };
    return sendBulkOneHourReminders(req, res);
  }

  let isFeedbackCampaignRunning = false;

  async function getActiveFeedbackConfig() {
    let config = null;
    if (typeof campaignConfigModel?.findOne === 'function') {
      try {
        config = await campaignConfigModel.findOne({ campaignKey: FEEDBACK_CAMPAIGN_KEY }).lean();
      } catch (_) {}
    }
    return {
      campaignKey: FEEDBACK_CAMPAIGN_KEY,
      name: 'Post-Webinar Feedback Campaign',
      subject: config?.subject || webinarEmailService.DEFAULT_FEEDBACK_EMAIL_SUBJECT,
      bodyText: config?.bodyText || webinarEmailService.DEFAULT_FEEDBACK_BODY_TEXT,
      feedbackFormUrl: config?.feedbackFormUrl || webinarEmailService.DEFAULT_FEEDBACK_FORM_URL,
      whatsappUrl: config?.whatsappUrl || webinarEmailService.DEFAULT_FEEDBACK_WHATSAPP_URL,
      youtubeUrl: config?.youtubeUrl || webinarEmailService.DEFAULT_FEEDBACK_YOUTUBE_URL,
      instagramUrl: config?.instagramUrl || webinarEmailService.DEFAULT_FEEDBACK_INSTAGRAM_URL,
      updatedAt: config?.updatedAt || null,
      updatedBy: config?.updatedBy || null,
    };
  }

  async function getFeedbackCampaignPreview(req, res) {
    try {
      const config = await getActiveFeedbackConfig();
      const targetWebinar = req.body?.webinarId || req.query?.webinarId;
      const webinarFilter = getWebinarTargetFilter(req);
      const queryResult = await (typeof registrationModel.find === 'function' ? (Object.keys(webinarFilter).length > 0 ? registrationModel.find(webinarFilter) : registrationModel.find()) : []);
      let registrations = Array.isArray(queryResult)
        ? queryResult
        : maybeLean(queryResult && typeof queryResult.sort === 'function' ? queryResult.sort({ createdAt: -1 }) : queryResult) || [];
      registrations = filterRegistrationsByWebinar(registrations, targetWebinar);

      const seenEmails = new Set();
      let total = registrations.length;
      let valid = 0;
      let sent = 0;
      let pending = 0;
      let failed = 0;
      let duplicates = 0;
      let invalid = 0;

      for (const reg of registrations) {
        const rawEmail = String(reg?.email || '').trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail) || rawEmail.length > 254) {
          invalid += 1;
          continue;
        }
        const normalized = rawEmail.toLowerCase();
        if (seenEmails.has(normalized)) {
          duplicates += 1;
          continue;
        }
        seenEmails.add(normalized);
        valid += 1;

        if (reg.feedbackEmailSent === true) {
          sent += 1;
        } else if (reg.feedbackEmailLastError) {
          failed += 1;
        } else {
          pending += 1;
        }
      }

      const emailContent = emailService.buildFeedbackEmail(config, 'Participant');

      return res.json({
        config,
        preview: {
          subject: emailContent.subject,
          text: emailContent.text,
          html: emailContent.html,
        },
        recipients: {
          total,
          valid,
          sent,
          pending,
          failed,
          duplicates,
          invalid,
          eligibleToSend: pending + failed,
        },
      });
    } catch (err) {
      safeLogger.error('Failed to get feedback campaign preview.', { code: err.code || 'ADMIN_FEEDBACK_PREVIEW_FAILED' });
      return res.status(500).json({ message: 'Feedback campaign preview could not be loaded.' });
    }
  }

  async function updateFeedbackCampaignConfig(req, res) {
    try {
      const { subject, bodyText, feedbackFormUrl, whatsappUrl, youtubeUrl, instagramUrl } = req.body || {};

      if (!subject || typeof subject !== 'string' || !subject.trim()) {
        return res.status(400).json({ message: 'Subject is required.' });
      }
      if (subject.length > 250) {
        return res.status(400).json({ message: 'Subject must not exceed 250 characters.' });
      }
      if (!bodyText || typeof bodyText !== 'string' || !bodyText.trim()) {
        return res.status(400).json({ message: 'Body text is required.' });
      }
      if (bodyText.length > 5000) {
        return res.status(400).json({ message: 'Body text must not exceed 5000 characters.' });
      }

      function isValidHttpUrl(stringUrl) {
        if (!stringUrl || typeof stringUrl !== 'string') return false;
        try {
          const parsed = new URL(stringUrl.trim());
          return parsed.protocol === 'http:' || parsed.protocol === 'https:';
        } catch (_) {
          return false;
        }
      }

      if (feedbackFormUrl && !isValidHttpUrl(feedbackFormUrl)) {
        return res.status(400).json({ message: 'Invalid Feedback Form URL.' });
      }
      if (whatsappUrl && !isValidHttpUrl(whatsappUrl)) {
        return res.status(400).json({ message: 'Invalid WhatsApp Community URL.' });
      }
      if (youtubeUrl && !isValidHttpUrl(youtubeUrl)) {
        return res.status(400).json({ message: 'Invalid YouTube URL.' });
      }
      if (instagramUrl && !isValidHttpUrl(instagramUrl)) {
        return res.status(400).json({ message: 'Invalid Instagram URL.' });
      }

      const dangerousPattern = /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>|javascript:|onerror=|onload=|onclick=/i;
      if (dangerousPattern.test(subject) || dangerousPattern.test(bodyText)) {
        return res.status(400).json({ message: 'Unsafe script characters detected.' });
      }

      const updateData = {
        subject: subject.trim(),
        bodyText: bodyText.trim(),
        ...(feedbackFormUrl ? { feedbackFormUrl: feedbackFormUrl.trim() } : {}),
        ...(whatsappUrl ? { whatsappUrl: whatsappUrl.trim() } : {}),
        ...(youtubeUrl ? { youtubeUrl: youtubeUrl.trim() } : {}),
        ...(instagramUrl ? { instagramUrl: instagramUrl.trim() } : {}),
        updatedBy: req.user?.email || 'admin',
      };

      let updated;
      if (typeof campaignConfigModel?.findOneAndUpdate === 'function') {
        updated = await campaignConfigModel.findOneAndUpdate(
          { campaignKey: FEEDBACK_CAMPAIGN_KEY },
          { $set: updateData },
          { new: true, upsert: true, setDefaultsOnInsert: true }
        );
      } else {
        updated = updateData;
      }

      return res.json({
        message: 'Feedback campaign configuration updated successfully.',
        config: updated,
      });
    } catch (err) {
      safeLogger.error('Failed to update feedback campaign configuration.', { code: err.code || 'ADMIN_FEEDBACK_CONFIG_FAILED' });
      return res.status(500).json({ message: 'Campaign configuration could not be saved.' });
    }
  }

  async function sendBulkFeedbackEmails(req, res) {
    if (!req.body || req.body.confirmed !== true) {
      return res.status(400).json({ message: 'Confirmation is required before sending the feedback campaign to registered participants.' });
    }

    if (isFeedbackCampaignRunning) {
      return res.status(409).json({ message: 'A feedback email campaign is already in progress. Please wait for it to complete.' });
    }

    isFeedbackCampaignRunning = true;
    const delayMs = Number.isFinite(Number(req.body?.delayMs)) ? Math.max(0, Number(req.body.delayMs)) : 250;
    const includeSent = req.body && req.body.includeSent === true;

    try {
      const config = await getActiveFeedbackConfig();
      const targetWebinar = req.body?.webinarId || req.query?.webinarId;
      const webinarFilter = getWebinarTargetFilter(req);
      const queryResult = await (typeof registrationModel.find === 'function' ? (Object.keys(webinarFilter).length > 0 ? registrationModel.find(webinarFilter) : registrationModel.find()) : []);
      let registrations = Array.isArray(queryResult)
        ? queryResult
        : maybeLean(queryResult && typeof queryResult.sort === 'function' ? queryResult.sort({ createdAt: -1 }) : queryResult) || [];
      registrations = filterRegistrationsByWebinar(registrations, targetWebinar);

      // Validate emails and deduplicate identical emails
      const seenEmails = new Set();
      const eligibleRegistrations = [];

      for (const reg of registrations) {
        const rawEmail = String(reg?.email || '').trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail) || rawEmail.length > 254) {
          continue;
        }
        const normalized = rawEmail.toLowerCase();
        if (seenEmails.has(normalized)) {
          continue;
        }
        seenEmails.add(normalized);

        if (!includeSent && reg.feedbackEmailSent === true) {
          continue;
        }

        eligibleRegistrations.push(reg);
      }

      const summary = {
        total: registrations.length,
        eligible: eligibleRegistrations.length,
        sent: 0,
        failed: 0,
        skipped: Math.max(0, registrations.length - eligibleRegistrations.length),
      };
      const failedEmails = [];
      const sentEmails = [];

      for (const [index, registration] of eligibleRegistrations.entries()) {
        const regId = (registration._id && typeof registration._id === 'object' && registration._id.oid)
          ? String(registration._id.oid)
          : registration._id;
        try {
          await emailService.sendFeedbackEmail(registration.email, registration.fullName, config);
          await markFeedbackResult(regId, { success: true, email: registration.email, fullName: registration.fullName });
          summary.sent += 1;
          sentEmails.push(registration.email);
        } catch (error) {
          const errMsg = error.message || 'Feedback email delivery failed.';
          await markFeedbackResult(regId, { success: false, errorMessage: errMsg, email: registration.email, fullName: registration.fullName });
          summary.failed += 1;
          failedEmails.push({ email: registration.email, error: errMsg });
          safeLogger.error('Bulk feedback email send failed.', {
            code: error.code || 'ADMIN_FEEDBACK_BATCH_FAILED',
            email: registration.email,
            registrationId: regId,
          });
        }

        if (index < eligibleRegistrations.length - 1 && delayMs > 0) {
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      }

      const hasFailures = summary.failed > 0;
      return res.json({
        success: !hasFailures,
        message: hasFailures
          ? `Feedback email campaign completed with ${summary.sent} sent and ${summary.failed} failed.`
          : `Feedback email campaign sent successfully to ${summary.sent} registered participants.`,
        summary,
        failedEmails,
        sentEmails,
      });
    } catch (err) {
      safeLogger.error('Bulk feedback email campaign failed.', { code: err.code || 'ADMIN_FEEDBACK_CAMPAIGN_FAILED' });
      return res.status(500).json({ message: 'Feedback email campaign could not be completed.' });
    } finally {
      isFeedbackCampaignRunning = false;
    }
  }

  async function resendBulkFeedbackEmails(req, res) {
    req.body = { ...(req.body || {}), includeSent: true, confirmed: true };
    return sendBulkFeedbackEmails(req, res);
  }

  async function sendSingleFeedbackEmail(req, res) {
    if (!isValidId(req.params.id)) {
      return res.status(404).json({ message: 'Registration not found.' });
    }
    try {
      const registration = await findRegistrationRecord(req.params.id);
      if (!registration) {
        return res.status(404).json({ message: 'Registration not found.' });
      }
      const config = await getActiveFeedbackConfig();
      const regId = (registration._id && typeof registration._id === 'object' && registration._id.oid)
        ? String(registration._id.oid)
        : (registration._id || req.params.id);

      await emailService.sendFeedbackEmail(registration.email, registration.fullName, config);
      const updated = await markFeedbackResult(regId, {
        success: true,
        email: registration.email,
        fullName: registration.fullName,
      });
      return res.json({
        message: `Feedback email sent to ${registration.email}.`,
        registration: updated,
      });
    } catch (err) {
      safeLogger.error('Single feedback email send failed.', {
        code: err.code || 'FEEDBACK_SINGLE_SEND_FAILED',
        id: req.params.id,
      });
      await markFeedbackResult(req.params.id, {
        success: false,
        errorMessage: err.message,
      });
      return res.status(500).json({ message: 'Feedback email could not be sent.' });
    }
  }

  
  async function sendIndividualEmail(req, res) {
    if (!isValidId(req.params.id)) {
      return res.status(404).json({ success: false, message: 'Registration not found.' });
    }

    const lockId = String(req.params.id);
    if (inFlightSends.has(lockId)) {
      return res.status(409).json({ success: false, message: 'An email is currently being sent to this recipient. Please wait for it to complete.' });
    }

    const { subject, message } = req.body || {};
    const cleanSubject = typeof subject === 'string' ? subject.trim() : '';
    const cleanMessage = typeof message === 'string' ? message.trim() : '';

    if (!cleanSubject) {
      return res.status(400).json({ success: false, message: 'Email subject is required.' });
    }
    if (cleanSubject.length > 300) {
      return res.status(400).json({ success: false, message: 'Email subject cannot exceed 300 characters.' });
    }
    if (!cleanMessage) {
      return res.status(400).json({ success: false, message: 'Email message is required.' });
    }
    if (cleanMessage.length > 10000) {
      return res.status(400).json({ success: false, message: 'Email message cannot exceed 10,000 characters.' });
    }

    inFlightSends.add(lockId);
    try {
      const registration = await findRegistrationRecord(req.params.id);
      if (!registration) {
        return res.status(404).json({ success: false, message: 'Registration not found.' });
      }
      if (!registration.email || !String(registration.email).includes('@')) {
        return res.status(400).json({ success: false, message: 'This registration does not have a valid email address.' });
      }

      if (registration.emailStatus === 'bounced' && req.body?.force !== true) {
        return res.status(400).json({ success: false, message: 'Cannot send email to a previously bounced address. Please verify or update the email address first.' });
      }

      if (registration.emailLastAttemptAt) {
        const lastAttempt = new Date(registration.emailLastAttemptAt).getTime();
        if (!Number.isNaN(lastAttempt) && Date.now() - lastAttempt < 3000) {
          return res.status(429).json({ success: false, message: 'Please wait a moment before sending another email to this recipient.' });
        }
      }

      const regId = (registration._id && typeof registration._id === 'object' && registration._id.oid)
        ? String(registration._id.oid)
        : (registration._id || req.params.id);

      let sendResult;
      try {
        sendResult = await emailService.sendCustomEmail(registration.email, {
          subject: cleanSubject,
          message: cleanMessage,
          recipientName: registration.fullName,
        });
      } catch (sendError) {
        const isBounce = /bounce|suppressed|invalid recipient/i.test(sendError?.message || '');
        await updateRegistrationRecord(regId, {
          $set: {
            emailStatus: isBounce ? 'bounced' : 'failed',
            emailLastAttemptAt: new Date(),
            emailProvider: 'smtp',
            emailLastError: String(sendError.message || 'Custom email delivery failed.').slice(0, 500),
          },
          $inc: { emailAttemptCount: 1 },
        }, registration).catch(() => {});
        throw sendError;
      }

      const messageId = sendResult?.messageId || sendResult?.id || null;
      const provider = 'smtp';

      await updateRegistrationRecord(regId, {
        $set: {
          emailStatus: 'accepted',
          emailMessageId: messageId,
          emailLastAttemptAt: new Date(),
          emailProvider: provider,
          emailLastError: null,
          confirmationEmailSent: true,
          confirmationEmailSentAt: new Date(),
        },
        $inc: { emailAttemptCount: 1 },
      }, registration).catch(() => {});

      safeLogger.info('Admin individual email sent successfully.', {
        registrationId: regId,
        email: registration.email,
        subject: cleanSubject,
        messageId,
      });

      return res.json({
        success: true,
        message: `Email sent successfully to ${registration.email}.`,
        data: {
          registrationId: regId,
          email: registration.email,
          fullName: registration.fullName,
          emailMessageId: messageId,
          emailStatus: 'accepted',
        },
      });
    } catch (error) {
      safeLogger.error('Admin individual email send failed.', {
        code: error.code || 'ADMIN_INDIVIDUAL_EMAIL_FAILED',
        message: error.message,
        id: req.params.id,
      });

      let userMessage = error.message || 'Failed to send email. Please check configuration and try again.';
      if (/smtp connection timed out/i.test(error.message)) {
        userMessage = 'SMTP connection timed out. Hostinger SMTP server could not be reached within the timeout limit. Please verify network connectivity or try again.';
      } else if (error.code === 'ETIMEDOUT' || error.code === 'ESOCKETTIMEDOUT' || /timeout|timed out/i.test(error.message)) {
        userMessage = 'Email delivery timed out. Please check network connectivity and try again.';
      } else if (error.code === 'EAUTH' || /auth|authentication/i.test(error.message)) {
        userMessage = 'Email authentication failed. Please check your credentials.';
      }

      return res.status(500).json({
        success: false,
        message: userMessage,
      });
    } finally {
      inFlightSends.delete(lockId);
    }
  }

  async function updateStatus(req, res) {
    const { status } = req.body || {};
    if (!REGISTRATION_STATUSES.includes(status)) {
      return res.status(400).json({ message: 'Choose a valid registration status.' });
    }
    if (!isValidId(req.params.id)) return res.status(404).json({ message: 'Registration not found.' });
    try {
      const existing = await findRegistrationRecord(req.params.id);
      if (!existing) return res.status(404).json({ message: 'Registration not found.' });
      const regId = (existing._id && typeof existing._id === 'object' && existing._id.oid) ? String(existing._id.oid) : (existing._id || req.params.id);
      const registration = await updateRegistrationRecord(regId, { status }, existing);
      if (!registration) return res.status(404).json({ message: 'Registration not found.' });
      return res.json({ success: true, data: normalizeStatus(registration) });
    } catch (error) {
      safeLogger.error('Admin registration status update failed.', { code: error.code || 'ADMIN_STATUS_FAILED' });
      return res.status(500).json({ message: 'Registration status could not be updated right now.' });
    }
  }

  async function exportCsv(req, res) {
    let cursor;
    try {
      const filter = buildRegistrationFilter(req.query);
      const fields = Object.keys(registrationModel.schema.paths).filter(field => !['_id', '__v'].includes(field));
      const columns = ['_id', ...fields];
      cursor = registrationModel.find(filter).sort({ createdAt: -1, _id: -1 }).lean().cursor();
      const filename = `webinar-registrations-${new Date().toISOString().slice(0, 10)}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Cache-Control', 'no-store');
      if (!res.write(`${columns.map(csvCell).join(',')}\r\n`)) await once(res, 'drain');
      for await (const registration of cursor) {
        const record = normalizeEmailTracking(normalizeStatus(registration));
        record.referenceId = record.referenceId || record.registrationId || String(record._id);
        if (!res.write(`${columns.map(field => csvCell(record[field])).join(',')}\r\n`)) await once(res, 'drain');
      }
      return res.end();
    } catch (error) {
      safeLogger.error('Admin registration export failed.', { code: error.code || 'ADMIN_EXPORT_FAILED' });
      if (res.headersSent) return res.destroy(error);
      return res.status(error.message.startsWith('Invalid ') || error.message.startsWith('The start date') ? 400 : 500)
        .json({ message: 'Registration data could not be exported.' });
    } finally {
      if (cursor) await cursor.close().catch(() => {});
    }
  }

  async function getWebinars(req, res) {
    try {
      let webinars = [];
      if (typeof webinarModel?.find === 'function') {
        webinars = await webinarModel.find().sort({ dateIso: -1, createdAt: -1 }).lean();
      }
      if (!webinars || webinars.length === 0) {
        webinars = [
          {
            webinarId: 'halal-wealth-nov-2026',
            title: 'Halal Wealth Webinar',
            topic: 'Halal Trade, Investments & Generational Wealth',
            date: 'Sunday, November 1, 2026',
            time: '11:00 AM IST | 1:30 PM SGT | 9:30 AM GST | 8:30 AM AST',
            status: 'Upcoming',
            isCurrent: true,
            isRegistrationClosed: false,
          },
          {
            webinarId: 'halal-wealth-oct-2026',
            title: 'Halal Wealth Webinar',
            topic: 'Halal Trade, Investments & Generational Wealth',
            date: 'Sunday, October 18, 2026',
            time: '11:00 AM IST | 1:30 PM SGT | 9:30 AM GST | 8:30 AM AST',
            status: 'Completed',
            isCurrent: false,
            isRegistrationClosed: true,
          },
        ];
      }

      const webinarsWithCounts = await Promise.all(
        webinars.map(async (webinar) => {
          let count = 0;
          try {
            if (typeof registrationModel.countDocuments === 'function') {
              count = await registrationModel.countDocuments({
                $or: [
                  { webinarId: webinar.webinarId },
                  ...(webinar.webinarId === 'halal-wealth-nov-2026' ? [{ webinarVersion: 'November 1, 2026 Webinar' }] : []),
                  ...(webinar.webinarId === 'halal-wealth-oct-2026' ? [{ webinarVersion: 'October 2026 Webinar' }] : []),
                ],
              });
            }
          } catch (_) {}
          return {
            ...webinar,
            participantCount: count,
          };
        })
      );

      return res.json({ success: true, data: webinarsWithCounts });
    } catch (error) {
      safeLogger.error('Admin get webinars failed.', { code: error.code || 'ADMIN_GET_WEBINARS_FAILED' });
      return res.status(500).json({ success: false, message: 'Webinars could not be loaded.' });
    }
  }

  async function getEmailDiagnostic(req, res) {
    try {
      if (typeof emailService.verifyEmailService === 'function') {
        const diagnostic = await emailService.verifyEmailService();
        return res.json({ success: diagnostic.ok, data: diagnostic });
      }
      return res.json({
        success: true,
        data: {
          provider: 'Unknown/Mock',
          message: 'Diagnostic verification not implemented on custom email service.',
        },
      });
    } catch (error) {
      safeLogger.error('Admin email diagnostic check failed.', { code: error.code || 'ADMIN_EMAIL_DIAGNOSTIC_FAILED' });
      return res.status(500).json({ success: false, message: error.message || 'Diagnostic failed.' });
    }
  }

  async function sendTestDiagnosticEmail(req, res) {
    try {
      const recipient = String(req.body?.testEmail || process.env.ADMIN_EMAIL || req.admin?.email || 'info@halalwealth.finance').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
        return res.status(400).json({ success: false, message: 'Invalid recipient email address for test email.' });
      }

      await emailService.sendCustomEmail(recipient, {
        subject: `[Diagnostic Test] Halal Wealth Email Service Check - ${new Date().toISOString()}`,
        message: 'This is a test email sent from the Halal Wealth Webinar admin diagnostic endpoint to verify end-to-end email delivery.',
        recipientName: 'Administrator',
      });

      return res.json({
        success: true,
        message: `Diagnostic test email submitted successfully to ${recipient}. Check inbox and spam folders.`,
        recipient,
      });
    } catch (error) {
      safeLogger.error('Admin send test email failed.', { code: error.code || 'ADMIN_TEST_EMAIL_FAILED', message: error.message });
      return res.status(500).json({
        success: false,
        message: error.message || 'Failed to send test email.',
      });
    }
  }

  return {
    getWebinars,
    getEmailDiagnostic,
    sendTestDiagnosticEmail,
    list,
    getById,
    sendConfirmation,
    sendBulkConfirmations,
    resendBulkConfirmations,
    getBulkEmailPreview,
    startBulkEmailJob,
    getBulkEmailJobStatus,
    getActiveBulkEmailJob,
    cancelBulkEmailJob,
    sendPostponementAnnouncement,
    sendBulkPostponementAnnouncements,
    resendBulkPostponementAnnouncements,
    sendSingleZoomJoiningLink,
    sendBulkZoomJoiningLinks,
    resendBulkZoomJoiningLinks,
    sendBulkOneHourReminders,
    resendBulkOneHourReminders,
    getJoiningCampaignPreview,
    getFeedbackCampaignPreview,
    updateFeedbackCampaignConfig,
    sendBulkFeedbackEmails,
    resendBulkFeedbackEmails,
    sendSingleFeedbackEmail,
    sendIndividualEmail,
    markFeedbackResult,
    updateStatus,
    exportCsv,
  };
}

module.exports = {
  PAGE_SIZES,
  REGISTRATION_STATUSES,
  buildRegistrationFilter,
  createAdminRegistrationController,
  csvCell,
  ...createAdminRegistrationController(),
};