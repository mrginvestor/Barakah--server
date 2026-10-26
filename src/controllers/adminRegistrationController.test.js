const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRegistrationFilter, createAdminRegistrationController, csvCell } = require('./adminRegistrationController');

function createResponse() {
  return {
    statusCode: 200,
    body: undefined,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader(name, value) { this.headers[name] = value; },
  };
}

function createLogger() {
  return { error() {} };
}

test('builds server-side search, status, and date filters safely', () => {
  const filter = buildRegistrationFilter({ q: 'name+tag@example.com', status: 'Registered', from: '2026-10-01', to: '2026-10-05' });

  assert.equal(filter.$or.length, 8);
  assert.equal(filter.$or[1].email.$regex, undefined);
  assert.match(filter.$or[1].email.source, /name\\\+tag/);
  assert.deepEqual(filter.status, { $in: ['Registered', 'New', null] });
  assert.equal(filter.createdAt.$gte.toISOString(), '2026-10-01T00:00:00.000Z');
  assert.equal(filter.createdAt.$lt.toISOString(), '2026-10-06T00:00:00.000Z');
});

test('rejects unsupported statuses and invalid date ranges', () => {
  assert.throws(() => buildRegistrationFilter({ status: 'Unknown' }), /Invalid registration status/);
  assert.throws(() => buildRegistrationFilter({ from: '2026-02-30' }), /Invalid date filter/);
  assert.throws(() => buildRegistrationFilter({ from: '2026-10-05', to: '2026-10-04' }), /start date/);
});

test('returns one backend-paginated page and global registration summaries', async () => {
  let pipeline;
  const registrationModel = {
    aggregate: async value => {
      pipeline = value;
      return [{
        data: [{ _id: 'r1', fullName: 'Test User', status: 'Registered' }],
        filteredTotal: [{ count: 26 }],
        summary: [{ total: 80, today: 3, verified: 50, pending: 20 }],
      }];
    },
  };
  const controller = createAdminRegistrationController({ registrationModel, logger: createLogger() });
  const response = createResponse();

  await controller.list({ query: { page: '2', limit: '25', q: 'Test' } }, response);

  assert.equal(pipeline[0].$facet.data[2].$skip, 25);
  assert.equal(pipeline[0].$facet.data[3].$limit, 25);
  assert.equal(response.body.data.length, 1);
  assert.equal(response.body.summary.total, 80);
  assert.deepEqual(response.body.pagination, { page: 2, limit: 25, total: 26, totalPages: 2 });
});

test('restricts registration status updates to supported workflow values', async () => {
  let updateCalled = false;
  const controller = createAdminRegistrationController({
    registrationModel: { findByIdAndUpdate: () => { updateCalled = true; } },
    logger: createLogger(),
  });
  const response = createResponse();

  await controller.updateStatus({ params: { id: '64b7abdecf9f6cd9a54b4b6e' }, body: { status: 'Checked-In' } }, response);

  assert.equal(response.statusCode, 400);
  assert.equal(updateCalled, false);
});

test('escapes CSV fields and neutralizes spreadsheet formulas', () => {
  assert.equal(csvCell('A, "B"'), '"A, ""B"""');
  assert.equal(csvCell('=HYPERLINK("https://example.com")'), '"\'=HYPERLINK(""https://example.com"")"');
});

test('streams all schema fields with filtered data and a safe download filename', async () => {
  const chunks = [];
  let ended = false;
  const registration = { _id: 'record-1', fullName: 'Test User', email: 'test@example.com', status: 'New' };
  const cursor = {
    async *[Symbol.asyncIterator]() { yield registration; },
    async close() {},
  };
  const registrationModel = {
    schema: { paths: { _id: {}, fullName: {}, email: {}, status: {}, __v: {} } },
    find: filter => {
      assert.equal(filter.status, 'Confirmed');
      return { sort: () => ({ lean: () => ({ cursor: () => cursor }) }) };
    },
  };
  const response = {
    ...createResponse(),
    write(chunk) { chunks.push(chunk); return true; },
    end() { ended = true; },
    destroy(error) { throw error; },
  };
  const controller = createAdminRegistrationController({ registrationModel, logger: createLogger() });

  await controller.exportCsv({ query: { status: 'Confirmed' } }, response);

  assert.equal(ended, true);
  assert.match(response.headers['Content-Disposition'], /^attachment; filename="webinar-registrations-\d{4}-\d{2}-\d{2}\.csv"$/);
  assert.equal(chunks[0], '"_id","fullName","email","status"\r\n');
  assert.equal(chunks[1], '"record-1","Test User","test@example.com","Registered"\r\n');
});

