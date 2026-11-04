const { defaultReminderCampaignService } = require('../services/reminderCampaignService');
const defaultEmailService = require('../services/webinarEmailService');

function createReminderCampaignController({
  campaignService = defaultReminderCampaignService,
  emailService = defaultEmailService,
  logger = console,
} = {}) {
  async function preview(req, res) {
    try {
      const page = req.query.page ? parseInt(req.query.page, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit, 10) : 50;
      const search = req.query.search || req.query.q || '';

      const result = await campaignService.previewRecipients({ page, limit, search });
      return res.status(200).json(result);
    } catch (error) {
      logger.error('Failed to preview reminder campaign recipients:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to preview reminder campaign recipients.',
        error: error.message,
      });
    }
  }

  async function status(req, res) {
    try {
      const summary = await campaignService.getCampaignStats();
      const statusState = campaignService.getActiveCampaignStatus();
      return res.status(200).json({
        success: true,
        summary,
        isRunning: statusState.isRunning,
        activeState: statusState.activeState,
      });
    } catch (error) {
      logger.error('Failed to get reminder campaign status:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to retrieve reminder campaign status.',
        error: error.message,
      });
    }
  }

  async function send(req, res) {
    try {
      const { confirmed } = req.body || {};
      if (!confirmed) {
        return res.status(400).json({
          success: false,
          message: 'Explicit admin confirmation is required to initiate the reminder campaign send.',
        });
      }

      const adminUser = req.admin?.email || req.admin?.username || 'admin';
      const result = await campaignService.sendReminderEmails({
        adminUser,
        scope: 'pending',
      });

      return res.status(200).json({
        success: true,
        message: result.message,
        data: result,
      });
    } catch (error) {
      logger.error('Failed to send reminder campaign emails:', error);
      return res.status(error.message?.includes('already in progress') ? 409 : 500).json({
        success: false,
        message: error.message || 'Failed to dispatch reminder emails.',
      });
    }
  }

  async function retryFailed(req, res) {
    try {
      const { confirmed } = req.body || {};
      if (!confirmed) {
        return res.status(400).json({
          success: false,
          message: 'Explicit admin confirmation is required to retry failed reminder emails.',
        });
      }

      const adminUser = req.admin?.email || req.admin?.username || 'admin';
      const result = await campaignService.retryFailedReminderEmails({
        adminUser,
      });

      return res.status(200).json({
        success: true,
        message: result.message,
        data: result,
      });
    } catch (error) {
      logger.error('Failed to retry failed reminder emails:', error);
      return res.status(error.message?.includes('already in progress') ? 409 : 500).json({
        success: false,
        message: error.message || 'Failed to retry failed reminder emails.',
      });
    }
  }

  async function testSend(req, res) {
    try {
      const { testEmail } = req.body || {};
      const cleanEmail = String(testEmail || '').trim().toLowerCase();

      if (!cleanEmail || !/^\S+@\S+\.\S+$/.test(cleanEmail)) {
        return res.status(400).json({
          success: false,
          message: 'Please provide a valid test recipient email address.',
        });
      }

      const sendResult = await emailService.sendNovember1ReminderEmail(
        cleanEmail,
        'Admin Test Recipient'
      );

      const isSuccess = Boolean(sendResult && (sendResult.success === true || sendResult.messageId || sendResult.id));

      if (isSuccess) {
        return res.status(200).json({
          success: true,
          message: `Test reminder email successfully dispatched to ${cleanEmail}.`,
          messageId: sendResult.messageId || sendResult.id || null,
        });
      }

      return res.status(502).json({
        success: false,
        message: 'SMTP dispatch failed for test email: ' + (sendResult?.error?.message || 'Unknown error'),
      });
    } catch (error) {
      logger.error('Failed to dispatch test reminder email:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to dispatch test reminder email: ' + error.message,
      });
    }
  }

  return {
    preview,
    status,
    send,
    retryFailed,
    testSend,
  };
}

module.exports = {
  createReminderCampaignController,
  defaultReminderCampaignController: createReminderCampaignController(),
  ...createReminderCampaignController(),
};

