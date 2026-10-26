const WebinarRegistration = require('../models/WebinarRegistration');
const Webinar = require('../models/Webinar');
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
    country: String(registration.country || '').trim(),
    state: String(registration.state || '').trim(),
    city: String(registration.city || '').trim(),
    ageGroup: String(registration.ageGroup || '').trim(),
    otherAgeGroup: String(registration.otherAgeGroup || '').trim(),
    occupation: String(registration.occupation || registration.designation || registration.businessRole || '').trim(),
    otherOccupation: String(registration.otherOccupation || '').trim(),
    designation: String(registration.designation || registration.occupation || '').trim(),
    industry: String(registration.industry || registration.businessType || '').trim(),
    companyName: String(registration.companyName || registration.businessName || '').trim(),
    businessWebsite: String(registration.businessWebsite || '').trim(),
    financialInterests: Array.isArray(registration.financialInterests) ? registration.financialInterests : [],
    otherFinancialInterest: String(registration.otherFinancialInterest || registration.financialInterestsOther || '').trim(),
    questionsOrTopics: String(registration.questionsOrTopics || registration.additionalInfo || registration.financialChallenge || '').trim(),
    additionalInfo: String(registration.additionalInfo || registration.questionsOrTopics || registration.financialChallenge || '').trim(),
    financialChallenge: String(registration.financialChallenge || '').trim(),
    webinarSource: String(registration.webinarSource || registration.referralSource || '').trim(),
    otherWebinarSource: String(registration.otherWebinarSource || '').trim(),
    webinarId: String(registration.webinarId || (registration.webinarVersion === 'November 1, 2026 Webinar' ? 'halal-wealth-nov-2026' : 'halal-wealth-oct-2026')).trim(),
    webinarVersion: String(registration.webinarVersion || 'October 2026 Webinar').trim(),
    consent: registration.consent === true,
    createdAt: registration.createdAt,
  };
}

const REGISTRATION_CLOSED_MESSAGE = 'Registration for this webinar has now closed. We appreciate your interest and support.';

function isWebinarRegistrationClosed(environment = process.env) {
  if (environment.WEBINAR_REGISTRATION_CLOSED !== undefined) {
    return String(environment.WEBINAR_REGISTRATION_CLOSED).toLowerCase() === 'true';
  }
  if (environment.WEBINAR_REGISTRATION_OPEN !== undefined) {
    return String(environment.WEBINAR_REGISTRATION_OPEN).toLowerCase() !== 'true';
  }
  return false;
}

