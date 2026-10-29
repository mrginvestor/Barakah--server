const test = require('node:test');
const assert = require('node:assert/strict');
const { createBulkEmailService, isPermanentError } = require('./bulkEmailService');

test('isPermanentError correctly identifies permanent vs temporary SMTP failures', () => {
  assert.equal(isPermanentError(new Error('550 5.1.1 User unknown')), true);
  assert.equal(isPermanentError(new Error('501 Syntax error in parameters or arguments')), true);
  assert.equal(isPermanentError(new Error('Address rejected by recipient mail server')), true);
  assert.equal(isPermanentError(new Error('Mailbox unavailable')), true);
  assert.equal(isPermanentError({ responseCode: 550, message: 'Bad mailbox' }), true);

  // Temporary network/transporter issues
  assert.equal(isPermanentError(new Error('Connection timeout')), false);
  assert.equal(isPermanentError(new Error('ETIMEDOUT')), false);
  assert.equal(isPermanentError(new Error('ECONNRESET')), false);
  assert.equal(isPermanentError(new Error('ECONNREFUSED')), false);
  assert.equal(isPermanentError({ responseCode: 421, message: 'Try again later' }), false);
});

test('startJob blocks concurrent bulk jobs with an error', async () => {
  let savedJob = null;
  const mockBulkJobModel = function(data) {
    this.data = data;
    this.save = async () => { savedJob = this.data; return this; };
  };
  mockBulkJobModel.findOne = async () => null;
  mockBulkJobModel.updateOne = async () => {};

  const mockRegModel = {
    find: () => ({
      sort: async () => [{ _id: 'reg1', email: 'one@example.com' }, { _id: 'reg2', email: 'two@example.com' }],
    }),
    findById: async (id) => ({ _id: id, email: `${id}@example.com`, fullName: 'User' }),
    updateOne: async () => {},
  };

  const mockEmailService = {
    sendRegistrationConfirmation: async () => {
      // Delay to simulate in-flight job
      await new Promise(r => setTimeout(r, 100));
      return { messageId: 'msg-1' };
    },
  };

  const service = createBulkEmailService({
    bulkJobModel: mockBulkJobModel,
    registrationModel: mockRegModel,
    emailService: mockEmailService,
    delayMs: 10,
  });

  const firstJob = await service.startJob({ scope: 'pending_failed' });
  assert.equal(firstJob.status, 'queued');
  assert.ok(firstJob.jobId);

  // Second concurrent start must throw
  await assert.rejects(
    async () => {
      await service.startJob({ scope: 'pending_failed' });
    },
    /A bulk email job is already running/
  );
});

test('skips already sent recipients in pending_failed scope', async () => {
  const updates = [];
  const jobUpdates = [];

  const mockBulkJobModel = function(data) {
    this.data = data;
    this.save = async () => this;
  };
  mockBulkJobModel.findOne = async () => null;
  mockBulkJobModel.updateOne = async (filter, update) => {
    jobUpdates.push({ filter, update });
  };

  const registrations = {
    r1: { _id: 'r1', email: 'already@example.com', fullName: 'Already Sent', confirmationEmailSent: true, emailStatus: 'accepted' },
    r2: { _id: 'r2', email: 'pending@example.com', fullName: 'Pending User', confirmationEmailSent: false, emailStatus: 'pending' },
  };

  const mockRegModel = {
    find: async () => [{ _id: 'r1' }, { _id: 'r2' }],
    findById: async (id) => registrations[id],
    updateOne: async (filter, update) => {
      updates.push({ filter, update });
    },
  };

  let sentEmail = null;
  const mockEmailService = {
    sendRegistrationConfirmation: async (email) => {
      sentEmail = email;
      return { messageId: 'msg-r2' };
    },
  };

  const service = createBulkEmailService({
    bulkJobModel: mockBulkJobModel,
    registrationModel: mockRegModel,
    emailService: mockEmailService,
    delayMs: 0,
  });

  const job = await service.startJob({
    recipientIds: ['r1', 'r2'],
    scope: 'pending_failed',
  });

  assert.equal(job.total, 2);

  // Wait for background execution to complete
  await new Promise(r => setTimeout(r, 150));

  // Only r2 should have been sent
  assert.equal(sentEmail, 'pending@example.com');

  // Verify that jobUpdates recorded a skipped item for r1 and accepted for r2
  const skippedUpdate = jobUpdates.find(u => u.update?.$inc?.skipped === 1);
  assert.ok(skippedUpdate, 'Job should record 1 skipped recipient');

  const acceptedUpdate = jobUpdates.find(u => u.update?.$inc?.accepted === 1);
  assert.ok(acceptedUpdate, 'Job should record 1 accepted recipient');
});

