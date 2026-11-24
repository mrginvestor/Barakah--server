/**
 * Central Summit Event and UPI Payment Configuration
 *
 * Configurable parameters for the Halal Wealth DEC Summit.
 * Sensitive or deployment-specific values can be overridden via environment variables.
 */

const SUMMIT_CONFIG = {
  eventName: 'DEC Summit',
  eventTitle: 'Halal Wealth DEC Summit',
  subtitle: 'Join an exclusive gathering focused on Islamic finance, halal wealth and financial awareness. Limited to 80 participants.',
  maxCapacity: 80,
  registrationFee: 500,
  currency: 'INR',
  currencySymbol: '₹',

  // Reservation hold duration for participants completing UPI payment
  reservationTimeoutMinutes: 30,

  // Exact DEC Summit Payment Details
  accountHolderName: process.env.SUMMIT_ACCOUNT_HOLDER_NAME || 'ANAS RAHMAN H',
  upiId: process.env.SUMMIT_UPI_ID || '6380413253@ybl',
  phoneNumber: process.env.SUMMIT_PHONE || '6380413253',
  upiQrCode: process.env.SUMMIT_UPI_QR_CODE || '/assets/phonepe-qr.jpg',

  // Upload limits
  maxScreenshotSizeBytes: 5 * 1024 * 1024, // 5 MB
  allowedMimeTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
};

module.exports = SUMMIT_CONFIG;
