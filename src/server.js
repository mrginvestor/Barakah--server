const path = require('path');
// Ensure dotenv loads server/.env reliably whether launched from root, server, or subfolder
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const nodemailer = require('nodemailer');
const {
  maskMongoUri,
  getMongoConnectionOptions,
  logMongoConnectionError,
  setupMongoConnectionEvents,
} = require('./utils/mongoConnection');

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
app.set('trust proxy', 1);

// --- CORS Configuration (registered BEFORE helmet and API routes) ---
const parseOrigins = value => String(value || '')
  .split(',')
  .map(origin => origin.trim().replace(/\/+$/, ''))
  .filter(Boolean);

const configuredFrontendOrigins = [
  ...parseOrigins(process.env.FRONTEND_URLS),
  ...parseOrigins(process.env.CLIENT_URL),
];

// Production domains and standard local origins are ALWAYS explicitly allowed
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

const allowedOriginsSet = new Set(
  [...KNOWN_ALLOWED_ORIGINS, ...configuredFrontendOrigins].map(o => o.toLowerCase())
);

const isAllowedOrigin = (requestOrigin) => {
  if (!requestOrigin) return true; // allow same-origin, curl, server-to-server, Postman
  const normalized = String(requestOrigin).trim().toLowerCase().replace(/\/+$/, '');
  
  if (allowedOriginsSet.has(normalized)) return true;

  // Pattern matching: allow halalwealth.finance and any subdomains (e.g. www.halalwealth.finance)
  if (/^https?:\/\/([a-z0-9-]+\.)*halalwealth\.finance$/i.test(normalized)) {
    return true;
  }

  // Allow localhost / 127.0.0.1 on any port for local development and testing
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(normalized)) {
    return true;
  }

  return false;
};

const corsOptions = {
  origin: (requestOrigin, callback) => {
    if (isAllowedOrigin(requestOrigin)) {
      callback(null, true);
    } else {
      console.warn(`[CORS] Blocked request from unauthorized origin: ${requestOrigin}`);
      callback(null, false);
    }
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  credentials: true,
  optionsSuccessStatus: 204,
  maxAge: 86400, // cache preflight response for 24 hours
};

// Apply CORS middleware first
app.use(cors(corsOptions));

// Explicitly handle all OPTIONS preflight requests before any route or security middleware
app.options('*', cors(corsOptions));

// Apply Helmet security headers with crossOriginResourcePolicy allowing cross-origin API calls
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  },
}));

// Static Assets
app.use('/assets', express.static(path.join(__dirname, '../assets')));

// Basic Route for testing
app.get('/api/status', (req, res) => res.json({ status: 'API is running' }));

// Registration Routes
const apiRoutes = require('./routes/api');
app.use('/api/admin', require('./routes/admin'));
app.use('/api', apiRoutes);

// Express Error Handling Middleware with CORS preservation
app.use((err, req, res, next) => {
  const requestOrigin = req.headers.origin;
  if (requestOrigin && isAllowedOrigin(requestOrigin)) {
    res.setHeader('Access-Control-Allow-Origin', requestOrigin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }
  const statusCode = err.status || err.statusCode || 500;
  console.error(`[API ERROR] ${req.method} ${req.originalUrl}:`, err.message || err);
  res.status(statusCode).json({
    success: false,
    message: err.message || 'An internal server error occurred.',
  });
});

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
  console.error('Expected location: server/.env or system environment variable MONGODB_URI.');
  process.exitCode = 1;
} else {
  // Register runtime connection lifecycle event listeners
  setupMongoConnectionEvents(mongoose);

  const mongoOptions = getMongoConnectionOptions();
  console.log(`Connecting to MongoDB Atlas (${maskMongoUri(process.env.MONGODB_URI)}) [timeout: ${mongoOptions.serverSelectionTimeoutMS}ms]...`);

  mongoose.connect(process.env.MONGODB_URI, mongoOptions)
  .then(() => {
    console.log('MongoDB Connected successfully');
    verifyAdminAuthConfiguration();
    const { bootstrapInvestorMissionAdmin } = require('./utils/bootstrapAdminAccounts');
    bootstrapInvestorMissionAdmin({ logger: console }).catch(err => {
      console.warn('[ADMIN_BOOTSTRAP] Warning:', err?.message || err);
    });
    const { defaultBulkEmailService } = require('./services/bulkEmailService');
    defaultBulkEmailService.recoverStalledJobs().catch(err => {
      console.warn('Background bulk email recovery notice:', err?.message || err);
    });
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running on port ${PORT}`);
      // Run SMTP verification asynchronously in background so HTTP server is immediately responsive
      verifyEmailConfiguration().catch(err => {
        console.warn('Background SMTP verification notice:', err?.message || err);
      });
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error('\n' + '='.repeat(70));
        console.error(`[FATAL ERROR] Port ${PORT} is already in use by another running process.`);
        console.error(`Address: 0.0.0.0:${PORT}`);
        console.error('The backend cannot start because another instance or process has bound this port.');
        console.error('\nTo identify and terminate the process holding port ' + PORT + ':');
        console.error(`  PowerShell (Windows):`);
        console.error(`    Stop-Process -Id (Get-NetTCPConnection -LocalPort ${PORT}).OwningProcess -Force`);
        console.error(`  Command Prompt (CMD):`);
        console.error(`    netstat -ano | findstr :${PORT}`);
        console.error(`    taskkill /PID <PID> /F`);
        console.error(`  Linux / macOS:`);
        console.error(`    lsof -i :${PORT} | awk 'NR>1 {print $2}' | xargs kill -9`);
        console.error('='.repeat(70) + '\n');
        process.exit(1);
      } else {
        console.error(`[FATAL ERROR] Server error on port ${PORT}:`, err);
        process.exit(1);
      }
    });
  })
  .catch(err => {
    process.exitCode = 1;
    logMongoConnectionError(err, process.env.MONGODB_URI);
  });
}