function createWebinarRegistrationHandler({
  registrationModel = WebinarRegistration,
  emailService = webinarEmailService,
  logger = console,
  isRegistrationClosed = isWebinarRegistrationClosed,
} = {}) {
  const safeLogger = {
    ...console,
    ...logger,
  };
  if (typeof safeLogger.info !== 'function') safeLogger.info = () => {};
  if (typeof safeLogger.error !== 'function') safeLogger.error = () => {};

  return async (req, res) => {
    try {
      const closed = typeof isRegistrationClosed === 'function'
        ? isRegistrationClosed()
        : Boolean(isRegistrationClosed);

      if (closed) {
        return res.status(403).json({
          success: false,
          closed: true,
          message: REGISTRATION_CLOSED_MESSAGE,
        });
      }

      const submittedPhone = String(req.body.whatsapp || req.body.phone || '').trim();
      const countryHint = String(req.body.phoneCountry || req.body.country || '').trim().toUpperCase();
      const parsedPhone = parsePhoneNumberFromString(submittedPhone, countryHint);
      const normalizedPhone = parsedPhone?.isValid() ? parsedPhone.number : submittedPhone;

      const country = String(req.body.country || '').trim();
      const state = String(req.body.state || '').trim();
      const city = String(req.body.city || '').trim();
      const location = String(req.body.location || [city, state, country].filter(Boolean).join(', ')).trim();

      // Conditional "Other" sanitization: do not store other* values if selection is not Other
      const ageGroup = String(req.body.ageGroup || '').trim();
      const otherAgeGroup = ageGroup === 'Other' ? String(req.body.otherAgeGroup || '').trim() : '';

      const occupation = String(req.body.occupation || req.body.designation || '').trim();
      const otherOccupation = occupation === 'Other' ? String(req.body.otherOccupation || req.body.otherDesignation || '').trim() : '';
      const designation = occupation === 'Other' && otherOccupation ? otherOccupation : (occupation || 'Registered Participant');

      const rawInterests = Array.isArray(req.body.financialInterests) ? req.body.financialInterests : [];
      const hasOtherInterest = rawInterests.includes('Other') || rawInterests.includes('Others');
      const otherFinancialInterest = hasOtherInterest ? String(req.body.otherFinancialInterest || '').trim() : '';

      const webinarSource = String(req.body.webinarSource || 'Website').trim();
      const otherWebinarSource = webinarSource === 'Other' ? String(req.body.otherWebinarSource || '').trim() : '';

      const questionsOrTopics = String(req.body.questionsOrTopics || req.body.additionalInfo || req.body.financialChallenge || '').trim();
      const submittedWebinarId = String(req.body.webinarId || '').trim().toLowerCase();
      let webinarVersion = String(req.body.webinarVersion || '').trim();
      let webinarId = submittedWebinarId && /^[a-z0-9_-]+$/.test(submittedWebinarId)
        ? submittedWebinarId
        : '';

      if (!webinarId) {
        if (webinarVersion === 'Business Webinar 2026') {
          webinarId = 'business-webinar-2026';
        } else {
          webinarId = 'halal-wealth-nov-2026';
        }
      }
      if (!webinarVersion) {
        webinarVersion = webinarId === 'business-webinar-2026'
          ? 'Business Webinar 2026'
          : 'November 1, 2026 Webinar';
      }
      const consent = req.body.consent !== false && req.body.consent !== 'false';

      const payload = {
        fullName: String(req.body.fullName || '').trim(),
        whatsapp: normalizedPhone,
        phoneCountry: req.body.phoneCountry || parsedPhone?.country,
        email: String(req.body.email || '').trim().toLowerCase(),
        country: country || (location.split(',').pop()?.trim()) || '',
        state,
        city: city || (location.split(',')[0]?.trim()) || '',
        location,
        ageGroup,
        otherAgeGroup,
        occupation,
        otherOccupation,
        designation,
        industry: String(req.body.industry || '').trim(),
        companyName: String(req.body.companyName || '').trim(),
        businessWebsite: String(req.body.businessWebsite || '').trim(),
        financialInterests: rawInterests,
        otherFinancialInterest,
        questionsOrTopics,
        additionalInfo: questionsOrTopics,
        financialChallenge: questionsOrTopics,
        webinarSource,
        otherWebinarSource,
        webinarId,
        webinarVersion,
        consent,
      };

      const validation = validateWebinarRegistration(payload);
      if (!validation.isValid) {
        return res.status(400).json({
          message: Object.values(validation.errors)[0] || 'Please check the information you entered.',
          errors: validation.errors,
        });
      }

      const existingQuery = {
        email: payload.email,
        $or: [
          { webinarId: payload.webinarId },
          ...(payload.webinarId === 'halal-wealth-nov-2026' ? [{ webinarVersion: 'November 1, 2026 Webinar' }] : []),
          ...(payload.webinarId === 'halal-wealth-oct-2026' ? [{ webinarVersion: 'October 2026 Webinar' }] : []),
        ],
      };
      const existing = await registrationModel.findOne(existingQuery);
      if (existing) {
        return res.status(400).json({ message: 'This email address is already registered for this webinar.' });
      }

      if (!payload.registrationId) {
        const randomSuffix = Math.random().toString(36).slice(2, 8).toUpperCase();
        const prefix = payload.webinarVersion === 'Business Webinar 2026' ? 'HWW-B26-' : (payload.webinarId === 'halal-wealth-nov-2026' ? 'HWW-N26-' : 'HWW-REG-');
        payload.registrationId = `${prefix}${randomSuffix}`;
      }

      const registration = await registrationModel.create(payload);
      let confirmationEmailSent = false;
      let joiningEmailSent = false;

      // Only dispatch confirmation email if user opted in (consent === true) and emailService is configured
      if (consent && emailService) {
        try {
          if (typeof emailService.sendRegistrationConfirmation === 'function') {
            await emailService.sendRegistrationConfirmation(registration.email, registration.fullName);
            confirmationEmailSent = true;
            safeLogger.info('Webinar registration confirmation email sent.', { email: registration.email });
          } else if (typeof emailService.sendZoomJoiningLink === 'function') {
            await emailService.sendZoomJoiningLink(registration.email, registration.fullName);
            joiningEmailSent = true;
            confirmationEmailSent = true;
            safeLogger.info('Webinar registration Zoom joining email sent.', { email: registration.email });
          }

          if (typeof registrationModel.findByIdAndUpdate === 'function') {
            await registrationModel.findByIdAndUpdate(
              registration._id,
              {
                $set: {
                  joiningEmailSent: joiningEmailSent || false,
                  joiningEmailSentAt: joiningEmailSent ? new Date() : null,
                  joiningEmailLastError: null,
                  confirmationEmailSent: confirmationEmailSent || false,
                  confirmationEmailSentAt: confirmationEmailSent ? new Date() : null,
                  confirmationEmailLastError: null,
                },
              },
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
              {
                $set: {
                  joiningEmailSent: false,
                  joiningEmailSentAt: null,
                  joiningEmailLastError: String(error.message || 'Email delivery failed.').slice(0, 500),
                  confirmationEmailSent: false,
                  confirmationEmailSentAt: null,
                  confirmationEmailLastError: String(error.message || 'Email delivery failed.').slice(0, 500),
                },
              },
              { new: true, runValidators: true },
            ).catch(() => {});
          }
        }
      }

      return res.status(201).json({
        success: true,
        message: 'Registration successful',
        confirmationEmailSent,
        joiningEmailSent,
        data: registration,
      });
    } catch (error) {
      if (error.name === 'ValidationError') {
        return res.status(400).json({ message: 'Please check the information you entered.' });
      }
      return res.status(500).json({ message: 'We could not complete your registration right now. Please try again.' });
    }
  };
}

