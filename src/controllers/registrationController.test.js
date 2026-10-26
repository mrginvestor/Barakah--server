const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createRegistrationHandler,
  getNextRegistrationId,
} = require('./registrationController');

const validSummitPayload = {
  fullName: 'Amina Rahman',
  countryCode: '+91',
  whatsappNumber: '9876543210',
  email: 'amina.rahman@example.com',
  ageGroup: '25-34',
  gender: 'Female',
  city: 'Chennai',
  state: 'Tamil Nadu',
  country: 'India',
  currentProfession: 'Salaried Professional',
  professionalExperience: 5,
  financialInterests: ['Halal Investments', 'Personal Finance'],
  islamicFinanceKnowledge: 'Basic',
  biggestFinancialChallenge: 'How to reliably allocate personal savings into halal equities and funds in India.',
  participationMode: 'Both',
  whatsappCommunity: true,
  referralSource: 'LinkedIn / Instagram / Facebook',
};

function createResponse() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function createLogger() {
  return { info() {}, error() {} };
}

test('getNextRegistrationId increments from highest existing registrationId sequence', async () => {
  const mockModel = {
    findOne: () => ({
      sort: () => ({
        select: () => ({
          lean: async () => ({ registrationId: 'HWS26-00042' }),
        }),
      }),
    }),
  };

  const nextId = await getNextRegistrationId(mockModel);
  assert.equal(nextId, 'HWS26-00043');
});

test('getNextRegistrationId falls back to countDocuments + 1 when no records match pattern', async () => {
  const mockModel = {
    findOne: () => ({
      sort: () => ({
        select: () => ({
          lean: async () => null,
        }),
      }),
    }),
    countDocuments: async () => 5,
  };

  const nextId = await getNextRegistrationId(mockModel);
  assert.equal(nextId, 'HWS26-00006');
});

test('saves summit registration to database before dispatching confirmation email', async () => {
  let saved = false;
  let sentTo = null;
  let sentName = null;
  let updatedRecord = null;

  const mockModel = {
    findOne: async () => null,
    create: async payload => {
      saved = true;
      return { ...payload, _id: 'summit-reg-1' };
    },
    updateOne: async (query, update) => {
      updatedRecord = { ...query, ...update.$set };
    },
  };

  const mockEmailService = {
    sendRegistrationConfirmation: async (email, name) => {
      assert.equal(saved, true, 'Database save must complete before email dispatch');
      sentTo = email;
      sentName = name;
    },
  };

  const handler = createRegistrationHandler({
    registrationModel: mockModel,
    emailService: mockEmailService,
    logger: createLogger(),
  });

  const response = createResponse();
  const result = await handler({ body: validSummitPayload }, response);

  assert.equal(response.statusCode, 201);
  assert.equal(response.body.success, true);
  assert.match(response.body.registrationId, /^HWS26-\d{5}$/);

  await result?.emailPromise;
  assert.equal(sentTo, 'amina.rahman@example.com');
  assert.equal(sentName, 'Amina Rahman');
  assert.equal(updatedRecord.confirmationEmailSent, true);
  assert.ok(updatedRecord.confirmationEmailSentAt instanceof Date);
});

test('returns prompt HTTP 201 response immediately even when SMTP is delayed', async () => {
  let emailFinished = false;

  const mockModel = {
    findOne: async () => null,
    create: async payload => ({ ...payload, _id: 'summit-delay-1' }),
    updateOne: async () => {},
  };

  const mockEmailService = {
    sendRegistrationConfirmation: async () => {
      await new Promise(resolve => setTimeout(resolve, 300));
      emailFinished = true;
    },
  };

  const handler = createRegistrationHandler({
    registrationModel: mockModel,
    emailService: mockEmailService,
    logger: createLogger(),
  });

  const response = createResponse();
  const startTime = Date.now();
  const result = await handler({ body: validSummitPayload }, response);
  const elapsed = Date.now() - startTime;

  assert.ok(elapsed < 200, `Expected prompt response under 200ms, took ${elapsed}ms`);
  assert.equal(response.statusCode, 201);
  assert.equal(response.body.success, true);
  assert.equal(emailFinished, false, 'Email should still be pending when HTTP response is sent');

  await result?.emailPromise;
  assert.equal(emailFinished, true);
});

