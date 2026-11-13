const mongoose = require('mongoose');

const registrationSchema = new mongoose.Schema({
  // Unique summit registration sequence (e.g. HWS26-00031)
  registrationId: { type: String, required: true, unique: true, trim: true },

  // Participant Personal Information
  fullName: { type: String, required: true, trim: true },
  name: { type: String, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  phone: { type: String, trim: true },
  countryCode: { type: String, required: true, default: '+91', trim: true },
  whatsappNumber: { type: String, required: true, trim: true },
  ageGroup: { type: String, enum: ['18-24', '25-34', '35-44', '45-54', '55+'], required: true },
  gender: { type: String, enum: ['Male', 'Female', 'Prefer not to say'], required: true },

  // Geographical Location
  city: { type: String, required: true, trim: true },
  state: { type: String, required: true, trim: true },
  country: { type: String, required: true, trim: true, default: 'India' },

  // Professional Background
  currentProfession: { type: String, required: true, trim: true },
  otherProfession: { type: String, default: '', trim: true },
  professionalExperience: { type: Number, required: true, min: 0, max: 80 },

  // Financial Interests & Knowledge
  financialInterests: {
    type: [String],
    required: true,
    validate: {
      validator: values => Array.isArray(values) && values.length >= 1 && values.length <= 4,
      message: 'Select between 1 and 4 financial interests.',
    },
  },
  islamicFinanceKnowledge: {
    type: String,
    enum: ['Beginner / New', 'Basic', 'Intermediate', 'Advanced / Practitioner'],
    required: true,
  },
  biggestFinancialChallenge: { type: String, required: true, minlength: 10, maxlength: 500, trim: true },

  // Preferences
  participationMode: {
    type: String,
    enum: ['Online Webinars', 'In-Person Seminars & Networking Events', 'Both'],
    required: true,
  },
  whatsappCommunity: { type: Boolean, required: true },
  referralSource: { type: String, required: true, trim: true },
  otherReferralSource: { type: String, default: '', trim: true },

  // Organization & Status
  organization: { type: String, default: '', trim: true },
  companyName: { type: String, default: '', trim: true },
  jobTitle: { type: String, default: '', trim: true },
  status: {
    type: String,
    enum: ['Pending', 'Confirmed', 'Checked-In', 'Rejected', 'Expired'],
    default: 'Confirmed',
  },

  // Non-breaking compatibility fields
  district: { type: String, default: '', trim: true },
  occupation: { type: String, default: '', trim: true },
  mobileNumber: { type: String, default: '', trim: true },
  sessionExpectations: { type: String, default: '', trim: true },
  paymentStatus: { type: String, default: 'PAID' },
  registrationFee: { type: Number, default: 0 },
}, { timestamps: true });

registrationSchema.index({ status: 1 });
registrationSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Registration', registrationSchema);
