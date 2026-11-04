const test = require('node:test');
const assert = require('node:assert/strict');
const { createRecordingCampaignController } = require('./recordingCampaignController');

function createResponse() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

test('recordingCampaignController.preview returns 200 with enriched recipients and stats', async () => {
  const mockCampaignService = {
    previewRecipients: async ({ page, limit, search }) => ({
      success: true,
      data: [{ fullName: 'Brother Tariq', email: 'tariq@example.com', deliveryStatus: 'pending' }],
      pagination: { page, limit, total: 1, totalPages: 1 },
      summary: { eligibleCount: 200, sentCount: 0, failedCount: 0, pendingCount: 200 },
    }),
  };

  const controller = createRecordingCampaignController({ campaignService: mockCampaignService });
  const req = { query: { page: '1', limit: '25' } };
  const res = createResponse();

  await controller.preview(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.length, 1);
  assert.equal(res.body.summary.eligibleCount, 200);
});

test('recordingCampaignController.send requires explicit admin confirmation', async () => {
  const controller = createRecordingCampaignController({});
  const req = { body: {} };
  const res = createResponse();

  await controller.send(req, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /Explicit admin confirmation is required/);
});

test('recordingCampaignController.send returns 409 conflict when campaign is running', async () => {
  const conflictError = new Error('A recording campaign email dispatch is already in progress.');
  conflictError.statusCode = 409;
  conflictError.code = 'CAMPAIGN_ALREADY_RUNNING';

  const mockCampaignService = {
    sendRecordingEmails: async () => { throw conflictError; },
  };

  const controller = createRecordingCampaignController({ campaignService: mockCampaignService });
  const req = { body: { confirmed: true } };
  const res = createResponse();

  await controller.send(req, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'CAMPAIGN_ALREADY_RUNNING');
});

test('recordingCampaignController.retryFailed requires explicit confirmation and calls service', async () => {
  let retryCalled = false;
  const mockCampaignService = {
    retryFailedRecordingEmails: async () => {
      retryCalled = true;
      return { success: true, message: 'Retrying' };
    },
  };

  const controller = createRecordingCampaignController({ campaignService: mockCampaignService });

  // 1. Unconfirmed
  const unconfirmedRes = createResponse();
  await controller.retryFailed({ body: {} }, unconfirmedRes);
  assert.equal(unconfirmedRes.statusCode, 400);
  assert.equal(retryCalled, false);

  // 2. Confirmed
  const confirmedRes = createResponse();
  await controller.retryFailed({ body: { confirmed: true } }, confirmedRes);
  assert.equal(confirmedRes.statusCode, 200);
  assert.equal(retryCalled, true);
});

test('recordingCampaignController.testSend validates email and dispatches test recording email', async () => {
  let dispatched = null;
  const mockEmailService = {
    sendRecordingEmail: async (email, name) => {
      dispatched = { email, name };
      return { messageId: '<test-msg-123@halalwealth.finance>' };
    },
  };

  const controller = createRecordingCampaignController({ emailService: mockEmailService });

  // Invalid email
  const badRes = createResponse();
  await controller.testSend({ body: { testEmail: 'not-an-email' } }, badRes);
  assert.equal(badRes.statusCode, 400);

  // Valid email
  const goodRes = createResponse();
  await controller.testSend({ body: { testEmail: 'admin@halalwealth.finance', recipientName: 'Admin Reviewer' } }, goodRes);
  assert.equal(goodRes.statusCode, 200);
  assert.equal(dispatched.email, 'admin@halalwealth.finance');
  assert.equal(dispatched.name, 'Admin Reviewer');
});

test('recordingCampaignController.sync delegates to service with webinarId', async () => {
  let syncedWebinarId = null;
  const mockCampaignService = {
    syncEligibleRegistrants: async ({ webinarId }) => {
      syncedWebinarId = webinarId;
      return { synced: 15, total: 20 };
    },
  };

  const controller = createRecordingCampaignController({ campaignService: mockCampaignService });
  const req = { body: { webinarId: 'halal-wealth-nov-2026' } };
  const res = createResponse();

  await controller.sync(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(syncedWebinarId, 'halal-wealth-nov-2026');
});

test('recordingCampaignController.sendIndividual validates registrationId and calls service', async () => {
  let sentParams = null;
  const mockCampaignService = {
    sendIndividualRecordingEmail: async (params) => {
      sentParams = params;
      return { success: true, message: 'Sent' };
    },
  };

  const controller = createRecordingCampaignController({ campaignService: mockCampaignService });

  // Missing ID
  const badRes = createResponse();
  await controller.sendIndividual({ body: {} }, badRes);
  assert.equal(badRes.statusCode, 400);

  // Valid ID
  const goodRes = createResponse();
  await controller.sendIndividual({ body: { registrationId: 'rec-123', forceResend: true } }, goodRes);
  assert.equal(goodRes.statusCode, 200);
  assert.equal(sentParams.registrationId, 'rec-123');
  assert.equal(sentParams.forceResend, true);
});

