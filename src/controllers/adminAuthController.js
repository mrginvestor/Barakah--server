const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { ADMIN_JWT_ISSUER } = require('../middleware/requireAdmin');

const SESSION_SECONDS = 30 * 60;

function readFirstDefined(environment, keys) {
  for (const key of keys) {
    const value = environment?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return '';
}

function createAdminAuthController({
  comparePassword = bcrypt.compare,
  signToken = jwt.sign,
  getEnvironment = () => process.env,
  logger = console,
} = {}) {
  async function login(req, res) {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!email || !password) {
      return res.status(400).json({ message: 'Enter your admin email and password.' });
    }

    const environment = getEnvironment();
    const adminEmail = readFirstDefined(environment, ['ADMIN_EMAIL', 'ADMIN_USER_EMAIL', 'ADMIN_USERNAME']).toLowerCase();
    const passwordHash = readFirstDefined(environment, ['ADMIN_PASSWORD_HASH', 'ADMIN_HASHED_PASSWORD']);
    const configuredPassword = readFirstDefined(environment, ['ADMIN_PASSWORD', 'ADMIN_PLAIN_PASSWORD']);
    const jwtSecret = readFirstDefined(environment, ['JWT_SECRET']);
    if (!adminEmail || (!passwordHash && !configuredPassword) || jwtSecret.length < 32) {
      return res.status(503).json({ message: 'Admin authentication is not configured.' });
    }

    try {
      let passwordMatches = false;
      if (passwordHash && /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(passwordHash)) {
        passwordMatches = await comparePassword(password, passwordHash);
      } else if (configuredPassword) {
        passwordMatches = password === configuredPassword;
      }

      if (email !== adminEmail || !passwordMatches) {
        return res.status(401).json({ message: 'Invalid admin email or password.' });
      }

      const token = signToken(
        { email: adminEmail, role: 'ROLE_ADMIN' },
        jwtSecret,
        { algorithm: 'HS256', subject: 'admin', issuer: ADMIN_JWT_ISSUER, expiresIn: SESSION_SECONDS },
      );
      return res.json({ token, tokenType: 'Bearer', expiresInSeconds: SESSION_SECONDS, role: 'ROLE_ADMIN', email: adminEmail });
    } catch (error) {
      logger.error('Admin authentication failed.', { code: error.code || 'ADMIN_AUTH_FAILED' });
      return res.status(503).json({ message: 'Admin authentication is temporarily unavailable.' });
    }
  }

  function getSession(req, res) {
    return res.json({ authenticated: true, role: req.admin.role, email: req.admin.email });
  }

  return { login, getSession };
}

module.exports = { SESSION_SECONDS, createAdminAuthController, ...createAdminAuthController() };