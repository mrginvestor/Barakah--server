const test = require('node:test');
const assert = require('node:assert/strict');
const { createAdminAuthController } = require('./adminAuthController');

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