const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CAMPAIGN_ID,
  WEBINAR_ID,
  getEligibleQuery,
  createReminderCampaignService,
} = require('./reminderCampaignService');

function createMockRegistrationModel(records = []) {
  return {
    countDocuments: async (query = {}) => {
      if (Object.keys(query).length === 0) return records.length;
      return records.filter(r => {
        if (query.$and) {
          const isNov = r.webinarId === 'halal-wealth-nov-2026' || r.webinarVersion === 'November 1, 2026 Webinar';
          if (!isNov) return false;
          if (r.webinarId === 'halal-wealth-oct-2026' || r.webinarVersion === 'October 2026 Webinar') return false;
          if (r.status === 'Cancelled') return false;
        }
        return true;
      }).length;
    },
    find: (query = {}) => {
      const filtered = records.filter(r => {
        if (query.$and) {
          const isNov = r.webinarId === 'halal-wealth-nov-2026' || r.webinarVersion === 'November 1, 2026 Webinar';
          if (!isNov) return false;
          if (r.webinarId === 'halal-wealth-oct-2026' || r.webinarVersion === 'October 2026 Webinar') return false;
          if (r.status === 'Cancelled') return false;
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
    findByIdAndUpdate: async () => {},
  };
}

function createMockDeliveryModel(deliveries = []) {
  const store = [...deliveries];
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
        if (query.registrationId?.$in) {
          const ids = query.registrationId.$in.map(String);
          return ids.includes(String(d.registrationId));
        }
        return true;
      }),
      populate: () => ({
        lean: async () => store.filter(d => {
          if (query.campaignId && d.campaignId !== query.campaignId) return false;
          if (query.emailStatus && d.emailStatus !== query.emailStatus) return false;
          return true;
        }),
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
    findById: async (id) => {
      const found = store.find(d => String(d._id) === String(id));
      if (!found) return null;
      found.save = async function () { return this; };
      return found;
    },
  };
}

test('getEligibleQuery includes only November 1 webinar and excludes October / Business / Cancelled', () => {
  const query = getEligibleQuery();
  assert.ok(query.$and, 'Must have $and clauses');
  const webinarFilter = query.$and[0].$or;
  assert.ok(webinarFilter.some(c => c.webinarId === 'halal-wealth-nov-2026'));
  assert.ok(webinarFilter.some(c => c.webinarVersion === 'November 1, 2026 Webinar'));

  const exclusionWebinarId = query.$and[1].webinarId.$nin;
  assert.ok(exclusionWebinarId.includes('halal-wealth-oct-2026'));
  assert.ok(exclusionWebinarId.includes('business-webinar-2026'));

  const exclusionVersion = query.$and[2].webinarVersion.$nin;
  assert.ok(exclusionVersion.includes('October 2026 Webinar'));
  assert.ok(exclusionVersion.includes('Business Webinar 2026'));

  assert.equal(query.$and[3].status.$ne, 'Cancelled');
});

test('getCampaignStats calculates eligible, excluded, sent, pending, and failed counts accurately', async () => {
  const records = [
    { _id: '1', fullName: 'Nov User 1', email: 'nov1@example.com', webinarId: 'halal-wealth-nov-2026', webinarVersion: 'November 1, 2026 Webinar' },
    { _id: '2', fullName: 'Nov User 2', email: 'nov2@example.com', webinarId: 'halal-wealth-nov-2026', webinarVersion: 'November 1, 2026 Webinar' },
    { _id: '3', fullName: 'Nov User 3', email: 'nov3@example.com', webinarId: 'halal-wealth-nov-2026', webinarVersion: 'November 1, 2026 Webinar' },
    { _id: '4', fullName: 'Oct User', email: 'oct@example.com', webinarId: 'halal-wealth-oct-2026', webinarVersion: 'October 2026 Webinar' },
    { _id: '5', fullName: 'Cancelled Nov User', email: 'cancelled@example.com', webinarId: 'halal-wealth-nov-2026', status: 'Cancelled' },
  ];

  const deliveries = [
    { campaignId: CAMPAIGN_ID, registrationId: '1', emailStatus: 'sent' },
    { campaignId: CAMPAIGN_ID, registrationId: '2', emailStatus: 'failed' },
  ];

  const service = createReminderCampaignService({
    registrationModel: createMockRegistrationModel(records),
    deliveryModel: createMockDeliveryModel(deliveries),
  });

  const stats = await service.getCampaignStats();
  assert.equal(stats.totalRegistrations, 5);
  assert.equal(stats.eligibleCount, 3);
  assert.equal(stats.excludedCount, 2);
  assert.equal(stats.sentCount, 1);
  assert.equal(stats.failedCount, 1);
  assert.equal(stats.pendingCount, 2); // 3 eligible - 1 sent = 2 pending
  assert.equal(stats.isRunning, false);
});

test('previewRecipients returns paginated records with enriched deliveryStatus without sending emails', async () => {
  const records = [
    { _id: '1', fullName: 'Zayd', email: 'zayd@example.com', webinarId: 'halal-wealth-nov-2026', webinarVersion: 'November 1, 2026 Webinar', registrationId: 'HWW-N26-001' },
    { _id: '2', fullName: 'Amina', email: 'amina@example.com', webinarId: 'halal-wealth-nov-2026', webinarVersion: 'November 1, 2026 Webinar', registrationId: 'HWW-N26-002' },
  ];

  const deliveries = [
    { campaignId: CAMPAIGN_ID, registrationId: '1', emailStatus: 'sent', sentAt: new Date() },
  ];

  let emailSent = false;
  const service = createReminderCampaignService({
    registrationModel: createMockRegistrationModel(records),
    deliveryModel: createMockDeliveryModel(deliveries),
    emailService: {
      sendNovember1ReminderEmail: async () => { emailSent = true; },
    },
  });

  const preview = await service.previewRecipients({ page: 1, limit: 10 });
  assert.equal(preview.success, true);
  assert.equal(preview.data.length, 2);
  assert.equal(preview.data[0].deliveryStatus, 'sent');
  assert.equal(preview.data[1].deliveryStatus, 'pending');
  assert.equal(emailSent, false, 'Preview must never trigger an email');
});

test('sendReminderEmails dispatches reminder emails to pending recipients and updates tracking', async () => {
  const records = [
    { _id: '1', fullName: 'Farooq', email: 'farooq@example.com', webinarId: 'halal-wealth-nov-2026', webinarVersion: 'November 1, 2026 Webinar' },
    { _id: '2', fullName: 'Bilal', email: 'bilal@example.com', webinarId: 'halal-wealth-nov-2026', webinarVersion: 'November 1, 2026 Webinar' },
  ];

  const deliveries = [
    { campaignId: CAMPAIGN_ID, registrationId: '1', emailStatus: 'sent' },
  ];

  const sentEmails = [];
  const service = createReminderCampaignService({
    registrationModel: createMockRegistrationModel(records),
    deliveryModel: createMockDeliveryModel(deliveries),
    emailService: {
      sendNovember1ReminderEmail: async (email, name) => {
        sentEmails.push({ email, name });
        return { success: true, messageId: 'msg-test-123' };
      },
    },
    delayMs: 0,
  });

  const result = await service.sendReminderEmails({ adminUser: 'admin@halalwealth.finance' });
  assert.equal(result.success, true);
  assert.equal(result.sent, 1);
  assert.equal(result.skipped, 1); // Record 1 was already sent
  assert.equal(sentEmails.length, 1);
  assert.equal(sentEmails[0].email, 'bilal@example.com');
});

test('sendReminderEmails prevents concurrent execution', async () => {
  const records = [
    { _id: '1', fullName: 'User 1', email: 'u1@example.com', webinarId: 'halal-wealth-nov-2026', webinarVersion: 'November 1, 2026 Webinar' },
  ];

  let releasePromise;
  const blockingPromise = new Promise(resolve => { releasePromise = resolve; });

  const service = createReminderCampaignService({
    registrationModel: createMockRegistrationModel(records),
    deliveryModel: createMockDeliveryModel([]),
    emailService: {
      sendNovember1ReminderEmail: async () => {
        await blockingPromise;
        return { success: true };
      },
    },
    delayMs: 0,
  });

  const job1 = service.sendReminderEmails({ adminUser: 'admin1' });

  await assert.rejects(
    async () => {
      await service.sendReminderEmails({ adminUser: 'admin2' });
    },
    { message: /already in progress/i }
  );

  releasePromise();
  await job1;
});

