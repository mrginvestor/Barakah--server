const mongoose = require('mongoose');

const registrationSchema = new mongoose.Schema({
  registrationId: { type: String, required: true, unique: true },
  name: { type: String },
  fullName: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true },
  phone: { type: String },
  countryCode: { type: String, required: true },
  whatsappNumber: { type: String, required: true },
  ageGroup: { type: String, enum: ['18-24', '25-34', '35-44', '45-54', '55+'], required: true },
  gender: { type: String, enum: ['Male', 'Female', 'Prefer not to say'], required: true },
  city: { type: String, required: true, trim: true },
  state: { type: String, required: true, trim: true },
  country: { type: String, required: true, trim: true },
  currentProfession: { type: String, required: true },
  otherProfession: { type: String, trim: true },
  professionalExperience: { type: Number, required: true, min: 0, max: 80 },
  financialInterests: { type: [String], required: true, validate: { validator: values => values.length >= 1 && values.length <= 4, message: 'Select between 1 and 4 financial interests.' } },
  islamicFinanceKnowledge: { type: String, enum: ['Beginner / New', 'Basic', 'Intermediate', 'Advanced / Practitioner'], required: true },
  biggestFinancialChallenge: { type: String, required: true, minlength: 10, maxlength: 500, trim: true },
  participationMode: { type: String, enum: ['Online Webinars', 'In-Person Seminars & Networking Events', 'Both'], required: true },
  whatsappCommunity: { type: Boolean, required: true },
  referralSource: { type: String, required: true },
  otherReferralSource: { type: String, trim: true },
  organization: { type: String },
  jobTitle: { type: String },
  status: { type: String, enum: ['Pending', 'Confirmed', 'Checked-In'], default: 'Confirmed' }
}, { timestamps: true });

module.exports = mongoose.model('Registration', registrationSchema);
