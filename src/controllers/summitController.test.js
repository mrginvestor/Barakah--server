const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  calculateActiveSeats,
  getSummitCapacity,
  createSummitRegistration,
  getSummitPaymentDetails,
  submitSummitPaymentProof,
  approveSummitPayment,
  rejectSummitPayment,
  getNextSmallSummitRegistrationId,
  evaluateCombinedApproval,
  resendAcknowledgementEmail,
} = require('./summitController');
const investorMissionEmailService = require('../services/investorMissionEmailService');
const SmallSummitRegistration = require('../models/SmallSummitRegistration');
const { validateImageMagicBytes, UPLOAD_DIR } = require('../middleware/receiptUpload');

test('validateImageMagicBytes detects valid PNG, JPEG and rejects invalid files', () => {
  const tmpDir = path.resolve(__dirname, '../../test_tmp');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  const pngPath = path.join(tmpDir, 'test.png');
  const pngHeader = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D]);
  fs.writeFileSync(pngPath, pngHeader);
  assert.strictEqual(validateImageMagicBytes(pngPath), true);

  const jpgPath = path.join(tmpDir, 'test.jpg');
  const jpgHeader = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01]);
  fs.writeFileSync(jpgPath, jpgHeader);
  assert.strictEqual(validateImageMagicBytes(jpgPath), true);

  const textPath = path.join(tmpDir, 'fake.png');
  fs.writeFileSync(textPath, Buffer.from('NOT AN IMAGE FILE CONTENT AT ALL'));
  assert.strictEqual(validateImageMagicBytes(textPath), false);

  // Clean up
  try {
    fs.unlinkSync(pngPath);
    fs.unlinkSync(jpgPath);
    fs.unlinkSync(textPath);
    fs.rmdirSync(tmpDir);
  } catch (_) {}
});

test('calculateActiveSeats correctly computes seats with 80 capacity (confirmed seats only)', async () => {
  const mockModel = {
    countDocuments: async (query) => {
      if (query?.$or) return 30; // 30 confirmed
      return 0;
    },
  };

  const result = await calculateActiveSeats(mockModel);
  assert.strictEqual(result.maxCapacity, 80);
  assert.strictEqual(result.confirmedCount, 30);
  assert.strictEqual(result.availableSeats, 50); // 80 - 30 = 50
  assert.strictEqual(result.isSoldOut, false);
});

test('calculateActiveSeats detects sold-out condition when confirmed capacity is 80', async () => {
  const mockModel = {
    countDocuments: async (query) => {
      if (query?.$or) return 80; // 80 confirmed
      return 0;
    },
  };

  const result = await calculateActiveSeats(mockModel);
  assert.strictEqual(result.confirmedCount, 80);
  assert.strictEqual(result.availableSeats, 0);
  assert.strictEqual(result.isSoldOut, true);
});

test('createSummitRegistration validates minimum 3 characters for fullName', async () => {
  const req = {
    body: {
      fullName: 'Al',
      email: 'ali@example.com',
      mobileNumber: '9876543210',
      state: 'Tamil Nadu',
      district: 'Chennai',
      city: 'Chennai',
      occupation: 'Professional',
      termsAccepted: true,
    },
  };
  let statusCode = 0;
  let jsonResponse = null;
  const res = {
    status: (code) => {
      statusCode = code;
      return {
        json: (data) => { jsonResponse = data; },
      };
    },
  };

  await createSummitRegistration(req, res);
  assert.strictEqual(statusCode, 400);
  assert.strictEqual(jsonResponse.message.includes('minimum 3 characters'), true);
});

test('createSummitRegistration validates email format', async () => {
  const req = {
    body: {
      fullName: 'Ahmad Khan',
      email: 'not-an-email',
      mobileNumber: '9876543210',
      state: 'Tamil Nadu',
      district: 'Chennai',
      city: 'Chennai',
      occupation: 'Professional',
      termsAccepted: true,
    },
  };
  let statusCode = 0;
  let jsonResponse = null;
  const res = {
    status: (code) => {
      statusCode = code;
      return {
        json: (data) => { jsonResponse = data; },
      };
    },
  };

  await createSummitRegistration(req, res);
  assert.strictEqual(statusCode, 400);
  assert.strictEqual(jsonResponse.message.includes('valid email'), true);
});

test('createSummitRegistration validates termsAccepted is mandatory', async () => {
  const req = {
    body: {
      fullName: 'Ahmad Khan',
      email: 'ahmad@example.com',
      mobileNumber: '9876543210',
      state: 'Tamil Nadu',
      district: 'Chennai',
      city: 'Chennai',
      occupation: 'Professional',
      sessionExpectations: 'Looking forward to Shariah investment guidance.',
      termsAccepted: false,
    },
  };
  let statusCode = 0;
  let jsonResponse = null;
  const res = {
    status: (code) => {
      statusCode = code;
      return {
        json: (data) => { jsonResponse = data; },
      };
    },
  };

  await createSummitRegistration(req, res);
  assert.strictEqual(statusCode, 400);
  assert.strictEqual(jsonResponse.message.includes('Terms & Conditions'), true);
});

test('createSummitRegistration requires otherOccupation when occupation is Other', async () => {
  const req = {
    body: {
      fullName: 'Ahmad Khan',
      email: 'ahmad@example.com',
      mobileNumber: '9876543210',
      state: 'Tamil Nadu',
      district: 'Chennai',
      city: 'Chennai',
      occupation: 'Other',
      otherOccupation: '',
      sessionExpectations: 'Looking forward to learning about halal funds.',
      termsAccepted: true,
    },
  };
  let statusCode = 0;
  let jsonResponse = null;
  const res = {
    status: (code) => {
      statusCode = code;
      return {
        json: (data) => { jsonResponse = data; },
      };
    },
  };

  await createSummitRegistration(req, res);
  assert.strictEqual(statusCode, 400);
  assert.strictEqual(jsonResponse.field, 'otherOccupation');
  assert.strictEqual(jsonResponse.message.includes('specify your occupation'), true);
});