test('sends a confirmation email for a selected registration and marks it sent', async () => {
  let emailCalled = false;
  const controller = createAdminRegistrationController({
    registrationModel: {
      findById: async () => ({ _id: 'record-1', fullName: 'Test User', email: 'test@example.com', confirmationEmailSent: false }),
      findByIdAndUpdate: async (_id, update) => ({ _id, ...update.$set }),
    },
    emailService: {
      sendRegistrationConfirmation: async (email, name) => {
        emailCalled = true;
        assert.equal(email, 'test@example.com');
        assert.equal(name, 'Test User');
      },
    },
    logger: createLogger(),
  });
  const response = createResponse();

  await controller.sendConfirmation({ params: { id: 'record-1' } }, response);
  console.log('single-send-response', JSON.stringify(response.body, null, 2));

  assert.equal(emailCalled, true);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.data.confirmationEmailSent, true);
  assert.ok(response.body.data.confirmationEmailSentAt instanceof Date || response.body.data.confirmationEmailSentAt != null);
  assert.equal(response.body.data.confirmationEmailLastError, null);
});

test('sends only pending registrations in bulk and continues after failures', async () => {
  const updated = [];
  const controller = createAdminRegistrationController({
    registrationModel: {
      find: async () => [
        { _id: '1', fullName: 'Pending User', email: 'pending@example.com', confirmationEmailSent: false },
        { _id: '2', fullName: 'Already Sent', email: 'sent@example.com', confirmationEmailSent: true },
        { _id: '3', fullName: 'Failed User', email: 'failed@example.com', confirmationEmailSent: false },
      ],
      findByIdAndUpdate: async (_id, update) => {
        updated.push({ _id, ...update.$set });
        return { _id, ...update.$set };
      },
    },
    emailService: {
      sendRegistrationConfirmation: async email => {
        if (email === 'failed@example.com') throw new Error('SMTP unavailable');
      },
    },
    logger: createLogger(),
  });
  const response = createResponse();

  await controller.sendBulkConfirmations({ body: {} }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.summary.total, 3);
  assert.equal(response.body.summary.sent, 1);
  assert.equal(response.body.summary.failed, 1);
  assert.equal(response.body.summary.skipped, 1);
  assert.deepEqual(response.body.failedEmails, ['failed@example.com']);
  assert.equal(updated.length, 2);
  assert.ok(updated.some(entry => entry._id === '1' && entry.confirmationEmailSent === true));
});

test('sends postponement announcement to single registration and updates record', async () => {
  let emailCalled = false;
  const controller = createAdminRegistrationController({
    registrationModel: {
      findById: async () => ({ _id: 'post-1', fullName: 'Postponed User', email: 'user@example.com', announcementEmailSent: false }),
      findByIdAndUpdate: async (_id, update) => ({ _id, ...update.$set }),
    },
    emailService: {
      sendPostponementAnnouncement: async (email, name) => {
        emailCalled = true;
        assert.equal(email, 'user@example.com');
        assert.equal(name, 'Postponed User');
      },
    },
    logger: createLogger(),
  });
  const response = createResponse();

  await controller.sendPostponementAnnouncement({ params: { id: 'post-1' } }, response);

  assert.equal(emailCalled, true);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.data.announcementEmailSent, true);
  assert.ok(response.body.data.announcementEmailSentAt != null);
});

