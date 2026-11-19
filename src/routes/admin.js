const express = require('express');
const rateLimit = require('express-rate-limit');
const { createAdminAuthController } = require('../controllers/adminAuthController');
const { createAdminRegistrationController } = require('../controllers/adminRegistrationController');
const { createRecordingCampaignController } = require('../controllers/recordingCampaignController');
const { createReminderCampaignController } = require('../controllers/reminderCampaignController');
const { createFeedbackCampaignController } = require('../controllers/feedbackCampaignController');
const {
  getAdminSummitRegistrations,
  getAdminSummitStats,
  getPaymentReceiptFile,
  approveSummitRegistration,
  approveSummitPayment,
  rejectSummitRegistration,
  rejectSummitPayment,
  recordOfflinePayment,
  addAdminVerificationNotes,
  checkInParticipant,
  getAttendanceStats,
  exportAttendanceCsv,
  resendConfirmationEmail,
  resendAcknowledgementEmail,
  getInvestorMissionEmailDiagnostic,
} = require('../controllers/summitController');
const { requireAdmin, requireInvestorMissionAdmin } = require('../middleware/requireAdmin');

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

// Authentication endpoints
router.post('/login', loginRateLimit, authController.login);
router.post('/investor-mission/login', loginRateLimit, authController.loginInvestorMissionAdmin);
router.post('/investor-mission-admin/login', loginRateLimit, authController.loginInvestorMissionAdmin);

// Session endpoint (Accessible by both ROLE_ADMIN and INVESTOR_MISSION_ADMIN)
router.get('/session', requireInvestorMissionAdmin, authController.getSession);

// Investor Mission Password Change
router.post('/investor-mission/change-password', requireInvestorMissionAdmin, authController.changePassword);

// ============================================================================
// INVESTOR MISSION 2026 EVENT OPERATIONS (ROLE_ADMIN & INVESTOR_MISSION_ADMIN)
// ============================================================================
router.get('/investor-mission/stats', requireInvestorMissionAdmin, getAdminSummitStats);
router.get('/investor-mission/registrations', requireInvestorMissionAdmin, getAdminSummitRegistrations);
router.get('/investor-mission/receipt/:registrationId', requireInvestorMissionAdmin, getPaymentReceiptFile);
router.post('/investor-mission/registrations/:registrationId/approve-registration', requireInvestorMissionAdmin, approveSummitRegistration);
router.post('/investor-mission/registrations/:registrationId/approve-payment', requireInvestorMissionAdmin, approveSummitPayment);
router.post('/investor-mission/registrations/:registrationId/approve', requireInvestorMissionAdmin, approveSummitPayment);
router.post('/investor-mission/registrations/:registrationId/reject-registration', requireInvestorMissionAdmin, rejectSummitRegistration);
router.post('/investor-mission/registrations/:registrationId/reject-payment', requireInvestorMissionAdmin, rejectSummitPayment);
router.post('/investor-mission/registrations/:registrationId/reject', requireInvestorMissionAdmin, rejectSummitPayment);
router.post('/investor-mission/registrations/:registrationId/record-offline-payment', requireInvestorMissionAdmin, recordOfflinePayment);
router.post('/investor-mission/registrations/:registrationId/notes', requireInvestorMissionAdmin, addAdminVerificationNotes);
router.get('/investor-mission/email-diagnostic', requireInvestorMissionAdmin, getInvestorMissionEmailDiagnostic);
router.post('/investor-mission/registrations/:registrationId/resend-confirmation', requireInvestorMissionAdmin, resendConfirmationEmail);
router.post('/investor-mission/registrations/:registrationId/send-confirmation', requireInvestorMissionAdmin, resendConfirmationEmail);
router.post('/investor-mission/registrations/:registrationId/resend-acknowledgement', requireInvestorMissionAdmin, resendAcknowledgementEmail);
router.post('/investor-mission/checkin', requireInvestorMissionAdmin, checkInParticipant);
router.get('/investor-mission/attendance', requireInvestorMissionAdmin, getAttendanceStats);
router.get('/investor-mission/attendance/export', requireInvestorMissionAdmin, exportAttendanceCsv);

