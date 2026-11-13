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
} = require('./summitController');
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

test('calculateActiveSeats correctly computes seats with 50 capacity (confirmed seats only)', async () => {
  const mockModel = {
    countDocuments: async (query) => {
      if (query?.$or) return 30; // 30 confirmed
      return 0;
    },
  };

  const result = await calculateActiveSeats(mockModel);
  assert.strictEqual(result.maxCapacity, 50);
  assert.strictEqual(result.confirmedCount, 30);
  assert.strictEqual(result.availableSeats, 20);
  assert.strictEqual(result.isSoldOut, false);
});

test('calculateActiveSeats detects sold-out condition when confirmed capacity is 50', async () => {
  const mockModel = {
    countDocuments: async (query) => {
      if (query?.$or) return 50; // 50 confirmed
      return 0;
    },
  };

  const result = await calculateActiveSeats(mockModel);
  assert.strictEqual(result.confirmedCount, 50);
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

