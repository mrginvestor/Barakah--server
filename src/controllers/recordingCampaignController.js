const { defaultRecordingCampaignService } = require('../services/recordingCampaignService');
const defaultEmailService = require('../services/webinarEmailService');

function createRecordingCampaignController({
  campaignService = defaultRecordingCampaignService,
  emailService = defaultEmailService,
  logger = console,
} = {}) {
  async function sync(req, res) {
    try {
      const webinarId = req?.body?.webinarId || req?.query?.webinarId || req?.query?.edition || 'halal-wealth-nov-2026';
      const result = await campaignService.syncEligibleRegistrants({ webinarId });
      return res.status(200).json({
        success: true,
        message: `Synchronized ${result.synced} recording delivery tracking records for ${webinarId}.`,
        result,
      });
    } catch (error) {
      logger.error('Failed to sync recording campaign delivery records:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to sync recording campaign delivery records.',
        error: error.message,
      });
    }
  }

  async function preview(req, res) {
    try {
      const page = req?.query?.page ? parseInt(req.query.page, 10) : 1;
      const limit = req?.query?.limit ? parseInt(req.query.limit, 10) : 50;
      const search = req?.query?.search || req?.query?.q || '';
      const webinarId = req?.query?.webinarId || req?.query?.edition || 'halal-wealth-nov-2026';

      const result = await campaignService.previewRecipients({ page, limit, search, webinarId });
      return res.status(200).json(result);
    } catch (error) {
      logger.error('Failed to preview recording campaign recipients:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to preview recording campaign recipients.',
        error: error.message,
      });
    }
  }

  async function status(req, res) {
    try {
      const webinarId = req?.query?.webinarId || req?.query?.edition || 'halal-wealth-nov-2026';
      const summary = await campaignService.getCampaignStats({ webinarId });
      const statusState = campaignService.getActiveCampaignStatus();
      return res.status(200).json({
        success: true,
        summary,
        webinarId,
        isRunning: statusState.isRunning,
        activeState: statusState.activeState,
      });
    } catch (error) {
      logger.error('Failed to get recording campaign status:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to retrieve recording campaign status.',
        error: error.message,
      });
    }
  }

  async function send(req, res) {
    try {
      const { confirmed } = req?.body || {};
      if (!confirmed) {
        return res.status(400).json({
          success: false,
          message: 'Explicit admin confirmation is required to initiate the recording campaign send.',
        });
      }

      const adminUser = req?.admin?.email || req?.admin?.username || 'admin';
      const webinarId = req?.body?.webinarId || req?.query?.webinarId || 'halal-wealth-nov-2026';

      const result = await campaignService.sendRecordingEmails({
        adminUser,
        scope: 'pending',
        webinarId,
      });

      return res.status(200).json({
        success: true,
        message: result.message,
        data: result,
      });
    } catch (error) {
      if (error.statusCode === 409 || error.code === 'CAMPAIGN_ALREADY_RUNNING') {
        return res.status(409).json({
          success: false,
          message: error.message,
          code: 'CAMPAIGN_ALREADY_RUNNING',
        });
      }
      logger.error('Failed to start recording campaign send:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to dispatch recording campaign emails.',
        error: error.message,
      });
    }
  }

  async function retryFailed(req, res) {
    try {
      const { confirmed } = req?.body || {};
      if (!confirmed) {
        return res.status(400).json({
          success: false,
          message: 'Explicit admin confirmation is required to retry failed recording emails.',
        });
      }

      const adminUser = req?.admin?.email || req?.admin?.username || 'admin';
      const webinarId = req?.body?.webinarId || req?.query?.webinarId || 'halal-wealth-nov-2026';

      const result = await campaignService.retryFailedRecordingEmails({
        adminUser,
        webinarId,
      });

      return res.status(200).json({
        success: true,
        message: result.message,
        data: result,
      });
    } catch (error) {
      if (error.statusCode === 409 || error.code === 'CAMPAIGN_ALREADY_RUNNING') {
        return res.status(409).json({
          success: false,
          message: error.message,
          code: 'CAMPAIGN_ALREADY_RUNNING',
        });
      }
      logger.error('Failed to retry recording campaign send:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to retry failed recording campaign emails.',
        error: error.message,
      });
    }
  }

  async function sendIndividual(req, res) {
    try {
      const { registrationId, forceResend } = req?.body || {};
      if (!registrationId) {
        return res.status(400).json({
          success: false,
          message: 'Please provide a valid participant registrationId.',
        });
      }

      const adminUser = req?.admin?.email || req?.admin?.username || 'admin';
      const result = await campaignService.sendIndividualRecordingEmail({
        registrationId,
        forceResend: Boolean(forceResend),
        adminUser,
      });

      return res.status(200).json(result);
    } catch (error) {
      logger.error('Failed to dispatch individual recording email:', error);
      return res.status(500).json({
        success: false,
        message: error.message || 'Failed to dispatch individual recording email.',
      });
    }
  }

  async function testSend(req, res) {
    try {
      const { testEmail, recipientName } = req?.body || {};
      const cleanEmail = String(testEmail || '').trim().toLowerCase();

      if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        return res.status(400).json({
          success: false,
          message: 'Please provide a valid test email address.',
        });
      }

      const result = await emailService.sendRecordingEmail(cleanEmail, recipientName || 'Test Attendee');

      return res.status(200).json({
        success: true,
        message: `Test recording email sent successfully to ${cleanEmail}.`,
        messageId: result?.messageId || null,
      });
    } catch (error) {
      logger.error('Failed to send test recording email:', error);
      return res.status(500).json({
        success: false,
        message: error.diagnosticMessage || error.message || 'Failed to send test recording email.',
      });
    }
  }

  return {
    sync,
    preview,
    status,
    send,
    retryFailed,
    sendIndividual,
    testSend,
  };
}

module.exports = {
  createRecordingCampaignController,
  defaultRecordingCampaignController: createRecordingCampaignController(),
};