test('bulk postponement requires explicit confirmation and reports progress/summary', async () => {
  const controller = createAdminRegistrationController({
    registrationModel: { find: async () => [] },
    emailService: {},
    logger: createLogger(),
  });
  const unconfirmedRes = createResponse();

  // Test unconfirmed request rejected with 400
  await controller.sendBulkPostponementAnnouncements({ body: {} }, unconfirmedRes);
  assert.equal(unconfirmedRes.statusCode, 400);
  assert.match(unconfirmedRes.body.message, /Confirmation is required/);

  // Test confirmed request with controlled sending
  const sent = [];
  const updated = [];
  const controllerConfirmed = createAdminRegistrationController({
    registrationModel: {
      find: async () => [
        { _id: 'p1', fullName: 'User 1', email: 'p1@example.com', announcementEmailSent: false },
        { _id: 'p2', fullName: 'User 2', email: 'p2@example.com', announcementEmailSent: true },
        { _id: 'p3', fullName: 'User 3', email: 'p3@example.com', announcementEmailSent: false },
      ],
      findByIdAndUpdate: async (_id, update) => {
        updated.push({ _id, ...update.$set });
        return { _id, ...update.$set };
      },
    },
    emailService: {
      sendPostponementAnnouncement: async email => {
        sent.push(email);
        if (email === 'p3@example.com') throw new Error('SMTP rate limit');
      },
    },
    logger: createLogger(),
  });
  const confirmedRes = createResponse();

  await controllerConfirmed.sendBulkPostponementAnnouncements({ body: { confirmed: true, delayMs: 0 } }, confirmedRes);

  assert.equal(confirmedRes.statusCode, 200);
  assert.equal(confirmedRes.body.summary.total, 3);
  assert.equal(confirmedRes.body.summary.sent, 1);
  assert.equal(confirmedRes.body.summary.failed, 1);
  assert.equal(confirmedRes.body.summary.skipped, 1);
  assert.deepEqual(confirmedRes.body.failedEmails, ['p3@example.com']);
  assert.deepEqual(sent, ['p1@example.com', 'p3@example.com']);
});

test('rejects malformed [object Object] and invalid IDs for postponement and confirmation with 404 without throwing', async () => {
  const controller = createAdminRegistrationController({
    registrationModel: {
      findById: async () => { throw new Error('findById should not be called'); },
      findByIdAndUpdate: async () => { throw new Error('findByIdAndUpdate should not be called'); },
    },
    emailService: {},
    logger: createLogger(),
  });

  const postRes = createResponse();
  await controller.sendPostponementAnnouncement({ params: { id: '[object Object]' } }, postRes);
  assert.equal(postRes.statusCode, 404);
  assert.equal(postRes.body.message, 'Registration not found.');

  const confRes = createResponse();
  await controller.sendConfirmation({ params: { id: '[object Object]' } }, confRes);
  assert.equal(confRes.statusCode, 404);
  assert.equal(confRes.body.message, 'Registration not found.');

  const getRes = createResponse();
  await controller.getById({ params: { id: '[object Object]' } }, getRes);
  assert.equal(getRes.statusCode, 404);
  assert.equal(getRes.body.message, 'Registration not found.');

  const statusRes = createResponse();
  await controller.updateStatus({ params: { id: '[object Object]' }, body: { status: 'Confirmed' } }, statusRes);
  assert.equal(statusRes.statusCode, 404);
  assert.equal(statusRes.body.message, 'Registration not found.');

  const zoomRes = createResponse();
  await controller.sendSingleZoomJoiningLink({ params: { id: '[object Object]' } }, zoomRes);
  assert.equal(zoomRes.statusCode, 404);
  assert.equal(zoomRes.body.message, 'Registration not found.');
});

test('sends Zoom joining link to single registration and updates record', async () => {
  let emailSentTo;
  let updateData;
  const registration = { _id: '64b7abdecf9f6cd9a54b4b6e', fullName: 'Sister Fatima', email: 'fatima@example.com', joiningEmailSent: false };
  const controller = createAdminRegistrationController({
    registrationModel: {
      findById: async () => registration,
      findByIdAndUpdate: async (id, update) => {
        updateData = update.$set;
        return { ...registration, ...updateData };
      },
    },
    emailService: {
      sendZoomJoiningLink: async email => { emailSentTo = email; },
    },
    logger: createLogger(),
  });
  const response = createResponse();

  await controller.sendSingleZoomJoiningLink({ params: { id: '64b7abdecf9f6cd9a54b4b6e' } }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.success, true);
  assert.equal(emailSentTo, 'fatima@example.com');
  assert.equal(updateData.joiningEmailSent, true);
  assert.equal(response.body.data.joiningEmailStatus, 'Sent');
});

