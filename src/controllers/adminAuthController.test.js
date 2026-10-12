const test = require('node:test');
const assert = require('node:assert/strict');
const { createAdminAuthController, getMissingAuthConfiguration } = require('./adminAuthController');

const environment = {
  ADMIN_EMAIL: 'Admin@halalwealth.finance',
  ADMIN_PASSWORD_HASH: `$2b$12$${'a'.repeat(53)}`,
  JWT_SECRET: 's'.repeat(32),
};

function createResponse() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('returns 503 when admin authentication is not configured', async () => {
  const controller = createAdminAuthController({ getEnvironment: () => ({}) });
  const response = createResponse();

  await controller.login({ body: { email: 'admin@example.com', password: 'password' } }, response);

  assert.equal(response.statusCode, 503);
  assert.doesNotMatch(JSON.stringify(response.body), /JWT_SECRET|ADMIN_PASSWORD_HASH/);
});

test('returns one generic 401 response for incorrect admin credentials', async () => {
  let tokenCreated = false;
  const controller = createAdminAuthController({
    getEnvironment: () => environment,
    comparePassword: async () => false,
    signToken: () => { tokenCreated = true; return 'token'; },
  });
  const response = createResponse();

  await controller.login({ body: { email: 'wrong@example.com', password: 'wrong-password' } }, response);

  assert.equal(response.statusCode, 401);
  assert.equal(response.body.message, 'Invalid admin email or password.');
  assert.equal(tokenCreated, false);
});

test('allows a configured plaintext admin password when the hashed value is not set', async () => {
  let tokenPayload;
  const controller = createAdminAuthController({
    getEnvironment: () => ({
      ADMIN_EMAIL: 'admin@halalwealth.finance',
      ADMIN_PASSWORD: 'correct-password',
      JWT_SECRET: 's'.repeat(32),
    }),
    comparePassword: async (password, hash) => password === 'correct-password' && hash === 'correct-password',
    signToken: (payload, _secret) => {
      tokenPayload = payload;
      return 'plaintext-admin-token';
    },
  });
  const response = createResponse();

  await controller.login({ body: { email: 'admin@halalwealth.finance', password: 'correct-password' } }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.token, 'plaintext-admin-token');
  assert.deepEqual(tokenPayload, { email: 'admin@halalwealth.finance', role: 'ROLE_ADMIN' });
});

test('issues a short-lived ROLE_ADMIN bearer token for valid credentials', async () => {
  let tokenPayload;
  let tokenSecret;
  let tokenOptions;
  const controller = createAdminAuthController({
    getEnvironment: () => environment,
    comparePassword: async (password, hash) => password === 'correct-password' && hash === environment.ADMIN_PASSWORD_HASH,
    signToken: (payload, secret, options) => {
      tokenPayload = payload;
      tokenSecret = secret;
      tokenOptions = options;
      return 'signed-admin-token';
    },
  });
  const response = createResponse();

  await controller.login({ body: { email: ' ADMIN@HALALWEALTH.FINANCE ', password: 'correct-password' } }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.token, 'signed-admin-token');
  assert.equal(response.body.role, 'ROLE_ADMIN');
  assert.equal(response.body.email, 'admin@halalwealth.finance');
  assert.deepEqual(tokenPayload, { email: 'admin@halalwealth.finance', role: 'ROLE_ADMIN' });
  assert.equal(tokenSecret, environment.JWT_SECRET);
  assert.equal(tokenOptions.expiresIn, 1800);
});

test('identifies specific missing configuration variables safely', () => {
  const missingAll = getMissingAuthConfiguration({});
  assert.ok(missingAll.includes('ADMIN_EMAIL'));
  assert.ok(missingAll.includes('ADMIN_PASSWORD or ADMIN_PASSWORD_HASH'));
  assert.ok(missingAll.includes('JWT_SECRET'));

  const shortSecret = getMissingAuthConfiguration({
    ADMIN_EMAIL: 'admin@halalwealth.finance',
    ADMIN_PASSWORD: 'password123',
    JWT_SECRET: 'short_secret',
  });
  assert.equal(shortSecret.length, 1);
  assert.match(shortSecret[0], /JWT_SECRET/);
  assert.match(shortSecret[0], /must be at least 32 characters/);

  const complete = getMissingAuthConfiguration({
    ADMIN_EMAIL: 'admin@halalwealth.finance',
    ADMIN_PASSWORD: 'password123',
    JWT_SECRET: 's'.repeat(32),
  });
  assert.equal(complete.length, 0);
});

test('logs safe diagnostic message when admin auth configuration is missing', async () => {
  const loggedErrors = [];
  const fakeLogger = {
    error: message => { loggedErrors.push(message); },
  };
  const controller = createAdminAuthController({
    getEnvironment: () => ({}),
    logger: fakeLogger,
  });
  const response = createResponse();

  await controller.login({ body: { email: 'admin@halalwealth.finance', password: 'password123' } }, response);

  assert.equal(response.statusCode, 503);
  assert.equal(response.body.message, 'Admin authentication is not configured.');
  assert.equal(loggedErrors.length, 1);
  assert.match(loggedErrors[0], /Admin authentication configuration is incomplete/);
  assert.match(loggedErrors[0], /ADMIN_EMAIL/);
  assert.match(loggedErrors[0], /ADMIN_PASSWORD or ADMIN_PASSWORD_HASH/);
  assert.match(loggedErrors[0], /JWT_SECRET/);
  assert.doesNotMatch(loggedErrors[0], /password123/);
});

test('accepts synonym environment variables such as ADMIN_PASS and ADMIN_JWT_SECRET', async () => {
  const controller = createAdminAuthController({
    getEnvironment: () => ({
      ADMIN_USER_EMAIL: 'admin@halalwealth.finance',
      ADMIN_PASS: 'secret-pass-synonym',
      ADMIN_JWT_SECRET: 'x'.repeat(32),
    }),
    comparePassword: async (password, configured) => password === configured,
    signToken: () => 'synonym-token',
  });
  const response = createResponse();

  await controller.login({ body: { email: 'admin@halalwealth.finance', password: 'secret-pass-synonym' } }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.token, 'synonym-token');
});