test('createSummitRegistration requires sessionExpectations (minimum 10 chars)', async () => {
  const req = {
    body: {
      fullName: 'Ahmad Khan',
      email: 'ahmad@example.com',
      mobileNumber: '9876543210',
      state: 'Tamil Nadu',
      district: 'Chennai',
      city: 'Chennai',
      occupation: 'Student',
      sessionExpectations: 'Short',
      termsAccepted: true,
    },
  };
  let statusCode = 0;
  let jsonResponse = null;
  const res = {
    status: (code) => {
      statusCode = code;
      return {
        json: (data) => { jsonResponse = data; },
      };
    },
  };

  await createSummitRegistration(req, res);
  assert.strictEqual(statusCode, 400);
  assert.strictEqual(jsonResponse.field, 'sessionExpectations');
  assert.strictEqual(jsonResponse.message.includes('minimum 10 characters'), true);
});

test('createSummitRegistration rejects names with numbers or symbols', async () => {
  const reqWithNumbers = {
    body: {
      fullName: 'Ahmad123',
      email: 'ahmad@example.com',
      mobileNumber: '9876543210',
      state: 'Tamil Nadu',
      district: 'Chennai',
      city: 'Chennai',
      occupation: 'Student',
      sessionExpectations: 'Looking forward to Islamic finance knowledge.',
      termsAccepted: true,
    },
  };
  let statusCode = 0;
  let jsonResponse = null;
  const res = {
    status: (code) => {
      statusCode = code;
      return {
        json: (data) => { jsonResponse = data; },
      };
    },
  };

  await createSummitRegistration(reqWithNumbers, res);
  assert.strictEqual(statusCode, 400);
  assert.strictEqual(jsonResponse.message.includes('only letters and normal spaces'), true);
});

test('createSummitRegistration strictly validates 10-digit Indian mobile numbers', async () => {
  const invalidNumbers = ['987654321', '98765432101', '98765abc10', '98765@3210', '9876 54321'];
  for (const num of invalidNumbers) {
    const req = {
      body: {
        fullName: 'Ahmad Khan',
        email: 'ahmad@example.com',
        mobileNumber: num,
        state: 'Tamil Nadu',
        district: 'Chennai',
        city: 'Chennai',
        occupation: 'Student',
        sessionExpectations: 'Looking forward to Islamic finance knowledge.',
        termsAccepted: true,
      },
    };
    let statusCode = 0;
    let jsonResponse = null;
    const res = {
      status: (code) => {
        statusCode = code;
        return {
          json: (data) => { jsonResponse = data; },
        };
      },
    };

    await createSummitRegistration(req, res);
    assert.strictEqual(statusCode, 400, `Failed for number: ${num}`);
    assert.strictEqual(jsonResponse.message, 'Please enter a valid 10-digit mobile number.');
  }
});

test('createSummitRegistration rejects offline payment method with 400 Bad Request', async () => {
  const req = {
    body: {
      fullName: 'Ahmad Khan',
      email: 'ahmad@example.com',
      mobileNumber: '9876543210',
      state: 'Tamil Nadu',
      district: 'Coimbatore',
      city: 'Coimbatore',
      occupation: 'Professional',
      sessionExpectations: 'Looking forward to Shariah investment guidance.',
      termsAccepted: true,
      paymentMethod: 'OFFLINE',
    },
  };
  let statusCode = 0;
  let jsonResponse = null;
  const res = {
    status: (code) => {
      statusCode = code;
      return {
        json: (data) => { jsonResponse = data; },
      };
    },
  };

  await createSummitRegistration(req, res);
  assert.strictEqual(statusCode, 400);
  assert.strictEqual(jsonResponse.field, 'paymentMethod');
  assert.strictEqual(jsonResponse.message.includes('Offline payment is no longer available'), true);
});

test('createSummitRegistration rejects invalid non-online payment methods', async () => {
  const req = {
    body: {
      fullName: 'Ahmad Khan',
      email: 'ahmad@example.com',
      mobileNumber: '9876543210',
      state: 'Tamil Nadu',
      district: 'Coimbatore',
      city: 'Coimbatore',
      occupation: 'Professional',
      sessionExpectations: 'Looking forward to Shariah investment guidance.',
      termsAccepted: true,
      paymentMethod: 'CRYPTO',
    },
  };
  let statusCode = 0;
  let jsonResponse = null;
  const res = {
    status: (code) => {
      statusCode = code;
      return {
        json: (data) => { jsonResponse = data; },
      };
    },
  };

  await createSummitRegistration(req, res);
  assert.strictEqual(statusCode, 400);
  assert.strictEqual(jsonResponse.field, 'paymentMethod');
  assert.strictEqual(jsonResponse.message.includes('Invalid payment method'), true);
});

test('getNextSmallSummitRegistrationId generates SS26- format correctly', async () => {
  const mockModel = {
    findOne: () => ({
      sort: () => ({
        select: () => ({
          lean: async () => ({ registrationId: 'SS26-00012' }),
        }),
      }),
    }),
  };
  const id = await getNextSmallSummitRegistrationId(mockModel);
  assert.strictEqual(id, 'SS26-00013');
});

