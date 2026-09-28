require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');

const app = express();

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
app.use('/api', apiRoutes);

const PORT = process.env.PORT || 5000;

if (!process.env.MONGODB_URI) {
  console.error('MONGODB_URI is required. Set it in the environment before starting the server.');
  process.exitCode = 1;
} else {
  mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('MongoDB Connected successfully');
    app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
  })
  .catch(err => console.error('MongoDB connection error:', err));
}
