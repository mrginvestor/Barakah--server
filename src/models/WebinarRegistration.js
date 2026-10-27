const mongoose = require('mongoose');

const webinarRegistrationSchema = new mongoose.Schema({
  fullName: { type: String, required: true, trim: true },
  whatsapp: { type: String, required: true, trim: true },
  email: { type: String, required: true, trim: true, lowercase: true },
  location: { type: String, default: '', trim: true },
  country: { type: String, default: '', trim: true },
  state: { type: String, default: '', trim: true },
  city: { type: String, default: '', trim: true },
  ageGroup: { type: String, default: '', trim: true },
  otherAgeGroup: { type: String, default: '', trim: true },
  designation: { type: String, required: true, trim: true },
  occupation: { type: String, default: '', trim: true },
  otherOccupation: { type: String, default: '', trim: true },
  industry: { type: String, default: '', trim: true },
  companyName: { type: String, default: '', trim: true },
  businessWebsite: { type: String, default: '', trim: true },
  financialInterests: {
    type: [String],
    required: true,
    validate: {
      validator: values => Array.isArray(values) && values.length >= 1,
      message: 'Select at least one financial topic.',
    },
  },
  otherFinancialInterest: { type: String, default: '', trim: true },
  additionalInfo: { type: String, default: '', trim: true },
  financialChallenge: { type: String, default: '' },
  questionsOrTopics: { type: String, default: '', trim: true },
  webinarSource: { type: String, default: 'Website', trim: true },
  otherWebinarSource: { type: String, default: '', trim: true },
  webinarId: { type: String, default: 'halal-wealth-nov-2026', trim: true },
  webinarVersion: { type: String, default: 'November 1, 2026 Webinar', trim: true },
  consent: { type: Boolean, default: true },
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
  feedbackEmailSent: { type: Boolean, default: false },
  feedbackEmailSentAt: { type: Date, default: null },
  feedbackEmailLastError: { type: String, default: null },
  registrationId: { type: String, default: null, trim: true },
  referenceId: { type: String, default: null, trim: true },
}, { timestamps: true });

webinarRegistrationSchema.index({ email: 1 });
webinarRegistrationSchema.index({ createdAt: -1 });
webinarRegistrationSchema.index({ status: 1, createdAt: -1 });
webinarRegistrationSchema.index({ registrationId: 1 });
webinarRegistrationSchema.index({ referenceId: 1 }, { sparse: true });
webinarRegistrationSchema.index({ feedbackEmailSent: 1 });
webinarRegistrationSchema.index({ webinarVersion: 1, createdAt: -1 });
webinarRegistrationSchema.index({ webinarId: 1, createdAt: -1 });
webinarRegistrationSchema.index({ email: 1, webinarId: 1 });

module.exports = mongoose.model('WebinarRegistration', webinarRegistrationSchema);
