const WebinarRegistration = require('../models/WebinarRegistration');
const { validateWebinarRegistration } = require('../utils/webinarValidation');
const { parsePhoneNumberFromString } = require('libphonenumber-js/max');
const webinarEmailService = require('../services/webinarEmailService');

function normalizeLegacyRegistration(registration) {
  const location = String(registration.location || [registration.city, registration.state, registration.country].filter(Boolean).join(', ')).trim();
  return {
    _id: registration._id,
    fullName: registration.fullName,
    email: registration.email,
    whatsapp: String(registration.whatsapp || registration.phone || '').trim(),
    location,
    designation: String(registration.designation || registration.businessRole || '').trim(),
    industry: String(registration.industry || registration.businessType || '').trim(),
    financialInterests: Array.isArray(registration.financialInterests) ? registration.financialInterests : [],
    otherFinancialInterest: String(registration.otherFinancialInterest || registration.financialInterestsOther || '').trim(),
    financialChallenge: String(registration.financialChallenge || '').trim(),
    webinarSource: String(registration.webinarSource || registration.referralSource || '').trim(),
    consent: registration.consent === true,
    createdAt: registration.createdAt,
  };
}

function createWebinarRegistrationHandler({
  registrationModel = WebinarRegistration,
  emailService = webinarEmailService,
  logger = console,
} = {}) {
  const safeLogger = {
    ...console,
    ...logger,
  };
  if (typeof safeLogger.info !== 'function') safeLogger.info = () => {};
  if (typeof safeLogger.error !== 'function') safeLogger.error = () => {};

  return async (req, res) => {
    try {
      const submittedPhone = String(req.body.whatsapp || req.body.phone || '').trim();
      const parsedPhone = parsePhoneNumberFromString(submittedPhone);
      const normalizedPhone = parsedPhone?.isValid() ? parsedPhone.number : submittedPhone;
      const payload = {
        fullName: req.body.fullName,
        whatsapp: normalizedPhone,
        phoneCountry: req.body.phoneCountry,
        email: String(req.body.email || '').trim().toLowerCase(),
        location: String(req.body.location || '').trim(),
        designation: String(req.body.designation || '').trim(),
        industry: String(req.body.industry || '').trim(),
        financialInterests: req.body.financialInterests,
        otherFinancialInterest: String(req.body.otherFinancialInterest || '').trim(),
        financialChallenge: String(req.body.financialChallenge || '').trim(),
        webinarSource: String(req.body.webinarSource || '').trim(),
        consent: req.body.consent,
      };

      const validation = validateWebinarRegistration(payload);
      if (!validation.isValid) {
        return res.status(400).json({ message: Object.values(validation.errors)[0] || 'Please check the information you entered.' });
      }

      const existing = await registrationModel.findOne({ email: payload.email });
      if (existing) {
        return res.status(400).json({ message: 'This email address is already registered for the webinar.' });
      }

      const registration = await registrationModel.create(payload);
      let confirmationEmailSent = false;
      try {
        await emailService.sendRegistrationConfirmation(registration.email, registration.fullName);
        confirmationEmailSent = true;
        safeLogger.info('Webinar registration confirmation email sent.', { email: registration.email });
        if (typeof registrationModel.findByIdAndUpdate === 'function') {
          await registrationModel.findByIdAndUpdate(
            registration._id,
            { $set: { confirmationEmailSent: true, confirmationEmailSentAt: new Date(), confirmationEmailLastError: null } },
            { new: true, runValidators: true },
          );
        }
      } catch (error) {
        safeLogger.error('Webinar registration confirmation email failed.', {
          code: error.code || 'EMAIL_SEND_FAILED',
          message: error.message || 'Unknown email failure',
          email: registration.email,
        });
        if (typeof registrationModel.findByIdAndUpdate === 'function') {
          await registrationModel.findByIdAndUpdate(
            registration._id,
            { $set: { confirmationEmailSent: false, confirmationEmailSentAt: null, confirmationEmailLastError: String(error.message || 'Email delivery failed.').slice(0, 500) } },
            { new: true, runValidators: true },
          ).catch(() => {});
        }
      }

      return res.status(201).json({
        success: true,
        message: 'Registration successful',
        confirmationEmailSent,
        data: registration,
      });
    } catch (error) {
      if (error.name === 'ValidationError') {
        return res.status(400).json({ message: 'Please check the information you entered.' });
      }
      return res.status(500).json({ message: 'We could not complete your registration right now. Please try again.' });
    }
  }
}

exports.createWebinarRegistration = createWebinarRegistrationHandler();
exports.createWebinarRegistrationHandler = createWebinarRegistrationHandler;

exports.getWebinarRegistrations = async (req, res) => {
  try {
    const registrations = await WebinarRegistration.find().sort({ createdAt: -1 }).lean();
    return res.json(registrations.map(normalizeLegacyRegistration));
  } catch (error) {
    return res.status(500).json({ message: 'Server error' });
  }
};
