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
  status: { type: String, default: 'New' },
}, { timestamps: true });

module.exports = mongoose.model('WebinarRegistration', webinarRegistrationSchema);