test('bulk Zoom joining link requires explicit confirmation, skips already sent, and reports summary', async () => {
  const controller = createAdminRegistrationController({
    registrationModel: { find: async () => [] },
    emailService: {},
    logger: createLogger(),
  });
  const unconfirmedRes = createResponse();

  // Test unconfirmed request rejected with 400
  await controller.sendBulkZoomJoiningLinks({ body: {} }, unconfirmedRes);
  assert.equal(unconfirmedRes.statusCode, 400);
  assert.match(unconfirmedRes.body.message, /Confirmation is required/);

  // Test confirmed request with skipping already sent
  const sent = [];
  const updated = [];
  const controllerConfirmed = createAdminRegistrationController({
    registrationModel: {
      find: async () => [
        { _id: 'z1', fullName: 'User 1', email: 'z1@example.com', joiningEmailSent: false },
        { _id: 'z2', fullName: 'User 2', email: 'z2@example.com', joiningEmailSent: true },
        { _id: 'z3', fullName: 'User 3', email: 'z3@example.com', joiningEmailSent: false },
      ],
      findByIdAndUpdate: async (_id, update) => {
        updated.push({ _id, ...update.$set });
        return { _id, ...update.$set };
      },
    },
    emailService: {
      sendZoomJoiningLink: async email => {
        sent.push(email);
        if (email === 'z3@example.com') throw new Error('SMTP rate limit');
      },
    },
    logger: createLogger(),
  });
  const confirmedRes = createResponse();

  await controllerConfirmed.sendBulkZoomJoiningLinks({ body: { confirmed: true, delayMs: 0 } }, confirmedRes);

  assert.equal(confirmedRes.statusCode, 200);
  assert.equal(confirmedRes.body.summary.total, 3);
  assert.equal(confirmedRes.body.summary.sent, 1);
  assert.equal(confirmedRes.body.summary.failed, 1);
  assert.equal(confirmedRes.body.summary.skipped, 1);
  assert.deepEqual(confirmedRes.body.failedEmails, ['z3@example.com']);
  assert.deepEqual(sent, ['z1@example.com', 'z3@example.com']);
});

test('returns Zoom joining campaign preview with accurate counts and email template', async () => {
  const controller = createAdminRegistrationController({
    registrationModel: {
      find: async () => [
        { _id: 'z1', joiningEmailSent: true },
        { _id: 'z2', joiningEmailSent: false },
        { _id: 'z3', joiningEmailSent: false, joiningEmailLastError: 'SMTP connection failed' },
      ],
    },
    emailService: {},
    logger: createLogger(),
  });
  const response = createResponse();

  await controller.getJoiningCampaignPreview({}, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.success, true);
  assert.deepEqual(response.body.summary, {
    total: 3,
    sent: 1,
    pending: 1,
    failed: 1,
    eligibleCount: 2,
  });
  assert.equal(response.body.preview.subject, 'Your Zoom Joining Link – Halal Wealth Webinar | 18 October 2026');
  assert.match(response.body.preview.text, /814 8798 3324/);
  assert.match(response.body.preview.text, /666991/);
});

