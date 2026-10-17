const mongoose = require('mongoose');

const webinarRegistrationSchema = new mongoose.Schema({
  fullName: { type: String, required: true, trim: true },
  whatsapp: { type: String, required: true, trim: true },
  email: { type: String, required: true, trim: true, lowercase: true },
  location: { type: String, default: '', trim: true },
  designation: { type: String, required: true, trim: true },
  industry: { type: String, required: true, trim: true },
  financialInterests: { type: [String], required: true, enum: ['Financial Planning', 'Loans and Financing', 'Investments and Wealth Management', 'Business Ethics', 'Others'], validate: {
    validator: values => Array.isArray(values) && values.length >= 1,
    message: 'Select at least one financial topic.',
  } },
  otherFinancialInterest: { type: String, default: '', trim: true },
  financialChallenge: { type: String, default: '' },
  webinarSource: { type: String, required: true, trim: true },
  consent: { type: Boolean, required: true },
  status: { type: String, enum: ['New', 'Registered', 'Confirmed', 'Attended', 'Cancelled'], default: 'Registered' },
  confirmationEmailSent: { type: Boolean, default: false },
  confirmationEmailSentAt: { type: Date, default: null },
  confirmationEmailLastError: { type: String, default: null },
  announcementEmailSent: { type: Boolean, default: false },
  announcementEmailSentAt: { type: Date, default: null },
  announcementEmailLastError: { type: String, default: null },
  joiningEmailSent: { type: Boolean, default: false },
  joiningEmailSentAt: { type: Date, default: null },
  joiningEmailLastError: { type: String, default: null },
  reminderEmailSent: { type: Boolean, default: false },
  reminderEmailSentAt: { type: Date, default: null },
  reminderEmailLastError: { type: String, default: null },
  registrationId: { type: String, default: null, trim: true },
}, { timestamps: true });

webinarRegistrationSchema.index({ email: 1 });
webinarRegistrationSchema.index({ createdAt: -1 });
webinarRegistrationSchema.index({ status: 1, createdAt: -1 });
webinarRegistrationSchema.index({ registrationId: 1 });

module.exports = mongoose.model('WebinarRegistration', webinarRegistrationSchema);
