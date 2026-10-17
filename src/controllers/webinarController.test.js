const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createWebinarRegistrationHandler,
  getWebinarRegistrationStatusHandler,
  isWebinarRegistrationClosed,
  REGISTRATION_CLOSED_MESSAGE,
} = require('./webinarController');

const validPayload = {
  fullName: 'Test User',
  whatsapp: '+919876543210',
  phoneCountry: 'IN',
  email: 'test@example.com',
  location: 'Chennai, Tamil Nadu, India',
  designation: 'Founder / Owner',
  industry: 'Technology / IT',
  financialInterests: ['Financial Planning'],
  otherFinancialInterest: '',
  financialChallenge: '',
  webinarSource: 'Website',
  consent: true,
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

test('saves the registration before sending its confirmation email', async () => {
  let saved = false;
  let sentTo;
  let sentName;
  const registration = { ...validPayload, _id: 'registration-id' };
  const handler = createWebinarRegistrationHandler({
    isRegistrationClosed: () => false,
    registrationModel: {
      findOne: async () => null,
      create: async payload => { saved = true; return { ...registration, ...payload }; },
    },
    emailService: {
      sendRegistrationConfirmation: async (email, name) => {
        assert.equal(saved, true);
        sentTo = email;
        sentName = name;
      },
    },
    logger: createLogger(),
  });
  const response = createResponse();

  await handler({ body: validPayload }, response);

  assert.equal(response.statusCode, 201);
  assert.equal(response.body.success, true);
  assert.equal(response.body.confirmationEmailSent, true);
  assert.equal(sentTo, validPayload.email);
  assert.equal(sentName, validPayload.fullName);
});

test('does not send email when registration persistence fails', async () => {
  let emailAttempted = false;
  const handler = createWebinarRegistrationHandler({
    isRegistrationClosed: () => false,
    registrationModel: {
      findOne: async () => null,
      create: async () => { throw new Error('database unavailable'); },
    },
    emailService: { sendRegistrationConfirmation: async () => { emailAttempted = true; } },
    logger: createLogger(),
  });
  const response = createResponse();

  await handler({ body: validPayload }, response);

  assert.equal(response.statusCode, 500);
  assert.equal(emailAttempted, false);
});

test('keeps a saved registration successful when sending its email fails', async () => {
  let savedRegistration;
  let loggedFailure;
  const handler = createWebinarRegistrationHandler({
    isRegistrationClosed: () => false,
    registrationModel: {
      findOne: async () => null,
      create: async payload => { savedRegistration = { ...payload, _id: 'registration-id' }; return savedRegistration; },
    },
    emailService: { sendRegistrationConfirmation: async () => { const error = new Error('SMTP unavailable'); error.code = 'ECONNECTION'; throw error; } },
    logger: { info() {}, error(message, details) { loggedFailure = { message, details }; } },
  });
  const response = createResponse();

  await handler({ body: validPayload }, response);

  assert.ok(savedRegistration);
  assert.equal(response.statusCode, 201);
  assert.equal(response.body.success, true);
  assert.equal(response.body.confirmationEmailSent, false);
  assert.deepEqual(loggedFailure, {
    message: 'Webinar registration confirmation email failed.',
    details: {
      code: 'ECONNECTION',
      message: 'SMTP unavailable',
      email: 'test@example.com',
    },
  });
  assert.doesNotMatch(JSON.stringify(response.body), /SMTP unavailable|ECONNECTION/);
});

test('does not send another email for a rejected duplicate registration', async () => {
  let emailAttempted = false;
  const handler = createWebinarRegistrationHandler({
    isRegistrationClosed: () => false,
    registrationModel: {
      findOne: async () => ({ _id: 'existing-registration' }),
      create: async () => assert.fail('duplicate registration must not be saved'),
    },
    emailService: { sendRegistrationConfirmation: async () => { emailAttempted = true; } },
    logger: createLogger(),
  });
  const response = createResponse();

  await handler({ body: validPayload }, response);

  assert.equal(response.statusCode, 400);
  assert.equal(emailAttempted, false);
});

test('automatically sends Zoom joining link to new registrants and records status', async () => {
  let sentZoomTo;
  let sentZoomName;
  let updatedRecord;
  const registration = { ...validPayload, _id: 'reg-zoom-1' };
  const handler = createWebinarRegistrationHandler({
    isRegistrationClosed: () => false,
    registrationModel: {
      findOne: async () => null,
      create: async payload => ({ ...registration, ...payload }),
      findByIdAndUpdate: async (id, update) => {
        updatedRecord = { id, ...update.$set };
        return updatedRecord;
      },
    },
    emailService: {
      sendZoomJoiningLink: async (email, name) => {
        sentZoomTo = email;
        sentZoomName = name;
      },
    },
    logger: createLogger(),
  });
  const response = createResponse();

  await handler({ body: validPayload }, response);

  assert.equal(response.statusCode, 201);
  assert.equal(response.body.success, true);
  assert.equal(response.body.joiningEmailSent, true);
  assert.equal(sentZoomTo, validPayload.email);
  assert.equal(sentZoomName, validPayload.fullName);
  assert.equal(updatedRecord.joiningEmailSent, true);
  assert.ok(updatedRecord.joiningEmailSentAt instanceof Date);
});

test('rejects incoming registration with HTTP 403 and friendly message when registration is closed by default', async () => {
  let dbQueried = false;
  let emailAttempted = false;
  const handler = createWebinarRegistrationHandler({
    isRegistrationClosed: () => true,
    registrationModel: {
      findOne: async () => { dbQueried = true; return null; },
      create: async () => { dbQueried = true; return {}; },
    },
    emailService: {
      sendZoomJoiningLink: async () => { emailAttempted = true; },
      sendRegistrationConfirmation: async () => { emailAttempted = true; },
    },
    logger: createLogger(),
  });
  const response = createResponse();

  await handler({ body: validPayload }, response);

  assert.equal(response.statusCode, 403);
  assert.equal(response.body.success, false);
  assert.equal(response.body.closed, true);
  assert.equal(response.body.message, REGISTRATION_CLOSED_MESSAGE);
  assert.equal(response.body.message, 'Registration for this webinar has now closed. We appreciate your interest and support.');
  assert.equal(dbQueried, false);
  assert.equal(emailAttempted, false);
});

test('reports registration closure accurately in status endpoint handler', async () => {
  const closedHandler = getWebinarRegistrationStatusHandler({ isRegistrationClosed: () => true });
  const closedRes = createResponse();
  closedHandler({}, closedRes);
  assert.equal(closedRes.statusCode, 200);
  assert.equal(closedRes.body.closed, true);
  assert.equal(closedRes.body.message, REGISTRATION_CLOSED_MESSAGE);

  const openHandler = getWebinarRegistrationStatusHandler({ isRegistrationClosed: () => false });
  const openRes = createResponse();
  openHandler({}, openRes);
  assert.equal(openRes.statusCode, 200);
  assert.equal(openRes.body.closed, false);
  assert.equal(openRes.body.message, 'Registration is open.');
});

test('isWebinarRegistrationClosed defaults to true and respects environment variables', () => {
  assert.equal(isWebinarRegistrationClosed({}), true);
  assert.equal(isWebinarRegistrationClosed({ WEBINAR_REGISTRATION_CLOSED: 'true' }), true);
  assert.equal(isWebinarRegistrationClosed({ WEBINAR_REGISTRATION_CLOSED: 'false' }), false);
  assert.equal(isWebinarRegistrationClosed({ WEBINAR_REGISTRATION_OPEN: 'true' }), false);
  assert.equal(isWebinarRegistrationClosed({ WEBINAR_REGISTRATION_OPEN: 'false' }), true);
});