test('SmallSummitRegistration schema defines PENDING_PAYMENT in registrationStatus and paymentStatus enums with default', () => {
  const regEnumValues = SmallSummitRegistration.schema.path('registrationStatus').enumValues;
  assert.ok(regEnumValues.includes('PENDING_PAYMENT'), 'registrationStatus should include PENDING_PAYMENT');
  assert.ok(regEnumValues.includes('PENDING_APPROVAL'), 'registrationStatus should include PENDING_APPROVAL');
  assert.ok(regEnumValues.includes('CONFIRMED'), 'registrationStatus should include CONFIRMED');
  assert.strictEqual(SmallSummitRegistration.schema.path('registrationStatus').defaultValue, 'PENDING_PAYMENT');

  const payEnumValues = SmallSummitRegistration.schema.path('paymentStatus').enumValues;
  assert.ok(payEnumValues.includes('PENDING_PAYMENT'), 'paymentStatus should include PENDING_PAYMENT');
  assert.ok(payEnumValues.includes('PENDING_VERIFICATION'), 'paymentStatus should include PENDING_VERIFICATION');
  assert.ok(payEnumValues.includes('PAID'), 'paymentStatus should include PAID');
  assert.strictEqual(SmallSummitRegistration.schema.path('paymentStatus').defaultValue, 'PENDING_PAYMENT');
});

test('evaluateCombinedApproval keeps PENDING_APPROVAL when only registration is approved', async () => {
  let saved = false;
  const reg = {
    registrationApproved: true,
    paymentApproved: false,
    registrationStatus: 'PENDING_APPROVAL',
    paymentStatus: 'PENDING_VERIFICATION',
    status: 'Pending',
    save: async () => { saved = true; return reg; },
  };
  const result = await evaluateCombinedApproval(reg, 'admin@halalwealth.finance', 'Registration looks good');
  assert.strictEqual(result.confirmed, false);
  assert.strictEqual(reg.registrationStatus, 'PENDING_APPROVAL');
  assert.strictEqual(reg.paymentStatus, 'PENDING_VERIFICATION');
  assert.strictEqual(reg.status, 'Pending');
  assert.strictEqual(saved, true);
});

test('evaluateCombinedApproval keeps PENDING_APPROVAL when only payment is approved', async () => {
  let saved = false;
  const reg = {
    registrationApproved: false,
    paymentApproved: true,
    registrationStatus: 'PENDING_APPROVAL',
    paymentStatus: 'PENDING_VERIFICATION',
    status: 'Pending',
    save: async () => { saved = true; return reg; },
  };
  const result = await evaluateCombinedApproval(reg, 'admin@halalwealth.finance', 'Payment verified in bank');
  assert.strictEqual(result.confirmed, false);
  assert.strictEqual(reg.registrationStatus, 'PENDING_APPROVAL');
  assert.strictEqual(reg.status, 'Pending');
  assert.strictEqual(saved, true);
});

test('evaluateCombinedApproval transitions to CONFIRMED and PAID when both are approved', async () => {
  const origCount = SmallSummitRegistration.countDocuments;
  SmallSummitRegistration.countDocuments = async () => 10; // 10 confirmed seats
  try {
    let saved = false;
    const reg = {
      _id: 'reg123',
      registrationId: 'SS26-00001',
      fullName: 'Muhammad Ali',
      email: 'muhammad@example.com',
      registrationApproved: true,
      paymentApproved: true,
      registrationStatus: 'PENDING_APPROVAL',
      paymentStatus: 'PENDING_VERIFICATION',
      status: 'Pending',
      confirmationEmailSent: true, // Mark already sent so it won't trigger network/email in this test
      confirmationEmailStatus: 'SENT',
      save: async () => { saved = true; return reg; },
    };

    const result = await evaluateCombinedApproval(reg, 'admin@halalwealth.finance', 'All approved');
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.confirmed, true);
    assert.strictEqual(reg.registrationStatus, 'CONFIRMED');
    assert.strictEqual(reg.paymentStatus, 'PAID');
    assert.strictEqual(reg.status, 'Confirmed');
    assert.ok(reg.checkInToken, 'Should generate check-in token');
    assert.ok(reg.checkInTokenHash, 'Should generate check-in token hash');
    assert.strictEqual(saved, true);
  } finally {
    SmallSummitRegistration.countDocuments = origCount;
  }
});

test('createSummitRegistration triggers acknowledgement email and records delivery status', async () => {
  let ackEmailPayload = null;
  const origAck = investorMissionEmailService.sendInvestorMissionAcknowledgement;
  investorMissionEmailService.sendInvestorMissionAcknowledgement = async (payload) => {
    ackEmailPayload = payload;
    return { success: true, messageId: '<test-ack-123@halalwealth.finance>' };
  };

  const origSave = SmallSummitRegistration.prototype.save;
  const origFindOne = SmallSummitRegistration.findOne;
  const origCount = SmallSummitRegistration.countDocuments;

  SmallSummitRegistration.countDocuments = async () => 5;
  SmallSummitRegistration.findOne = async () => null;
  SmallSummitRegistration.prototype.save = async function () {
    return this;
  };

  const req = {
    body: {
      fullName: 'Salman Faris',
      email: 'salman.faris@example.com',
      mobileNumber: '9876543210',
      state: 'Tamil Nadu',
      district: 'Coimbatore',
      city: 'Coimbatore',
      occupation: 'Employee',
      sessionExpectations: 'I hope to understand halal wealth management and Shariah investing concepts.',
      termsAccepted: true,
      paymentMethod: 'ONLINE',
    },
  };

  let statusCode = 200;
  let jsonResponse = null;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      jsonResponse = data;
      return this;
    },
  };

  try {
    await createSummitRegistration(req, res);

    assert.strictEqual(statusCode, 201);
    assert.strictEqual(jsonResponse.success, true);
    assert.strictEqual(jsonResponse.redirectUrl, `/investor-mission-payment/${jsonResponse.registrationId}`);

    // Wait a tick for async email promise resolution
    await new Promise(r => setTimeout(r, 20));

    assert.ok(ackEmailPayload, 'Acknowledgement email must be triggered');
    assert.strictEqual(ackEmailPayload.recipientEmail, 'salman.faris@example.com');
    assert.strictEqual(ackEmailPayload.participantName, 'Salman Faris');
    assert.strictEqual(ackEmailPayload.registrationId, jsonResponse.registrationId);
  } finally {
    investorMissionEmailService.sendInvestorMissionAcknowledgement = origAck;
    SmallSummitRegistration.prototype.save = origSave;
    SmallSummitRegistration.findOne = origFindOne;
    SmallSummitRegistration.countDocuments = origCount;
  }
});

