const Registration = require('../models/Registration');
const defaultEmailService = require('../services/webinarEmailService');

async function getNextRegistrationId(registrationModel = Registration) {
  try {
    if (typeof registrationModel.findOne === 'function') {
      const latest = await registrationModel
        .findOne({ registrationId: /^HWS26-\d+$/ })
        .sort({ registrationId: -1 })
        .select('registrationId')
        .lean();

      if (latest && latest.registrationId) {
        const match = String(latest.registrationId).match(/^HWS26-(\d+)$/);
        if (match) {
          const nextSeq = parseInt(match[1], 10) + 1;
          return `HWS26-${String(nextSeq).padStart(5, '0')}`;
        }
      }
    }
    const count = typeof registrationModel.countDocuments === 'function'
      ? await registrationModel.countDocuments()
      : 0;
    return `HWS26-${String(count + 1).padStart(5, '0')}`;
  } catch (_) {
    const random = Math.floor(10000 + Math.random() * 90000);
    return `HWS26-${random}`;
  }
}

function createRegistrationHandler({
  registrationModel = Registration,
  emailService = defaultEmailService,
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
      const rawEmail = String(req.body?.email || '').trim().toLowerCase();
      const sanitizedRecipient = rawEmail ? rawEmail.replace(/(.{2})(.*)(@.*)/, '$1***$3') : null;
      safeLogger.info('REGISTRATION_REQUEST_RECEIVED', {
        stage: 'REGISTRATION_REQUEST_RECEIVED',
        event: 'Halal Wealth Summit',
        recipient: sanitizedRecipient,
        timestamp: new Date().toISOString(),
      });

      const data = { ...req.body, email: rawEmail };
      const required = [
        'fullName',
        'countryCode',
        'whatsappNumber',
        'email',
        'ageGroup',
        'gender',
        'city',
        'state',
        'country',
        'currentProfession',
        'professionalExperience',
        'financialInterests',
        'islamicFinanceKnowledge',
        'biggestFinancialChallenge',
        'participationMode',
        'whatsappCommunity',
        'referralSource',
      ];
      if (required.some(field => data[field] === undefined || data[field] === null || data[field] === '')) {
        return res.status(400).json({ message: 'Please complete all required fields.' });
      }
      if (!/^\S+@\S+\.\S+$/.test(data.email)) {
        return res.status(400).json({ message: 'Please enter a valid email address.' });
      }
      if (!/^\+?[1-9]\d{6,14}$/.test(`${data.countryCode}${String(data.whatsappNumber).replace(/\D/g, '')}`)) {
        return res.status(400).json({ message: 'Please enter a valid WhatsApp number.' });
      }
      if (!Array.isArray(data.financialInterests) || data.financialInterests.length < 1 || data.financialInterests.length > 4) {
        return res.status(400).json({ message: 'Please select no more than 4 topics.' });
      }
      if (data.currentProfession === 'Other' && !String(data.otherProfession || '').trim()) {
        return res.status(400).json({ message: 'Please specify your profession.' });
      }
      if (data.referralSource === 'Other' && !String(data.otherReferralSource || '').trim()) {
        return res.status(400).json({ message: 'Please specify how you heard about us.' });
      }
      if (String(data.fullName).trim().length < 2 || String(data.biggestFinancialChallenge).trim().length < 10 || String(data.biggestFinancialChallenge).length > 500) {
        return res.status(400).json({ message: 'Please check your name and financial challenge.' });
      }

      const existing = await registrationModel.findOne({ email: data.email });
      if (existing) {
        return res.status(400).json({ message: 'This email is already registered for the summit.' });
      }

      const phone = `${data.countryCode}${String(data.whatsappNumber).replace(/\D/g, '')}`;

      // Save participant to MongoDB first with retry protection against concurrent ID collision
      let registration = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const registrationId = await getNextRegistrationId(registrationModel);
        const candidate = typeof registrationModel === 'function'
          ? new registrationModel({ ...data, name: data.fullName, phone, registrationId })
          : { ...data, name: data.fullName, phone, registrationId };

        try {
          if (typeof candidate.save === 'function') {
            await candidate.save();
            registration = candidate;
          } else if (typeof registrationModel.create === 'function') {
            registration = await registrationModel.create({ ...data, name: data.fullName, phone, registrationId });
          } else {
            registration = candidate;
          }
          break;
        } catch (saveError) {
          if (saveError.code === 11000) {
            const isEmailConflict = saveError.keyPattern?.email || /email/i.test(saveError.message);
            if (isEmailConflict) {
              return res.status(400).json({ message: 'This email is already registered for the summit.' });
            }
            if (attempt < 2) continue;
          }
          throw saveError;
        }
      }

      if (!registration) {
        throw new Error('Failed to create registration record.');
      }

      const sanitizedEmail = registration.email ? registration.email.replace(/(.{2})(.*)(@.*)/, '$1***$3') : null;
      safeLogger.info('REGISTRATION_SAVED', {
        stage: 'REGISTRATION_SAVED',
        registrationId: registration.registrationId,
        recordId: String(registration._id),
        event: 'Halal Wealth Summit',
        recipient: sanitizedEmail,
        timestamp: new Date().toISOString(),
      });

      // Background asynchronous email dispatch: prompt HTTP response without SMTP delays
      async function dispatchConfirmationEmail() {
        safeLogger.info('EMAIL_SEND_STARTED', {
          stage: 'EMAIL_SEND_STARTED',
          registrationId: registration.registrationId,
          recipient: sanitizedEmail,
          purpose: 'summit confirmation',
          timestamp: new Date().toISOString(),
        });
        if (!emailService || typeof emailService.sendRegistrationConfirmation !== 'function') {
          return null;
        }
        try {
          await emailService.sendRegistrationConfirmation(registration.email, registration.fullName || registration.name);
          safeLogger.info('Summit registration confirmation email sent.', {
            registrationId: registration.registrationId,
            email: registration.email,
          });
          if (typeof registrationModel.updateOne === 'function') {
            await registrationModel.updateOne(
              { _id: registration._id },
              {
                $set: {
                  confirmationEmailSent: true,
                  confirmationEmailSentAt: new Date(),
                  confirmationEmailLastError: null,
                },
              }
            ).catch(() => {});
          }
          return { success: true };
        } catch (emailError) {
          safeLogger.error('EMAIL_SEND_FAILED', {
            stage: 'EMAIL_SEND_FAILED',
            code: emailError.code || 'EMAIL_SEND_FAILED',
            message: emailError.message || 'Unknown email failure',
            registrationId: registration.registrationId,
            recipient: sanitizedEmail,
            timestamp: new Date().toISOString(),
          });
          if (typeof registrationModel.updateOne === 'function') {
            await registrationModel.updateOne(
              { _id: registration._id },
              {
                $set: {
                  confirmationEmailSent: false,
                  confirmationEmailSentAt: null,
                  confirmationEmailLastError: String(emailError.message || 'Email delivery failed.').slice(0, 500),
                },
              }
            ).catch(() => {});
          }
          return { success: false, error: emailError };
        }
      }

      // Trigger confirmation email asynchronously in background
      const emailPromise = dispatchConfirmationEmail();

      // Return prompt response to participant immediately
      res.status(201).json({
        success: true,
        message: 'Registration successful',
        registrationId: registration.registrationId,
      });

      return { registration, emailPromise };
    } catch (error) {
      if (error.name === 'ValidationError') {
        return res.status(400).json({ message: 'Please check the information you entered.' });
      }
      if (error.code === 11000) {
        return res.status(400).json({ message: 'This email is already registered for the summit.' });
      }
      return res.status(500).json({ message: 'We could not complete your registration right now. Please try again.' });
    }
  };
}

exports.getNextRegistrationId = getNextRegistrationId;
exports.createRegistrationHandler = createRegistrationHandler;
exports.createRegistration = createRegistrationHandler();

exports.getRegistrations = async (req, res) => {
  try {
    const registrations = await Registration.find().sort({ createdAt: -1 });
    res.json(registrations);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};

exports.checkIn = async (req, res) => {
  try {
    const { registrationId } = req.body;
    const registration = await Registration.findOne({ registrationId });
    if (!registration) return res.status(404).json({ message: 'Registration not found' });
    if (registration.status === 'Checked-In') return res.status(400).json({ message: 'Already checked in' });

    await Registration.updateOne({ _id: registration._id }, { $set: { status: 'Checked-In' } });
    registration.status = 'Checked-In';
    res.json({ message: 'Check-in successful', data: registration });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};
