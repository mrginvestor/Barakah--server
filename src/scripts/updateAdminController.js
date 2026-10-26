const fs = require('fs');
const path = require('path');

const targetFile = path.resolve(__dirname, '../controllers/adminRegistrationController.js');
let content = fs.readFileSync(targetFile, 'utf8');

// 1. Add Webinar import and helper functions
const importOld = "const WebinarRegistration = require('../models/WebinarRegistration');";
const importNew = `const WebinarRegistration = require('../models/WebinarRegistration');
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
}`;

if (!content.includes("const Webinar = require('../models/Webinar');")) {
  content = content.replace(importOld, importNew);
}

// 2. Update buildRegistrationFilter to support query.webinarId
const filterEditionOld = `  if (query.edition || query.webinarVersion) {`;
const filterEditionNew = `  if (query.webinarId && query.webinarId !== 'all') {
    const wid = String(query.webinarId).trim().toLowerCase();
    if (wid === 'halal-wealth-nov-2026' || wid.includes('november') || wid === 'nov1') {
      filter.webinarId = 'halal-wealth-nov-2026';
    } else if (wid === 'halal-wealth-oct-2026' || wid.includes('october') || wid === 'previous') {
      filter.webinarId = 'halal-wealth-oct-2026';
    } else {
      filter.webinarId = wid;
    }
  } else if (query.edition || query.webinarVersion) {`;

if (!content.includes("query.webinarId && query.webinarId !== 'all'")) {
  content = content.replace(filterEditionOld, filterEditionNew);
}

// 3. Inject webinarModel into createAdminRegistrationController parameters
const factoryOld = `function createAdminRegistrationController({
  registrationModel = WebinarRegistration,
  logger = console,
  emailService = webinarEmailService,
  campaignConfigModel = CampaignConfig,
} = {}) {`;

const factoryNew = `function createAdminRegistrationController({
  registrationModel = WebinarRegistration,
  logger = console,
  emailService = webinarEmailService,
  campaignConfigModel = CampaignConfig,
  webinarModel = Webinar,
} = {}) {`;

content = content.replace(factoryOld, factoryNew);

// 4. Update list method to scope summary to webinarScope
const listSummaryOld = `      const today = new Date();
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
              $group: {`;

const listSummaryNew = `      const today = new Date();
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
              $group: {`;

content = content.replace(listSummaryOld, listSummaryNew);

// 5. Update sendBulkConfirmations
const bulkConfOld = `  async function sendBulkConfirmations(req, res) {
    const sendToSent = req.body && req.body.includeSent === true;
    const queryResult = await registrationModel.find();
    const registrations = Array.isArray(queryResult)
      ? queryResult
      : maybeLean(queryResult && typeof queryResult.sort === 'function' ? queryResult.sort({ createdAt: -1 }) : queryResult) || [];`;

const bulkConfNew = `  async function sendBulkConfirmations(req, res) {
    const sendToSent = req.body && req.body.includeSent === true;
    const targetWebinar = req.body?.webinarId || req.query?.webinarId;
    const webinarFilter = getWebinarTargetFilter(req);
    const queryResult = await (typeof registrationModel.find === 'function' ? registrationModel.find(webinarFilter) : []);
    let registrations = Array.isArray(queryResult)
      ? queryResult
      : maybeLean(queryResult && typeof queryResult.sort === 'function' ? queryResult.sort({ createdAt: -1 }) : queryResult) || [];
    registrations = filterRegistrationsByWebinar(registrations, targetWebinar);`;

content = content.replace(bulkConfOld, bulkConfNew);

// 6. Update sendBulkPostponementAnnouncements
const bulkPostOld = `    const delayMs = Number.isFinite(Number(req.body?.delayMs)) ? Number(req.body.delayMs) : 250;

    const queryResult = await registrationModel.find();
    const registrations = Array.isArray(queryResult)
      ? queryResult
      : maybeLean(queryResult && typeof queryResult.sort === 'function' ? queryResult.sort({ createdAt: -1 }) : queryResult) || [];`;

const bulkPostNew = `    const delayMs = Number.isFinite(Number(req.body?.delayMs)) ? Number(req.body.delayMs) : 250;
    const targetWebinar = req.body?.webinarId || req.query?.webinarId;
    const webinarFilter = getWebinarTargetFilter(req);
    const queryResult = await (typeof registrationModel.find === 'function' ? registrationModel.find(webinarFilter) : []);
    let registrations = Array.isArray(queryResult)
      ? queryResult
      : maybeLean(queryResult && typeof queryResult.sort === 'function' ? queryResult.sort({ createdAt: -1 }) : queryResult) || [];
    registrations = filterRegistrationsByWebinar(registrations, targetWebinar);`;

content = content.replace(bulkPostOld, bulkPostNew);

// 7. Update sendBulkZoomJoiningLinks
const bulkZoomOld = `    const delayMs = Number.isFinite(Number(req.body?.delayMs)) ? Number(req.body.delayMs) : 250;

    const queryResult = await registrationModel.find();
    const registrations = Array.isArray(queryResult)
      ? queryResult
      : maybeLean(queryResult && typeof queryResult.sort === 'function' ? queryResult.sort({ createdAt: -1 }) : queryResult) || [];`;

