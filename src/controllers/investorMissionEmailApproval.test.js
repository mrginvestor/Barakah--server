const test = require('node:test');
const assert = require('node:assert/strict');
const {
  evaluateCombinedApproval,
  resendConfirmationEmail,
} = require('./summitController');
const investorMissionEmailService = require('../services/investorMissionEmailService');
const SmallSummitRegistration = require('../models/SmallSummitRegistration');

test('evaluateCombinedApproval confirms seat and dispatches confirmation email on success', async () => {
  const origCount = SmallSummitRegistration.countDocuments;
  const origUpdateOne = SmallSummitRegistration.updateOne;
  const origSend = investorMissionEmailService.sendInvestorMissionConfirmation;

  SmallSummitRegistration.countDocuments = async () => 5; // 5 confirmed seats
  let updateOneCalledWith = null;
  SmallSummitRegistration.updateOne = async (query, update) => {
    updateOneCalledWith = { query, update };
    return { modifiedCount: 1 };
  };

  let emailSentPayload = null;
  investorMissionEmailService.sendInvestorMissionConfirmation = async (payload) => {
    emailSentPayload = payload;
    return { success: true, messageId: 'msg-test-123' };
  };

  try {
    let saved = false;
    const reg = {
      _id: 'reg-email-test-01',
      registrationId: 'IM26-00001',
      fullName: 'Tariq Ahmad',
      email: 'tariq@example.com',
      registrationApproved: true,
      paymentApproved: true,
      registrationStatus: 'PENDING_APPROVAL',
      paymentStatus: 'PENDING_VERIFICATION',
      status: 'Pending',
      confirmationEmailSent: false,
      confirmationEmailStatus: 'NOT_SENT',
      save: async () => {
        saved = true;
        return reg;
      },
    };

    const result = await evaluateCombinedApproval(reg, 'admin@halalwealth.finance', 'Approved in full');

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.confirmed, true);
    assert.strictEqual(reg.registrationStatus, 'CONFIRMED');
    assert.strictEqual(reg.paymentStatus, 'PAID');
    assert.strictEqual(reg.status, 'Confirmed');
    assert.strictEqual(saved, true);

    // Wait a tick for email promise to resolve
    await new Promise((r) => setTimeout(r, 50));

    assert.ok(emailSentPayload, 'Email service should be called');
    assert.strictEqual(emailSentPayload.recipientEmail, 'tariq@example.com');
    assert.strictEqual(emailSentPayload.registrationId, 'IM26-00001');

    assert.ok(updateOneCalledWith, 'SmallSummitRegistration.updateOne should be called on email success');
    assert.strictEqual(updateOneCalledWith.update.$set.confirmationEmailStatus, 'SENT');
    assert.strictEqual(updateOneCalledWith.update.$set.confirmationEmailSent, true);
    assert.strictEqual(updateOneCalledWith.update.$inc.confirmationEmailAttempts, 1);
  } finally {
    SmallSummitRegistration.countDocuments = origCount;
    SmallSummitRegistration.updateOne = origUpdateOne;
    investorMissionEmailService.sendInvestorMissionConfirmation = origSend;
  }
});

test('evaluateCombinedApproval decouples payment approval from email timeout - seat remains CONFIRMED and PAID', async () => {
  const origCount = SmallSummitRegistration.countDocuments;
  const origUpdateOne = SmallSummitRegistration.updateOne;
  const origSend = investorMissionEmailService.sendInvestorMissionConfirmation;

  SmallSummitRegistration.countDocuments = async () => 12;
  let updateOneCalledWith = null;
  SmallSummitRegistration.updateOne = async (query, update) => {
    updateOneCalledWith = { query, update };
    return { modifiedCount: 1 };
  };

  // Simulate timeout failure during email sending
  investorMissionEmailService.sendInvestorMissionConfirmation = async () => {
    const timeoutErr = new Error('Connection timeout');
    timeoutErr.code = 'ETIMEDOUT';
    throw timeoutErr;
  };

  try {
    let saved = false;
    const reg = {
      _id: 'reg-email-test-02',
      registrationId: 'IM26-00002',
      fullName: 'Aisha Begum',
      email: 'aisha@example.com',
      registrationApproved: true,
      paymentApproved: true,
      registrationStatus: 'PENDING_APPROVAL',
      paymentStatus: 'PENDING_VERIFICATION',
      status: 'Pending',
      confirmationEmailSent: false,
      confirmationEmailStatus: 'NOT_SENT',
      save: async () => {
        saved = true;
        return reg;
      },
    };

    const result = await evaluateCombinedApproval(reg, 'admin@halalwealth.finance', 'Approved payment');

    // Crucial check: Seat and payment approval SUCCEEDS despite email timeout
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.confirmed, true);
    assert.strictEqual(reg.registrationStatus, 'CONFIRMED');
    assert.strictEqual(reg.paymentStatus, 'PAID');
    assert.strictEqual(reg.status, 'Confirmed');
    assert.strictEqual(saved, true);

    // Wait a tick for email promise rejection handler to run
    await new Promise((r) => setTimeout(r, 50));

    assert.ok(updateOneCalledWith, 'SmallSummitRegistration.updateOne should record email failure state');
    assert.strictEqual(updateOneCalledWith.update.$set.confirmationEmailStatus, 'FAILED');
    assert.strictEqual(updateOneCalledWith.update.$set.confirmationEmailSent, false);
    assert.strictEqual(updateOneCalledWith.update.$set.confirmationEmailLastError, 'Connection timeout');
    assert.strictEqual(updateOneCalledWith.update.$inc.confirmationEmailAttempts, 1);
  } finally {
    SmallSummitRegistration.countDocuments = origCount;
    SmallSummitRegistration.updateOne = origUpdateOne;
    investorMissionEmailService.sendInvestorMissionConfirmation = origSend;
  }
});

