const jwt = require('jsonwebtoken');

const ADMIN_JWT_ISSUER = 'halal-wealth-admin';

function createRequireAdmin({ verifyToken = jwt.verify, getSecret = () => process.env.JWT_SECRET } = {}) {
  return (req, res, next) => {
    const authorization = req.get('authorization') || '';
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      return res.status(401).json({ message: 'Authentication is required.' });
    }

    const secret = getSecret();
    if (!secret || secret.length < 32) {
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

    if (claims.role !== 'ROLE_ADMIN') {
      return res.status(403).json({ message: 'Admin permission is required.' });
    }
    if (claims.sub !== 'admin' || !claims.email) {
      return res.status(401).json({ message: 'Your admin session is invalid or has expired.' });
    }

    req.admin = { email: claims.email, role: claims.role };
    return next();
  };
}

module.exports = { ADMIN_JWT_ISSUER, createRequireAdmin, requireAdmin: createRequireAdmin() };