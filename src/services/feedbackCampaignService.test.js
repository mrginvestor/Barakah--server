const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CAMPAIGN_ID,
  getEligibleQuery,
  createFeedbackCampaignService,
} = require('./feedbackCampaignService');

function createMockRegistrationModel(records = []) {
  return {
    countDocuments: async (query = {}) => {
      if (Object.keys(query).length === 0) return records.length;
      return records.filter(r => {
        if (query.status?.$ne && r.status === query.status.$ne) return false;
        return true;
      }).length;
    },
    find: (query = {}) => {
      const filtered = records.filter(r => {
        if (query.status?.$ne && r.status === query.status.$ne) return false;
        return true;
      });

      return {
        sort: () => ({
          skip: (skipAmount) => ({
            limit: (limitAmount) => ({
              select: () => ({
                lean: async () => filtered.slice(skipAmount, skipAmount + limitAmount),
              }),
            }),
          }),
          select: () => ({
            lean: async () => filtered,
          }),
        }),
      };
    },
    findById: (id) => ({
      lean: async () => records.find(r => String(r._id) === String(id)) || null,
    }),
  };
}

function createMockDeliveryModel(deliveries = []) {
  const store = deliveries;
  return {
    countDocuments: async (query = {}) => {
      return store.filter(d => {
        if (query.campaignId && d.campaignId !== query.campaignId) return false;
        if (query.emailStatus && d.emailStatus !== query.emailStatus) return false;
        return true;
      }).length;
    },
    find: (query = {}) => ({
      lean: async () => store.filter(d => {
        if (query.campaignId && d.campaignId !== query.campaignId) return false;
        if (query.emailStatus && d.emailStatus !== query.emailStatus) return false;
        if (query.registrationId?.$in) {
          const ids = query.registrationId.$in.map(String);
          return ids.includes(String(d.registrationId));
        }
        return true;
      }),
    }),
    findOne: async (query = {}) => {
      return store.find(d => {
        if (query.campaignId && d.campaignId !== query.campaignId) return false;
        if (query.registrationId && String(d.registrationId) === String(query.registrationId)) return true;
        return false;
      }) || null;
    },
    create: async (data) => {
      const doc = {
        _id: 'deliv-' + (store.length + 1),
        ...data,
        save: async function () { return this; },
      };
      store.push(doc);
      return doc;
    },
    findByIdAndUpdate: async (id, update) => {
      const doc = store.find(d => String(d._id) === String(id));
      if (!doc) return null;
      if (update.$set) Object.assign(doc, update.$set);
      if (update.$inc) {
        for (const [k, v] of Object.entries(update.$inc)) {
          doc[k] = (doc[k] || 0) + v;
        }
      }
      return doc;
    },
  };
}

test('feedbackCampaignService.getCampaignStats returns accurate counts', async () => {
  const mockRegistrations = [
    { _id: 'r1', fullName: 'Alice', email: 'alice@example.com', status: 'Registered' },
    { _id: 'r2', fullName: 'Bob', email: 'bob@example.com', status: 'Confirmed' },
    { _id: 'r3', fullName: 'Charlie', email: 'charlie@example.com', status: 'Cancelled' },
  ];

  const mockDeliveries = [
    { campaignId: CAMPAIGN_ID, registrationId: 'r1', emailStatus: 'sent' },
  ];

  const service = createFeedbackCampaignService({
    registrationModel: createMockRegistrationModel(mockRegistrations),
    deliveryModel: createMockDeliveryModel(mockDeliveries),
  });

  const stats = await service.getCampaignStats();
  assert.equal(stats.totalRegistrations, 3);
  assert.equal(stats.eligibleCount, 2); // Excludes Cancelled
  assert.equal(stats.sentCount, 1);
  assert.equal(stats.failedCount, 0);
  assert.equal(stats.pendingCount, 1);
});

