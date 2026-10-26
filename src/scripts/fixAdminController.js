const fs = require('fs');
const path = require('path');

const targetFile = path.resolve(__dirname, '../controllers/adminRegistrationController.js');
let content = fs.readFileSync(targetFile, 'utf8');
const isCRLF = content.includes('\r\n');

function normalizeNewlines(str) {
  return str.replace(/\r\n/g, '\n');
}

let normalized = normalizeNewlines(content);

// 1. Factory function parameters
const factoryTarget = `function createAdminRegistrationController({
  registrationModel = WebinarRegistration,
  logger = console,
  emailService = webinarEmailService,
  campaignConfigModel = CampaignConfig,
} = {}) {`;

const factoryReplacement = `function createAdminRegistrationController({
  registrationModel = WebinarRegistration,
  logger = console,
  emailService = webinarEmailService,
  campaignConfigModel = CampaignConfig,
  webinarModel = Webinar,
} = {}) {`;

if (normalized.includes(factoryTarget)) {
  normalized = normalized.replace(factoryTarget, factoryReplacement);
  console.log('1. Replaced factory parameters successfully');
} else {
  console.error('1. Factory parameters target not found!');
}

// 2. list summary scoping
const listTarget = `      const today = new Date();
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

const listReplacement = `      const today = new Date();
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

if (normalized.includes(listTarget)) {
  normalized = normalized.replace(listTarget, listReplacement);
  console.log('2. Replaced list summary scoping successfully');
} else {
  console.error('2. list summary scoping target not found!');
}

// 3. sendBulkConfirmations
const bulkConfTarget = `  async function sendBulkConfirmations(req, res) {
    const sendToSent = req.body && req.body.includeSent === true;
    const queryResult = await registrationModel.find();
    const registrations = Array.isArray(queryResult)
      ? queryResult
      : maybeLean(queryResult && typeof queryResult.sort === 'function' ? queryResult.sort({ createdAt: -1 }) : queryResult) || [];`;

const bulkConfReplacement = `  async function sendBulkConfirmations(req, res) {
    const sendToSent = req.body && req.body.includeSent === true;
    const targetWebinar = req.body?.webinarId || req.query?.webinarId;
    const webinarFilter = getWebinarTargetFilter(req);
    const queryResult = await (typeof registrationModel.find === 'function' ? (Object.keys(webinarFilter).length > 0 ? registrationModel.find(webinarFilter) : registrationModel.find()) : []);
    let registrations = Array.isArray(queryResult)
      ? queryResult
      : maybeLean(queryResult && typeof queryResult.sort === 'function' ? queryResult.sort({ createdAt: -1 }) : queryResult) || [];
    registrations = filterRegistrationsByWebinar(registrations, targetWebinar);`;

if (normalized.includes(bulkConfTarget)) {
  normalized = normalized.replace(bulkConfTarget, bulkConfReplacement);
  console.log('3. Replaced sendBulkConfirmations successfully');
} else {
  console.error('3. sendBulkConfirmations target not found!');
}

// 4. sendBulkPostponementAnnouncements
const bulkPostTarget = `    const delayMs = Number.isFinite(Number(req.body?.delayMs)) ? Number(req.body.delayMs) : 250;

    const queryResult = await registrationModel.find();
    const registrations = Array.isArray(queryResult)
      ? queryResult
      : maybeLean(queryResult && typeof queryResult.sort === 'function' ? queryResult.sort({ createdAt: -1 }) : queryResult) || [];`;

const bulkPostReplacement = `    const delayMs = Number.isFinite(Number(req.body?.delayMs)) ? Number(req.body.delayMs) : 250;
    const targetWebinar = req.body?.webinarId || req.query?.webinarId;
    const webinarFilter = getWebinarTargetFilter(req);
    const queryResult = await (typeof registrationModel.find === 'function' ? (Object.keys(webinarFilter).length > 0 ? registrationModel.find(webinarFilter) : registrationModel.find()) : []);
    let registrations = Array.isArray(queryResult)
      ? queryResult
      : maybeLean(queryResult && typeof queryResult.sort === 'function' ? queryResult.sort({ createdAt: -1 }) : queryResult) || [];
    registrations = filterRegistrationsByWebinar(registrations, targetWebinar);`;

if (normalized.includes(bulkPostTarget)) {
  normalized = normalized.replace(bulkPostTarget, bulkPostReplacement);
  console.log('4. Replaced sendBulkPostponementAnnouncements successfully');
} else {
  console.error('4. sendBulkPostponementAnnouncements target not found!');
}

// 5. sendBulkZoomJoiningLinks
const bulkZoomTarget = `  async function sendBulkZoomJoiningLinks(req, res) {
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
      : maybeLean(queryResult && typeof queryResult.sort === 'function' ? queryResult.sort({ createdAt: -1 }) : queryResult) || [];`;

const bulkZoomReplacement = `  async function sendBulkZoomJoiningLinks(req, res) {
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
    registrations = filterRegistrationsByWebinar(registrations, targetWebinar);`;

