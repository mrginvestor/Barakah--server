const bcrypt = require('bcryptjs');
const AdminUser = require('../models/AdminUser');

const DEFAULT_USERNAME = 'SIO Coimbatore';
const DEFAULT_DISPLAY_NAME = 'SIO Coimbatore';
const DEFAULT_ROLE = 'INVESTOR_MISSION_ADMIN';
const DEFAULT_ALLOWED_EVENTS = ['INVESTOR_MISSION_2026'];
const BCRYPT_ROUNDS = 12;

/**
 * Ensures the dedicated SIO Coimbatore administrator account exists in MongoDB
 * without altering or replacing any existing accounts.
 */
async function bootstrapInvestorMissionAdmin({
  customPassword,
  forceUpdate = false,
  logger = console,
} = {}) {
  const username = (process.env.INVESTOR_MISSION_ADMIN_USERNAME || DEFAULT_USERNAME).trim();
  const usernameLower = username.toLowerCase();
  const displayName = (process.env.INVESTOR_MISSION_ADMIN_NAME || DEFAULT_DISPLAY_NAME).trim();
  const password = customPassword || process.env.INVESTOR_MISSION_ADMIN_PASSWORD || 'SIOCoimbatore@2026';

  try {
    const existing = await AdminUser.findOne({ usernameLower });
    if (existing) {
      if (forceUpdate) {
        const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
        existing.passwordHash = passwordHash;
        existing.displayName = displayName;
        existing.role = DEFAULT_ROLE;
        existing.isActive = true;
        existing.failedLoginAttempts = 0;
        existing.lockUntil = null;
        await existing.save();
        logger.info(`[ADMIN_BOOTSTRAP] Updated existing ${DEFAULT_ROLE} account for "${username}".`);
        return { created: false, updated: true, user: existing };
      }
      logger.info(`[ADMIN_BOOTSTRAP] ${DEFAULT_ROLE} account for "${username}" already exists. Duplicate creation prevented.`);
      return { created: false, updated: false, user: existing };
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const newUser = await AdminUser.create({
      username,
      usernameLower,
      displayName,
      passwordHash,
      role: DEFAULT_ROLE,
      allowedEvents: DEFAULT_ALLOWED_EVENTS,
      isActive: true,
      failedLoginAttempts: 0,
      lockUntil: null,
    });

    logger.info(`[ADMIN_BOOTSTRAP] Created new ${DEFAULT_ROLE} account for "${username}" successfully.`);
    return { created: true, updated: false, user: newUser };
  } catch (error) {
    logger.error(`[ADMIN_BOOTSTRAP] Failed to bootstrap Investor Mission admin account:`, error.message);
    throw error;
  }
}

module.exports = {
  DEFAULT_USERNAME,
  DEFAULT_DISPLAY_NAME,
  DEFAULT_ROLE,
  bootstrapInvestorMissionAdmin,
};