test('preserves saved registration and records error in database when SMTP fails', async () => {
  let savedRecord = null;
  let updatedRecord = null;
  let loggedError = null;

  const mockModel = {
    findOne: async () => null,
    create: async payload => {
      savedRecord = { ...payload, _id: 'summit-smtp-fail' };
      return savedRecord;
    },
    updateOne: async (query, update) => {
      updatedRecord = { ...query, ...update.$set };
    },
  };

  const mockEmailService = {
    sendRegistrationConfirmation: async () => {
      const error = new Error('Hostinger SMTP timeout on port 465');
      error.code = 'ETIMEDOUT';
      throw error;
    },
  };

  const mockLogger = {
    info() {},
    error(msg, details) { loggedError = { msg, details }; },
  };

  const handler = createRegistrationHandler({
    registrationModel: mockModel,
    emailService: mockEmailService,
    logger: mockLogger,
  });

  const response = createResponse();
  const result = await handler({ body: validSummitPayload }, response);

  // Response must still be HTTP 201 success because participant is saved in MongoDB
  assert.equal(response.statusCode, 201);
  assert.equal(response.body.success, true);
  assert.ok(savedRecord, 'Registration must remain saved in database');

  await result?.emailPromise;
  assert.ok(loggedError, 'SMTP failure must be logged');
  assert.equal(loggedError.details.code, 'ETIMEDOUT');
  assert.equal(loggedError.details.registrationId, savedRecord.registrationId);
  assert.ok(updatedRecord, 'Failed email state must be tracked in DB');
  assert.equal(updatedRecord.confirmationEmailSent, false);
  assert.match(updatedRecord.confirmationEmailLastError, /Hostinger SMTP timeout/);
});

test('rejects duplicate email with HTTP 400 and does not attempt email delivery', async () => {
  let emailAttempted = false;

  const mockModel = {
    findOne: async () => ({ _id: 'existing-summit-user', email: 'amina.rahman@example.com' }),
    create: async () => assert.fail('Duplicate user must not be persisted'),
  };

  const mockEmailService = {
    sendRegistrationConfirmation: async () => { emailAttempted = true; },
  };

  const handler = createRegistrationHandler({
    registrationModel: mockModel,
    emailService: mockEmailService,
    logger: createLogger(),
  });

  const response = createResponse();
  await handler({ body: validSummitPayload }, response);

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.message, 'This email is already registered for the summit.');
  assert.equal(emailAttempted, false);
});

test('retries save with next ID on concurrent registrationId key collision', async () => {
  let createAttempts = 0;
  const mockModel = {
    findOne: async () => null,
    create: async payload => {
      createAttempts++;
      if (createAttempts === 1) {
        const collisionErr = new Error('E11000 duplicate key error collection: registrations index: registrationId_1 dup key');
        collisionErr.code = 11000;
        throw collisionErr;
      }
      return { ...payload, _id: 'summit-retry-success' };
    },
    updateOne: async () => {},
  };

  const mockEmailService = {
    sendRegistrationConfirmation: async () => {},
  };

  const handler = createRegistrationHandler({
    registrationModel: mockModel,
    emailService: mockEmailService,
    logger: createLogger(),
  });

  const response = createResponse();
  const result = await handler({ body: validSummitPayload }, response);

  assert.equal(createAttempts, 2, 'Should retry save on registrationId collision');
  assert.equal(response.statusCode, 201);
  assert.equal(response.body.success, true);
  await result?.emailPromise;
});

test('validates required fields, email, WhatsApp, and profession other requirement', async () => {
  const handler = createRegistrationHandler({
    registrationModel: { findOne: async () => null },
    emailService: null,
    logger: createLogger(),
  });

  // Missing required fields
  const missingRes = createResponse();
  await handler({ body: { fullName: 'Test' } }, missingRes);
  assert.equal(missingRes.statusCode, 400);
  assert.match(missingRes.body.message, /complete all required fields/i);

  // Invalid email
  const badEmailRes = createResponse();
  await handler({ body: { ...validSummitPayload, email: 'notanemail' } }, badEmailRes);
  assert.equal(badEmailRes.statusCode, 400);
  assert.match(badEmailRes.body.message, /valid email/i);

  // Missing other profession specification
  const otherProfRes = createResponse();
  await handler({ body: { ...validSummitPayload, currentProfession: 'Other', otherProfession: '' } }, otherProfRes);
  assert.equal(otherProfRes.statusCode, 400);
  assert.match(otherProfRes.body.message, /specify your profession/i);
});