test('bulk one-hour reminder requires explicit confirmation, deduplicates emails, and reports summary', async () => {
  const registrations = [
    { _id: 'r1', email: 'user1@example.com', fullName: 'User One', reminderEmailSent: false },
    { _id: 'r2', email: 'user1@example.com', fullName: 'User One Duplicate', reminderEmailSent: false },
    { _id: 'r3', email: 'invalid-email', fullName: 'Invalid User', reminderEmailSent: false },
    { _id: 'r4', email: 'user2@example.com', fullName: 'User Two', reminderEmailSent: false },
  ];
  const sent = [];

  const registrationModel = {
    find: async () => registrations,
    collection: {
      updateOne: async () => ({ matchedCount: 1, modifiedCount: 1 }),
      findOne: async filter => registrations.find(r => r._id === filter._id || r.email === filter.email),
    },
    findOneAndUpdate: async (filter, update) => {
      const reg = registrations.find(r => r._id === filter._id || r.email === filter.email);
      if (reg) Object.assign(reg, update.$set);
      return reg;
    },
    findByIdAndUpdate: async (id, update) => {
      const reg = registrations.find(r => r._id === id);
      if (reg) Object.assign(reg, update.$set);
      return reg;
    },
  };

  const emailService = {
    sendOneHourReminder: async (email, name) => {
      if (email === 'user2@example.com') {
        throw new Error('SMTP connection refused');
      }
      sent.push({ email, name });
      return { accepted: [email], messageId: '<test-reminder-msg-id>' };
    },
  };

  const controller = createAdminRegistrationController({
    registrationModel,
    emailService,
    logger: createLogger(),
  });

  // 1. Missing confirmation rejected
  const unconfirmedRes = createResponse();
  await controller.sendBulkOneHourReminders({ body: {} }, unconfirmedRes);
  assert.equal(unconfirmedRes.statusCode, 400);

  // 2. Confirmed run
  const confirmedRes = createResponse();
  await controller.sendBulkOneHourReminders({ body: { confirmed: true, delayMs: 0 } }, confirmedRes);

  assert.equal(confirmedRes.statusCode, 200);
  assert.equal(confirmedRes.body.success, false); // has 1 failure
  assert.equal(confirmedRes.body.summary.total, 4);
  assert.equal(confirmedRes.body.summary.eligible, 2); // user1 and user2 (dup skipped, invalid skipped)
  assert.equal(confirmedRes.body.summary.sent, 1); // user1 sent
  assert.equal(confirmedRes.body.summary.failed, 1); // user2 failed
  assert.equal(confirmedRes.body.summary.skipped, 2);
  assert.deepEqual(confirmedRes.body.sentEmails, ['user1@example.com']);
  assert.equal(confirmedRes.body.failedEmails.length, 1);
  assert.equal(confirmedRes.body.failedEmails[0].email, 'user2@example.com');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].email, 'user1@example.com');
});

test('bulk one-hour reminder prevents concurrent duplicate campaign runs', async () => {
  let releaseFirstSend;
  const slowEmailService = {
    sendOneHourReminder: async () => new Promise(resolve => { releaseFirstSend = resolve; }),
  };

  const controller = createAdminRegistrationController({
    registrationModel: { find: async () => [{ _id: 'r1', email: 'slow@example.com', fullName: 'Slow User' }] },
    emailService: slowEmailService,
    logger: createLogger(),
  });

  const firstRes = createResponse();
  const firstPromise = controller.sendBulkOneHourReminders({ body: { confirmed: true, delayMs: 0 } }, firstRes);

  // Attempt concurrent second run
  const secondRes = createResponse();
  await controller.sendBulkOneHourReminders({ body: { confirmed: true, delayMs: 0 } }, secondRes);

  assert.equal(secondRes.statusCode, 409);
  assert.match(secondRes.body.message, /already in progress/);

  // Complete first run
  releaseFirstSend({ accepted: ['slow@example.com'], messageId: '<msg-1>' });
  await firstPromise;
  assert.equal(firstRes.statusCode, 200);
});

test('feedback campaign preview returns accurate counts and template preview', async () => {
  const registrations = [
    { _id: 'r1', email: 'sent@example.com', fullName: 'Sent User', feedbackEmailSent: true },
    { _id: 'r2', email: 'pending@example.com', fullName: 'Pending User', feedbackEmailSent: false },
    { _id: 'r3', email: 'failed@example.com', fullName: 'Failed User', feedbackEmailSent: false, feedbackEmailLastError: 'SMTP fail' },
    { _id: 'r4', email: 'pending@example.com', fullName: 'Dup User', feedbackEmailSent: false },
    { _id: 'r5', email: 'not-an-email', fullName: 'Bad User', feedbackEmailSent: false },
  ];
  const controller = createAdminRegistrationController({
    registrationModel: { find: async () => registrations },
    emailService: {
      buildFeedbackEmail: (cfg, name) => ({ subject: 'Feedback Subject', text: 'Text', html: 'Html' }),
    },
    campaignConfigModel: { findOne: async () => null },
    logger: createLogger(),
  });
  const res = createResponse();
  await controller.getFeedbackCampaignPreview({}, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.recipients.total, 5);
  assert.equal(res.body.recipients.valid, 3);
  assert.equal(res.body.recipients.sent, 1);
  assert.equal(res.body.recipients.pending, 1);
  assert.equal(res.body.recipients.failed, 1);
  assert.equal(res.body.recipients.duplicates, 1);
  assert.equal(res.body.recipients.invalid, 1);
  assert.equal(res.body.recipients.eligibleToSend, 2);
  assert.equal(res.body.preview.subject, 'Feedback Subject');
});

