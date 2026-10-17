const { once } = require('node:events');
const mongoose = require('mongoose');
const WebinarRegistration = require('../models/WebinarRegistration');
const webinarEmailService = require('../services/webinarEmailService');

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

function normalizeEmailTracking(registration = {}) {
  const normalized = { ...registration };
  if (normalized._id && typeof normalized._id === 'object') {
    if (normalized._id.oid) normalized._id = String(normalized._id.oid);
    else if (normalized._id.$oid) normalized._id = String(normalized._id.$oid);
  }
  if (!normalized.registrationId && normalized._id && typeof normalized._id === 'string') {
    normalized.registrationId = normalized._id;
  }
  if (normalized.createdAt && typeof normalized.createdAt === 'object') {
    if (normalized.createdAt.date) normalized.createdAt = new Date(normalized.createdAt.date);
    else if (normalized.createdAt.$date) normalized.createdAt = new Date(normalized.createdAt.$date);
  }
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
  normalized.emailStatus = normalizeEmailStatus(normalized);
  normalized.announcementEmailStatus = normalizeAnnouncementStatus(normalized);
  normalized.joiningEmailStatus = normalizeJoiningStatus(normalized);
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

function createAdminRegistrationController({ registrationModel = WebinarRegistration, logger = console, emailService = webinarEmailService } = {}) {
  const safeLogger = {
    ...console,
    ...logger,
  };
  if (typeof safeLogger.info !== 'function') safeLogger.info = () => {};
  if (typeof safeLogger.error !== 'function') safeLogger.error = () => {};

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
      { _id: { oid: rawId } },
      { registrationId: rawId },
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
    if (typeof registrationModel.findOneAndUpdate === 'function') {
      try {
        const updated = await registrationModel.findOneAndUpdate(
          lookup,
          { $set: update },
          { new: true, runValidators: true },
        );
        if (updated) return maybeLean(updated);
      } catch (_) {}
    }
    if (typeof registrationModel.findByIdAndUpdate === 'function') {
      try {
        const updated = await registrationModel.findByIdAndUpdate(
          id,
          { $set: update },
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
            ...(fallbackDoc?.email ? [{ email: fallbackDoc.email }] : []),
          ],
        };
        await registrationModel.collection.updateOne(filter, { $set: update });
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
            summary: [{
              $group: {
                _id: null,
                total: { $sum: 1 },
                today: { $sum: { $cond: [{ $gte: ['$createdAt', today] }, 1, 0] } },
                verified: { $sum: { $cond: [{ $eq: [normalizedStatus, 'Confirmed'] }, 1, 0] } },
                pending: { $sum: { $cond: [{ $eq: [normalizedStatus, 'Registered'] }, 1, 0] } },
                joiningSent: { $sum: { $cond: [{ $eq: ['$joiningEmailSent', true] }, 1, 0] } },
                joiningPending: { $sum: { $cond: [{ $and: [{ $ne: ['$joiningEmailSent', true] }, { $eq: [{ $ifNull: ['$joiningEmailLastError', null] }, null] }] }, 1, 0] } },
                joiningFailed: { $sum: { $cond: [{ $and: [{ $ne: ['$joiningEmailSent', true] }, { $ne: [{ $ifNull: ['$joiningEmailLastError', null] }, null] }] }, 1, 0] } },
              },
            }],
          },
        },
      ]);
      const summary = result.summary?.[0] || { total: 0, today: 0, verified: 0, pending: 0, joiningSent: 0, joiningPending: 0, joiningFailed: 0 };
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

  async function markConfirmationResult(registrationId, { success, errorMessage, email, fullName }) {
    const update = success
      ? { confirmationEmailSent: true, confirmationEmailSentAt: new Date(), confirmationEmailLastError: null }
      : { confirmationEmailSent: false, confirmationEmailSentAt: null, confirmationEmailLastError: String(errorMessage || 'Email delivery failed.').slice(0, 500) };

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

  async function sendConfirmation(req, res) {
    if (!isValidId(req.params.id)) {
      return res.status(404).json({ message: 'Registration not found.' });
    }
    try {
      const registration = await findRegistrationRecord(req.params.id);
      if (!registration) return res.status(404).json({ message: 'Registration not found.' });
      if (!registration.email) return res.status(400).json({ message: 'This registration does not have a valid email address.' });

      await emailService.sendRegistrationConfirmation(registration.email, registration.fullName);
      const regId = (registration._id && typeof registration._id === 'object' && registration._id.oid) ? String(registration._id.oid) : (registration._id || req.params.id);
      const updatedRegistration = await markConfirmationResult(regId, {
        success: true,
        email: registration.email,
        fullName: registration.fullName,
      });
      safeLogger.info('Admin confirmation email sent.', { registrationId: regId, email: registration.email });
      return res.json({ success: true, message: 'Confirmation email sent successfully.', data: updatedRegistration });
    } catch (error) {
      let updatedRegistration = null;
      let email = null;
      if (isValidId(req.params.id)) {
        try {
          const reg = await findRegistrationRecord(req.params.id);
          if (reg) {
            email = reg.email;
            const regId = (reg._id && typeof reg._id === 'object' && reg._id.oid) ? String(reg._id.oid) : (reg._id || req.params.id);
            updatedRegistration = await markConfirmationResult(regId, {
              success: false,
              errorMessage: error.message || 'Email could not be sent right now.',
              email: reg.email,
              fullName: reg.fullName,
            });
          }
        } catch (dbError) {
          safeLogger.error('Admin confirmation error tracking failed.', {
            code: dbError.code || 'ADMIN_CONFIRMATION_TRACK_FAILED',
            registrationId: req.params.id,
          });
        }
      }
      safeLogger.error('Admin confirmation email send failed.', {
        code: error.code || 'ADMIN_EMAIL_SEND_FAILED',
        registrationId: req.params.id,
        email,
      });
      return res.status(200).json({
        success: false,
        message: 'Confirmation email could not be sent right now.',
        data: updatedRegistration,
      });
    }
  }

  async function sendBulkConfirmations(req, res) {
    const sendToSent = req.body && req.body.includeSent === true;
    const queryResult = await registrationModel.find();
    const registrations = Array.isArray(queryResult)
      ? queryResult
      : maybeLean(queryResult && typeof queryResult.sort === 'function' ? queryResult.sort({ createdAt: -1 }) : queryResult) || [];
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

    const queryResult = await registrationModel.find();
    const registrations = Array.isArray(queryResult)
      ? queryResult
      : maybeLean(queryResult && typeof queryResult.sort === 'function' ? queryResult.sort({ createdAt: -1 }) : queryResult) || [];

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

    const queryResult = await registrationModel.find();
    const registrations = Array.isArray(queryResult)
      ? queryResult
      : maybeLean(queryResult && typeof queryResult.sort === 'function' ? queryResult.sort({ createdAt: -1 }) : queryResult) || [];

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
      const queryResult = await registrationModel.find();
      const registrations = Array.isArray(queryResult)
        ? queryResult
        : maybeLean(queryResult && typeof queryResult.sort === 'function' ? queryResult.sort({ createdAt: -1 }) : queryResult) || [];

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
      const queryResult = await registrationModel.find();
      const registrations = Array.isArray(queryResult)
        ? queryResult
        : maybeLean(queryResult && typeof queryResult.sort === 'function' ? queryResult.sort({ createdAt: -1 }) : queryResult) || [];

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
        const record = normalizeStatus(registration);
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

  return {
    list,
    getById,
    sendConfirmation,
    sendBulkConfirmations,
    resendBulkConfirmations,
    sendPostponementAnnouncement,
    sendBulkPostponementAnnouncements,
    resendBulkPostponementAnnouncements,
    sendSingleZoomJoiningLink,
    sendBulkZoomJoiningLinks,
    resendBulkZoomJoiningLinks,
    sendBulkOneHourReminders,
    resendBulkOneHourReminders,
    getJoiningCampaignPreview,
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