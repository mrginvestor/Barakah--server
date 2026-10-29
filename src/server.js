require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const nodemailer = require('nodemailer');

const app = express();

function isPlaceholder(value) {
  if (!value) return true;
  const s = String(value).trim();
  return /^(REPLACE_|YOUR_|YOUR-|<)/i.test(s) || s === 'pass' || s === 'user';
}

async function verifyEmailConfiguration() {
  const { verifyEmailService } = require('./services/webinarEmailService');
  try {
    const diagnostic = await verifyEmailService({ timeoutMs: 8000 });
    if (diagnostic.ok) {
      console.log(`SMTP connected successfully to ${diagnostic.host}:${diagnostic.port} (${diagnostic.authenticatedUser}) via ${diagnostic.transport}`);
    } else {
      console.warn('SMTP verification notice:', {
        code: diagnostic.code,
        errorCategory: diagnostic.errorCategory,
        timeoutCategory: diagnostic.timeoutCategory || null,
        host: diagnostic.host,
        port: diagnostic.port,
        secure: diagnostic.secure,
        message: diagnostic.errorMessage || diagnostic.message,
      });
    }
  } catch (err) {
    console.warn('Background SMTP verification notice:', err?.message || err);
  }
}
app.use(helmet());
const parseOrigins = value => String(value || '')
  .split(',')
  .map(origin => origin.trim().replace(/\/+$/, ''))
  .filter(Boolean);
const isProduction = process.env.NODE_ENV === 'production';
const isLocalOrigin = origin => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
const configuredFrontendOrigins = parseOrigins(process.env.FRONTEND_URLS);
const productionOrigins = configuredFrontendOrigins.filter(origin => !isLocalOrigin(origin));
const legacyClientOrigins = parseOrigins(process.env.CLIENT_URL)
  .filter(origin => !isProduction || !isLocalOrigin(origin));
const defaultOrigins = isProduction
  ? (productionOrigins.length ? productionOrigins : [
    'https://www.halalwealth.finance',
    'https://halalwealth.finance',
    'https://barakah-client-eta.vercel.app',
  ])
  : [
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:3000',
  ];
const allowedOrigins = new Set([
  ...defaultOrigins,
  ...(!isProduction ? configuredFrontendOrigins : []),
  ...legacyClientOrigins,
]);
const corsOptions = {
  origin: (requestOrigin, callback) => {
    if (!requestOrigin || allowedOrigins.has(requestOrigin)) {
      callback(null, true);
      return;
    }

    console.warn(`Blocked CORS request from origin: ${requestOrigin}`);
    callback(new Error('Origin not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false,
  optionsSuccessStatus: 204,
};
app.set('trust proxy', 1);
app.use(cors(corsOptions));
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  },
}));

// Basic Route for testing
app.get('/api/status', (req, res) => res.json({ status: 'API is running' }));

// Registration Routes
const apiRoutes = require('./routes/api');
app.use('/api/admin', require('./routes/admin'));
app.use('/api', apiRoutes);

function verifyAdminAuthConfiguration() {
  const { getMissingAuthConfiguration } = require('./controllers/adminAuthController');
  const missing = getMissingAuthConfiguration(process.env);
  if (missing.length > 0) {
    console.warn(`Admin authentication configuration notice: ${missing.join(', ')} is missing. Admin login will remain disabled until set in environment variables.`);
  } else {
    const adminEmail = process.env.ADMIN_EMAIL || process.env.ADMIN_USER_EMAIL || process.env.ADMIN_USERNAME;
    console.log(`Admin authentication configured successfully for ${adminEmail}`);
  }
}

const PORT = process.env.PORT || 5000;

if (!process.env.MONGODB_URI) {
  console.error('MONGODB_URI is required. Set it in the environment before starting the server.');
  process.exitCode = 1;
} else {
  mongoose.connect(process.env.MONGODB_URI, {
    maxPoolSize: 10,
    minPoolSize: 2,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  })
  .then(() => {
    console.log('MongoDB Connected successfully');
    verifyAdminAuthConfiguration();
    const { defaultBulkEmailService } = require('./services/bulkEmailService');
    defaultBulkEmailService.recoverStalledJobs().catch(err => {
      console.warn('Background bulk email recovery notice:', err?.message || err);
    });
    app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
    // Run SMTP verification asynchronously in background so HTTP server is immediately responsive
    verifyEmailConfiguration().catch(err => {
      console.warn('Background SMTP verification notice:', err?.message || err);
    });
  })
  .catch(err => console.error('MongoDB connection error:', err));
}