// DEC Summit Event Registrations & Multi-Step Verification Operations (Aliases)
router.get('/dec-summit/email-diagnostic', requireInvestorMissionAdmin, getInvestorMissionEmailDiagnostic);
router.get('/dec-summit/stats', requireInvestorMissionAdmin, getAdminSummitStats);
router.get('/dec-summit/registrations', requireInvestorMissionAdmin, getAdminSummitRegistrations);
router.get('/dec-summit/receipt/:registrationId', requireInvestorMissionAdmin, getPaymentReceiptFile);
router.post('/dec-summit/registrations/:registrationId/approve-registration', requireInvestorMissionAdmin, approveSummitRegistration);
router.post('/dec-summit/registrations/:registrationId/approve-payment', requireInvestorMissionAdmin, approveSummitPayment);
router.post('/dec-summit/registrations/:registrationId/approve', requireInvestorMissionAdmin, approveSummitPayment);
router.post('/dec-summit/registrations/:registrationId/reject-registration', requireInvestorMissionAdmin, rejectSummitRegistration);
router.post('/dec-summit/registrations/:registrationId/reject-payment', requireInvestorMissionAdmin, rejectSummitPayment);
router.post('/dec-summit/registrations/:registrationId/reject', requireInvestorMissionAdmin, rejectSummitPayment);
router.post('/dec-summit/registrations/:registrationId/record-offline-payment', requireInvestorMissionAdmin, recordOfflinePayment);
router.post('/dec-summit/registrations/:registrationId/notes', requireInvestorMissionAdmin, addAdminVerificationNotes);
router.post('/dec-summit/registrations/:registrationId/resend-confirmation', requireInvestorMissionAdmin, resendConfirmationEmail);
router.post('/dec-summit/registrations/:registrationId/send-confirmation', requireInvestorMissionAdmin, resendConfirmationEmail);
router.post('/dec-summit/registrations/:registrationId/resend-acknowledgement', requireInvestorMissionAdmin, resendAcknowledgementEmail);
router.post('/dec-summit/checkin', requireInvestorMissionAdmin, checkInParticipant);
router.get('/dec-summit/attendance', requireInvestorMissionAdmin, getAttendanceStats);
router.get('/dec-summit/attendance/export', requireInvestorMissionAdmin, exportAttendanceCsv);

// Backward-compatibility aliases for /small-summit/*
router.get('/small-summit/stats', requireInvestorMissionAdmin, getAdminSummitStats);
router.get('/small-summit/registrations', requireInvestorMissionAdmin, getAdminSummitRegistrations);
router.get('/small-summit/receipt/:registrationId', requireInvestorMissionAdmin, getPaymentReceiptFile);
router.post('/small-summit/registrations/:registrationId/approve-registration', requireInvestorMissionAdmin, approveSummitRegistration);
router.post('/small-summit/registrations/:registrationId/approve-payment', requireInvestorMissionAdmin, approveSummitPayment);
router.post('/small-summit/registrations/:registrationId/approve', requireInvestorMissionAdmin, approveSummitPayment);
router.post('/small-summit/registrations/:registrationId/reject-registration', requireInvestorMissionAdmin, rejectSummitRegistration);
router.post('/small-summit/registrations/:registrationId/reject-payment', requireInvestorMissionAdmin, rejectSummitPayment);
router.post('/small-summit/registrations/:registrationId/reject', requireInvestorMissionAdmin, rejectSummitPayment);
router.post('/small-summit/registrations/:registrationId/record-offline-payment', requireInvestorMissionAdmin, recordOfflinePayment);
router.post('/small-summit/registrations/:registrationId/notes', requireInvestorMissionAdmin, addAdminVerificationNotes);
router.post('/small-summit/registrations/:registrationId/resend-confirmation', requireInvestorMissionAdmin, resendConfirmationEmail);
router.post('/small-summit/registrations/:registrationId/send-confirmation', requireInvestorMissionAdmin, resendConfirmationEmail);
router.post('/small-summit/registrations/:registrationId/resend-acknowledgement', requireInvestorMissionAdmin, resendAcknowledgementEmail);
router.post('/small-summit/checkin', requireInvestorMissionAdmin, checkInParticipant);
router.get('/small-summit/attendance', requireInvestorMissionAdmin, getAttendanceStats);
router.get('/small-summit/attendance/export', requireInvestorMissionAdmin, exportAttendanceCsv);

// Backward-compatibility aliases for /summit/*
router.get('/summit/stats', requireInvestorMissionAdmin, getAdminSummitStats);
router.get('/summit/registrations', requireInvestorMissionAdmin, getAdminSummitRegistrations);
router.get('/summit/receipt/:registrationId', requireInvestorMissionAdmin, getPaymentReceiptFile);
router.post('/summit/registrations/:registrationId/approve-registration', requireInvestorMissionAdmin, approveSummitRegistration);
router.post('/summit/registrations/:registrationId/approve-payment', requireInvestorMissionAdmin, approveSummitPayment);
router.post('/summit/registrations/:registrationId/approve', requireInvestorMissionAdmin, approveSummitPayment);
router.post('/summit/registrations/:registrationId/reject-registration', requireInvestorMissionAdmin, rejectSummitRegistration);
router.post('/summit/registrations/:registrationId/reject-payment', requireInvestorMissionAdmin, rejectSummitPayment);
router.post('/summit/registrations/:registrationId/reject', requireInvestorMissionAdmin, rejectSummitPayment);
router.post('/summit/registrations/:registrationId/record-offline-payment', requireInvestorMissionAdmin, recordOfflinePayment);
router.post('/summit/registrations/:registrationId/notes', requireInvestorMissionAdmin, addAdminVerificationNotes);

// ============================================================================
// MAIN SUMMIT & WEBINAR OPERATIONS (RESTRICTED TO ROLE_ADMIN ONLY)
// ============================================================================
router.use(requireAdmin);

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