test('createSummitRegistration does not roll back registration if acknowledgement email fails', async () => {
  const origAck = investorMissionEmailService.sendInvestorMissionAcknowledgement;
  investorMissionEmailService.sendInvestorMissionAcknowledgement = async () => {
    throw new Error('SMTP connection timed out');
  };

  const origSave = SmallSummitRegistration.prototype.save;
  const origFindOne = SmallSummitRegistration.findOne;
  const origCount = SmallSummitRegistration.countDocuments;

  SmallSummitRegistration.countDocuments = async () => 5;
  SmallSummitRegistration.findOne = async () => null;
  let saveCount = 0;
  SmallSummitRegistration.prototype.save = async function () {
    saveCount++;
    return this;
  };

  const req = {
    body: {
      fullName: 'Hameed Raza',
      email: 'hameed.raza@example.com',
      mobileNumber: '9876543211',
      state: 'Tamil Nadu',
      district: 'Coimbatore',
      city: 'Coimbatore',
      occupation: 'Professional',
      sessionExpectations: 'Looking to learn Shariah screening and wealth structuring methods.',
      termsAccepted: true,
      paymentMethod: 'ONLINE',
    },
  };

  let statusCode = 200;
  let jsonResponse = null;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      jsonResponse = data;
      return this;
    },
  };

  try {
    await createSummitRegistration(req, res);

    // Registration must succeed with 201 despite email failure
    assert.strictEqual(statusCode, 201);
    assert.strictEqual(jsonResponse.success, true);
    assert.strictEqual(jsonResponse.redirectUrl, `/investor-mission-payment/${jsonResponse.registrationId}`);

    await new Promise(r => setTimeout(r, 20));

    // Save should have been called (initially and on failure status update)
    assert.ok(saveCount >= 1);
  } finally {
    investorMissionEmailService.sendInvestorMissionAcknowledgement = origAck;
    SmallSummitRegistration.prototype.save = origSave;
    SmallSummitRegistration.findOne = origFindOne;
    SmallSummitRegistration.countDocuments = origCount;
  }
});

test('createSummitRegistration prevents duplicate acknowledgement emails when user resubmits', async () => {
  let ackCallCount = 0;
  const origAck = investorMissionEmailService.sendInvestorMissionAcknowledgement;
  investorMissionEmailService.sendInvestorMissionAcknowledgement = async () => {
    ackCallCount++;
    return { success: true };
  };

  const origFindOne = SmallSummitRegistration.findOne;
  const origCount = SmallSummitRegistration.countDocuments;

  SmallSummitRegistration.countDocuments = async () => 5;

  // Mock an existing pending registration with acknowledgementEmailSent: true
  const mockExisting = {
    registrationId: 'SS26-00099',
    fullName: 'Mohamed Bilal',
    name: 'Mohamed Bilal',
    email: 'bilal@example.com',
    paymentMethod: 'ONLINE',
    registrationFee: 500,
    registrationStatus: 'PENDING_PAYMENT',
    paymentStatus: 'PENDING_PAYMENT',
    status: 'Pending',
    registrationApproved: false,
    paymentApproved: false,
    acknowledgementEmailSent: true,
    acknowledgementEmailStatus: 'SENT',
    save: async () => {},
  };

  SmallSummitRegistration.findOne = async () => mockExisting;

  const req = {
    body: {
      fullName: 'Mohamed Bilal',
      email: 'bilal@example.com',
      mobileNumber: '9876543212',
      state: 'Tamil Nadu',
      district: 'Coimbatore',
      city: 'Coimbatore',
      occupation: 'Student',
      sessionExpectations: 'Want to understand ethical investing principles and avoid riba.',
      termsAccepted: true,
      paymentMethod: 'ONLINE',
    },
  };

  let statusCode = 200;
  let jsonResponse = null;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      jsonResponse = data;
      return this;
    },
  };

  try {
    await createSummitRegistration(req, res);

    assert.strictEqual(statusCode, 200);
    assert.strictEqual(jsonResponse.success, true);
    assert.strictEqual(jsonResponse.registrationId, 'SS26-00099');
    assert.strictEqual(jsonResponse.redirectUrl, '/investor-mission-payment/SS26-00099');

    await new Promise(r => setTimeout(r, 20));

    // Must NOT send duplicate acknowledgement email
    assert.strictEqual(ackCallCount, 0, 'No duplicate acknowledgement email should be sent');
  } finally {
    investorMissionEmailService.sendInvestorMissionAcknowledgement = origAck;
    SmallSummitRegistration.findOne = origFindOne;
    SmallSummitRegistration.countDocuments = origCount;
  }
});

