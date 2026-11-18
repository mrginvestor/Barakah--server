const mongoose = require('mongoose');

const smallSummitRegistrationSchema = new mongoose.Schema({
  // Unique small summit registration sequence (e.g. SS26-00001)
  registrationId: { type: String, required: true, unique: true, trim: true },

  // Participant Personal Information
  fullName: { type: String, required: true, trim: true, minlength: 3 },
  name: { type: String, trim: true },
  email: { type: String, required: true, trim: true, lowercase: true },
  mobileNumber: { type: String, required: true, trim: true },
  phone: { type: String, trim: true },
  countryCode: { type: String, trim: true, default: '+91' },

  // Geographical Location
  state: { type: String, required: true, trim: true },
  district: { type: String, required: true, trim: true },
  city: { type: String, required: true, trim: true },
  country: { type: String, trim: true, default: 'India' },

  // Professional Background
  occupation: {
    type: String,
    required: true,
    trim: true,
    enum: [
      'Business Owner',
      'Entrepreneur',
      'Student',
      'Employee',
      'Professional',
      'Investor',
      'Other',
    ],
  },
  otherOccupation: { type: String, trim: true, default: '' },
  organization: { type: String, trim: true, default: '' },
  companyName: { type: String, trim: true, default: '' },

  // Participant Expectations from the Session (Mandatory textarea)
  sessionExpectations: { type: String, required: true, trim: true, minlength: 5 },

  // Fee, Payment Method and Seat Reservation Management (₹500 per seat, strict 50 capacity)
  registrationFee: { type: Number, default: 500 },
  paymentAmount: { type: Number, default: 500 },
  paymentMethod: {
    type: String,
    enum: ['ONLINE', 'OFFLINE'],
    default: 'ONLINE',
    required: true,
  },
  registrationStatus: {
    type: String,
    enum: ['PENDING_PAYMENT', 'PENDING_APPROVAL', 'CONFIRMED', 'REJECTED'],
    default: 'PENDING_PAYMENT',
  },
  paymentStatus: {
    type: String,
    enum: [
      'PENDING',
      'PENDING_PAYMENT',
      'PENDING_VERIFICATION',
      'PENDING_OFFLINE_PAYMENT',
      'PAID',
      'REJECTED',
      'EXPIRED',
    ],
    default: 'PENDING_PAYMENT',
  },
  reservationExpiresAt: { type: Date, default: null },

  // Two-Step Approval Flags (Both required for confirmed seat)
  registrationApproved: { type: Boolean, default: false },
  registrationApprovedAt: { type: Date, default: null },
  registrationApprovedBy: { type: String, default: null },
  paymentApproved: { type: Boolean, default: false },
  paymentApprovedAt: { type: Date, default: null },
  paymentApprovedBy: { type: String, default: null },
  approvedAt: { type: Date, default: null },

  // Offline Payment Details
  offlinePaymentRecorded: { type: Boolean, default: false },
  offlinePaymentMethod: { type: String, default: '', trim: true },
  offlinePaymentDate: { type: Date, default: null },
  offlinePaymentRecordedBy: { type: String, default: null },
  adminVerificationNotes: { type: String, default: '', trim: true },

  // Payment Verification & Receipt Details
  paymentScreenshot: { type: String, default: null },
  paymentScreenshotMimeType: { type: String, default: null },
  paymentScreenshotSize: { type: Number, default: null },
  upiTransactionId: { type: String, default: null, trim: true },
  paymentDate: { type: Date, default: null },
  paymentNotes: { type: String, default: '', trim: true },

  // Administrative Verification Details
  status: {
    type: String,
    enum: ['Pending', 'Confirmed', 'Checked-In', 'Rejected', 'Expired'],
    default: 'Pending',
  },
  adminNotes: { type: String, default: '', trim: true },
  rejectionReason: { type: String, default: '', trim: true },
  paymentVerifiedAt: { type: Date, default: null },
  paymentVerifiedBy: { type: String, default: null },

  // Terms and Consent
  termsAccepted: { type: Boolean, default: true },

  // Email Notifications & Status
  confirmationEmailStatus: {
    type: String,
    enum: ['NOT_SENT', 'SENT', 'FAILED'],
    default: 'NOT_SENT',
  },
  confirmationEmailSent: { type: Boolean, default: false },
  confirmationEmailSentAt: { type: Date, default: null },
  confirmationEmailLastError: { type: String, default: null },

  // Registration Received Acknowledgement Email
  acknowledgementEmailStatus: {
    type: String,
    enum: ['NOT_SENT', 'SENT', 'FAILED'],
    default: 'NOT_SENT',
  },
  acknowledgementEmailSent: { type: Boolean, default: false },
  acknowledgementEmailSentAt: { type: Date, default: null },
  acknowledgementEmailLastError: { type: String, default: null },

  // Secure Event Check-In & Attendance
  checkInToken: { type: String, default: null },
  checkInTokenHash: { type: String, default: null, trim: true },
  attendanceStatus: {
    type: String,
    enum: ['NOT_CHECKED_IN', 'CHECKED_IN'],
    default: 'NOT_CHECKED_IN',
  },
  checkedInAt: { type: Date, default: null },
  checkedInBy: { type: String, default: null, trim: true },
}, { timestamps: true });

// Efficient indexes for capacity calculation and admin search
smallSummitRegistrationSchema.index({ paymentStatus: 1, reservationExpiresAt: 1 });
smallSummitRegistrationSchema.index({ status: 1 });
smallSummitRegistrationSchema.index({ paymentMethod: 1 });
smallSummitRegistrationSchema.index({ registrationStatus: 1 });
smallSummitRegistrationSchema.index({ registrationApproved: 1, paymentApproved: 1 });
smallSummitRegistrationSchema.index({ checkInTokenHash: 1 }, { unique: true, sparse: true });
smallSummitRegistrationSchema.index({ attendanceStatus: 1 });
smallSummitRegistrationSchema.index({ createdAt: -1 });

module.exports = mongoose.model(
  'SmallSummitRegistration',
  smallSummitRegistrationSchema,
  'smallsummitregistrations'
);
