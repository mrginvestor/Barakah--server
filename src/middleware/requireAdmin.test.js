const test = require('node:test');
const assert = require('node:assert/strict');
const { createRequireAdmin } = require('./requireAdmin');

function createResponse() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('rejects missing and invalid bearer tokens with 401', () => {
  const middleware = createRequireAdmin({ getSecret: () => 's'.repeat(32), verifyToken: () => { throw new Error('invalid token'); } });
  const missingResponse = createResponse();
  middleware({ get: () => undefined }, missingResponse, () => assert.fail('missing token must be rejected'));
  assert.equal(missingResponse.statusCode, 401);

  const invalidResponse = createResponse();
  middleware({ get: () => 'Bearer expired-token' }, invalidResponse, () => assert.fail('invalid token must be rejected'));
  assert.equal(invalidResponse.statusCode, 401);

  const unavailableMiddleware = createRequireAdmin({ getSecret: () => undefined });
  const unavailableResponse = createResponse();
  unavailableMiddleware({ get: () => 'Bearer valid-shaped-token' }, unavailableResponse, () => assert.fail('unconfigured JWT secret must be rejected'));
  assert.equal(unavailableResponse.statusCode, 503);
});

test('rejects authenticated users without ROLE_ADMIN with 403', () => {
  const middleware = createRequireAdmin({
    getSecret: () => 's'.repeat(32),
    verifyToken: () => ({ sub: 'user-1', email: 'user@example.com', role: 'ROLE_USER' }),
  });
  const response = createResponse();

  middleware({ get: () => 'Bearer valid-user-token' }, response, () => assert.fail('non-admin token must be rejected'));

  assert.equal(response.statusCode, 403);
});

test('passes a valid admin identity to the protected route', () => {
  const middleware = createRequireAdmin({
    getSecret: () => 's'.repeat(32),
    verifyToken: () => ({ sub: 'admin', email: 'admin@example.com', role: 'ROLE_ADMIN' }),
  });
  const req = { get: () => 'Bearer valid-admin-token' };
  const response = createResponse();
  let continued = false;

  middleware(req, response, () => { continued = true; });

  assert.equal(continued, true);
  assert.deepEqual(req.admin, { email: 'admin@example.com', role: 'ROLE_ADMIN' });
});

test('requireInvestorMissionAdmin allows both ROLE_ADMIN and INVESTOR_MISSION_ADMIN', () => {
  const { requireInvestorMissionAdmin } = require('./requireAdmin');
  const imMiddleware = createRequireAdmin({
    getSecret: () => 's'.repeat(32),
    allowedRoles: ['ROLE_ADMIN', 'INVESTOR_MISSION_ADMIN'],
    verifyToken: (token) => {
      if (token === 'im-token') {
        return { sub: 'sio-coimbatore', username: 'SIO Coimbatore', displayName: 'SIO Coimbatore', role: 'INVESTOR_MISSION_ADMIN' };
      }
      if (token === 'admin-token') {
        return { sub: 'admin', email: 'admin@halalwealth.finance', role: 'ROLE_ADMIN' };
      }
      return { sub: 'user-1', email: 'user@example.com', role: 'ROLE_USER' };
    },
  });

  // Test IM admin
  const imReq = { get: () => 'Bearer im-token' };
  const imRes = createResponse();
  let imContinued = false;
  imMiddleware(imReq, imRes, () => { imContinued = true; });
  assert.equal(imContinued, true);
  assert.equal(imReq.admin.role, 'INVESTOR_MISSION_ADMIN');
  assert.equal(imReq.admin.username, 'SIO Coimbatore');

  // Test Main admin
  const adminReq = { get: () => 'Bearer admin-token' };
  const adminRes = createResponse();
  let adminContinued = false;
  imMiddleware(adminReq, adminRes, () => { adminContinued = true; });
  assert.equal(adminContinued, true);
  assert.equal(adminReq.admin.role, 'ROLE_ADMIN');

  // Test Unauthorized user
  const userReq = { get: () => 'Bearer user-token' };
  const userRes = createResponse();
  imMiddleware(userReq, userRes, () => assert.fail('user must be rejected'));
  assert.equal(userRes.statusCode, 403);
});