test('updateFeedbackCampaignConfig validates URLs and prevents script injection', async () => {
  let savedConfig = null;
  const controller = createAdminRegistrationController({
    campaignConfigModel: {
      findOneAndUpdate: async (filter, update) => {
        savedConfig = update.$set;
        return savedConfig;
      },
    },
    logger: createLogger(),
  });

  // Rejects missing subject
  const res1 = createResponse();
  await controller.updateFeedbackCampaignConfig({ body: { subject: '', bodyText: 'Body' } }, res1);
  assert.equal(res1.statusCode, 400);

  // Rejects invalid URL
  const res2 = createResponse();
  await controller.updateFeedbackCampaignConfig({ body: { subject: 'Subject', bodyText: 'Body', feedbackFormUrl: 'ftp://not-allowed' } }, res2);
  assert.equal(res2.statusCode, 400);

  // Rejects script injection
  const res3 = createResponse();
  await controller.updateFeedbackCampaignConfig({ body: { subject: '<script>alert(1)</script>', bodyText: 'Body' } }, res3);
  assert.equal(res3.statusCode, 400);

  // Accepts valid config
  const res4 = createResponse();
  await controller.updateFeedbackCampaignConfig({
    body: {
      subject: 'Valid Subject',
      bodyText: 'Valid Body',
      feedbackFormUrl: 'https://forms.gle/test',
    },
    user: { email: 'admin@halalwealth.finance' },
  }, res4);
  assert.equal(res4.statusCode, 200);
  assert.equal(savedConfig.subject, 'Valid Subject');
  assert.equal(savedConfig.updatedBy, 'admin@halalwealth.finance');
});

test('bulk feedback emails require explicit confirmation, deduplicate, skip already sent, and track results', async () => {
  const registrations = [
    { _id: 'r1', email: 'reg1@example.com', fullName: 'User One', feedbackEmailSent: false },
    { _id: 'r2', email: 'reg1@example.com', fullName: 'User One Duplicate', feedbackEmailSent: false },
    { _id: 'r3', email: 'already-sent@example.com', fullName: 'User Sent', feedbackEmailSent: true },
    { _id: 'r4', email: 'fail@example.com', fullName: 'User Fail', feedbackEmailSent: false },
  ];
  const sent = [];
  const updates = {};
  const controller = createAdminRegistrationController({
    registrationModel: {
      find: async () => registrations,
      findOneAndUpdate: async (filter, update) => {
        const id = filter._id || (filter.$or && (filter.$or[0]?._id || filter.$or[2]?.registrationId)) || 'unknown';
        updates[id] = update.$set;
        return { _id: id, ...update.$set };
      },
    },
    emailService: {
      sendFeedbackEmail: async (email, name) => {
        if (email === 'fail@example.com') throw new Error('SMTP timeout');
        sent.push({ email, name });
        return { accepted: [email], messageId: '<msg-test>' };
      },
      DEFAULT_FEEDBACK_EMAIL_SUBJECT: 'Feedback Subject',
      DEFAULT_FEEDBACK_BODY_TEXT: 'Feedback Body',
    },
    campaignConfigModel: { findOne: async () => null },
    logger: createLogger(),
  });

  // 1. Without confirmation: rejected
  const unconfirmedRes = createResponse();
  await controller.sendBulkFeedbackEmails({ body: {} }, unconfirmedRes);
  assert.equal(unconfirmedRes.statusCode, 400);

  // 2. With confirmation
  const confirmedRes = createResponse();
  await controller.sendBulkFeedbackEmails({ body: { confirmed: true, delayMs: 0 } }, confirmedRes);
  assert.equal(confirmedRes.statusCode, 200);
  assert.equal(confirmedRes.body.summary.total, 4);
  assert.equal(confirmedRes.body.summary.eligible, 2); // reg1 and fail (dup skipped, already-sent skipped)
  assert.equal(confirmedRes.body.summary.sent, 1);
  assert.equal(confirmedRes.body.summary.failed, 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].email, 'reg1@example.com');
  assert.equal(updates['r1'].feedbackEmailSent, true);
  assert.equal(updates['r4'].feedbackEmailSent, false);
  assert.match(updates['r4'].feedbackEmailLastError, /SMTP timeout/);
});

