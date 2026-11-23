const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  dispatchConfirmationEmail,
  processPendingRetryQueue,
  calculateNextRetryAt,
  MAX_AUTO_ATTEMPTS,
} = require('./investorMissionRetryWorker');

describe('investorMissionRetryWorker', () => {
  it('calculates exponential backoff correctly for attempts', () => {
    const base = new Date('2026-12-01T10:00:00Z');
    const retry1 = calculateNextRetryAt(1, base);
    assert.equal(retry1.getTime() - base.getTime(), 60000); // 1 min

    const retry2 = calculateNextRetryAt(2, base);
    assert.equal(retry2.getTime() - base.getTime(), 300000); // 5 min

    const retry3 = calculateNextRetryAt(3, base);
    assert.equal(retry3.getTime() - base.getTime(), 900000); // 15 min

    const retry4 = calculateNextRetryAt(4, base);
    assert.equal(retry4.getTime() - base.getTime(), 3600000); // 60 min

    const retry5 = calculateNextRetryAt(5, base);
    assert.equal(retry5.getTime() - base.getTime(), 7200000); // 120 min
  });

  it('successfully dispatches email and updates registration status to SENT', async () => {
    let saved = false;
    const dummyReg = {
      _id: 'reg-rw-01',
      registrationId: 'SS26-00001',
      fullName: 'Yusuf Patel',
      email: 'yusuf@example.com',
      registrationApproved: true,
      paymentApproved: true,
      registrationStatus: 'CONFIRMED',
      paymentStatus: 'PAID',
      status: 'Confirmed',
      confirmationEmailSent: false,
      confirmationEmailStatus: 'PENDING',
      confirmationEmailAttempts: 0,
      save: async function () {
        saved = true;
        return this;
      },
    };

    const mockModel = {
      findOne: async () => dummyReg,
    };

    let sentParams = null;
    const mockEmailService = {
      sendInvestorMissionConfirmation: async (params) => {
        sentParams = params;
        return { success: true, messageId: 'msg-test-rw-01' };
      },
    };

    const result = await dispatchConfirmationEmail('SS26-00001', {
      model: mockModel,
      emailService: mockEmailService,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });

    assert.equal(result.success, true);
    assert.equal(result.emailStatus, 'SENT');
    assert.equal(result.attempts, 1);
    assert.equal(result.messageId, 'msg-test-rw-01');

    assert.equal(saved, true);
    assert.equal(dummyReg.confirmationEmailSent, true);
    assert.equal(dummyReg.confirmationEmailStatus, 'SENT');
    assert.equal(dummyReg.confirmationEmailAttempts, 1);
    assert.equal(dummyReg.confirmationEmailLastError, null);
    assert.equal(dummyReg.confirmationEmailLockUntil, null);

    assert.ok(sentParams);
    assert.equal(sentParams.recipientEmail, 'yusuf@example.com');
    assert.equal(sentParams.registrationId, 'SS26-00001');
  });

  it('guarantees idempotency: skips dispatch if already SENT unless forced', async () => {
    const dummyReg = {
      _id: 'reg-rw-02',
      registrationId: 'SS26-00002',
      fullName: 'Fatima Zahra',
      email: 'fatima@example.com',
      registrationApproved: true,
      paymentApproved: true,
      registrationStatus: 'CONFIRMED',
      paymentStatus: 'PAID',
      status: 'Confirmed',
      confirmationEmailSent: true,
      confirmationEmailStatus: 'SENT',
      confirmationEmailSentAt: new Date('2026-11-20T10:00:00Z'),
      save: async function () { return this; },
    };

    const mockModel = { findOne: async () => dummyReg };
    let emailSentCalled = false;
    const mockEmailService = {
      sendInvestorMissionConfirmation: async () => {
        emailSentCalled = true;
        return { success: true };
      },
    };

    const result = await dispatchConfirmationEmail('SS26-00002', {
      force: false,
      model: mockModel,
      emailService: mockEmailService,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });

    assert.equal(result.success, true);
    assert.equal(result.alreadySent, true);
    assert.equal(result.emailStatus, 'SENT');
    assert.equal(emailSentCalled, false, 'Email service should not be invoked when already SENT');
  });

  it('records FAILED status, increments attempts, and schedules backoff when email times out', async () => {
    let saved = false;
    const dummyReg = {
      _id: 'reg-rw-03',
      registrationId: 'SS26-00003',
      fullName: 'Bilal Hassan',
      email: 'bilal@example.com',
      registrationApproved: true,
      paymentApproved: true,
      registrationStatus: 'CONFIRMED',
      paymentStatus: 'PAID',
      status: 'Confirmed',
      confirmationEmailSent: false,
      confirmationEmailStatus: 'PENDING',
      confirmationEmailAttempts: 0,
      save: async function () {
        saved = true;
        return this;
      },
    };

    const mockModel = { findOne: async () => dummyReg };
    const mockEmailService = {
      sendInvestorMissionConfirmation: async () => {
        const timeoutErr = new Error('Connection timeout');
        timeoutErr.code = 'ETIMEDOUT';
        throw timeoutErr;
      },
    };

    const before = Date.now();
    const result = await dispatchConfirmationEmail('SS26-00003', {
      model: mockModel,
      emailService: mockEmailService,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });

    assert.equal(result.success, false);
    assert.equal(result.emailStatus, 'FAILED');
    assert.equal(result.attempts, 1);
    assert.match(result.error, /Connection timeout/);

    assert.equal(saved, true);
    assert.equal(dummyReg.confirmationEmailSent, false);
    assert.equal(dummyReg.confirmationEmailStatus, 'FAILED');
    assert.equal(dummyReg.confirmationEmailAttempts, 1);
    assert.equal(dummyReg.confirmationEmailLastError, 'Connection timeout');
    assert.equal(dummyReg.confirmationEmailLockUntil, null);
    assert.ok(dummyReg.confirmationEmailNextRetryAt);
    assert.ok(dummyReg.confirmationEmailNextRetryAt.getTime() >= before + 59000);
  });

  it('stops automatic retries after MAX_AUTO_ATTEMPTS (5)', async () => {
    const dummyReg = {
      _id: 'reg-rw-04',
      registrationId: 'SS26-00004',
      fullName: 'Zainab Begum',
      email: 'zainab@example.com',
      registrationApproved: true,
      paymentApproved: true,
      registrationStatus: 'CONFIRMED',
      paymentStatus: 'PAID',
      status: 'Confirmed',
      confirmationEmailSent: false,
      confirmationEmailStatus: 'FAILED',
      confirmationEmailAttempts: 4, // 5th attempt coming up
      save: async function () { return this; },
    };

    const mockModel = { findOne: async () => dummyReg };
    const mockEmailService = {
      sendInvestorMissionConfirmation: async () => {
        throw new Error('Persistent timeout');
      },
    };

    const result = await dispatchConfirmationEmail('SS26-00004', {
      model: mockModel,
      emailService: mockEmailService,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });

    assert.equal(result.success, false);
    assert.equal(result.attempts, 5);
    assert.equal(dummyReg.confirmationEmailAttempts, 5);
    assert.equal(dummyReg.confirmationEmailNextRetryAt, null, 'Should not schedule more retries after reaching 5');
  });

  it('processPendingRetryQueue finds eligible failed emails and executes retry batch', async () => {
    const mockPending = [
      { registrationId: 'SS26-00010', email: 'user1@example.com' },
      { registrationId: 'SS26-00011', email: 'user2@example.com' },
    ];

    let queryRan = null;
    const mockModel = {
      find: (q) => {
        queryRan = q;
        return {
          select: () => ({
            limit: () => ({
              lean: async () => mockPending,
            }),
          }),
        };
      },
      findOne: async ({ registrationId }) => ({
        _id: `id-${registrationId}`,
        registrationId,
        fullName: 'Attendee',
        email: `${registrationId}@example.com`,
        registrationApproved: true,
        paymentApproved: true,
        registrationStatus: 'CONFIRMED',
        paymentStatus: 'PAID',
        status: 'Confirmed',
        confirmationEmailSent: false,
        confirmationEmailStatus: 'FAILED',
        confirmationEmailAttempts: 1,
        save: async function () { return this; },
      }),
    };

    const retried = [];
    const mockEmailService = {
      sendInvestorMissionConfirmation: async ({ registrationId }) => {
        retried.push(registrationId);
        return { success: true };
      },
    };

    const res = await processPendingRetryQueue({
      model: mockModel,
      emailService: mockEmailService,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });

    assert.equal(res.processed, 2);
    assert.equal(res.successes, 2);
    assert.equal(res.failures, 0);
    assert.deepEqual(retried, ['SS26-00010', 'SS26-00011']);
    assert.ok(queryRan);
  });
});
