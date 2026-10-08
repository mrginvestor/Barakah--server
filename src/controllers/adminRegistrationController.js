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

function normalizeEmailTracking(registration = {}) {
  const normalized = { ...registration };
  normalized.confirmationEmailSent = normalized.confirmationEmailSent === true;
  normalized.confirmationEmailSentAt = normalized.confirmationEmailSentAt || null;
  normalized.confirmationEmailLastError = normalized.confirmationEmailLastError || null;
  normalized.emailStatus = normalizeEmailStatus(normalized);
  return normalized;
}

function maybeLean(value) {
  if (!value) return value;
  if (typeof value.lean === 'function') return value.lean();
  return value;
}

function csvCell(value) {
  let text = value instanceof Date ? value.toISOString() : Array.isArray(value) ? value.join('; ') : value == null ? '' : String(value);
  if (/^[\t\r ]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function createAdminRegistrationController({ registrationModel = WebinarRegistration, logger = console, emailService = webinarEmailService } = {}) {
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
              },
            }],
          },
        },
      ]);
      const summary = result.summary?.[0] || { total: 0, today: 0, verified: 0, pending: 0 };
      const total = result.filteredTotal?.[0]?.count || 0;
      return res.json({
        data: result.data || [],
        summary: { total: summary.total, today: summary.today, verified: summary.verified, pending: summary.pending },
        pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
      });
    } catch (error) {
      if (error.message.startsWith('Invalid ') || error.message.startsWith('The start date')) {
        return res.status(400).json({ message: error.message });
      }
      logger.error('Admin registration listing failed.', { code: error.code || 'ADMIN_LIST_FAILED' });
      return res.status(500).json({ message: 'Registrations could not be loaded right now.' });
    }
  }

  async function getById(req, res) {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Registration not found.' });
    try {
      const registration = maybeLean(await registrationModel.findById(req.params.id));
      if (!registration) return res.status(404).json({ message: 'Registration not found.' });
      return res.json({ data: normalizeEmailTracking(normalizeStatus(registration)) });
    } catch (error) {
      logger.error('Admin registration detail lookup failed.', { code: error.code || 'ADMIN_DETAIL_FAILED' });
      return res.status(500).json({ message: 'Registration details could not be loaded right now.' });
    }
  }

  async function markConfirmationResult(registrationId, { success, errorMessage, email, fullName }) {
    const update = success
      ? { confirmationEmailSent: true, confirmationEmailSentAt: new Date(), confirmationEmailLastError: null }
      : { confirmationEmailSent: false, confirmationEmailSentAt: null, confirmationEmailLastError: String(errorMessage || 'Email delivery failed.').slice(0, 500) };

    const updatedRegistration = maybeLean(await registrationModel.findByIdAndUpdate(
      registrationId,
      { $set: update },
      { new: true, runValidators: true },
    ));

    if (!updatedRegistration) return null;
    const mergedRegistration = {
      ...(updatedRegistration || {}),
      _id: registrationId,
      email: email || updatedRegistration.email,
      fullName: fullName || updatedRegistration.fullName,
      ...update,
    };
    return normalizeEmailTracking(normalizeStatus(mergedRegistration));
  }

  async function sendConfirmation(req, res) {
    try {
      const registration = maybeLean(await registrationModel.findById(req.params.id));
      if (!registration) return res.status(404).json({ message: 'Registration not found.' });
      if (!registration.email) return res.status(400).json({ message: 'This registration does not have a valid email address.' });

      await emailService.sendRegistrationConfirmation(registration.email, registration.fullName);
      const updatedRegistration = await markConfirmationResult(registration._id, {
        success: true,
        email: registration.email,
        fullName: registration.fullName,
      });
      logger.info('Admin confirmation email sent.', { registrationId: registration._id, email: registration.email });
      return res.json({ success: true, message: 'Confirmation email sent successfully.', data: updatedRegistration });
    } catch (error) {
      const registration = maybeLean(await registrationModel.findById(req.params.id));
      const updatedRegistration = registration ? await markConfirmationResult(registration._id, {
        success: false,
        errorMessage: error.message || 'Email could not be sent right now.',
        email: registration.email,
        fullName: registration.fullName,
      }) : null;
      logger.error('Admin confirmation email send failed.', {
        code: error.code || 'ADMIN_EMAIL_SEND_FAILED',
        registrationId: req.params.id,
        email: registration?.email,
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
      try {
        await emailService.sendRegistrationConfirmation(registration.email, registration.fullName);
        await markConfirmationResult(registration._id, { success: true, email: registration.email, fullName: registration.fullName });
        summary.sent += 1;
        sentEmails.push(registration.email);
      } catch (error) {
        await markConfirmationResult(registration._id, { success: false, errorMessage: error.message || 'Email delivery failed.', email: registration.email, fullName: registration.fullName });
        summary.failed += 1;
        failedEmails.push(registration.email);
        logger.error('Bulk confirmation email failed.', {
          code: error.code || 'ADMIN_EMAIL_BATCH_FAILED',
          email: registration.email,
          registrationId: registration._id,
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

  async function updateStatus(req, res) {
    const { status } = req.body || {};
    if (!REGISTRATION_STATUSES.includes(status)) {
      return res.status(400).json({ message: 'Choose a valid registration status.' });
    }
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Registration not found.' });
    try {
      const registration = maybeLean(await registrationModel.findByIdAndUpdate(
        req.params.id,
        { $set: { status } },
        { new: true, runValidators: true },
      ));
      if (!registration) return res.status(404).json({ message: 'Registration not found.' });
      return res.json({ success: true, data: normalizeStatus(registration) });
    } catch (error) {
      logger.error('Admin registration status update failed.', { code: error.code || 'ADMIN_STATUS_FAILED' });
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
      logger.error('Admin registration export failed.', { code: error.code || 'ADMIN_EXPORT_FAILED' });
      if (res.headersSent) return res.destroy(error);
      return res.status(error.message.startsWith('Invalid ') || error.message.startsWith('The start date') ? 400 : 500)
        .json({ message: 'Registration data could not be exported.' });
    } finally {
      if (cursor) await cursor.close().catch(() => {});
    }
  }

  return { list, getById, sendConfirmation, sendBulkConfirmations, resendBulkConfirmations, updateStatus, exportCsv };
}

module.exports = {
  PAGE_SIZES,
  REGISTRATION_STATUSES,
  buildRegistrationFilter,
  createAdminRegistrationController,
  csvCell,
  ...createAdminRegistrationController(),
};