const bulkZoomNew = `    const delayMs = Number.isFinite(Number(req.body?.delayMs)) ? Number(req.body.delayMs) : 250;
    const targetWebinar = req.body?.webinarId || req.query?.webinarId;
    const webinarFilter = getWebinarTargetFilter(req);
    const queryResult = await (typeof registrationModel.find === 'function' ? registrationModel.find(webinarFilter) : []);
    let registrations = Array.isArray(queryResult)
      ? queryResult
      : maybeLean(queryResult && typeof queryResult.sort === 'function' ? queryResult.sort({ createdAt: -1 }) : queryResult) || [];
    registrations = filterRegistrationsByWebinar(registrations, targetWebinar);`;

content = content.replace(bulkZoomOld, bulkZoomNew);

// 8. Update getJoiningCampaignPreview
const zoomPreviewOld = `  async function getJoiningCampaignPreview(req, res) {
    try {
      const queryResult = await registrationModel.find();
      const registrations = Array.isArray(queryResult)
        ? queryResult
        : maybeLean(queryResult && typeof queryResult.sort === 'function' ? queryResult.sort({ createdAt: -1 }) : queryResult) || [];`;

const zoomPreviewNew = `  async function getJoiningCampaignPreview(req, res) {
    try {
      const targetWebinar = req.body?.webinarId || req.query?.webinarId;
      const webinarFilter = getWebinarTargetFilter(req);
      const queryResult = await (typeof registrationModel.find === 'function' ? registrationModel.find(webinarFilter) : []);
      let registrations = Array.isArray(queryResult)
        ? queryResult
        : maybeLean(queryResult && typeof queryResult.sort === 'function' ? queryResult.sort({ createdAt: -1 }) : queryResult) || [];
      registrations = filterRegistrationsByWebinar(registrations, targetWebinar);`;

content = content.replace(zoomPreviewOld, zoomPreviewNew);

// 9. Update sendBulkOneHourReminders
const bulkReminderOld = `    try {
      const queryResult = await registrationModel.find();
      const registrations = Array.isArray(queryResult)
        ? queryResult
        : maybeLean(queryResult && typeof queryResult.sort === 'function' ? queryResult.sort({ createdAt: -1 }) : queryResult) || [];`;

const bulkReminderNew = `    try {
      const targetWebinar = req.body?.webinarId || req.query?.webinarId;
      const webinarFilter = getWebinarTargetFilter(req);
      const queryResult = await (typeof registrationModel.find === 'function' ? registrationModel.find(webinarFilter) : []);
      let registrations = Array.isArray(queryResult)
        ? queryResult
        : maybeLean(queryResult && typeof queryResult.sort === 'function' ? queryResult.sort({ createdAt: -1 }) : queryResult) || [];
      registrations = filterRegistrationsByWebinar(registrations, targetWebinar);`;

content = content.replace(bulkReminderOld, bulkReminderNew);

// 10. Update getFeedbackCampaignPreview
const feedbackPreviewOld = `  async function getFeedbackCampaignPreview(req, res) {
    try {
      const config = await getActiveFeedbackConfig();
      const queryResult = await registrationModel.find();
      const registrations = Array.isArray(queryResult)
        ? queryResult
        : maybeLean(queryResult && typeof queryResult.sort === 'function' ? queryResult.sort({ createdAt: -1 }) : queryResult) || [];`;

const feedbackPreviewNew = `  async function getFeedbackCampaignPreview(req, res) {
    try {
      const config = await getActiveFeedbackConfig();
      const targetWebinar = req.body?.webinarId || req.query?.webinarId;
      const webinarFilter = getWebinarTargetFilter(req);
      const queryResult = await (typeof registrationModel.find === 'function' ? registrationModel.find(webinarFilter) : []);
      let registrations = Array.isArray(queryResult)
        ? queryResult
        : maybeLean(queryResult && typeof queryResult.sort === 'function' ? queryResult.sort({ createdAt: -1 }) : queryResult) || [];
      registrations = filterRegistrationsByWebinar(registrations, targetWebinar);`;

content = content.replace(feedbackPreviewOld, feedbackPreviewNew);

// 11. Update sendBulkFeedbackEmails
const bulkFeedbackOld = `    try {
      const config = await getActiveFeedbackConfig();
      const queryResult = await registrationModel.find();
      const registrations = Array.isArray(queryResult)
        ? queryResult
        : maybeLean(queryResult && typeof queryResult.sort === 'function' ? queryResult.sort({ createdAt: -1 }) : queryResult) || [];`;

const bulkFeedbackNew = `    try {
      const config = await getActiveFeedbackConfig();
      const targetWebinar = req.body?.webinarId || req.query?.webinarId;
      const webinarFilter = getWebinarTargetFilter(req);
      const queryResult = await (typeof registrationModel.find === 'function' ? registrationModel.find(webinarFilter) : []);
      let registrations = Array.isArray(queryResult)
        ? queryResult
        : maybeLean(queryResult && typeof queryResult.sort === 'function' ? queryResult.sort({ createdAt: -1 }) : queryResult) || [];
      registrations = filterRegistrationsByWebinar(registrations, targetWebinar);`;

content = content.replace(bulkFeedbackOld, bulkFeedbackNew);

// 12. Add getWebinars method and export it
const getWebinarsCode = `  async function getWebinars(req, res) {
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

  return {
    getWebinars,`;

content = content.replace('  return {\n    list,', getWebinarsCode + '\n    list,');

// Also export buildWebinarScope
content = content.replace(
  '  REGISTRATION_STATUSES,\n  buildRegistrationFilter,',
  '  REGISTRATION_STATUSES,\n  buildWebinarScope,\n  buildRegistrationFilter,'
);

fs.writeFileSync(targetFile, content, 'utf8');
console.log('Successfully updated adminRegistrationController.js');