test('resendConfirmationEmail increments attempt count and updates status when retried by admin', async () => {
  const origFindOne = SmallSummitRegistration.findOne;
  const origSend = investorMissionEmailService.sendInvestorMissionConfirmation;

  let saved = false;
  let regRecord = {
    _id: 'reg-email-test-03',
    registrationId: 'IM26-00003',
    fullName: 'Zubair Khan',
    email: 'zubair@example.com',
    registrationStatus: 'CONFIRMED',
    paymentStatus: 'PAID',
    status: 'Confirmed',
    confirmationEmailSent: false,
    confirmationEmailStatus: 'FAILED',
    confirmationEmailAttempts: 1,
    checkInToken: 'testtoken123',
    save: async function () {
      saved = true;
      return this;
    },
  };

  SmallSummitRegistration.findOne = async () => regRecord;

  investorMissionEmailService.sendInvestorMissionConfirmation = async () => {
    return { success: true, messageId: 'msg-retry-456' };
  };

  try {
    const req = {
      params: { registrationId: 'IM26-00003' },
    };
    let responseStatus = 200;
    let responseJson = null;
    const res = {
      status: (code) => {
        responseStatus = code;
        return res;
      },
      json: (data) => {
        responseJson = data;
        return data;
      },
    };

    await resendConfirmationEmail(req, res);

    assert.strictEqual(responseStatus, 200);
    assert.strictEqual(responseJson.success, true);
    assert.strictEqual(responseJson.emailStatus, 'SENT');
    assert.strictEqual(responseJson.attempts, 2);

    assert.strictEqual(saved, true);
    assert.strictEqual(regRecord.confirmationEmailStatus, 'SENT');
    assert.strictEqual(regRecord.confirmationEmailSent, true);
    assert.strictEqual(regRecord.confirmationEmailAttempts, 2);
  } finally {
    SmallSummitRegistration.findOne = origFindOne;
    investorMissionEmailService.sendInvestorMissionConfirmation = origSend;
  }
});

test('evaluateCombinedApproval does not dispatch duplicate emails if already sent', async () => {
  const origCount = SmallSummitRegistration.countDocuments;
  const origSend = investorMissionEmailService.sendInvestorMissionConfirmation;

  SmallSummitRegistration.countDocuments = async () => 10;
  let emailSentCalled = false;
  investorMissionEmailService.sendInvestorMissionConfirmation = async () => {
    emailSentCalled = true;
    return { success: true };
  };

  try {
    const reg = {
      _id: 'reg-email-test-04',
      registrationId: 'IM26-00004',
      fullName: 'Farooq Abdullah',
      email: 'farooq@example.com',
      registrationApproved: true,
      paymentApproved: true,
      registrationStatus: 'CONFIRMED',
      paymentStatus: 'PAID',
      status: 'Confirmed',
      confirmationEmailSent: true,
      confirmationEmailStatus: 'SENT',
      save: async () => reg,
    };

    const result = await evaluateCombinedApproval(reg, 'admin@halalwealth.finance', 'Re-check');
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.confirmed, true);

    await new Promise((r) => setTimeout(r, 50));
    assert.strictEqual(emailSentCalled, false, 'Should not dispatch duplicate email if already sent');
  } finally {
    SmallSummitRegistration.countDocuments = origCount;
    investorMissionEmailService.sendInvestorMissionConfirmation = origSend;
  }
});
