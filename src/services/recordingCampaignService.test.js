const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CAMPAIGN_ID,
  DEFAULT_WEBINAR_ID,
  getEligibleQuery,
  createRecordingCampaignService,
} = require('./recordingCampaignService');

function createMockRegistrationModel(records = []) {
  return {
    countDocuments: async (query = {}) => {
      if (Object.keys(query).length === 0) return records.length;
      return records.filter(r => {
        if (query.status?.$ne && r.status === query.status.$ne) return false;
        if (query.$or) {
          const match = query.$or.some(clause => {
            if (clause.webinarId && r.webinarId === clause.webinarId) return true;
            if (clause.webinarVersion && r.webinarVersion === clause.webinarVersion) return true;
            return false;
          });
          if (!match) return false;
        }
        return true;
      }).length;
    },
    find: (query = {}) => {
      const filtered = records.filter(r => {
        if (query.status?.$ne && r.status === query.status.$ne) return false;
        if (query.$or) {
          const match = query.$or.some(clause => {
            if (clause.webinarId && r.webinarId === clause.webinarId) return true;
            if (clause.webinarVersion && r.webinarVersion === clause.webinarVersion) return true;
            return false;
          });
          if (!match) return false;
        }
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
    _store: store,
  };
}

test('recordingCampaignService getEligibleQuery scopes by webinarId and excludes cancelled', () => {
  const novQuery = getEligibleQuery('halal-wealth-nov-2026');
  assert.equal(novQuery.status.$ne, 'Cancelled');
  assert.ok(Array.isArray(novQuery.$or));
  const hasNovId = novQuery.$or.some(c => c.webinarId === 'halal-wealth-nov-2026');
  assert.equal(hasNovId, true);

  const allQuery = getEligibleQuery('all');
  assert.equal(allQuery.status.$ne, 'Cancelled');
  assert.equal(allQuery.$or, undefined);
});

test('recordingCampaignService.getCampaignStats accurately calculates counts', async () => {
  const records = [
    { _id: 'r1', fullName: 'Participant 1', email: 'p1@example.com', webinarId: 'halal-wealth-nov-2026', status: 'Registered' },
    { _id: 'r2', fullName: 'Participant 2', email: 'p2@example.com', webinarId: 'halal-wealth-nov-2026', status: 'Registered' },
    { _id: 'r3', fullName: 'Cancelled One', email: 'p3@example.com', webinarId: 'halal-wealth-nov-2026', status: 'Cancelled' },
  ];

  const deliveryModel = createMockDeliveryModel([
    { campaignId: CAMPAIGN_ID, registrationId: 'r1', emailStatus: 'sent' },
  ]);

  const service = createRecordingCampaignService({
    registrationModel: createMockRegistrationModel(records),
    deliveryModel,
  });

  const stats = await service.getCampaignStats({ webinarId: 'halal-wealth-nov-2026' });
  assert.equal(stats.totalRegistrations, 3);
  assert.equal(stats.eligibleCount, 2); // Excludes Cancelled
  assert.equal(stats.sentCount, 1);
  assert.equal(stats.failedCount, 0);
  assert.equal(stats.pendingCount, 1);
  assert.equal(stats.total, 2);
  assert.equal(stats.pending, 1);
  assert.equal(stats.sent, 1);
  assert.equal(stats.failed, 0);
});

test('recordingCampaignService.previewRecipients enriches records with separate recording delivery status', async () => {
  const records = [
    { _id: 'r1', fullName: 'Participant 1', email: 'p1@example.com', webinarId: 'halal-wealth-nov-2026', status: 'Registered' },
    { _id: 'r2', fullName: 'Participant 2', email: 'p2@example.com', webinarId: 'halal-wealth-nov-2026', status: 'Registered' },
  ];

  const deliveryModel = createMockDeliveryModel([
    { campaignId: CAMPAIGN_ID, registrationId: 'r1', emailStatus: 'sent', sentAt: new Date(), messageId: 'rec-msg-1' },
  ]);

  const service = createRecordingCampaignService({
    registrationModel: createMockRegistrationModel(records),
    deliveryModel,
  });

  const preview = await service.previewRecipients({ page: 1, limit: 10, webinarId: 'halal-wealth-nov-2026' });
  assert.equal(preview.success, true);
  assert.equal(preview.data.length, 2);
  assert.equal(preview.data[0].deliveryStatus, 'sent');
  assert.equal(preview.data[0].messageId, 'rec-msg-1');
  assert.equal(preview.data[1].deliveryStatus, 'pending');
});

test('recordingCampaignService.sendRecordingEmails dispatches only to eligible pending, skips sent, and records delivery', async () => {
  const records = [
    { _id: 'r1', fullName: 'Recipient One', email: 'r1@example.com', webinarId: 'halal-wealth-nov-2026', status: 'Registered' },
    { _id: 'r2', fullName: 'Recipient Two', email: 'r2@example.com', webinarId: 'halal-wealth-nov-2026', status: 'Registered' },
  ];

  // r1 is already sent
  const deliveryModel = createMockDeliveryModel([
    { campaignId: CAMPAIGN_ID, registrationId: 'r1', emailStatus: 'sent', recipientEmail: 'r1@example.com' },
  ]);

  const dispatched = [];
  const mockEmailService = {
    sendRecordingEmail: async (email, name) => {
      dispatched.push({ email, name });
      return { messageId: '<msg-recording-123@halalwealth.finance>' };
    },
  };

  const service = createRecordingCampaignService({
    registrationModel: createMockRegistrationModel(records),
    deliveryModel,
    emailService: mockEmailService,
    delayMs: 0,
  });

  const result = await service.sendRecordingEmails({ webinarId: 'halal-wealth-nov-2026' });
  assert.equal(result.success, true);
  assert.equal(result.state.total, 1); // Only r2 is pending
  assert.equal(result.state.accepted, 1);
  assert.equal(result.state.skipped, 1);
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].email, 'r2@example.com');

  // Verify r2 is now recorded as sent
  const r2Delivery = await deliveryModel.findOne({ registrationId: 'r2' });
  assert.equal(r2Delivery.emailStatus, 'sent');
  assert.equal(r2Delivery.attemptCount, 1);
});

test('recordingCampaignService.sendRecordingEmails blocks concurrent execution with 409 conflict', async () => {
  const records = [
    { _id: 'r1', fullName: 'Recipient One', email: 'r1@example.com', webinarId: 'halal-wealth-nov-2026', status: 'Registered' },
  ];

  const deliveryModel = createMockDeliveryModel([]);
  let resolveSend;
  const slowSendPromise = new Promise(resolve => { resolveSend = resolve; });

  const mockEmailService = {
    sendRecordingEmail: async () => {
      await slowSendPromise;
      return { messageId: '<slow-msg@halalwealth.finance>' };
    },
  };

  const service = createRecordingCampaignService({
    registrationModel: createMockRegistrationModel(records),
    deliveryModel,
    emailService: mockEmailService,
    delayMs: 0,
  });

  // Start first send (will hang until resolveSend)
  const firstSend = service.sendRecordingEmails({ webinarId: 'halal-wealth-nov-2026' });

  // Attempt second send immediately
  await assert.rejects(
    async () => {
      await service.sendRecordingEmails({ webinarId: 'halal-wealth-nov-2026' });
    },
    {
      statusCode: 409,
      code: 'CAMPAIGN_ALREADY_RUNNING',
    }
  );

  // Unblock first send
  resolveSend();
  await firstSend;
});

test('recordingCampaignService.retryFailedRecordingEmails retries only failed recipients and preserves sent records', async () => {
  const records = [
    { _id: 'r1', fullName: 'Sent User', email: 'sent@example.com', webinarId: 'halal-wealth-nov-2026', status: 'Registered' },
    { _id: 'r2', fullName: 'Failed User', email: 'failed@example.com', webinarId: 'halal-wealth-nov-2026', status: 'Registered' },
  ];

  const deliveryModel = createMockDeliveryModel([
    { campaignId: CAMPAIGN_ID, registrationId: 'r1', emailStatus: 'sent', recipientEmail: 'sent@example.com' },
    { campaignId: CAMPAIGN_ID, registrationId: 'r2', emailStatus: 'failed', recipientEmail: 'failed@example.com', save: async function () { return this; } },
  ]);

  const dispatched = [];
  const mockEmailService = {
    sendRecordingEmail: async (email, name) => {
      dispatched.push({ email, name });
      return { messageId: '<retry-msg@halalwealth.finance>' };
    },
  };

  const service = createRecordingCampaignService({
    registrationModel: createMockRegistrationModel(records),
    deliveryModel,
    emailService: mockEmailService,
    delayMs: 0,
  });

  const result = await service.retryFailedRecordingEmails({ webinarId: 'halal-wealth-nov-2026' });
  assert.equal(result.success, true);
  assert.equal(result.state.total, 1);
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].email, 'failed@example.com');
});

test('recordingCampaignService.sendIndividualRecordingEmail sends to single participant and updates delivery', async () => {
  const records = [
    { _id: 'r1', fullName: 'Individual One', email: 'indiv@example.com', webinarId: 'halal-wealth-nov-2026', status: 'Registered' },
  ];

  const deliveryModel = createMockDeliveryModel([]);
  let emailSent = false;
  const mockEmailService = {
    sendRecordingEmail: async (email, name) => {
      emailSent = true;
      return { messageId: '<individual-recording-msg@halalwealth.finance>' };
    },
  };

  const service = createRecordingCampaignService({
    registrationModel: createMockRegistrationModel(records),
    deliveryModel,
    emailService: mockEmailService,
  });

  const result = await service.sendIndividualRecordingEmail({ registrationId: 'r1' });
  assert.equal(result.success, true);
  assert.equal(emailSent, true);
  assert.equal(result.delivery.emailStatus, 'sent');
  assert.equal(result.delivery.messageId, '<individual-recording-msg@halalwealth.finance>');
});
