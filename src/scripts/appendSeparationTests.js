const fs = require('fs');
const path = require('path');

// 1. adminRegistrationController.test.js
const adminTestFile = path.resolve(__dirname, '../controllers/adminRegistrationController.test.js');
let adminTestContent = fs.readFileSync(adminTestFile, 'utf8');

const adminNewTests = `
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
`;

if (!adminTestContent.includes('buildRegistrationFilter correctly filters by webinarId')) {
  adminTestContent += adminNewTests.replace(/\n/g, '\r\n');
  fs.writeFileSync(adminTestFile, adminTestContent, 'utf8');
  console.log('Appended separation tests to adminRegistrationController.test.js');
}

// 2. webinarController.test.js
const webTestFile = path.resolve(__dirname, '../controllers/webinarController.test.js');
let webTestContent = fs.readFileSync(webTestFile, 'utf8');

const webNewTests = `
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
      webinarId: 'halal-wealth-nov-2026',
      financialInterests: ['Personal Financial Planning'],
      consent: true,
    },
  }, res);

  assert.equal(res.statusCode, 201);
  assert.equal(createdPayload.webinarId, 'halal-wealth-nov-2026');
  assert.equal(createdPayload.email, 'october.attendee@example.com');
});
`;

if (!webTestContent.includes('allows user from previous October webinar to register')) {
  webTestContent += webNewTests;
  fs.writeFileSync(webTestFile, webTestContent, 'utf8');
  console.log('Appended separation tests to webinarController.test.js');
}

