require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const nodemailer = require('nodemailer');

const app = express();

async function verifySmtpConfiguration() {
  const host = process.env.SMTP_HOST || process.env.MAIL_HOST;
  const port = Number(process.env.SMTP_PORT || process.env.MAIL_PORT || 587);
  const username = process.env.SMTP_USER || process.env.SMTP_USERNAME || process.env.MAIL_USERNAME || process.env.MAIL_USER;
  const password = process.env.SMTP_PASS || process.env.SMTP_PASSWORD || process.env.MAIL_PASS || process.env.MAIL_PASSWORD;
  const useSecureSocket = String(process.env.SMTP_SECURE || process.env.MAIL_SECURE || 'false').toLowerCase() === 'true';

  if (!host || !username || !password || !Number.isInteger(port) || port < 1) {
    console.warn('SMTP configuration is incomplete. Email delivery will remain disabled until real SMTP credentials are set.');
    return;
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: useSecureSocket || port === 465,
    requireTLS: !useSecureSocket && port !== 465,
    auth: { user: username, pass: password },
  });

  try {
    await transporter.verify();
    console.log('SMTP verification successful');
  } catch (error) {
    console.error('SMTP verification failed:', {
      code: error.code || 'SMTP_VERIFY_FAILED',
      host,
      port,
      secure: useSecureSocket || port === 465,
      username,
      message: error.message || 'Authentication failed',
    });
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
app.use(cors(corsOptions));
app.use(express.json());

// Basic Route for testing
app.get('/api/status', (req, res) => res.json({ status: 'API is running' }));

// Registration Routes
const apiRoutes = require('./routes/api');
app.use('/api/admin', require('./routes/admin'));
app.use('/api', apiRoutes);

const PORT = process.env.PORT || 5000;

if (!process.env.MONGODB_URI) {
  console.error('MONGODB_URI is required. Set it in the environment before starting the server.');
  process.exitCode = 1;
} else {
  mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log('MongoDB Connected successfully');
    await verifySmtpConfiguration();
    app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
  })
  .catch(err => console.error('MongoDB connection error:', err));
}