test('resendAcknowledgementEmail successfully resends acknowledgement email for admin', async () => {
  let ackPayload = null;
  const origAck = investorMissionEmailService.sendInvestorMissionAcknowledgement;
  investorMissionEmailService.sendInvestorMissionAcknowledgement = async (payload) => {
    ackPayload = payload;
    return { success: true };
  };

  const origFindOne = SmallSummitRegistration.findOne;
  let saved = false;
  const mockRegistration = {
    registrationId: 'SS26-00100',
    fullName: 'Yusuf Pathan',
    email: 'yusuf@example.com',
    acknowledgementEmailSent: false,
    acknowledgementEmailStatus: 'FAILED',
    save: async function () {
      saved = true;
      return this;
    },
  };

  SmallSummitRegistration.findOne = async () => mockRegistration;

  const req = {
    params: { registrationId: 'SS26-00100' },
  };

  let statusCode = 200;
  let jsonResponse = null;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      jsonResponse = data;
      return this;
    },
  };

  try {
    await resendAcknowledgementEmail(req, res);

    assert.strictEqual(statusCode, 200);
    assert.strictEqual(jsonResponse.success, true);
    assert.match(jsonResponse.message, /resent successfully/);
    assert.strictEqual(saved, true);
    assert.strictEqual(mockRegistration.acknowledgementEmailSent, true);
    assert.strictEqual(mockRegistration.acknowledgementEmailStatus, 'SENT');
    assert.ok(ackPayload);
    assert.strictEqual(ackPayload.recipientEmail, 'yusuf@example.com');
  } finally {
    investorMissionEmailService.sendInvestorMissionAcknowledgement = origAck;
    SmallSummitRegistration.findOne = origFindOne;
  }
});

test('createSummitRegistration returns 409 ALREADY_CONFIRMED for existing confirmed participant', async () => {
  const origFindOne = SmallSummitRegistration.findOne;
  const origCount = SmallSummitRegistration.countDocuments;

  SmallSummitRegistration.countDocuments = async () => 10;
  SmallSummitRegistration.findOne = async ({ email }) => {
    if (email === 'confirmed@example.com') {
      return {
        registrationId: 'SS26-00001',
        email: 'confirmed@example.com',
        fullName: 'Confirmed User',
        registrationStatus: 'CONFIRMED',
        paymentStatus: 'PAID',
        registrationApproved: true,
        paymentApproved: true,
      };
    }
    return null;
  };

  const req = {
    body: {
      fullName: 'Confirmed User',
      email: 'CONFIRMED@example.com',
      mobileNumber: '9876543210',
      state: 'Tamil Nadu',
      district: 'Coimbatore',
      city: 'Coimbatore',
      occupation: 'Investor',
      sessionExpectations: 'Excited for deep insights into Halal investing.',
      termsAccepted: true,
      paymentMethod: 'ONLINE',
    },
  };

  let statusCode = 0;
  let jsonResponse = null;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      jsonResponse = data;
      return this;
    },
  };

  try {
    await createSummitRegistration(req, res);
    assert.strictEqual(statusCode, 409);
    assert.strictEqual(jsonResponse.code, 'ALREADY_CONFIRMED');
    assert.match(jsonResponse.message, /already exists and is confirmed/);
  } finally {
    SmallSummitRegistration.findOne = origFindOne;
    SmallSummitRegistration.countDocuments = origCount;
  }
});

test('createSummitRegistration redirects to confirmation page if registration is under verification', async () => {
  const origFindOne = SmallSummitRegistration.findOne;
  const origCount = SmallSummitRegistration.countDocuments;

  SmallSummitRegistration.countDocuments = async () => 10;
  SmallSummitRegistration.findOne = async () => ({
    registrationId: 'SS26-00008',
    email: 'review@example.com',
    fullName: 'Review User',
    paymentStatus: 'PENDING_VERIFICATION',
    registrationStatus: 'PENDING_APPROVAL',
  });

  const req = {
    body: {
      fullName: 'Review User',
      email: 'review@example.com',
      mobileNumber: '9876543210',
      state: 'Tamil Nadu',
      district: 'Coimbatore',
      city: 'Coimbatore',
      occupation: 'Investor',
      sessionExpectations: 'Excited for deep insights into Halal investing.',
      termsAccepted: true,
      paymentMethod: 'ONLINE',
    },
  };

  let statusCode = 0;
  let jsonResponse = null;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      jsonResponse = data;
      return this;
    },
  };

  try {
    await createSummitRegistration(req, res);
    assert.strictEqual(statusCode, 200);
    assert.strictEqual(jsonResponse.code, 'PENDING_VERIFICATION');
    assert.strictEqual(jsonResponse.redirectUrl, '/investor-mission-confirmation/SS26-00008');
    assert.match(jsonResponse.message, /under administrative verification/);
  } finally {
    SmallSummitRegistration.findOne = origFindOne;
    SmallSummitRegistration.countDocuments = origCount;
  }
});

