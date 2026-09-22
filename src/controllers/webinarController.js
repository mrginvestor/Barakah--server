const WebinarRegistration = require('../models/WebinarRegistration');
const { validateWebinarRegistration } = require('../utils/webinarValidation');

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
}

exports.createWebinarRegistration = async (req, res) => {
  try {
    const payload = {
      fullName: req.body.fullName,
      phone: normalizePhone(req.body.phone),
      email: String(req.body.email || '').trim().toLowerCase(),
      city: String(req.body.city || '').trim(),
      state: String(req.body.state || '').trim(),
      country: String(req.body.country || '').trim(),
      businessName: req.body.businessName,
      businessWebsite: String(req.body.businessWebsite || '').trim(),
      businessRole: req.body.businessRole,
      businessType: req.body.businessType,
      designation: String(req.body.designation || req.body.businessRole || '').trim(),
      industry: String(req.body.industry || req.body.businessType || '').trim(),
      businessAge: req.body.businessAge || '',
      employeeCount: req.body.employeeCount || '',
      annualTurnover: req.body.annualTurnover || '',
      financialInterests: req.body.financialInterests,
      financialInterestsOther: String(req.body.financialInterestsOther || '').trim(),
      financialChallenge: String(req.body.financialChallenge || '').trim(),
      referralSource: req.body.referralSource,
      consent: req.body.consent,
    };

    const validation = validateWebinarRegistration(payload);
    if (!validation.isValid) {
      return res.status(400).json({ message: Object.values(validation.errors)[0] || 'Please check the information you entered.' });
    }

    const existing = await WebinarRegistration.findOne({ email: payload.email });
    if (existing) {
      return res.status(400).json({ message: 'This email address is already registered for the webinar.' });
    }

    const registration = await WebinarRegistration.create(payload);
    return res.status(201).json({ success: true, message: 'Registration successful', data: registration });
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ message: 'Please check the information you entered.' });
    }
    return res.status(500).json({ message: 'We could not complete your registration right now. Please try again.' });
  }
};

exports.getWebinarRegistrations = async (req, res) => {
  try {
    const registrations = await WebinarRegistration.find().sort({ createdAt: -1 });
    return res.json(registrations);
  } catch (error) {
    return res.status(500).json({ message: 'Server error' });
  }
};
