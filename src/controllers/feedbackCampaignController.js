const { defaultFeedbackCampaignService } = require('../services/feedbackCampaignService');
const defaultEmailService = require('../services/webinarEmailService');

function createFeedbackCampaignController({
  campaignService = defaultFeedbackCampaignService,
  emailService = defaultEmailService,
  logger = console,
} = {}) {
  async function sync(req, res) {
    try {
      const webinarId = req?.body?.webinarId || req?.query?.webinarId || req?.query?.edition || 'halal-wealth-nov-2026';
      const result = await campaignService.syncEligibleRegistrants({ webinarId });
      return res.status(200).json({
        success: true,
        message: `Synchronized ${result.synced} delivery tracking records for ${webinarId}.`,
        result,
      });
    } catch (error) {
      logger.error('Failed to sync feedback campaign delivery records:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to sync feedback campaign delivery records.',
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
      logger.error('Failed to preview feedback campaign recipients:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to preview feedback campaign recipients.',
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
      logger.error('Failed to get feedback campaign status:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to retrieve feedback campaign status.',
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
          message: 'Explicit admin confirmation is required to initiate the feedback campaign send.',
        });
      }

      const adminUser = req?.admin?.email || req?.admin?.username || 'admin';
      const webinarId = req?.body?.webinarId || req?.query?.webinarId || 'halal-wealth-nov-2026';

      const result = await campaignService.sendFeedbackEmails({
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
      logger.error('Failed to send feedback campaign emails:', error);
      return res.status(error.message?.includes('already in progress') ? 409 : 500).json({
        success: false,
        message: error.message || 'Failed to dispatch feedback emails.',
      });
    }
  }

  async function retryFailed(req, res) {
    try {
      const { confirmed } = req?.body || {};
      if (!confirmed) {
        return res.status(400).json({
          success: false,
          message: 'Explicit admin confirmation is required to retry failed feedback emails.',
        });
      }

      const adminUser = req?.admin?.email || req?.admin?.username || 'admin';
      const webinarId = req?.body?.webinarId || req?.query?.webinarId || 'halal-wealth-nov-2026';

      const result = await campaignService.retryFailedFeedbackEmails({
        adminUser,
        webinarId,
      });

      return res.status(200).json({
        success: true,
        message: result.message,
        data: result,
      });
    } catch (error) {
      logger.error('Failed to retry failed feedback emails:', error);
      return res.status(error.message?.includes('already in progress') ? 409 : 500).json({
        success: false,
        message: error.message || 'Failed to retry failed feedback emails.',
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
      const result = await campaignService.sendIndividualFeedbackEmail({
        registrationId,
        forceResend: Boolean(forceResend),
        adminUser,
      });

      return res.status(200).json(result);
    } catch (error) {
      logger.error('Failed to dispatch individual feedback email:', error);
      return res.status(500).json({
        success: false,
        message: error.message || 'Failed to dispatch individual feedback email.',
      });
    }
  }

  async function testSend(req, res) {
    try {
      const { testEmail, recipientName } = req?.body || {};
      const cleanEmail = String(testEmail || '').trim().toLowerCase();

      if (!cleanEmail || !/^\S+@\S+\.\S+$/.test(cleanEmail)) {
        return res.status(400).json({
          success: false,
          message: 'Please provide a valid test recipient email address.',
        });
      }

      const sendResult = await emailService.sendFeedbackCampaignEmail(
        cleanEmail,
        recipientName || 'Admin Test Recipient'
      );

      const isSuccess = Boolean(sendResult && (sendResult.success === true || sendResult.messageId || sendResult.id));

      if (isSuccess) {
        return res.status(200).json({
          success: true,
          message: `Test feedback email delivered successfully to ${cleanEmail}.`,
          messageId: sendResult?.messageId || sendResult?.id || 'delivered',
        });
      }

      return res.status(500).json({
        success: false,
        message: 'SMTP delivery failed for test feedback email.',
        error: sendResult?.error?.message || 'SMTP error',
      });
    } catch (error) {
      logger.error('Failed to send test feedback email:', error);
      return res.status(500).json({
        success: false,
        message: error.message || 'Failed to send test feedback email.',
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
  createFeedbackCampaignController,
  defaultFeedbackCampaignController: createFeedbackCampaignController(),
};