test('feedbackCampaignService.previewRecipients enriches records with separate delivery status', async () => {
  const mockRegistrations = [
    { _id: 'r1', fullName: 'Alice', email: 'alice@example.com', status: 'Registered' },
    { _id: 'r2', fullName: 'Bob', email: 'bob@example.com', status: 'Confirmed' },
  ];

  const mockDeliveries = [
    { campaignId: CAMPAIGN_ID, registrationId: 'r1', emailStatus: 'sent', sentAt: new Date(), messageId: 'msg-1' },
  ];

  const service = createFeedbackCampaignService({
    registrationModel: createMockRegistrationModel(mockRegistrations),
    deliveryModel: createMockDeliveryModel(mockDeliveries),
  });

  const preview = await service.previewRecipients({ page: 1, limit: 10 });
  assert.equal(preview.success, true);
  assert.equal(preview.data.length, 2);
  assert.equal(preview.data[0].deliveryStatus, 'sent');
  assert.equal(preview.data[0].messageId, 'msg-1');
  assert.equal(preview.data[1].deliveryStatus, 'pending');
});

test('feedbackCampaignService.sendIndividualFeedbackEmail sends to a single registrant without modifying registration', async () => {
  const mockRegistrations = [
    { _id: 'r1', fullName: 'Alice', email: 'alice@example.com', status: 'Registered' },
  ];
  const deliveryStore = [];
  let emailSentTo = null;

  const mockEmailService = {
    sendFeedbackCampaignEmail: async (email, name) => {
      emailSentTo = email;
      return { success: true, messageId: 'indiv-msg-101' };
    },
  };

  const service = createFeedbackCampaignService({
    registrationModel: createMockRegistrationModel(mockRegistrations),
    deliveryModel: createMockDeliveryModel(deliveryStore),
    emailService: mockEmailService,
  });

  const result = await service.sendIndividualFeedbackEmail({ registrationId: 'r1' });
  assert.equal(result.success, true);
  assert.equal(emailSentTo, 'alice@example.com');
  assert.equal(deliveryStore.length, 1);
  assert.equal(deliveryStore[0].emailStatus, 'sent');
  assert.equal(deliveryStore[0].messageId, 'indiv-msg-101');
});

test('feedbackCampaignService.sendFeedbackEmails dispatches bulk emails and skips already sent', async () => {
  const mockRegistrations = [
    { _id: 'r1', fullName: 'Alice', email: 'alice@example.com', status: 'Registered' },
    { _id: 'r2', fullName: 'Bob', email: 'bob@example.com', status: 'Confirmed' },
  ];
  const mockDeliveries = [
    { campaignId: CAMPAIGN_ID, registrationId: 'r1', emailStatus: 'sent' },
  ];
  const sentEmails = [];

  const mockEmailService = {
    sendFeedbackCampaignEmail: async (email) => {
      sentEmails.push(email);
      return { success: true, messageId: 'bulk-msg-' + sentEmails.length };
    },
  };

  const service = createFeedbackCampaignService({
    registrationModel: createMockRegistrationModel(mockRegistrations),
    deliveryModel: createMockDeliveryModel(mockDeliveries),
    emailService: mockEmailService,
    delayMs: 0,
  });

  const result = await service.sendFeedbackEmails({ adminUser: 'test-admin' });
  assert.equal(result.success, true);
  assert.equal(result.sent, 1); // Only Bob sent, Alice skipped
  assert.deepEqual(sentEmails, ['bob@example.com']);
});

test('feedbackCampaignService.retryFailedFeedbackEmails retries only failed deliveries', async () => {
  const mockRegistrations = [
    { _id: 'r1', fullName: 'Alice', email: 'alice@example.com', status: 'Registered' },
  ];
  const mockDeliveries = [
    { _id: 'd1', campaignId: CAMPAIGN_ID, registrationId: 'r1', recipientEmail: 'alice@example.com', recipientName: 'Alice', emailStatus: 'failed' },
  ];
  let retriedEmail = null;

  const mockEmailService = {
    sendFeedbackCampaignEmail: async (email) => {
      retriedEmail = email;
      return { success: true, messageId: 'retry-msg-999' };
    },
  };

  const service = createFeedbackCampaignService({
    registrationModel: createMockRegistrationModel(mockRegistrations),
    deliveryModel: createMockDeliveryModel(mockDeliveries),
    emailService: mockEmailService,
    delayMs: 0,
  });

  const result = await service.retryFailedFeedbackEmails({ adminUser: 'test-admin' });
  assert.equal(result.success, true);
  assert.equal(result.sent, 1);
  assert.equal(retriedEmail, 'alice@example.com');
  assert.equal(mockDeliveries[0].emailStatus, 'sent');
});