function getWebinarRegistrationStatusHandler({
  isRegistrationClosed = isWebinarRegistrationClosed,
} = {}) {
  return (req, res) => {
    const closed = typeof isRegistrationClosed === 'function'
      ? isRegistrationClosed()
      : Boolean(isRegistrationClosed);
    return res.json({
      closed,
      message: closed ? REGISTRATION_CLOSED_MESSAGE : 'Registration is open.',
    });
  };
}

function createGetWebinarsHandler({ webinarModel = Webinar } = {}) {
  return async (req, res) => {
    try {
      const webinars = await webinarModel.find().sort({ dateIso: -1, createdAt: -1 }).lean();
      return res.json({ success: true, data: webinars });
    } catch (error) {
      return res.status(500).json({ success: false, message: 'Webinars could not be loaded.' });
    }
  };
}

exports.REGISTRATION_CLOSED_MESSAGE = REGISTRATION_CLOSED_MESSAGE;
exports.isWebinarRegistrationClosed = isWebinarRegistrationClosed;
exports.createWebinarRegistration = createWebinarRegistrationHandler();
exports.createWebinarRegistrationHandler = createWebinarRegistrationHandler;
exports.getWebinarRegistrationStatus = getWebinarRegistrationStatusHandler();
exports.getWebinarRegistrationStatusHandler = getWebinarRegistrationStatusHandler;
exports.getWebinars = createGetWebinarsHandler();
exports.createGetWebinarsHandler = createGetWebinarsHandler;

exports.getWebinarRegistrations = async (req, res) => {
  try {
    const registrations = await WebinarRegistration.find().sort({ createdAt: -1 }).lean();
    return res.json(registrations.map(normalizeLegacyRegistration));
  } catch (error) {
    return res.status(500).json({ message: 'Server error' });
  }
};
