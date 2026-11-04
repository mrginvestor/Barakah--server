const test = require('node:test');
const assert = require('node:assert/strict');
const { createFeedbackCampaignController } = require('./feedbackCampaignController');

function createMockResponse() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('feedbackCampaignController.preview returns 200 and paginated preview records from service', async () => {
  const controller = createFeedbackCampaignController({
    campaignService: {
      previewRecipients: async ({ page, limit, search }) => {
        assert.equal(page, 1);
        assert.equal(limit, 50);
        assert.equal(search, 'Ahmad');
        return { success: true, data: [{ fullName: 'Ahmad' }], pagination: { page: 1, total: 1 } };
      },
    },
    logger: { error() {}, info() {} },
  });

  const res = createMockResponse();
  await controller.preview({ query: { page: '1', limit: '50', search: 'Ahmad' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.length, 1);
});

test('feedbackCampaignController.status returns 200 with summary counts and active state', async () => {
  const controller = createFeedbackCampaignController({
    campaignService: {
      getCampaignStats: async () => ({ eligibleCount: 499, pendingCount: 499, sentCount: 0, failedCount: 0, totalRegistrations: 499 }),
      getActiveCampaignStatus: () => ({ isRunning: false, activeState: null }),
    },
    logger: { error() {}, info() {} },
  });

  const res = createMockResponse();
  await controller.status({}, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.summary.eligibleCount, 499);
  assert.equal(res.body.isRunning, false);
});

test('feedbackCampaignController.send requires explicit admin confirmation', async () => {
  let sendCalled = false;
  const controller = createFeedbackCampaignController({
    campaignService: {
      sendFeedbackEmails: async () => { sendCalled = true; },
    },
    logger: { error() {}, info() {} },
  });

  const res = createMockResponse();
  await controller.send({ body: { confirmed: false } }, res);

  assert.equal(res.statusCode, 400);
  assert.equal(sendCalled, false);
  assert.match(res.body.message, /confirmation is required/i);
});

test('feedbackCampaignController.send dispatches feedback emails when confirmed', async () => {
  let receivedAdmin;
  const controller = createFeedbackCampaignController({
    campaignService: {
      sendFeedbackEmails: async ({ adminUser }) => {
        receivedAdmin = adminUser;
        return { success: true, total: 499, sent: 499, failed: 0, message: 'All feedback emails sent' };
      },
    },
    logger: { error() {}, info() {} },
  });

  const res = createMockResponse();
  await controller.send({
    body: { confirmed: true },
    admin: { email: 'admin@halalwealth.finance' },
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(receivedAdmin, 'admin@halalwealth.finance');
});

test('feedbackCampaignController.sendIndividual validates registrationId and calls service', async () => {
  let calledWith;
  const controller = createFeedbackCampaignController({
    campaignService: {
      sendIndividualFeedbackEmail: async (opts) => {
        calledWith = opts;
        return { success: true, message: 'Sent' };
      },
    },
    logger: { error() {}, info() {} },
  });

  const res1 = createMockResponse();
  await controller.sendIndividual({ body: {} }, res1);
  assert.equal(res1.statusCode, 400);

  const res2 = createMockResponse();
  await controller.sendIndividual({ body: { registrationId: 'reg-123', forceResend: true }, admin: { email: 'admin@example.com' } }, res2);
  assert.equal(res2.statusCode, 200);
  assert.equal(calledWith.registrationId, 'reg-123');
  assert.equal(calledWith.forceResend, true);
});

test('feedbackCampaignController.testSend validates recipient email and calls sendFeedbackCampaignEmail', async () => {
  let sentTo;
  let sentName;
  const controller = createFeedbackCampaignController({
    emailService: {
      sendFeedbackCampaignEmail: async (email, name) => {
        sentTo = email;
        sentName = name;
        return { success: true, messageId: 'msg-test-feedback' };
      },
    },
    logger: { error() {}, info() {} },
  });

  const res = createMockResponse();
  await controller.testSend({
    body: { testEmail: 'reviewer@halalwealth.finance', recipientName: 'Admin Reviewer' },
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(sentTo, 'reviewer@halalwealth.finance');
  assert.equal(sentName, 'Admin Reviewer');
});

