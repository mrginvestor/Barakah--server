const jwt = require('jsonwebtoken');

const ADMIN_JWT_ISSUER = 'halal-wealth-admin';

function createRequireAdmin({
  verifyToken = jwt.verify,
  getSecret = () => process.env.JWT_SECRET || process.env.ADMIN_JWT_SECRET || process.env.TOKEN_SECRET,
  allowedRoles = ['ROLE_ADMIN'],
  logger = console,
} = {}) {
  const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];

  return (req, res, next) => {
    const authorization = req.get('authorization') || '';
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      return res.status(401).json({ message: 'Authentication is required.' });
    }

    const secret = getSecret();
    if (!secret || secret.length < 32) {
      const safeErrorLog = (logger && typeof logger.error === 'function') ? logger.error.bind(logger) : console.error;
      safeErrorLog('Admin token verification failed: JWT_SECRET is missing or shorter than 32 characters in environment variables.');
      return res.status(503).json({ message: 'Admin authentication is temporarily unavailable.' });
    }

    let claims;
    try {
      claims = verifyToken(match[1], secret, {
        issuer: ADMIN_JWT_ISSUER,
        algorithms: ['HS256'],
      });
    } catch {
      return res.status(401).json({ message: 'Your admin session is invalid or has expired.' });
    }

    if (!roles.includes(claims.role)) {
      return res.status(403).json({ message: 'Admin permission is required.' });
    }

    if (claims.role === 'ROLE_ADMIN') {
      if (claims.sub !== 'admin' || !claims.email) {
        return res.status(401).json({ message: 'Your admin session is invalid or has expired.' });
      }
    } else {
      if (!claims.sub || (!claims.email && !claims.username)) {
        return res.status(401).json({ message: 'Your admin session is invalid or has expired.' });
      }
    }

    req.admin = {
      email: claims.email || '',
      role: claims.role,
      ...(claims.username ? { username: claims.username } : {}),
      ...(claims.displayName ? { displayName: claims.displayName } : {}),
      ...(claims.allowedEvents ? { allowedEvents: claims.allowedEvents } : {}),
    };
    return next();
  };
}

const requireAdmin = createRequireAdmin({ allowedRoles: ['ROLE_ADMIN'] });
const requireInvestorMissionAdmin = createRequireAdmin({
  allowedRoles: ['ROLE_ADMIN', 'INVESTOR_MISSION_ADMIN'],
});

module.exports = {
  ADMIN_JWT_ISSUER,
  createRequireAdmin,
  requireAdmin,
  requireInvestorMissionAdmin,
};