test('createSummitRegistration resets rejected registration and allows re-registration', async () => {
  const origFindOne = SmallSummitRegistration.findOne;
  const origCount = SmallSummitRegistration.countDocuments;
  const origAck = investorMissionEmailService.sendInvestorMissionAcknowledgement;
  investorMissionEmailService.sendInvestorMissionAcknowledgement = async () => ({ success: true });

  let saved = false;
  const mockExisting = {
    registrationId: 'SS26-00004',
    email: 'rejected@example.com',
    fullName: 'Old Name',
    registrationStatus: 'REJECTED',
    paymentStatus: 'REJECTED',
    status: 'Rejected',
    rejectionReason: 'Invalid screenshot',
    save: async function () {
      saved = true;
      return this;
    },
  };

  SmallSummitRegistration.countDocuments = async () => 10;
  SmallSummitRegistration.findOne = async () => mockExisting;

  const req = {
    body: {
      fullName: 'New Valid Name',
      email: 'rejected@example.com',
      mobileNumber: '9876543210',
      state: 'Tamil Nadu',
      district: 'Coimbatore',
      city: 'Coimbatore',
      occupation: 'Investor',
      sessionExpectations: 'Excited for deep insights into Halal investing.',
      termsAccepted: true,
      paymentMethod: 'ONLINE',
    },
  };

  let statusCode = 0;
  let jsonResponse = null;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      jsonResponse = data;
      return this;
    },
  };

  try {
    await createSummitRegistration(req, res);
    assert.strictEqual(statusCode, 200);
    assert.strictEqual(jsonResponse.code, 'REGISTRATION_RESET');
    assert.strictEqual(jsonResponse.redirectUrl, '/investor-mission-payment/SS26-00004');
    assert.strictEqual(saved, true);
    assert.strictEqual(mockExisting.registrationStatus, 'PENDING_PAYMENT');
    assert.strictEqual(mockExisting.paymentStatus, 'PENDING_PAYMENT');
    assert.strictEqual(mockExisting.fullName, 'New Valid Name');
  } finally {
    SmallSummitRegistration.findOne = origFindOne;
    SmallSummitRegistration.countDocuments = origCount;
    investorMissionEmailService.sendInvestorMissionAcknowledgement = origAck;
  }
});

test('approveSummitPayment verifies payment, marks seat CONFIRMED, generates check-in token and triggers confirmation email', async () => {
  const origFindOne = SmallSummitRegistration.findOne;
  const origCount = SmallSummitRegistration.countDocuments;
  const origConfirmEmail = investorMissionEmailService.sendInvestorMissionConfirmation;

  let emailSentPayload = null;
  investorMissionEmailService.sendInvestorMissionConfirmation = async (payload) => {
    emailSentPayload = payload;
    return { success: true };
  };

  let saved = false;
  const mockRegistration = {
    _id: 'mock-reg-id-123',
    registrationId: 'SS26-00050',
    fullName: 'Mohamed Ibrahim',
    email: 'ibrahim@example.com',
    registrationStatus: 'PENDING_APPROVAL',
    paymentStatus: 'PENDING_VERIFICATION',
    status: 'Pending',
    save: async function () {
      saved = true;
      return this;
    },
  };

  SmallSummitRegistration.findOne = async () => mockRegistration;
  // 30 confirmed seats currently out of 50
  SmallSummitRegistration.countDocuments = async () => 30;

  const req = {
    params: { registrationId: 'SS26-00050' },
    body: { adminNotes: 'Verified against bank UTR.' },
    admin: { email: 'admin@halalwealth.finance' },
  };

  let statusCode = 0;
  let jsonResponse = null;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      jsonResponse = data;
      return this;
    },
  };

  try {
    await approveSummitPayment(req, res);

    assert.strictEqual(statusCode, 0); // default res.json is 200
    assert.strictEqual(jsonResponse.success, true);
    assert.strictEqual(jsonResponse.isConfirmed, true);
    assert.strictEqual(mockRegistration.paymentStatus, 'PAID');
    assert.strictEqual(mockRegistration.registrationStatus, 'CONFIRMED');
    assert.strictEqual(mockRegistration.paymentApproved, true);
    assert.strictEqual(mockRegistration.registrationApproved, true);
    assert.ok(mockRegistration.checkInToken, 'Check-in token must be generated');
    assert.ok(mockRegistration.checkInTokenHash, 'Check-in token hash must be generated');

    // Wait a brief tick for async email dispatch
    await new Promise(r => setTimeout(r, 20));
    assert.ok(emailSentPayload, 'Seat confirmation email must be triggered');
    assert.strictEqual(emailSentPayload.recipientEmail, 'ibrahim@example.com');
    assert.strictEqual(emailSentPayload.registrationId, 'SS26-00050');
  } finally {
    SmallSummitRegistration.findOne = origFindOne;
    SmallSummitRegistration.countDocuments = origCount;
    investorMissionEmailService.sendInvestorMissionConfirmation = origConfirmEmail;
  }
});

test('approveSummitPayment enforces 80-seat capacity limit and warns without confirming seat', async () => {
  const origFindOne = SmallSummitRegistration.findOne;
  const origCount = SmallSummitRegistration.countDocuments;
  const origConfirmEmail = investorMissionEmailService.sendInvestorMissionConfirmation;

  let emailSentCount = 0;
  investorMissionEmailService.sendInvestorMissionConfirmation = async () => {
    emailSentCount++;
    return { success: true };
  };

  const mockRegistration = {
    _id: 'mock-reg-id-999',
    registrationId: 'SS26-00081',
    fullName: 'Over Capacity Participant',
    email: 'overcapacity@example.com',
    registrationStatus: 'PENDING_APPROVAL',
    paymentStatus: 'PENDING_VERIFICATION',
    status: 'Pending',
    save: async function () { return this; },
  };

  SmallSummitRegistration.findOne = async () => mockRegistration;
  // 80 confirmed seats already reached!
  SmallSummitRegistration.countDocuments = async () => 80;

  const req = {
    params: { registrationId: 'SS26-00081' },
    body: {},
    admin: { email: 'admin@halalwealth.finance' },
  };

  let statusCode = 0;
  let jsonResponse = null;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      jsonResponse = data;
      return this;
    },
  };

  try {
    await approveSummitPayment(req, res);

    assert.strictEqual(statusCode, 400);
    assert.strictEqual(jsonResponse.success, false);
    assert.strictEqual(jsonResponse.capacityReached, true);
    assert.match(jsonResponse.message, /capacity \(80 confirmed seats\) has been reached/);
    assert.strictEqual(mockRegistration.registrationStatus, 'PENDING_APPROVAL');
    assert.strictEqual(emailSentCount, 0, 'No confirmation email should be sent when capacity is full');
  } finally {
    SmallSummitRegistration.findOne = origFindOne;
    SmallSummitRegistration.countDocuments = origCount;
    investorMissionEmailService.sendInvestorMissionConfirmation = origConfirmEmail;
  }
});