test('bulk feedback emails prevent concurrent duplicate runs', async () => {
  let releaseFirstSend;
  let firstSendReached;
  const reachedPromise = new Promise(resolve => { firstSendReached = resolve; });

  const slowEmailService = {
    sendFeedbackEmail: async () => {
      firstSendReached();
      return new Promise(resolve => { releaseFirstSend = resolve; });
    },
    DEFAULT_FEEDBACK_EMAIL_SUBJECT: 'Sub',
    DEFAULT_FEEDBACK_BODY_TEXT: 'Txt',
  };

  const controller = createAdminRegistrationController({
    registrationModel: { find: async () => [{ _id: 'r1', email: 'slow@example.com', fullName: 'Slow User' }] },
    emailService: slowEmailService,
    campaignConfigModel: { findOne: async () => null },
    logger: createLogger(),
  });

  const firstRes = createResponse();
  const firstPromise = controller.sendBulkFeedbackEmails({ body: { confirmed: true, delayMs: 0 } }, firstRes);

  await reachedPromise;

  const secondRes = createResponse();
  await controller.sendBulkFeedbackEmails({ body: { confirmed: true, delayMs: 0 } }, secondRes);

  assert.equal(secondRes.statusCode, 409);
  assert.match(secondRes.body.message, /already in progress/);

  releaseFirstSend({ accepted: ['slow@example.com'], messageId: '<msg-1>' });
  await firstPromise;
  assert.equal(firstRes.statusCode, 200);
});
test('buildRegistrationFilter correctly filters by webinarId and ignores all', () => {
  const novFilter = buildRegistrationFilter({ webinarId: 'halal-wealth-nov-2026' });
  assert.equal(novFilter.webinarId, 'halal-wealth-nov-2026');

  const octFilter = buildRegistrationFilter({ webinarId: 'halal-wealth-oct-2026' });
  assert.equal(octFilter.webinarId, 'halal-wealth-oct-2026');

  const allFilter = buildRegistrationFilter({ webinarId: 'all' });
  assert.equal(allFilter.webinarId, undefined);
});

test('list scopes summary facet to the requested webinarId', async () => {
  let pipeline;
  const registrationModel = {
    aggregate: async value => {
      pipeline = value;
      return [{
        data: [{ _id: 'r1', fullName: 'Nov User', status: 'Registered' }],
        filteredTotal: [{ count: 1 }],
        summary: [{ total: 1, today: 1, verified: 0, pending: 1 }],
      }];
    },
  };
  const controller = createAdminRegistrationController({ registrationModel, logger: createLogger() });
  const response = createResponse();

  await controller.list({ query: { webinarId: 'halal-wealth-nov-2026' } }, response);

  assert.equal(pipeline[0].$facet.data[0].$match.webinarId, 'halal-wealth-nov-2026');
  assert.equal(pipeline[0].$facet.summary[0].$match.webinarId, 'halal-wealth-nov-2026');
  assert.equal(response.body.summary.total, 1);
});

