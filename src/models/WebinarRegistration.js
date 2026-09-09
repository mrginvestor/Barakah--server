const mongoose = require('mongoose');

const webinarRegistrationSchema = new mongoose.Schema({
  fullName: { type: String, required: true, trim: true },
  phone: { type: String, required: true, trim: true },
  email: { type: String, required: true, trim: true, lowercase: true },
  city: { type: String, required: true, trim: true },
  businessName: { type: String, required: true, trim: true },
  businessWebsite: { type: String, required: true, trim: true },
  businessRole: { type: String, required: true, trim: true },
  businessType: { type: String, required: true, trim: true },
  businessAge: { type: String, default: '' },
  employeeCount: { type: String, default: '' },
  annualTurnover: { type: String, default: '' },
  financialInterests: { type: [String], required: true, validate: {
    validator: values => Array.isArray(values) && values.length >= 1,
    message: 'Select at least one financial topic.',
  } },
  financialChallenge: { type: String, default: '' },
  referralSource: { type: String, required: true, trim: true },
  consent: { type: Boolean, required: true },
  status: { type: String, default: 'New' },
}, { timestamps: true });

module.exports = mongoose.model('WebinarRegistration', webinarRegistrationSchema);