if (normalized.includes(bulkZoomTarget)) {
  normalized = normalized.replace(bulkZoomTarget, bulkZoomReplacement);
  console.log('5. Replaced sendBulkZoomJoiningLinks successfully');
} else {
  console.error('5. sendBulkZoomJoiningLinks target not found!');
}

// 6. getJoiningCampaignPreview
const zoomPreviewTarget = `  async function getJoiningCampaignPreview(req, res) {
    try {
      const queryResult = await registrationModel.find();
      const registrations = Array.isArray(queryResult)
        ? queryResult
        : maybeLean(queryResult && typeof queryResult.sort === 'function' ? queryResult.sort({ createdAt: -1 }) : queryResult) || [];`;

const zoomPreviewReplacement = `  async function getJoiningCampaignPreview(req, res) {
    try {
      const targetWebinar = req.body?.webinarId || req.query?.webinarId;
      const webinarFilter = getWebinarTargetFilter(req);
      const queryResult = await (typeof registrationModel.find === 'function' ? (Object.keys(webinarFilter).length > 0 ? registrationModel.find(webinarFilter) : registrationModel.find()) : []);
      let registrations = Array.isArray(queryResult)
        ? queryResult
        : maybeLean(queryResult && typeof queryResult.sort === 'function' ? queryResult.sort({ createdAt: -1 }) : queryResult) || [];
      registrations = filterRegistrationsByWebinar(registrations, targetWebinar);`;

if (normalized.includes(zoomPreviewTarget)) {
  normalized = normalized.replace(zoomPreviewTarget, zoomPreviewReplacement);
  console.log('6. Replaced getJoiningCampaignPreview successfully');
} else {
  console.error('6. getJoiningCampaignPreview target not found!');
}

// 7. sendBulkOneHourReminders
const bulkReminderTarget = `  async function sendBulkOneHourReminders(req, res) {
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
        : maybeLean(queryResult && typeof queryResult.sort === 'function' ? queryResult.sort({ createdAt: -1 }) : queryResult) || [];`;

const bulkReminderReplacement = `  async function sendBulkOneHourReminders(req, res) {
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
      registrations = filterRegistrationsByWebinar(registrations, targetWebinar);`;

if (normalized.includes(bulkReminderTarget)) {
  normalized = normalized.replace(bulkReminderTarget, bulkReminderReplacement);
  console.log('7. Replaced sendBulkOneHourReminders successfully');
} else {
  console.error('7. sendBulkOneHourReminders target not found!');
}

// 8. getFeedbackCampaignPreview
const feedbackPreviewTarget = `  async function getFeedbackCampaignPreview(req, res) {
    try {
      const config = await getActiveFeedbackConfig();
      const queryResult = await registrationModel.find();
      const registrations = Array.isArray(queryResult)
        ? queryResult
        : maybeLean(queryResult && typeof queryResult.sort === 'function' ? queryResult.sort({ createdAt: -1 }) : queryResult) || [];`;

const feedbackPreviewReplacement = `  async function getFeedbackCampaignPreview(req, res) {
    try {
      const config = await getActiveFeedbackConfig();
      const targetWebinar = req.body?.webinarId || req.query?.webinarId;
      const webinarFilter = getWebinarTargetFilter(req);
      const queryResult = await (typeof registrationModel.find === 'function' ? (Object.keys(webinarFilter).length > 0 ? registrationModel.find(webinarFilter) : registrationModel.find()) : []);
      let registrations = Array.isArray(queryResult)
        ? queryResult
        : maybeLean(queryResult && typeof queryResult.sort === 'function' ? queryResult.sort({ createdAt: -1 }) : queryResult) || [];
      registrations = filterRegistrationsByWebinar(registrations, targetWebinar);`;

if (normalized.includes(feedbackPreviewTarget)) {
  normalized = normalized.replace(feedbackPreviewTarget, feedbackPreviewReplacement);
  console.log('8. Replaced getFeedbackCampaignPreview successfully');
} else {
  console.error('8. getFeedbackCampaignPreview target not found!');
}

// 9. sendBulkFeedbackEmails
const bulkFeedbackTarget = `  async function sendBulkFeedbackEmails(req, res) {
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
      const queryResult = await registrationModel.find();
      const registrations = Array.isArray(queryResult)
        ? queryResult
        : maybeLean(queryResult && typeof queryResult.sort === 'function' ? queryResult.sort({ createdAt: -1 }) : queryResult) || [];`;

const bulkFeedbackReplacement = `  async function sendBulkFeedbackEmails(req, res) {
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
      registrations = filterRegistrationsByWebinar(registrations, targetWebinar);`;

if (normalized.includes(bulkFeedbackTarget)) {
  normalized = normalized.replace(bulkFeedbackTarget, bulkFeedbackReplacement);
  console.log('9. Replaced sendBulkFeedbackEmails successfully');
} else {
  console.error('9. sendBulkFeedbackEmails target not found!');
}

const finalContent = isCRLF ? normalized.replace(/\n/g, '\r\n') : normalized;
fs.writeFileSync(targetFile, finalContent, 'utf8');
console.log('Finished updating adminRegistrationController.js');

