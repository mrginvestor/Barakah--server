const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { ADMIN_JWT_ISSUER } = require('../middleware/requireAdmin');
const AdminUser = require('../models/AdminUser');

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

function getMissingAuthConfiguration(environment = process.env) {
  const missing = [];
  const adminEmail = readFirstDefined(environment, ['ADMIN_EMAIL', 'ADMIN_USER_EMAIL', 'ADMIN_USERNAME']);
  const passwordHash = readFirstDefined(environment, ['ADMIN_PASSWORD_HASH', 'ADMIN_HASHED_PASSWORD', 'ADMIN_HASH']);
  const configuredPassword = readFirstDefined(environment, ['ADMIN_PASSWORD', 'ADMIN_PLAIN_PASSWORD', 'ADMIN_PASS', 'ADMIN_PWD']);
  const jwtSecret = readFirstDefined(environment, ['JWT_SECRET', 'ADMIN_JWT_SECRET', 'TOKEN_SECRET']);

  if (!adminEmail) {
    missing.push('ADMIN_EMAIL');
  }
  if (!passwordHash && !configuredPassword) {
    missing.push('ADMIN_PASSWORD or ADMIN_PASSWORD_HASH');
  }
  if (!jwtSecret) {
    missing.push('JWT_SECRET');
  } else if (jwtSecret.length < 32) {
    missing.push(`JWT_SECRET (length is ${jwtSecret.length}, must be at least 32 characters)`);
  }
  return missing;
}

