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

test('isWebinarRegistrationClosed defaults to false and respects environment variables', () => {
  assert.equal(isWebinarRegistrationClosed({}), false);
  assert.equal(isWebinarRegistrationClosed({ WEBINAR_REGISTRATION_CLOSED: 'true' }), true);
  assert.equal(isWebinarRegistrationClosed({ WEBINAR_REGISTRATION_CLOSED: 'false' }), false);
  assert.equal(isWebinarRegistrationClosed({ WEBINAR_REGISTRATION_OPEN: 'true' }), false);
  assert.equal(isWebinarRegistrationClosed({ WEBINAR_REGISTRATION_OPEN: 'false' }), true);
});

test('accepts business webinar registration with company, website, country and new interests', async () => {
  let createdPayload;
  const businessPayload = {
    fullName: 'Tariq Al-Mansoor',
    whatsapp: '+971501234567',
    phoneCountry: 'AE',
    email: 'tariq@mansoorgroup.com',
    occupation: 'Managing Director / CEO',
    industry: 'Trading, Import & Export',
    companyName: 'Al-Mansoor Trading LLC',
    businessWebsite: 'https://almansoor.ae',
    country: 'United Arab Emirates',
    city: 'Dubai',
    financialInterests: ['Business Growth and Trade', 'Halal Investments and Wealth Management', 'Generational Wealth Planning'],
    additionalInfo: 'Looking to scale Shariah-compliant export financing and corporate sukuk.',
    webinarVersion: 'Business Webinar 2026',
    consent: true,
  };

  const handler = createWebinarRegistrationHandler({
    isRegistrationClosed: () => false,
    registrationModel: {
      findOne: async () => null,
      create: async p => { createdPayload = p; return { ...p, _id: 'biz-1' }; },
    },
    emailService: { sendRegistrationConfirmation: async () => {} },
    logger: createLogger(),
  });
  const res = createResponse();

  await handler({ body: businessPayload }, res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.success, true);
  assert.equal(createdPayload.companyName, 'Al-Mansoor Trading LLC');
  assert.equal(createdPayload.businessWebsite, 'https://almansoor.ae');
  assert.equal(createdPayload.country, 'United Arab Emirates');
  assert.equal(createdPayload.city, 'Dubai');
  assert.equal(createdPayload.designation, 'Managing Director / CEO');
  assert.equal(createdPayload.webinarVersion, 'Business Webinar 2026');
  assert.ok(createdPayload.registrationId.startsWith('HWW-B26-'));
});


test('accepts November 1 inclusive registration with age group, state, and questions', async () => {
  let createdPayload;
  const novPayload = {
    fullName: 'Zayd Patel',
    whatsapp: '+447123456789',
    phoneCountry: 'GB',
    email: 'zayd@example.co.uk',
    occupation: 'Student',
    country: 'United Kingdom',
    state: 'Greater London',
    city: 'London',
    ageGroup: '18–24',
    financialInterests: ['Learning the Basics of Finance', 'Halal Investments', 'Personal Financial Planning'],
    questionsOrTopics: 'How to start investing in halal index funds with small amounts?',
    webinarSource: 'Friends or Family',
    consent: true,
  };

  const handler = createWebinarRegistrationHandler({
    isRegistrationClosed: () => false,
    registrationModel: {
      findOne: async () => null,
      create: async p => { createdPayload = p; return { ...p, _id: 'nov-1' }; },
    },
    emailService: { sendRegistrationConfirmation: async () => {} },
    logger: createLogger(),
  });
  const res = createResponse();

  await handler({ body: novPayload }, res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.success, true);
  assert.equal(createdPayload.occupation, 'Student');
  assert.equal(createdPayload.ageGroup, '18–24');
  assert.equal(createdPayload.country, 'United Kingdom');
  assert.equal(createdPayload.state, 'Greater London');
  assert.equal(createdPayload.city, 'London');
  assert.equal(createdPayload.questionsOrTopics, 'How to start investing in halal index funds with small amounts?');
  assert.equal(createdPayload.webinarVersion, 'November 1, 2026 Webinar');
  assert.ok(createdPayload.registrationId.startsWith('HWW-N26-'));
});

test('allows user from previous October webinar to register for November 1 webinar with same email', async () => {
  let createdPayload;
  const mockRegistrationModel = {
    findOne: async query => {
      if (query.email === 'october.attendee@example.com') {
        const matchesOct = query.$or?.some(c => c.webinarId === 'halal-wealth-oct-2026' || c.webinarVersion === 'October 2026 Webinar');
        if (matchesOct) return { _id: 'oct-1', email: 'october.attendee@example.com', webinarId: 'halal-wealth-oct-2026' };
      }
      return null;
    },
    create: async payload => {
      createdPayload = payload;
      return { _id: 'nov-new-1', ...payload };
    },
    findByIdAndUpdate: async () => {},
  };

  const handler = createWebinarRegistrationHandler({
    registrationModel: mockRegistrationModel,
    emailService: { sendRegistrationConfirmation: async () => {} },
    logger: { info() {}, error() {} },
    isRegistrationClosed: () => false,
  });

  const res = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(data) { this.body = data; return this; },
  };

  await handler({
    body: {
      fullName: 'October Attendee',
      email: 'october.attendee@example.com',
      whatsapp: '+6591234567',
      country: 'Singapore',
      occupation: 'Salaried Employee',
      location: 'Singapore',
      webinarId: 'halal-wealth-nov-2026',
      financialInterests: ['Personal Financial Planning'],
      consent: true,
    },
  }, res);

  assert.equal(res.statusCode, 201);
  assert.equal(createdPayload.webinarId, 'halal-wealth-nov-2026');
  assert.equal(createdPayload.email, 'october.attendee@example.com');
});