test('retries temporary failures and records permanent failures immediately', async () => {
  let attemptCount = 0;
  const mockEmailService = {
    sendRegistrationConfirmation: async (email) => {
      attemptCount++;
      if (email === 'temp@example.com') {
        if (attemptCount < 2) {
          throw new Error('ETIMEDOUT: Connection timeout');
        }
        return { messageId: 'recovered-msg' };
      }
      if (email === 'perm@example.com') {
        throw new Error('550 5.1.1 User mailbox not found');
      }
    },
  };

  const service = createBulkEmailService({
    emailService: mockEmailService,
    delayMs: 0,
    maxRetries: 2,
  });

  // Test temporary retry recovery
  attemptCount = 0;
  const tempOutcome = await service.sendSingleRecipientWithRetry({ email: 'temp@example.com', fullName: 'Temp User' });
  assert.equal(tempOutcome.success, true);
  assert.equal(tempOutcome.attempts, 2);

  // Test permanent failure (no retry)
  attemptCount = 0;
  const permOutcome = await service.sendSingleRecipientWithRetry({ email: 'perm@example.com', fullName: 'Perm User' });
  assert.equal(permOutcome.success, false);
  assert.equal(permOutcome.isPermanent, true);
  assert.equal(permOutcome.attempts, 1, 'Permanent failure should fail on attempt 1 without retries');
});

test('cancelJob signals running loop to stop processing further recipients', async () => {
  const jobUpdates = [];
  const processed = [];

  const mockBulkJobModel = function(data) {
    this.data = data;
    this.save = async () => this;
  };
  mockBulkJobModel.findOne = async (filter) => ({ jobId: filter.jobId, status: 'processing', save: async () => {} });
  mockBulkJobModel.updateOne = async (filter, update) => {
    jobUpdates.push({ filter, update });
  };

  const mockRegModel = {
    findById: async (id) => ({ _id: id, email: `${id}@example.com`, fullName: `User ${id}` }),
    updateOne: async () => {},
  };

  const mockEmailService = {
    sendRegistrationConfirmation: async (email) => {
      processed.push(email);
      await new Promise(r => setTimeout(r, 60));
      return { messageId: 'ok' };
    },
  };

  const service = createBulkEmailService({
    bulkJobModel: mockBulkJobModel,
    registrationModel: mockRegModel,
    emailService: mockEmailService,
    delayMs: 20,
  });

  const job = await service.startJob({
    recipientIds: ['u1', 'u2', 'u3', 'u4', 'u5'],
    scope: 'pending_failed',
  });

  // Let u1 process, then cancel
  await new Promise(r => setTimeout(r, 70));
  await service.cancelJob(job.jobId);

  // Wait for loop to exit
  await new Promise(r => setTimeout(r, 200));

  // Should have stopped early (not processed all 5)
  assert.ok(processed.length < 5, `Expected fewer than 5 processed, got ${processed.length}`);
  const cancelledUpdate = jobUpdates.find(u => u.update?.$set?.status === 'cancelled');
  assert.ok(cancelledUpdate, 'Job should record cancelled status in database');
});

test('recoverStalledJobs marks dangling jobs as failed with clear explanation', async () => {
  const savedJobs = [];
  const mockStalledJob = {
    jobId: 'stalled-123',
    status: 'processing',
    save: async function() { savedJobs.push(this); },
  };

  const mockBulkJobModel = {
    find: async () => [mockStalledJob],
  };

  const service = createBulkEmailService({
    bulkJobModel: mockBulkJobModel,
  });

  await service.recoverStalledJobs();

  assert.equal(mockStalledJob.status, 'failed');
  assert.match(mockStalledJob.errorMessage, /interrupted by a server restart/);
  assert.equal(savedJobs.length, 1);
});
