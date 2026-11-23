const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');
const SummitRegistration = require('../models/SummitRegistration');

const JWT_SECRET = 'route-test-secret-that-is-at-least-thirty-two-characters';
const ADMIN_JWT_ISSUER = 'halal-wealth-admin';


function createTestApp() {
  const app = express();
  app.set('trust proxy', 1);

  

  const KNOWN_ALLOWED_ORIGINS = [
    'https://www.halalwealth.finance',
    'https://halalwealth.finance',
    'http://www.halalwealth.finance',
    'http://halalwealth.finance',
    'https://barakah-client-eta.vercel.app',
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:3000',
    'http://localhost:5000',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:5174',
  ];

  const allowedOriginsSet = new Set(KNOWN_ALLOWED_ORIGINS.map(o => o.toLowerCase()));

  const isAllowedOrigin = (requestOrigin) => {
    if (!requestOrigin) return true;
    const normalized = String(requestOrigin).trim().toLowerCase().replace(/\/+$/, '');
    if (allowedOriginsSet.has(normalized)) return true;
    if (/^https?:\/\/([a-z0-9-]+\.)*halalwealth\.finance$/i.test(normalized)) return true;
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(normalized)) return true;
    return false;
  };

  const corsOptions = {
    origin: (requestOrigin, callback) => {
      if (isAllowedOrigin(requestOrigin)) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
    credentials: true,
    optionsSuccessStatus: 204,
    maxAge: 86400,
  };

  app.use(cors(corsOptions));
  app.options('*', cors(corsOptions));

  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }));

  app.use(express.json());
  app.use('/api/admin', require('./admin'));
  app.use('/api', require('./api'));

  app.use((err, req, res, next) => {
    const requestOrigin = req.headers.origin;
    if (requestOrigin && isAllowedOrigin(requestOrigin)) {
      res.setHeader('Access-Control-Allow-Origin', requestOrigin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
    }
    const statusCode = err.status || err.statusCode || 500;
    res.status(statusCode).json({ success: false, message: err.message || 'Internal error' });
  });

  return app;
}

test('production CORS allows www.halalwealth.finance and halalwealth.finance with OPTIONS 204', async () => {
  const app = createTestApp();
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const testOrigins = [
      'https://www.halalwealth.finance',
      'https://halalwealth.finance',
      'https://www.halalwealth.finance/', // trailing slash normalized
      'http://localhost:5173',
    ];

    for (const origin of testOrigins) {
      const res = await fetch(`${baseUrl}/api/admin/investor-mission/registrations/SS26-0001/send-confirmation`, {
        method: 'OPTIONS',
        headers: {
          Origin: origin,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Authorization,Content-Type',
        },
      });

      assert.equal(res.status, 204, `Preflight should return 204 for ${origin}`);
      const allowOrigin = res.headers.get('access-control-allow-origin');
      assert.equal(allowOrigin, origin);
      assert.match(res.headers.get('access-control-allow-methods') || '', /POST/);
      assert.match(res.headers.get('access-control-allow-headers') || '', /Authorization/i);
      assert.equal(res.headers.get('access-control-allow-credentials'), 'true');
    }

    // Disallowed origin should NOT have Access-Control-Allow-Origin and should NOT crash with 500
    const disallowedRes = await fetch(`${baseUrl}/api/admin/investor-mission/registrations/SS26-0001/send-confirmation`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://evil-hacker.com',
        'Access-Control-Request-Method': 'POST',
      },
    });
    assert.equal(disallowedRes.headers.get('access-control-allow-origin'), null);
    assert.notEqual(disallowedRes.status, 500);
  } finally {
    server.close();
  }
});

test('both send-confirmation and resend-confirmation routes exist for investor-mission and dec-summit', async () => {
  const originalSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = JWT_SECRET;

  const SummitRegistration = require('../models/SummitRegistration');
  const originalFindOne = SummitRegistration.findOne;
  SummitRegistration.findOne = async () => null; // Returns null so controller responds with 404 "Registration not found."

  const app = createTestApp();
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const imAdminToken = jwt.sign(
      { username: 'SIO Coimbatore', role: 'INVESTOR_MISSION_ADMIN', allowedEvents: ['INVESTOR_MISSION_2026'] },
      JWT_SECRET,
      { algorithm: 'HS256', subject: 'investor-mission-admin', issuer: ADMIN_JWT_ISSUER, expiresIn: 60 },
    );

    const confirmationEndpoints = [
      '/api/admin/investor-mission/registrations/NON_EXISTENT/resend-confirmation',
      '/api/admin/investor-mission/registrations/NON_EXISTENT/send-confirmation',
      '/api/admin/dec-summit/registrations/NON_EXISTENT/resend-confirmation',
      '/api/admin/dec-summit/registrations/NON_EXISTENT/send-confirmation',
      '/api/admin/small-summit/registrations/NON_EXISTENT/send-confirmation',
    ];

    for (const ep of confirmationEndpoints) {
      const res = await fetch(`${baseUrl}${ep}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${imAdminToken}`,
          'Content-Type': 'application/json',
          Origin: 'https://www.halalwealth.finance',
        },
      });

      // It must NOT return 404 Route Not Found; it returns 404 "Registration not found" (which proves route exists)
      const data = await res.json();
      assert.equal(res.status, 404, `Endpoint ${ep} should hit registration lookup`);
      assert.equal(data.message, 'Registration not found.', `Endpoint ${ep} must execute controller logic`);
    }
  } finally {
    process.env.JWT_SECRET = originalSecret;
    server.close();
  }
});

test('email diagnostic endpoint is accessible to investor-mission admin and returns SMTP status', async () => {
  const originalSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = JWT_SECRET;

  const app = createTestApp();
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const imAdminToken = jwt.sign(
      { username: 'SIO Coimbatore', role: 'INVESTOR_MISSION_ADMIN', allowedEvents: ['INVESTOR_MISSION_2026'] },
      JWT_SECRET,
      { algorithm: 'HS256', subject: 'investor-mission-admin', issuer: ADMIN_JWT_ISSUER, expiresIn: 60 },
    );

    const res = await fetch(`${baseUrl}/api/admin/investor-mission/email-diagnostic`, {
      headers: {
        Authorization: `Bearer ${imAdminToken}`,
        Origin: 'https://www.halalwealth.finance',
      },
    });

    const data = await res.json();
    assert.ok(data !== null && typeof data === 'object');
    assert.ok('ok' in data || 'success' in data);
    assert.ok('host' in data);
    assert.ok('port' in data);
    assert.equal(res.headers.get('access-control-allow-origin'), 'https://www.halalwealth.finance');
  } finally {
    process.env.JWT_SECRET = originalSecret;
    server.close();
  }
});
