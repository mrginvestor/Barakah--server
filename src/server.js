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
  const resendApiKey = process.env.RESEND_API_KEY;
  if (resendApiKey) {
    if (isPlaceholder(resendApiKey)) {
      console.warn('RESEND_API_KEY contains a placeholder value. Please set a valid Resend API key.');
      return;
    }
    const fromAddress = process.env.RESEND_FROM || process.env.MAIL_FROM || 'info@halalwealth.finance';
    console.log(`Email service configured with Resend HTTP API (sender: ${fromAddress})`);
    return;
  }

  const host = process.env.SMTP_HOST || process.env.MAIL_HOST;
  if (!host) {
    console.warn('Email service: Neither RESEND_API_KEY nor SMTP credentials are set. Set RESEND_API_KEY in Render environment variables for HTTP email delivery.');
    return;
  }

  if (process.env.RENDER || process.env.NODE_ENV === 'production') {
    console.warn(`[NOTICE] Render Free blocks outbound SMTP ports 25, 465, and 587. Email delivery to ${host} will stall unless RESEND_API_KEY is configured for HTTP API delivery.`);
  }

  if (process.env.ENABLE_SMTP_STARTUP_VERIFY === 'true') {
    const port = Number(process.env.SMTP_PORT || process.env.MAIL_PORT || (host.includes('hostinger') ? 465 : 587));
    const username = process.env.SMTP_USER || process.env.SMTP_USERNAME || process.env.MAIL_USERNAME || process.env.MAIL_USER;
    const password = process.env.SMTP_PASS || process.env.SMTP_PASSWORD || process.env.MAIL_PASS || process.env.MAIL_PASSWORD;
    const useSecureSocket = String(process.env.SMTP_SECURE || process.env.MAIL_SECURE || (port === 465 ? 'true' : 'false')).toLowerCase() === 'true';

    if (!username || !password || !Number.isInteger(port) || port < 1 || isPlaceholder(password)) {
      return;
    }

    const isSecure = useSecureSocket || port === 465;
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: isSecure,
      requireTLS: !isSecure && port !== 465,
      auth: { user: username, pass: password },
      family: 4,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });

    try {
      await transporter.verify();
      console.log(`SMTP connected successfully to ${host}:${port} (${username})`);
    } catch (error) {
      console.warn('SMTP verification notice:', {
        code: error.code || 'SMTP_VERIFY_FAILED',
        host,
        port,
        secure: isSecure,
        username,
        message: error.message || 'Authentication failed',
      });
    }
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
app.use(express.json());

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
    app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
    // Run SMTP verification asynchronously in background so HTTP server is immediately responsive
    verifyEmailConfiguration().catch(err => {
      console.warn('Background SMTP verification notice:', err?.message || err);
    });
  })
  .catch(err => console.error('MongoDB connection error:', err));
}
