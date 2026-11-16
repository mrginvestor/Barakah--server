const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');

const JWT_SECRET = 'route-test-secret-that-is-at-least-thirty-two-characters';
const ADMIN_JWT_ISSUER = 'halal-wealth-admin';

test('protects every registration read and check-in route at the HTTP boundary', async () => {
  const originalEnvironment = {
    JWT_SECRET: process.env.JWT_SECRET,
    ADMIN_EMAIL: process.env.ADMIN_EMAIL,
    ADMIN_PASSWORD_HASH: process.env.ADMIN_PASSWORD_HASH,
  };
  process.env.JWT_SECRET = JWT_SECRET;
  delete process.env.ADMIN_EMAIL;
  delete process.env.ADMIN_PASSWORD_HASH;

  const app = express();
  app.use(express.json());
  app.use('/api/admin', require('./admin'));
  app.use('/api', require('./api'));
  const server = app.listen(0);

  try {
    await new Promise(resolve => server.once('listening', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const paths = [
      '/api/admin/session',
      '/api/admin/registrations',
      '/api/admin/registrations/send-starting-reminder',
      '/api/admin/campaigns/feedback/preview',
      '/api/admin/campaigns/feedback/send',
      '/api/registrations',
      '/api/webinar/registrations',
      '/api/check-in',
    ];
    for (const path of paths) {
      const response = await fetch(`${baseUrl}${path}`, { method: path === '/api/check-in' || path.includes('/send') ? 'POST' : 'GET' });
      assert.equal(response.status, 401, path);
    }

    const userToken = jwt.sign(
      { email: 'user@example.com', role: 'ROLE_USER' },
      JWT_SECRET,
      { algorithm: 'HS256', subject: 'user-1', issuer: ADMIN_JWT_ISSUER, expiresIn: 60 },
    );
    const forbidden = await fetch(`${baseUrl}/api/admin/registrations`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    assert.equal(forbidden.status, 403);

    // Verify INVESTOR_MISSION_ADMIN access boundary
    const imAdminToken = jwt.sign(
      { username: 'SIO Coimbatore', displayName: 'SIO Coimbatore', role: 'INVESTOR_MISSION_ADMIN', allowedEvents: ['INVESTOR_MISSION_2026'] },
      JWT_SECRET,
      { algorithm: 'HS256', subject: 'investor-mission-admin', issuer: ADMIN_JWT_ISSUER, expiresIn: 60 },
    );

    // 1. IM Admin is allowed to access session
    const imSessionRes = await fetch(`${baseUrl}/api/admin/session`, {
      headers: { Authorization: `Bearer ${imAdminToken}` },
    });
    assert.equal(imSessionRes.status, 200);
    const sessionJson = await imSessionRes.json();
    assert.equal(sessionJson.role, 'INVESTOR_MISSION_ADMIN');
    assert.equal(sessionJson.username, 'SIO Coimbatore');

    // 2. IM Admin is forbidden (403) from accessing Main Summit / Webinar registrations & campaigns
    const forbiddenPathsForIM = [
      { path: '/api/admin/registrations', method: 'GET' },
      { path: '/api/admin/webinars', method: 'GET' },
      { path: '/api/admin/campaigns/feedback/preview', method: 'GET' },
      { path: '/api/admin/email/diagnostic', method: 'GET' },
      { path: '/api/registrations', method: 'GET' },
      { path: '/api/check-in', method: 'POST' },
    ];
    for (const { path: fPath, method } of forbiddenPathsForIM) {
      const fRes = await fetch(`${baseUrl}${fPath}`, {
        method,
        headers: { Authorization: `Bearer ${imAdminToken}` },
      });
      assert.equal(fRes.status, 403, `IM Admin must be forbidden (403) from ${fPath}`);
    }

    const login = await fetch(`${baseUrl}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@example.com', password: 'not-a-real-password' }),
    });
    assert.equal(login.status, 503);
    assert.match((await login.json()).message, /not configured/i);
  } finally {
    await new Promise(resolve => server.close(resolve));
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});