function createAdminAuthController({
  comparePassword = bcrypt.compare,
  signToken = jwt.sign,
  getEnvironment = () => process.env,
  adminUserModel = AdminUser,
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
    const passwordHash = readFirstDefined(environment, ['ADMIN_PASSWORD_HASH', 'ADMIN_HASHED_PASSWORD', 'ADMIN_HASH']);
    const configuredPassword = readFirstDefined(environment, ['ADMIN_PASSWORD', 'ADMIN_PLAIN_PASSWORD', 'ADMIN_PASS', 'ADMIN_PWD']);
    const jwtSecret = readFirstDefined(environment, ['JWT_SECRET', 'ADMIN_JWT_SECRET', 'TOKEN_SECRET']);

    const missingConfig = getMissingAuthConfiguration(environment);
    if (missingConfig.length > 0) {
      const safeErrorLog = (logger && typeof logger.error === 'function') ? logger.error.bind(logger) : console.error;
      safeErrorLog(`Admin authentication configuration is incomplete: ${missingConfig.join(', ')} is missing or invalid. Set these in your deployment environment variables.`);
      return res.status(503).json({ message: 'Admin authentication is not configured.' });
    }

    try {
      if (email !== adminEmail) {
        return res.status(401).json({ message: 'Invalid admin email or password.' });
      }

      let passwordMatches = false;
      if (passwordHash && /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(passwordHash)) {
        passwordMatches = await comparePassword(password, passwordHash);
      } else if (configuredPassword) {
        passwordMatches = password === configuredPassword;
      }

      if (!passwordMatches) {
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

  /**
   * Dedicated Login for Investor Mission Administrator (SIO Coimbatore)
   */
  async function loginInvestorMissionAdmin(req, res) {
    const rawUsername = String(req.body?.username || req.body?.loginId || req.body?.email || '').trim();
    const password = String(req.body?.password || '');

    if (!rawUsername || !password) {
      return res.status(400).json({ message: 'Enter your Login ID and password.' });
    }

    const environment = getEnvironment();
    const jwtSecret = readFirstDefined(environment, ['JWT_SECRET', 'ADMIN_JWT_SECRET', 'TOKEN_SECRET']);

    if (!jwtSecret || jwtSecret.length < 32) {
      const safeErrorLog = (logger && typeof logger.error === 'function') ? logger.error.bind(logger) : console.error;
      safeErrorLog('Investor Mission Admin authentication error: JWT_SECRET is missing or shorter than 32 characters.');
      return res.status(503).json({ message: 'Admin authentication is temporarily unavailable.' });
    }

    const usernameLower = rawUsername.toLowerCase();

    try {
      let dbUser = null;
      if (adminUserModel && typeof adminUserModel.findOne === 'function') {
        try {
          dbUser = await adminUserModel.findOne({ usernameLower });
        } catch (dbErr) {
          logger.warn('[IM_AUTH] MongoDB lookup failed or not connected, testing environment fallback:', dbErr.message);
        }
      }

      if (dbUser) {
        // Check account lock
        if (typeof dbUser.isLocked === 'function' && dbUser.isLocked()) {
          const minutes = Math.ceil((new Date(dbUser.lockUntil).getTime() - Date.now()) / (60 * 1000));
          return res.status(429).json({
            message: `Account is temporarily locked due to multiple failed login attempts. Try again in ${minutes} minutes.`,
          });
        }

        if (dbUser.isActive === false) {
          return res.status(403).json({ message: 'This admin account has been deactivated.' });
        }

        let passwordMatches = false;
        if (typeof dbUser.comparePassword === 'function') {
          passwordMatches = await dbUser.comparePassword(password);
        } else if (dbUser.passwordHash) {
          passwordMatches = await comparePassword(password, dbUser.passwordHash);
        }

        if (!passwordMatches) {
          // Increment failed attempts
          dbUser.failedLoginAttempts = (dbUser.failedLoginAttempts || 0) + 1;
          if (dbUser.failedLoginAttempts >= 5) {
            dbUser.lockUntil = new Date(Date.now() + 15 * 60 * 1000);
            logger.warn(`[IM_AUTH] Account "${dbUser.username}" locked for 15 minutes after 5 failed attempts.`);
          }
          if (typeof dbUser.save === 'function') {
            await dbUser.save();
          }
          return res.status(401).json({ message: 'Invalid Login ID or password.' });
        }

        // Success - reset attempts
        dbUser.failedLoginAttempts = 0;
        dbUser.lockUntil = null;
        dbUser.lastLoginAt = new Date();
        if (typeof dbUser.save === 'function') {
          await dbUser.save();
        }

        const token = signToken(
          {
            username: dbUser.username,
            displayName: dbUser.displayName || dbUser.username,
            role: dbUser.role || 'INVESTOR_MISSION_ADMIN',
            allowedEvents: dbUser.allowedEvents || ['INVESTOR_MISSION_2026'],
          },
          jwtSecret,
          {
            algorithm: 'HS256',
            subject: dbUser._id ? dbUser._id.toString() : 'investor-mission-admin',
            issuer: ADMIN_JWT_ISSUER,
            expiresIn: SESSION_SECONDS,
          }
        );

        logger.info(`[IM_AUTH] Admin "${dbUser.username}" logged in successfully.`);
        return res.json({
          token,
          tokenType: 'Bearer',
          expiresInSeconds: SESSION_SECONDS,
          role: dbUser.role || 'INVESTOR_MISSION_ADMIN',
          username: dbUser.username,
          displayName: dbUser.displayName || dbUser.username,
        });
      }

      // Environment Fallback when DB user is not yet seeded
      const envUsername = (readFirstDefined(environment, ['INVESTOR_MISSION_ADMIN_USERNAME']) || 'SIO Coimbatore').toLowerCase();
      const envPassword = readFirstDefined(environment, ['INVESTOR_MISSION_ADMIN_PASSWORD']) || 'SIOCoimbatore@2026';
      const envPasswordHash = readFirstDefined(environment, ['INVESTOR_MISSION_ADMIN_PASSWORD_HASH']);

      if (usernameLower === envUsername) {
        let envPasswordMatches = false;
        if (envPasswordHash && /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(envPasswordHash)) {
          envPasswordMatches = await comparePassword(password, envPasswordHash);
        } else {
          envPasswordMatches = password === envPassword;
        }

        if (envPasswordMatches) {
          const token = signToken(
            {
              username: 'SIO Coimbatore',
              displayName: 'SIO Coimbatore',
              role: 'INVESTOR_MISSION_ADMIN',
              allowedEvents: ['INVESTOR_MISSION_2026'],
            },
            jwtSecret,
            {
              algorithm: 'HS256',
              subject: 'investor-mission-admin',
              issuer: ADMIN_JWT_ISSUER,
              expiresIn: SESSION_SECONDS,
            }
          );
          logger.info(`[IM_AUTH] Admin "SIO Coimbatore" authenticated via environment credentials.`);
          return res.json({
            token,
            tokenType: 'Bearer',
            expiresInSeconds: SESSION_SECONDS,
            role: 'INVESTOR_MISSION_ADMIN',
            username: 'SIO Coimbatore',
            displayName: 'SIO Coimbatore',
          });
        }
      }

      return res.status(401).json({ message: 'Invalid Login ID or password.' });
    } catch (error) {
      logger.error('Investor Mission admin login failed:', error.message);
      return res.status(500).json({ message: 'Authentication is temporarily unavailable.' });
    }
  }

  /**
   * Password Change for Investor Mission Admin
   */
  async function changePassword(req, res) {
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Current password and new password are required.' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ message: 'New password must be at least 8 characters long.' });
    }

    try {
      const usernameLower = String(req.admin?.username || '').toLowerCase();
      let user = null;
      if (adminUserModel && typeof adminUserModel.findOne === 'function') {
        user = await adminUserModel.findOne({ usernameLower });
      }

      if (!user) {
        return res.status(404).json({ message: 'Admin account record not found in database.' });
      }

      let currentMatches = false;
      if (typeof user.comparePassword === 'function') {
        currentMatches = await user.comparePassword(currentPassword);
      } else {
        currentMatches = await comparePassword(currentPassword, user.passwordHash);
      }

      if (!currentMatches) {
        return res.status(400).json({ message: 'Current password does not match.' });
      }

      user.passwordHash = await bcrypt.hash(newPassword, 12);
      user.failedLoginAttempts = 0;
      user.lockUntil = null;
      if (typeof user.save === 'function') {
        await user.save();
      }

      logger.info(`[IM_AUTH] Password updated successfully for admin "${user.username}".`);
      return res.json({ success: true, message: 'Password updated successfully.' });
    } catch (error) {
      logger.error('Password change failed:', error.message);
      return res.status(500).json({ message: 'Failed to update password.' });
    }
  }

  function getSession(req, res) {
    return res.json({
      authenticated: true,
      role: req.admin.role,
      email: req.admin.email || '',
      username: req.admin.username || req.admin.email || '',
      displayName: req.admin.displayName || req.admin.username || 'Admin',
      allowedEvents: req.admin.allowedEvents || (req.admin.role === 'ROLE_ADMIN' ? ['ALL'] : ['INVESTOR_MISSION_2026']),
    });
  }

  return { login, loginInvestorMissionAdmin, changePassword, getSession };
}

const defaultAdminAuthController = createAdminAuthController();

module.exports = {
  SESSION_SECONDS,
  getMissingAuthConfiguration,
  createAdminAuthController,
  ...defaultAdminAuthController,
};