test('simultaneous admin approvals cannot exceed 80 confirmed seats', async () => {
  const origFindOne = SmallSummitRegistration.findOne;
  const origCount = SmallSummitRegistration.countDocuments;
  const origConfirmEmail = investorMissionEmailService.sendInvestorMissionConfirmation;

  investorMissionEmailService.sendInvestorMissionConfirmation = async () => ({ success: true });

  let confirmedInDb = 79; // Currently 79 confirmed seats out of 80

  const regA = {
    _id: 'mock-reg-a',
    registrationId: 'SS26-00080',
    fullName: 'Participant 80',
    email: 'p80@example.com',
    registrationStatus: 'PENDING_APPROVAL',
    paymentStatus: 'PENDING_VERIFICATION',
    status: 'Pending',
    registrationApproved: true,
    save: async function () {
      confirmedInDb++;
      return this;
    },
  };

  const regB = {
    _id: 'mock-reg-b',
    registrationId: 'SS26-00081',
    fullName: 'Participant 81',
    email: 'p81@example.com',
    registrationStatus: 'PENDING_APPROVAL',
    paymentStatus: 'PENDING_VERIFICATION',
    status: 'Pending',
    registrationApproved: true,
    save: async function () {
      confirmedInDb++;
      return this;
    },
  };

  SmallSummitRegistration.findOne = async (query) => {
    if (query.registrationId === 'SS26-00080') return regA;
    if (query.registrationId === 'SS26-00081') return regB;
    return null;
  };

  SmallSummitRegistration.countDocuments = async () => confirmedInDb;

  const results = [];
  const makeReqRes = (regId) => {
    const req = { params: { registrationId: regId }, body: {}, admin: { email: 'admin@halalwealth.finance' } };
    let code = 200;
    let body = null;
    const res = {
      status(c) { code = c; return this; },
      json(b) { body = b; results.push({ regId, code, body }); return this; },
    };
    return { req, res };
  };

  try {
    const call1 = makeReqRes('SS26-00080');
    const call2 = makeReqRes('SS26-00081');

    await approveSummitPayment(call1.req, call1.res);
    await approveSummitPayment(call2.req, call2.res);

    assert.strictEqual(results.length, 2);
    // First one succeeds (taking seat 80)
    assert.strictEqual(results[0].code, 200);
    assert.strictEqual(results[0].body.success, true);

    // Second one is blocked because capacity 80 is reached
    assert.strictEqual(results[1].code, 400);
    assert.strictEqual(results[1].body.capacityReached, true);
    assert.match(results[1].body.message, /capacity \(80 confirmed seats\) has been reached/);

    // Total confirmed in DB must not exceed 80
    assert.strictEqual(confirmedInDb, 80);
  } finally {
    SmallSummitRegistration.findOne = origFindOne;
    SmallSummitRegistration.countDocuments = origCount;
    investorMissionEmailService.sendInvestorMissionConfirmation = origConfirmEmail;
  }
});

test('rejectSummitPayment updates paymentStatus to REJECTED, keeps unconfirmed, and does not send email', async () => {
  const origFindOne = SmallSummitRegistration.findOne;
  const origConfirmEmail = investorMissionEmailService.sendInvestorMissionConfirmation;

  let emailSentCount = 0;
  investorMissionEmailService.sendInvestorMissionConfirmation = async () => {
    emailSentCount++;
    return { success: true };
  };

  let saved = false;
  const mockRegistration = {
    _id: 'mock-reg-reject',
    registrationId: 'SS26-00052',
    fullName: 'Zubair Ahmed',
    email: 'zubair@example.com',
    registrationStatus: 'PENDING_APPROVAL',
    paymentStatus: 'PENDING_VERIFICATION',
    status: 'Pending',
    save: async function () {
      saved = true;
      return this;
    },
  };

  SmallSummitRegistration.findOne = async () => mockRegistration;

  const req = {
    params: { registrationId: 'SS26-00052' },
    body: { reason: 'Incorrect UTR number provided.' },
    admin: { email: 'admin@halalwealth.finance' },
  };

  let statusCode = 0;
  let jsonResponse = null;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      jsonResponse = data;
      return this;
    },
  };

  try {
    await rejectSummitPayment(req, res);

    assert.strictEqual(statusCode, 0); // default res.json is 200
    assert.strictEqual(jsonResponse.success, true);
    assert.strictEqual(saved, true);
    assert.strictEqual(mockRegistration.paymentStatus, 'REJECTED');
    assert.strictEqual(mockRegistration.registrationStatus, 'REJECTED');
    assert.strictEqual(mockRegistration.paymentApproved, false);
    assert.strictEqual(mockRegistration.registrationApproved, false);
    assert.strictEqual(mockRegistration.rejectionReason, 'Incorrect UTR number provided.');
    assert.strictEqual(emailSentCount, 0, 'No confirmation email should be sent upon payment rejection');
  } finally {
    SmallSummitRegistration.findOne = origFindOne;
    investorMissionEmailService.sendInvestorMissionConfirmation = origConfirmEmail;
  }
});