test('bulk Zoom campaign scopes recipients to the selected webinarId and excludes others', async () => {
  const sent = [];
  const controller = createAdminRegistrationController({
    registrationModel: {
      find: async () => [
        { _id: 'nov-1', fullName: 'Nov User', email: 'nov@example.com', webinarId: 'halal-wealth-nov-2026', joiningEmailSent: false },
        { _id: 'oct-1', fullName: 'Oct User', email: 'oct@example.com', webinarId: 'halal-wealth-oct-2026', joiningEmailSent: false },
      ],
      findByIdAndUpdate: async (_id, update) => ({ _id, ...update.$set }),
    },
    emailService: {
      sendZoomJoiningLink: async email => { sent.push(email); },
    },
    logger: createLogger(),
  });
  const res = createResponse();

  await controller.sendBulkZoomJoiningLinks({ body: { confirmed: true, delayMs: 0, webinarId: 'halal-wealth-nov-2026' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.summary.sent, 1);
  assert.deepEqual(sent, ['nov@example.com']);
});

test('getWebinars returns all webinars with accurate participant counts', async () => {
  const controller = createAdminRegistrationController({
    registrationModel: {
      countDocuments: async filter => (filter.$or?.[0]?.webinarId === 'halal-wealth-nov-2026' ? 5 : 205),
    },
    webinarModel: {
      find: () => ({
        sort: () => ({
          lean: async () => [
            { webinarId: 'halal-wealth-nov-2026', title: 'Nov Webinar', status: 'Upcoming' },
            { webinarId: 'halal-wealth-oct-2026', title: 'Oct Webinar', status: 'Completed' },
          ],
        }),
      }),
    },
    logger: createLogger(),
  });
  const res = createResponse();

  await controller.getWebinars({}, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.length, 2);
  assert.equal(res.body.data[0].webinarId, 'halal-wealth-nov-2026');
  assert.equal(res.body.data[0].participantCount, 5);
  assert.equal(res.body.data[1].webinarId, 'halal-wealth-oct-2026');
  assert.equal(res.body.data[1].participantCount, 205);
});

test('sendIndividualEmail validates input, checks recipient, and dispatches custom email to single participant', async () => {
  let emailSentTo = null;
  let emailPayload = null;

  const mockEmailService = {
    sendCustomEmail: async (email, payload) => {
      emailSentTo = email;
      emailPayload = payload;
      return { accepted: [email], messageId: '<test-id@halalwealth.finance>' };
    },
  };

  const mockRegistrationModel = {
    findOne: async () => ({
      _id: 'reg-12345',
      registrationId: 'HWS-2026-001',
      fullName: 'Brother Harun',
      email: 'harun@example.com',
    }),
  };

  const controller = createAdminRegistrationController({
    registrationModel: mockRegistrationModel,
    emailService: mockEmailService,
    logger: createLogger(),
  });

  // 1. Rejects invalid id
  const resBadId = createResponse();
  await controller.sendIndividualEmail({ params: { id: '[object Object]' }, body: { subject: 'Test', message: 'Hi' } }, resBadId);
  assert.equal(resBadId.statusCode, 404);

  // 2. Rejects missing subject
  const resNoSubject = createResponse();
  await controller.sendIndividualEmail({ params: { id: 'reg-12345' }, body: { subject: '', message: 'Hi' } }, resNoSubject);
  assert.equal(resNoSubject.statusCode, 400);

  // 3. Rejects missing message
  const resNoMessage = createResponse();
  await controller.sendIndividualEmail({ params: { id: 'reg-12345' }, body: { subject: 'Subject', message: '  ' } }, resNoMessage);
  assert.equal(resNoMessage.statusCode, 400);

  // 4. Successful send
  const resSuccess = createResponse();
  await controller.sendIndividualEmail({
    params: { id: 'reg-12345' },
    body: { subject: 'Important Webinar Reminder', message: 'Assalamu Alaikum,\n\nPlease remember our session.' },
  }, resSuccess);

  assert.equal(resSuccess.statusCode, 200);
  assert.equal(resSuccess.body.success, true);
  assert.match(resSuccess.body.message, /Email sent successfully to harun@example.com/);
  assert.equal(emailSentTo, 'harun@example.com');
  assert.equal(emailPayload.subject, 'Important Webinar Reminder');
  assert.equal(emailPayload.recipientName, 'Brother Harun');
});

test('sendIndividualEmail handles participant not found and SMTP failure safely', async () => {
  const controller = createAdminRegistrationController({
    registrationModel: {
      findOne: async () => null,
      findById: async () => null,
    },
    emailService: {
      sendCustomEmail: async () => { throw new Error('SMTP connection timed out'); },
    },
    logger: createLogger(),
  });

  // 1. Participant not found
  const resNotFound = createResponse();
  await controller.sendIndividualEmail({ params: { id: 'non-existent-id' }, body: { subject: 'Hi', message: 'Test' } }, resNotFound);
  assert.equal(resNotFound.statusCode, 404);

  // 2. SMTP error handling
  const controllerWithParticipant = createAdminRegistrationController({
    registrationModel: {
      findOne: async () => ({ _id: 'reg-999', email: 'fail@example.com', fullName: 'Fail User' }),
    },
    emailService: {
      sendCustomEmail: async () => { throw new Error('SMTP connection timed out'); },
    },
    logger: createLogger(),
  });

  const resError = createResponse();
  await controllerWithParticipant.sendIndividualEmail({
    params: { id: 'reg-999' },
    body: { subject: 'Test Subject', message: 'Test Message' },
  }, resError);

  assert.equal(resError.statusCode, 500);
  assert.equal(resError.body.success, false);
  assert.match(resError.body.message, /SMTP connection timed out/);
});
