const test = require('node:test');
const assert = require('node:assert/strict');
const { createReminderCampaignController } = require('./reminderCampaignController');

function createMockResponse() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('preview returns 200 and paginated preview records from service', async () => {
  const controller = createReminderCampaignController({
    campaignService: {
      previewRecipients: async ({ page, limit, search }) => {
        assert.equal(page, 2);
        assert.equal(limit, 25);
        assert.equal(search, 'Zayd');
        return { success: true, data: [{ fullName: 'Zayd' }], pagination: { page: 2, total: 1 } };
      },
    },
    logger: { error() {}, info() {} },
  });

  const res = createMockResponse();
  await controller.preview({ query: { page: '2', limit: '25', search: 'Zayd' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.length, 1);
});

test('status returns 200 with summary counts and active state', async () => {
  const controller = createReminderCampaignController({
    campaignService: {
      getCampaignStats: async () => ({ eligibleCount: 272, pendingCount: 272, sentCount: 0, failedCount: 0, totalRegistrations: 477 }),
      getActiveCampaignStatus: () => ({ isRunning: false, activeState: null }),
    },
    logger: { error() {}, info() {} },
  });

  const res = createMockResponse();
  await controller.status({}, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.summary.eligibleCount, 272);
  assert.equal(res.body.isRunning, false);
});

test('send requires explicit admin confirmation', async () => {
  let sendCalled = false;
  const controller = createReminderCampaignController({
    campaignService: {
      sendReminderEmails: async () => { sendCalled = true; },
    },
    logger: { error() {}, info() {} },
  });

  const res = createMockResponse();
  await controller.send({ body: { confirmed: false } }, res);

  assert.equal(res.statusCode, 400);
  assert.equal(sendCalled, false);
  assert.match(res.body.message, /confirmation is required/i);
});

test('send dispatches reminder emails when confirmed', async () => {
  let receivedAdmin;
  const controller = createReminderCampaignController({
    campaignService: {
      sendReminderEmails: async ({ adminUser }) => {
        receivedAdmin = adminUser;
        return { success: true, total: 272, sent: 272, failed: 0, message: 'All sent' };
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

test('testSend validates recipient email and calls sendNovember1ReminderEmail', async () => {
  let sentTo;
  let sentName;
  const controller = createReminderCampaignController({
    emailService: {
      sendNovember1ReminderEmail: async (email, name) => {
        sentTo = email;
        sentName = name;
        return { success: true, messageId: 'msg-test-nov1' };
      },
    },
    logger: { error() {}, info() {} },
  });

  const res1 = createMockResponse();
  await controller.testSend({ body: { testEmail: 'invalid-email' } }, res1);
  assert.equal(res1.statusCode, 400);

  const res2 = createMockResponse();
  await controller.testSend({ body: { testEmail: 'tester@example.com' } }, res2);
  assert.equal(res2.statusCode, 200);
  assert.equal(res2.body.success, true);
  assert.equal(sentTo, 'tester@example.com');
  assert.equal(sentName, 'Admin Test Recipient');
});

