const express = require('express');
const rateLimit = require('express-rate-limit');
const { createAdminAuthController } = require('../controllers/adminAuthController');
const { createAdminRegistrationController } = require('../controllers/adminRegistrationController');
const { createRecordingCampaignController } = require('../controllers/recordingCampaignController');
const { createReminderCampaignController } = require('../controllers/reminderCampaignController');
const { createFeedbackCampaignController } = require('../controllers/feedbackCampaignController');
const { requireAdmin } = require('../middleware/requireAdmin');

const router = express.Router();
const authController = createAdminAuthController();
const registrationController = createAdminRegistrationController();
const recordingCampaignController = createRecordingCampaignController();
const reminderCampaignController = createReminderCampaignController();
const feedbackCampaignController = createFeedbackCampaignController();
const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { message: 'Too many login attempts. Please try again later.' },
});

router.post('/login', loginRateLimit, authController.login);
router.use(requireAdmin);
router.get('/session', authController.getSession);
router.get('/email/diagnostic', registrationController.getEmailDiagnostic);
router.post('/email/test-send', registrationController.sendTestDiagnosticEmail);
router.get('/webinars', registrationController.getWebinars);
router.get('/registrations/export', registrationController.exportCsv);
router.get('/registrations/joining-campaign', registrationController.getJoiningCampaignPreview);
router.get('/registrations', registrationController.list);
router.get('/registrations/:id', registrationController.getById);
router.get('/registrations/bulk-email/preview', registrationController.getBulkEmailPreview);
router.post('/registrations/bulk-email', registrationController.startBulkEmailJob);
router.get('/registrations/bulk-email/active', registrationController.getActiveBulkEmailJob);
router.get('/registrations/bulk-email/:jobId', registrationController.getBulkEmailJobStatus);
router.post('/registrations/bulk-email/:jobId/cancel', registrationController.cancelBulkEmailJob);
router.post('/registrations/send-confirmations', registrationController.sendBulkConfirmations);
router.post('/registrations/resend-confirmations', registrationController.resendBulkConfirmations);
router.post('/registrations/:id/send-confirmation', registrationController.sendConfirmation);
router.post('/registrations/:id/resend-confirmation', registrationController.sendConfirmation);
router.post('/registrations/:id/retry', registrationController.sendConfirmation);
router.post('/registrations/:id/retry-confirmation', registrationController.sendConfirmation);
router.post('/registrations/send-postponement', registrationController.sendBulkPostponementAnnouncements);
router.post('/registrations/resend-postponement', registrationController.resendBulkPostponementAnnouncements);
router.post('/registrations/:id/send-postponement', registrationController.sendPostponementAnnouncement);
router.post('/registrations/send-joining-link', registrationController.sendBulkZoomJoiningLinks);
router.post('/registrations/resend-joining-link', registrationController.resendBulkZoomJoiningLinks);
router.post('/registrations/:id/send-joining-link', registrationController.sendSingleZoomJoiningLink);
router.post('/registrations/send-starting-reminder', registrationController.sendBulkOneHourReminders);
router.post('/registrations/resend-starting-reminder', registrationController.resendBulkOneHourReminders);
router.get('/campaigns/feedback/preview', registrationController.getFeedbackCampaignPreview);
router.put('/campaigns/feedback/config', registrationController.updateFeedbackCampaignConfig);
router.post('/campaigns/feedback/send', registrationController.sendBulkFeedbackEmails);
router.post('/campaigns/feedback/resend', registrationController.resendBulkFeedbackEmails);
router.post('/registrations/:id/send-feedback', registrationController.sendSingleFeedbackEmail);
router.post('/registrations/:id/send-email', registrationController.sendIndividualEmail);
router.put('/registrations/:id/status', registrationController.updateStatus);

// Webinar Recording Sharing Campaign
router.post('/recording-campaign/sync', recordingCampaignController.sync);
router.get('/recording-campaign/preview', recordingCampaignController.preview);
router.get('/recording-campaign/status', recordingCampaignController.status);
router.post('/recording-campaign/send', recordingCampaignController.send);
router.post('/recording-campaign/retry-failed', recordingCampaignController.retryFailed);
router.post('/recording-campaign/send-individual', recordingCampaignController.sendIndividual);
router.post('/recording-campaign/test-send', recordingCampaignController.testSend);

// November 1 Webinar Reminder Campaign
router.get('/reminder-campaign/preview', reminderCampaignController.preview);
router.get('/reminder-campaign/status', reminderCampaignController.status);
router.post('/reminder-campaign/send', reminderCampaignController.send);
router.post('/reminder-campaign/retry-failed', reminderCampaignController.retryFailed);
router.post('/reminder-campaign/test-send', reminderCampaignController.testSend);

// Webinar Feedback Campaign
router.post('/feedback-campaign/sync', feedbackCampaignController.sync);
router.get('/feedback-campaign/preview', feedbackCampaignController.preview);
router.get('/feedback-campaign/status', feedbackCampaignController.status);
router.post('/feedback-campaign/send', feedbackCampaignController.send);
router.post('/feedback-campaign/retry-failed', feedbackCampaignController.retryFailed);
router.post('/feedback-campaign/send-individual', feedbackCampaignController.sendIndividual);
router.post('/feedback-campaign/test-send', feedbackCampaignController.testSend);

module.exports = router;