test('investorMission confirmation email template includes required subject, date, venue and Google Maps link', () => {
  const { buildInvestorMissionConfirmationContent } = require('../services/investorMissionEmailService');

  const content = buildInvestorMissionConfirmationContent({
    participantName: 'Tariq Mansoor',
    registrationId: 'SS26-00010',
    checkInUrl: 'https://halalwealth.finance/api/investor-mission/checkin/verify/token123',
  });

  assert.strictEqual(content.subject, 'Your Seat is Confirmed! | Investor Mission 2026');
  assert.match(content.text, /Tariq Mansoor/);
  assert.match(content.text, /SS26-00010/);
  assert.match(content.text, /Registration Fee: ₹500/);
  assert.doesNotMatch(content.text, /Registration Fee: ₹500 \(/i);
  assert.doesNotMatch(content.text, /Verified & Paid/i);
  assert.doesNotMatch(content.html, /Verified & Paid/i);
  assert.doesNotMatch(content.subject, /Halal Wealth/i);
  assert.doesNotMatch(content.text, /Halal Wealth/i);
  assert.doesNotMatch(content.html, /Halal Wealth/i);
  assert.match(content.text, /Sunday, 06 December 2026/);
  assert.match(content.text, /Siruthuli Noyyal Life Centre/);
  assert.match(content.text, /https:\/\/maps\.app\.goo\.gl\/4hwJsFTMujiSVDMEA/);
  assert.match(content.text, /Abdul Basith – Licensed Financial Consultant/);
  assert.match(content.text, /Team Investor Mission 2026/);
  assert.match(content.text, /SIO Coimbatore/);

  assert.match(content.html, /Tariq Mansoor/);
  assert.match(content.html, /SS26-00010/);
  assert.match(content.html, /https:\/\/maps\.app\.goo\.gl\/4hwJsFTMujiSVDMEA/);
  assert.match(content.html, /Abdul Basith/);
});

test('approveSummitPayment returns alreadyConfirmed when registration is already confirmed and paid', async () => {
  const origFindOne = SmallSummitRegistration.findOne;
  const origConfirmEmail = investorMissionEmailService.sendInvestorMissionConfirmation;

  let emailSentCount = 0;
  investorMissionEmailService.sendInvestorMissionConfirmation = async () => {
    emailSentCount++;
    return { success: true };
  };

  const mockRegistration = {
    registrationId: 'SS26-00007',
    fullName: 'Already Confirmed User',
    email: 'confirmed@example.com',
    paymentStatus: 'PAID',
    registrationStatus: 'CONFIRMED',
    paymentApproved: true,
    registrationApproved: true,
    status: 'Confirmed',
    save: async () => mockRegistration,
  };

  SmallSummitRegistration.findOne = async () => mockRegistration;

  const req = {
    params: { registrationId: 'SS26-00007' },
    body: { adminNotes: 'Duplicate approval attempt' },
    admin: { email: 'admin@halalwealth.finance' },
  };

  let statusCode = 200;
  let jsonResponse = null;
  const res = {
    status: (code) => {
      statusCode = code;
      return { json: (data) => { jsonResponse = data; } };
    },
    json: (data) => { jsonResponse = data; },
  };

  try {
    await approveSummitPayment(req, res);

    assert.strictEqual(statusCode, 200);
    assert.strictEqual(jsonResponse.success, true);
    assert.strictEqual(jsonResponse.alreadyConfirmed, true);
    assert.strictEqual(jsonResponse.isConfirmed, true);
    assert.match(jsonResponse.message, /seat and payment are already confirmed/);
    assert.strictEqual(emailSentCount, 0, 'Must not send duplicate confirmation email');
  } finally {
    SmallSummitRegistration.findOne = origFindOne;
    investorMissionEmailService.sendInvestorMissionConfirmation = origConfirmEmail;
  }
});

test('rejectSummitPayment blocks rejecting an already confirmed and paid participant', async () => {
  const origFindOne = SmallSummitRegistration.findOne;

  const mockRegistration = {
    registrationId: 'SS26-00008',
    fullName: 'Confirmed Participant',
    email: 'salim@example.com',
    paymentStatus: 'PAID',
    registrationStatus: 'CONFIRMED',
    paymentApproved: true,
    registrationApproved: true,
    status: 'Confirmed',
    save: async () => mockRegistration,
  };

  SmallSummitRegistration.findOne = async () => mockRegistration;

  const req = {
    params: { registrationId: 'SS26-00008' },
    body: { reason: 'Accidental reject attempt' },
    admin: { email: 'admin@halalwealth.finance' },
  };

  let statusCode = 0;
  let jsonResponse = null;
  const res = {
    status: (code) => {
      statusCode = code;
      return { json: (data) => { jsonResponse = data; } };
    },
    json: (data) => { jsonResponse = data; },
  };

  try {
    await rejectSummitPayment(req, res);

    assert.strictEqual(statusCode, 400);
    assert.strictEqual(jsonResponse.success, false);
    assert.strictEqual(jsonResponse.alreadyConfirmed, true);
    assert.match(jsonResponse.message, /Cannot reject participant SS26-00008: Seat is already confirmed/);
    // Ensure state was NOT mutated
    assert.strictEqual(mockRegistration.paymentStatus, 'PAID');
    assert.strictEqual(mockRegistration.registrationStatus, 'CONFIRMED');
  } finally {
    SmallSummitRegistration.findOne = origFindOne;
  }
});



