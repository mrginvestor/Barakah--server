const path = require('path');
const fs = require('fs');
const SummitRegistration = require('../models/SummitRegistration');
const SUMMIT_CONFIG = require('../config/summitConfig');
const { getNextRegistrationId } = require('./registrationController');
const crypto = require('crypto');
const { validateImageMagicBytes, UPLOAD_DIR } = require('../middleware/receiptUpload');
const { processAndStoreReceipt } = require('../services/receiptStorageService');
const defaultEmailService = require('../services/webinarEmailService');
const investorMissionEmailService = require('../services/investorMissionEmailService');
const { calculateNextRetryAt } = require('../services/investorMissionRetryWorker');

/**
 * Generate separate registration IDs for Small Summit (e.g. SS26-00001)
 * completely independent from Main Summit (HWS26-00001).
 */
async function getNextSmallSummitRegistrationId(model = SummitRegistration) {
  try {
    if (typeof model.find === 'function') {
      const docs = await model
        .find({ registrationId: /^SS26-\d+$/ })
        .select('registrationId')
        .lean();

      let maxSeq = 0;
      if (Array.isArray(docs)) {
        for (const doc of docs) {
          const match = String(doc?.registrationId || '').match(/^SS26-(\d+)$/);
          if (match) {
            const seq = parseInt(match[1], 10);
            if (!Number.isNaN(seq) && seq > maxSeq) {
              maxSeq = seq;
            }
          }
        }
      }

      let candidateSeq = maxSeq + 1;
      let candidateId = `SS26-${String(candidateSeq).padStart(5, '0')}`;

      // Guarantee candidate ID does not collide with existing documents
      if (typeof model.exists === 'function') {
        while (await model.exists({ registrationId: candidateId })) {
          candidateSeq += 1;
          candidateId = `SS26-${String(candidateSeq).padStart(5, '0')}`;
        }
      }

      return candidateId;
    }

    if (typeof model.findOne === 'function') {
      const latest = await model
        .findOne({ registrationId: /^SS26-\d+$/ })
        .sort({ registrationId: -1 })
        .select('registrationId')
        .lean();

      if (latest && latest.registrationId) {
        const match = String(latest.registrationId).match(/^SS26-(\d+)$/);
        if (match) {
          const nextSeq = parseInt(match[1], 10) + 1;
          return `SS26-${String(nextSeq).padStart(5, '0')}`;
        }
      }
    }

    const count = typeof model.countDocuments === 'function' ? await model.countDocuments() : 0;
    return `SS26-${String(count + 1).padStart(5, '0')}`;
  } catch (_) {
    const timestampSuffix = Date.now().toString().slice(-5);
    return `SS26-${timestampSuffix}`;
  }
}

/**
 * Calculates current confirmed seat count for Investor Mission 2026 (capacity: 80 participants).
 * Strictly enforces seat management rules:
 * - Pending form submissions, uploads, holds, or offline submissions DO NOT count as confirmed seats.
 * - Single-side approval (registration only or payment only) DOES NOT count as a confirmed seat.
 * - ONLY when BOTH registration AND payment are approved does it count as 1 confirmed seat.
 * Available seats = 80 - confirmed seats.
 */
async function calculateActiveSeats(model = SummitRegistration) {
  const confirmedQuery = {
    $or: [
      { registrationApproved: true, paymentApproved: true },
      { registrationStatus: 'CONFIRMED', paymentStatus: 'PAID' },
      { status: 'Confirmed', paymentStatus: 'PAID' },
    ],
  };

  const confirmedCount = typeof model.countDocuments === 'function'
    ? await model.countDocuments(confirmedQuery)
    : 0;

  const maxCapacity = SUMMIT_CONFIG.maxCapacity || 80;
  const availableSeats = Math.max(0, maxCapacity - confirmedCount);
  const isSoldOut = availableSeats <= 0;

  return {
    maxCapacity,
    registrationFee: SUMMIT_CONFIG.registrationFee || 500,
    confirmedCount,
    availableSeats,
    isSoldOut,
    // Legacy property for backwards compatibility with test suites
    activeCount: confirmedCount,
  };
}

/**
 * GET /api/summit/availability and GET /api/summit/capacity
 * Public endpoint returning real-time capacity and available seats.
 */
async function getSummitCapacity(req, res) {
  try {
    const stats = await calculateActiveSeats(SummitRegistration);
    return res.json({
      success: true,
      ...stats,
    });
  } catch (error) {
    console.error('Error calculating summit capacity:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve available seats.' });
  }
}

/**
 * POST /api/summit/register and POST /api/dec-summit/register
 * Strict validation, Payment Method (ONLINE / OFFLINE), Seat Capacity Check.
 */
async function createSummitRegistration(req, res) {
  try {
    const {
      fullName,
      email,
      mobileNumber,
      countryCode = '+91',
      state,
      district,
      city,
      occupation,
      otherOccupation = '',
      organization = '',
      sessionExpectations,
      paymentMethod = 'ONLINE',
      termsAccepted,
    } = req.body;

    // 1. Full Name Validation:
    // Required, Minimum 3 characters, Letters and normal spaces only, Reject numbers and invalid special characters
    const cleanName = String(fullName || '').trim();
    if (cleanName.length < 3) {
      return res.status(400).json({ message: 'Full name is required (minimum 3 characters).' });
    }
    if (/\d/.test(cleanName) || !/^[a-zA-Z\s]+$/.test(cleanName)) {
      return res.status(400).json({ message: 'Full name must contain only letters and normal spaces.' });
    }

    // 2. Email Address Validation:
    // Required, correct format, trimmed
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return res.status(400).json({ message: 'Please enter a valid email address.' });
    }

    // 3. Mobile Number Validation:
    // Required, exactly 10 digits for Indian mobile numbers, numbers only
    const rawMobile = String(mobileNumber || '').trim();
    if (!/^[0-9]{10}$/.test(rawMobile)) {
      return res.status(400).json({
        message: 'Please enter a valid 10-digit mobile number.',
        field: 'mobileNumber',
      });
    }

    // 4. State, District, City Validation:
    // Required, non-empty
    if (!String(state || '').trim()) {
      return res.status(400).json({ message: 'State is required.' });
    }
    if (!String(district || '').trim()) {
      return res.status(400).json({ message: 'District is required.' });
    }
    if (!String(city || '').trim()) {
      return res.status(400).json({ message: 'City is required.' });
    }

    // 5. Occupation Validation:
    const validOccupations = [
      'Business Owner',
      'Entrepreneur',
      'Student',
      'Employee',
      'Professional',
      'Investor',
      'Other',
    ];
    const cleanOccupation = String(occupation || '').trim();
    if (!validOccupations.includes(cleanOccupation)) {
      return res.status(400).json({ message: 'Please select a valid occupation.' });
    }

    // Conditional Other Option:
    const cleanOtherOccupation = String(otherOccupation || '').trim();
    if (cleanOccupation === 'Other' && !cleanOtherOccupation) {
      return res.status(400).json({
        message: 'Please specify your occupation.',
        field: 'otherOccupation',
      });
    }

    // 6. Session Expectations Validation:
    // Required, Minimum 10 characters, Maximum 500 characters
    const cleanExpectations = String(sessionExpectations || '').trim();
    if (!cleanExpectations || cleanExpectations.length < 10) {
      return res.status(400).json({
        message: 'Please describe what you expect to learn from this session (minimum 10 characters).',
        field: 'sessionExpectations',
      });
    }
    if (cleanExpectations.length > 500) {
      return res.status(400).json({
        message: 'Session expectations must not exceed 500 characters.',
        field: 'sessionExpectations',
      });
    }

    // 7. Terms & Conditions:
    if (!termsAccepted) {
      return res.status(400).json({ message: 'You must agree to the Terms & Conditions and Privacy Policy.' });
    }

    // 8. Payment Method: Online Payment (UPI) is mandatory for Investor Mission 2026
    if (paymentMethod && String(paymentMethod).trim().toUpperCase() === 'OFFLINE') {
      return res.status(400).json({
        message: 'Offline payment is no longer available for Investor Mission 2026. Online UPI payment is required.',
        field: 'paymentMethod',
      });
    }

    if (paymentMethod && String(paymentMethod).trim().toUpperCase() !== 'ONLINE') {
      return res.status(400).json({
        message: 'Invalid payment method. Only Online UPI payment is accepted.',
        field: 'paymentMethod',
      });
    }

    const cleanPaymentMethod = 'ONLINE';

    // 9. Capacity Check (80 confirmed seats max)
    const capacity = await calculateActiveSeats(SummitRegistration);
    if (capacity.availableSeats <= 0) {
      return res.status(400).json({
        message: `Investor Mission 2026 Registration Full (maximum capacity of ${SUMMIT_CONFIG.maxCapacity || 80} confirmed participants reached).`,
        isSoldOut: true,
      });
    }

    // 10. Duplicate Check within Investor Mission / DEC Summit
    const existing = await SummitRegistration.findOne({ email: cleanEmail });
    if (existing) {
      const isConfirmed =
        (existing.registrationApproved && existing.paymentApproved) ||
        existing.registrationStatus === 'CONFIRMED' ||
        existing.status === 'Confirmed' ||
        existing.paymentStatus === 'PAID';

      if (isConfirmed) {
        return res.status(409).json({
          success: false,
          code: 'ALREADY_CONFIRMED',
          message: 'A registration with this email already exists and is confirmed. Please check your existing registration confirmation.',
          registrationId: existing.registrationId,
        });
      }

      // Check if registration / payment is under review / verification
      const isPendingVerification =
        existing.paymentStatus === 'PENDING_VERIFICATION' ||
        existing.registrationStatus === 'PENDING_APPROVAL';

      if (isPendingVerification) {
        return res.status(200).json({
          success: true,
          code: 'PENDING_VERIFICATION',
          message: 'Your registration and payment have already been received and are currently under administrative verification.',
          registrationId: existing.registrationId,
          participantName: existing.fullName || existing.name,
          redirectUrl: `/investor-mission-confirmation/${existing.registrationId}`,
          registrationStatus: existing.registrationStatus,
          paymentStatus: existing.paymentStatus,
        });
      }

      // If previously rejected, allow re-registration cleanly:
      const isRejected =
        existing.registrationStatus === 'REJECTED' ||
        existing.status === 'Rejected' ||
        existing.paymentStatus === 'REJECTED';

      if (isRejected) {
        existing.fullName = cleanName;
        existing.name = cleanName;
        existing.mobileNumber = rawMobile;
        existing.phone = rawMobile;
        existing.countryCode = '+91';
        existing.state = String(state).trim();
        existing.district = String(district).trim();
        existing.city = String(city).trim();
        existing.occupation = cleanOccupation;
        existing.otherOccupation = cleanOccupation === 'Other' ? cleanOtherOccupation : '';
        existing.organization = String(organization || '').trim();
        existing.sessionExpectations = cleanExpectations;
        existing.paymentMethod = cleanPaymentMethod;
        existing.registrationStatus = 'PENDING_PAYMENT';
        existing.paymentStatus = 'PENDING_PAYMENT';
        existing.status = 'Pending';
        existing.registrationApproved = false;
        existing.paymentApproved = false;
        existing.rejectionReason = '';
        existing.paymentScreenshot = null;
        existing.paymentScreenshotMimeType = null;
        existing.paymentScreenshotSize = null;
        existing.upiTransactionId = null;
        existing.paymentDate = null;
        existing.paymentNotes = '';
        existing.reservationExpiresAt = new Date(Date.now() + SUMMIT_CONFIG.reservationTimeoutMinutes * 60 * 1000);
        await existing.save();

        investorMissionEmailService.sendInvestorMissionAcknowledgement({
          recipientEmail: existing.email,
          participantName: existing.fullName || existing.name,
          registrationId: existing.registrationId,
        }).catch(err => console.error('Acknowledgement email error:', err.message));

        return res.status(200).json({
          success: true,
          code: 'REGISTRATION_RESET',
          message: 'Your previous registration was reset. Please proceed to complete UPI payment.',
          registrationId: existing.registrationId,
          participantName: existing.fullName || existing.name,
          paymentMethod: existing.paymentMethod,
          registrationFee: existing.registrationFee || SUMMIT_CONFIG.registrationFee,
          redirectUrl: `/investor-mission-payment/${existing.registrationId}`,
          registrationStatus: existing.registrationStatus,
          paymentStatus: existing.paymentStatus,
        });
      }

      // Otherwise, it is PENDING_PAYMENT / PENDING.
      // Update details if they updated them on the form, keep existing registrationId:
      existing.fullName = cleanName;
      existing.name = cleanName;
      existing.mobileNumber = rawMobile;
      existing.phone = rawMobile;
      existing.state = String(state).trim();
      existing.district = String(district).trim();
      existing.city = String(city).trim();
      existing.occupation = cleanOccupation;
      existing.otherOccupation = cleanOccupation === 'Other' ? cleanOtherOccupation : '';
      existing.organization = String(organization || '').trim();
      existing.sessionExpectations = cleanExpectations;
      existing.reservationExpiresAt = new Date(Date.now() + SUMMIT_CONFIG.reservationTimeoutMinutes * 60 * 1000);
      await existing.save();

      // Trigger acknowledgement email if not yet sent
      if (!existing.acknowledgementEmailSent && existing.acknowledgementEmailStatus !== 'SENT') {
        investorMissionEmailService.sendInvestorMissionAcknowledgement({
          recipientEmail: existing.email,
          participantName: existing.fullName || existing.name,
          registrationId: existing.registrationId,
        })
          .then(async () => {
            existing.acknowledgementEmailSent = true;
            existing.acknowledgementEmailStatus = 'SENT';
            existing.acknowledgementEmailSentAt = new Date();
            existing.acknowledgementEmailLastError = null;
            await existing.save().catch(e => console.error('Save ack status error:', e.message));
          })
          .catch(async (emailErr) => {
            console.error('Failed to send Investor Mission acknowledgement email:', emailErr.message);
            existing.acknowledgementEmailStatus = 'FAILED';
            existing.acknowledgementEmailLastError = String(emailErr.message).slice(0, 500);
            await existing.save().catch(e => console.error('Save ack error status error:', e.message));
          });
      }

      return res.status(200).json({
        success: true,
        code: 'PENDING_PAYMENT',
        message: 'Existing registration retrieved. Please complete your UPI payment.',
        registrationId: existing.registrationId,
        participantName: existing.fullName || existing.name,
        paymentMethod: existing.paymentMethod,
        registrationFee: existing.registrationFee || SUMMIT_CONFIG.registrationFee,
        redirectUrl: `/investor-mission-payment/${existing.registrationId}`,
        registrationStatus: existing.registrationStatus,
        paymentStatus: existing.paymentStatus,
      });
    }

    // Generate unique registration ID with retry loop to handle concurrent submissions
    let registration = null;
    let attempts = 0;
    const maxAttempts = 5;

    while (!registration && attempts < maxAttempts) {
      attempts += 1;
      const registrationId = await getNextSmallSummitRegistrationId(SummitRegistration);
      const expiresAt = cleanPaymentMethod === 'ONLINE'
        ? new Date(Date.now() + SUMMIT_CONFIG.reservationTimeoutMinutes * 60 * 1000)
        : null;

      const candidateRegistration = new SummitRegistration({
        registrationId,
        fullName: cleanName,
        name: cleanName,
        email: cleanEmail,
        mobileNumber: rawMobile,
        phone: rawMobile,
        countryCode: '+91',
        state: String(state).trim(),
        district: String(district).trim(),
        city: String(city).trim(),
        occupation: cleanOccupation,
        otherOccupation: cleanOccupation === 'Other' ? cleanOtherOccupation : '',
        organization: String(organization || '').trim(),
        sessionExpectations: cleanExpectations,
        registrationFee: SUMMIT_CONFIG.registrationFee,
        paymentAmount: SUMMIT_CONFIG.registrationFee,
        paymentMethod: cleanPaymentMethod,
        registrationStatus: 'PENDING_PAYMENT',
        paymentStatus: cleanPaymentMethod === 'ONLINE' ? 'PENDING_PAYMENT' : 'PENDING_OFFLINE_PAYMENT',
        status: 'Pending',
        registrationApproved: false,
        paymentApproved: false,
        reservationExpiresAt: expiresAt,
        termsAccepted: true,
        acknowledgementEmailStatus: 'NOT_SENT',
        acknowledgementEmailSent: false,
      });

      try {
        await candidateRegistration.save();
        registration = candidateRegistration;
      } catch (saveError) {
        if (
          saveError.code === 11000 &&
          (saveError.keyPattern?.registrationId || (saveError.message && saveError.message.includes('registrationId')))
        ) {
          console.warn(`[InvestorMission] Registration ID collision for ${registrationId}. Retrying (attempt ${attempts}/${maxAttempts})...`);
          continue;
        }
        throw saveError;
      }
    }

    if (!registration) {
      return res.status(500).json({
        success: false,
        message: 'Could not generate a unique registration ID due to high concurrent volume. Please try again.',
      });
    }

    // Trigger Registration Received Acknowledgement Email immediately after MongoDB save
    if (!registration.acknowledgementEmailSent && registration.acknowledgementEmailStatus !== 'SENT') {
      investorMissionEmailService.sendInvestorMissionAcknowledgement({
        recipientEmail: registration.email,
        participantName: registration.fullName || registration.name,
        registrationId: registration.registrationId,
      })
        .then(async () => {
          registration.acknowledgementEmailSent = true;
          registration.acknowledgementEmailStatus = 'SENT';
          registration.acknowledgementEmailSentAt = new Date();
          registration.acknowledgementEmailLastError = null;
          await registration.save().catch(e => console.error('Save ack status error:', e.message));
        })
        .catch(async (emailErr) => {
          console.error('Failed to send Investor Mission acknowledgement email:', emailErr.message);
          registration.acknowledgementEmailStatus = 'FAILED';
          registration.acknowledgementEmailLastError = String(emailErr.message).slice(0, 500);
          await registration.save().catch(e => console.error('Save ack error status error:', e.message));
        });
    }

    const redirectUrl = `/investor-mission-payment/${registration.registrationId}`;
    const message = 'Registration details saved. Please complete UPI payment.';

    return res.status(201).json({
      success: true,
      message,
      registrationId: registration.registrationId,
      participantName: registration.fullName,
      paymentMethod: cleanPaymentMethod,
      registrationFee: SUMMIT_CONFIG.registrationFee,
      redirectUrl,
      registrationStatus: registration.registrationStatus,
      paymentStatus: registration.paymentStatus,
    });
  } catch (error) {
    console.error('Error creating summit registration:', error);
    if (error.code === 11000) {
      if (error.keyPattern?.email || (error.message && error.message.includes('email'))) {
        return res.status(409).json({
          success: false,
          code: 'DUPLICATE_EMAIL',
          message: 'A registration with this email address already exists. Please continue with your existing registration.',
        });
      }
      if (error.keyPattern?.registrationId || (error.message && error.message.includes('registrationId'))) {
        return res.status(409).json({
          success: false,
          code: 'DUPLICATE_ID',
          message: 'A registration sequence conflict occurred. Please submit again.',
        });
      }
      return res.status(400).json({
        success: false,
        message: 'A registration with this information already exists.',
      });
    }
    return res.status(500).json({
      success: false,
      message: 'Could not complete registration. Please try again.',
    });
  }
}

/**
 * GET /api/summit/registration/:registrationId and GET /api/summit/payment/:registrationId
 * Step 2: Retrieves registration info and UPI configuration for the payment page.
 */
async function getSummitPaymentDetails(req, res) {
  try {
    const { registrationId } = req.params;
    const registration = await SummitRegistration.findOne({ registrationId: String(registrationId).trim() });

    if (!registration) {
      return res.status(404).json({ success: false, message: 'Summit registration record not found.' });
    }

    const now = new Date();
    const isExpired = (registration.paymentStatus === 'PENDING' || registration.paymentStatus === 'PENDING_PAYMENT') &&
      registration.reservationExpiresAt &&
      new Date(registration.reservationExpiresAt) < now;

    return res.json({
      success: true,
      registrationId: registration.registrationId,
      fullName: registration.fullName || registration.name,
      email: registration.email,
      mobileNumber: registration.mobileNumber || registration.phone,
      state: registration.state,
      district: registration.district,
      city: registration.city,
      occupation: registration.occupation,
      otherOccupation: registration.otherOccupation,
      organization: registration.organization,
      sessionExpectations: registration.sessionExpectations,
      registrationFee: registration.registrationFee || SUMMIT_CONFIG.registrationFee,
      paymentAmount: registration.paymentAmount || SUMMIT_CONFIG.registrationFee,
      paymentMethod: registration.paymentMethod || 'ONLINE',
      registrationStatus: registration.registrationStatus || 'PENDING_APPROVAL',
      paymentStatus: registration.paymentStatus,
      status: registration.status,
      registrationApproved: Boolean(registration.registrationApproved),
      paymentApproved: Boolean(registration.paymentApproved),
      offlinePaymentRecorded: Boolean(registration.offlinePaymentRecorded),
      offlinePaymentMethod: registration.offlinePaymentMethod || '',
      offlinePaymentDate: registration.offlinePaymentDate,
      adminVerificationNotes: registration.adminVerificationNotes || '',
      upiTransactionId: registration.upiTransactionId,
      paymentDate: registration.paymentDate,
      paymentNotes: registration.paymentNotes,
      paymentScreenshot: Boolean(registration.paymentScreenshot),
      rejectionReason: registration.rejectionReason,
      reservationExpiresAt: registration.reservationExpiresAt,
      isExpired: Boolean(isExpired),
      upiDetails: {
        upiId: SUMMIT_CONFIG.upiId,
        accountHolderName: SUMMIT_CONFIG.accountHolderName,
        phoneNumber: SUMMIT_CONFIG.phoneNumber || '6380413253',
        upiQrCode: SUMMIT_CONFIG.upiQrCode,
        amount: SUMMIT_CONFIG.registrationFee,
        currency: SUMMIT_CONFIG.currency,
      },
      eventName: SUMMIT_CONFIG.eventName || 'DEC Summit',
    });
  } catch (error) {
    console.error('Error fetching summit payment details:', error);
    return res.status(500).json({ success: false, message: 'Failed to load payment details.' });
  }
}

/**
 * POST /api/summit/payment-proof and POST /api/summit/payment/:registrationId/submit
 * Step 2: Uploads receipt screenshot and UTR transaction ID.
 */
async function submitSummitPaymentProof(req, res) {
  try {
    const regId = req.params.registrationId || req.body.registrationId;
    if (!regId) {
      if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(400).json({ message: 'Registration ID is required.' });
    }

    const registration = await SummitRegistration.findOne({ registrationId: String(regId).trim() });

    if (!registration) {
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(404).json({ message: 'Summit registration record not found.' });
    }

    if (registration.paymentStatus === 'PAID' || registration.status === 'Confirmed') {
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(400).json({ message: 'This registration has already been verified and confirmed.' });
    }

    if (!req.file) {
      return res.status(400).json({ message: 'Payment screenshot is required.' });
    }

    // Validate image binary header (magic bytes)
    const isValidImage = validateImageMagicBytes(req.file.path);
    if (!isValidImage) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ message: 'Invalid image file. Only valid JPG, JPEG, PNG, and WebP images are allowed.' });
    }

    // Validate UPI Transaction / UTR ID
    const utr = String(req.body.upiTransactionId || '').trim();
    if (!utr || utr.length < 6 || utr.length > 35) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ message: 'Please provide a valid UPI Transaction ID / UTR Number (6–35 characters).' });
    }

    // Validate Payment Date
    const payDate = req.body.paymentDate ? new Date(req.body.paymentDate) : new Date();
    if (isNaN(payDate.getTime())) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ message: 'Please select a valid payment date.' });
    }

    // Clean up older screenshot if re-submitting after rejection
    if (registration.paymentScreenshot && registration.paymentScreenshot !== req.file.filename) {
      const oldPath = path.join(UPLOAD_DIR, registration.paymentScreenshot);
      if (fs.existsSync(oldPath)) {
        try { fs.unlinkSync(oldPath); } catch (_) {}
      }
    }

    // Process and persistently store screenshot (in MongoDB Atlas and optionally Cloudinary)
    const stored = await processAndStoreReceipt(req.file, registration.registrationId);

    // Save proof details and transition status to PENDING_VERIFICATION
    registration.paymentScreenshot = stored.filename;
    registration.paymentScreenshotMimeType = stored.mimeType;
    registration.paymentScreenshotSize = stored.size;
    registration.paymentScreenshotData = stored.buffer; // Persistent binary stored directly in MongoDB Atlas
    registration.paymentScreenshotStorage = stored.storageType;
    if (stored.cloudUrl) {
      registration.paymentScreenshotUrl = stored.cloudUrl;
    }
    registration.upiTransactionId = utr;
    registration.paymentDate = payDate;
    registration.paymentNotes = String(req.body.paymentNotes || '').trim();
    registration.paymentStatus = 'PENDING_VERIFICATION';
    registration.registrationStatus = 'PENDING_APPROVAL';
    registration.status = 'Pending';
    registration.rejectionReason = '';
    registration.reservationExpiresAt = null; // Proof submitted; held for admin verification

    await registration.save();

    return res.status(200).json({
      success: true,
      message: 'Your registration details and payment proof have been submitted successfully. Our team will verify your payment and send your registration confirmation shortly.',
      data: {
        registrationId: registration.registrationId,
        paymentStatus: registration.paymentStatus,
        upiTransactionId: registration.upiTransactionId,
      },
    });
  } catch (error) {
    console.error('Error submitting payment proof:', error);
    if (req.file && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch (_) {}
    }
    return res.status(500).json({ message: 'An error occurred while uploading your payment proof. Please try again.' });
  }
}

/**
 * GET /api/admin/summit/registrations and /api/admin/dec-summit/registrations
 * Admin list endpoint supporting dedicated filters:
 * - ALL
 * - PENDING
 * - ONLINE
 * - OFFLINE
 * - PENDING_VERIFICATION
 * - CONFIRMED
 * - REJECTED
 */
async function getAdminSummitRegistrations(req, res) {
  try {
    const { status, paymentStatus, filter: filterType, query } = req.query;
    const filter = {};

    // Specific filter types requested
    if (filterType === 'ONLINE') {
      filter.paymentMethod = 'ONLINE';
    } else if (filterType === 'OFFLINE') {
      filter.paymentMethod = 'OFFLINE';
    } else if (filterType === 'PENDING_VERIFICATION') {
      filter.paymentStatus = 'PENDING_VERIFICATION';
    } else if (filterType === 'CONFIRMED') {
      filter.$or = [
        { registrationStatus: 'CONFIRMED', paymentStatus: 'PAID' },
        { registrationApproved: true, paymentApproved: true },
        { status: 'Confirmed', paymentStatus: 'PAID' },
      ];
    } else if (filterType === 'REJECTED') {
      filter.$or = [
        { registrationStatus: 'REJECTED' },
        { paymentStatus: 'REJECTED' },
        { status: 'Rejected' },
      ];
    } else if (filterType === 'PENDING') {
      filter.$or = [
        { registrationApproved: false },
        { paymentApproved: false },
        { registrationStatus: { $in: ['PENDING_APPROVAL', 'PENDING_PAYMENT'] } },
      ];
      filter.status = { $nin: ['Rejected'] };
      filter.paymentStatus = { $nin: ['REJECTED'] };
    } else {
      if (status) filter.status = status;
      if (paymentStatus) filter.paymentStatus = paymentStatus;
    }

    if (query) {
      const regex = new RegExp(String(query).trim(), 'i');
      const searchCriteria = [
        { registrationId: regex },
        { fullName: regex },
        { name: regex },
        { email: regex },
        { mobileNumber: regex },
        { phone: regex },
        { upiTransactionId: regex },
        { city: regex },
        { district: regex },
        { state: regex },
        { occupation: regex },
        { otherOccupation: regex },
        { organization: regex },
        { sessionExpectations: regex },
        { adminVerificationNotes: regex },
      ];

      if (filter.$or) {
        filter.$and = [{ $or: filter.$or }, { $or: searchCriteria }];
        delete filter.$or;
      } else {
        filter.$or = searchCriteria;
      }
    }

    const registrations = await SummitRegistration.find(filter)
      .select('-paymentScreenshotData')
      .sort({ createdAt: -1 })
      .lean();
    const capacity = await calculateActiveSeats(SummitRegistration);

    return res.json({
      success: true,
      registrations,
      capacity,
    });
  } catch (error) {
    console.error('Error fetching admin summit registrations:', error);
    return res.status(500).json({ message: 'Failed to load summit registrations.' });
  }
}

/**
 * GET /api/admin/summit/stats and /api/admin/dec-summit/stats
 * Admin dashboard KPI statistics with separate Online / Offline and Pending counters.
 */
async function getAdminSummitStats(req, res) {
  try {
    const confirmedQuery = {
      $or: [
        { registrationApproved: true, paymentApproved: true },
        { registrationStatus: 'CONFIRMED', paymentStatus: 'PAID' },
        { status: 'Confirmed', paymentStatus: 'PAID' },
      ],
    };

    const [
      totalRegistrations,
      confirmedPayments,
      pendingVerification,
      pendingPayments,
      pendingOfflinePayments,
      rejectedPayments,
      onlineCount,
      offlineCount,
      pendingTotal,
      capacity,
    ] = await Promise.all([
      SummitRegistration.countDocuments(),
      SummitRegistration.countDocuments(confirmedQuery),
      SummitRegistration.countDocuments({ paymentStatus: 'PENDING_VERIFICATION' }),
      SummitRegistration.countDocuments({ paymentStatus: { $in: ['PENDING', 'PENDING_PAYMENT'] } }),
      SummitRegistration.countDocuments({ paymentStatus: 'PENDING_OFFLINE_PAYMENT' }),
      SummitRegistration.countDocuments({
        $or: [{ paymentStatus: 'REJECTED' }, { registrationStatus: 'REJECTED' }, { status: 'Rejected' }],
      }),
      SummitRegistration.countDocuments({ paymentMethod: 'ONLINE' }),
      SummitRegistration.countDocuments({ paymentMethod: 'OFFLINE' }),
      SummitRegistration.countDocuments({
        $and: [
          {
            $or: [
              { registrationApproved: false },
              { paymentApproved: false },
              { registrationStatus: { $in: ['PENDING_APPROVAL', 'PENDING_PAYMENT'] } },
            ],
          },
          { status: { $nin: ['Rejected'] } },
          { paymentStatus: { $nin: ['REJECTED'] } },
        ],
      }),
      calculateActiveSeats(SummitRegistration),
    ]);

    return res.json({
      success: true,
      totalRegistrations,
      confirmedPayments,
      pendingVerification,
      pendingPayments,
      pendingOfflinePayments,
      rejectedPayments,
      onlineCount,
      offlineCount,
      pendingTotal,
      availableSeats: capacity.availableSeats,
      maxCapacity: SUMMIT_CONFIG.maxCapacity,
    });
  } catch (error) {
    console.error('Error fetching summit stats:', error);
    return res.status(500).json({ message: 'Failed to retrieve stats.' });
  }
}

/**
 * GET /api/admin/investor-mission/receipt/:registrationId
 * Protected image streaming endpoint for authorized admins.
 * Streams JPEG, PNG, WEBP receipts with proper Content-Type directly from MongoDB Atlas or cloud storage.
 */
async function getPaymentReceiptFile(req, res) {
  try {
    const rawId = String(req.params.registrationId || '').trim();
    if (!rawId) {
      return res.status(400).json({ success: false, message: 'Registration ID is required.' });
    }

    const mongoose = require('mongoose');
    const query = {
      $or: [
        { registrationId: rawId },
        { registrationId: rawId.toUpperCase() },
        ...(mongoose.Types.ObjectId.isValid(rawId) ? [{ _id: rawId }] : []),
      ],
    };

    const registration = await SummitRegistration.findOne(query);

    if (!registration) {
      return res.status(404).json({
        success: false,
        code: 'RECEIPT_NOT_FOUND',
        message: 'Payment screenshot not found for this registration.',
      });
    }

    // 1. Persistent binary buffer stored directly in MongoDB Atlas
    let buffer = null;
    if (registration.paymentScreenshotData) {
      if (Buffer.isBuffer(registration.paymentScreenshotData)) {
        buffer = registration.paymentScreenshotData;
      } else if (registration.paymentScreenshotData.buffer && Buffer.isBuffer(registration.paymentScreenshotData.buffer)) {
        buffer = registration.paymentScreenshotData.buffer;
      } else {
        try {
          buffer = Buffer.from(registration.paymentScreenshotData);
        } catch (_) {}
      }
    }

    if (buffer && buffer.length > 0) {
      const mime = registration.paymentScreenshotMimeType || 'image/jpeg';
      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Length', buffer.length);
      res.setHeader('Cache-Control', 'private, max-age=86400');
      res.setHeader('Content-Disposition', `inline; filename="${registration.paymentScreenshot || `${registration.registrationId}-receipt.jpg`}"`);
      return res.end(buffer);
    }

    // 2. Cloud storage URL (e.g. Cloudinary) - proxy stream directly to avoid browser CORS/Auth header issues
    if (registration.paymentScreenshotUrl && /^https?:\/\//i.test(registration.paymentScreenshotUrl)) {
      try {
        const cloudRes = await fetch(registration.paymentScreenshotUrl, {
          signal: AbortSignal.timeout(10000),
        });
        if (cloudRes.ok) {
          const arrayBuffer = await cloudRes.arrayBuffer();
          const cloudBuffer = Buffer.from(arrayBuffer);
          const mime = cloudRes.headers.get('content-type') || registration.paymentScreenshotMimeType || 'image/jpeg';

          // Backfill into MongoDB Atlas so future retrievals don't even need the external roundtrip
          registration.paymentScreenshotData = cloudBuffer;
          registration.paymentScreenshotSize = cloudBuffer.length;
          registration.paymentScreenshotMimeType = mime;
          await registration.save().catch(() => {});

          res.setHeader('Content-Type', mime);
          res.setHeader('Content-Length', cloudBuffer.length);
          res.setHeader('Cache-Control', 'private, max-age=86400');
          res.setHeader('Content-Disposition', `inline; filename="${registration.paymentScreenshot || `${registration.registrationId}-receipt.jpg`}"`);
          return res.end(cloudBuffer);
        }
      } catch (cloudErr) {
        console.warn(`[getPaymentReceiptFile] Failed to proxy cloud URL for ${rawId}:`, cloudErr.message);
      }
    }

    // 3. Fallback: check local disk cache
    if (registration.paymentScreenshot) {
      const candidates = [
        path.join(UPLOAD_DIR, registration.paymentScreenshot),
        path.join(process.cwd(), 'uploads', 'receipts', registration.paymentScreenshot),
        path.join(__dirname, '../../uploads/receipts', registration.paymentScreenshot),
      ];
      for (const filePath of candidates) {
        if (fs.existsSync(filePath)) {
          const fileBuf = fs.readFileSync(filePath);
          // Automatically backfill MongoDB Atlas buffer
          registration.paymentScreenshotData = fileBuf;
          registration.paymentScreenshotSize = fileBuf.length;
          await registration.save().catch(() => {});

          const mime = registration.paymentScreenshotMimeType || 'image/jpeg';
          res.setHeader('Content-Type', mime);
          res.setHeader('Content-Length', fileBuf.length);
          res.setHeader('Cache-Control', 'private, max-age=86400');
          res.setHeader('Content-Disposition', `inline; filename="${registration.paymentScreenshot}"`);
          return res.end(fileBuf);
        }
      }
    }

    // 4. File is genuinely unavailable (legacy upload on ephemeral disk prior to persistent storage)
    return res.status(404).json({
      success: false,
      code: 'RECEIPT_FILE_UNAVAILABLE',
      message: 'Payment screenshot file is not available on the server (it was submitted prior to persistent storage enablement). Participant details and UTR number remain preserved.',
      registrationId: registration.registrationId,
      upiTransactionId: registration.upiTransactionId,
      paymentStatus: registration.paymentStatus,
    });
  } catch (error) {
    console.error('Error serving receipt file:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve payment receipt.' });
  }
}

/**
 * Internal atomic helper to evaluate combined two-step approval:
 * Confirms seat only when BOTH registrationApproved AND paymentApproved are true.
 * Performs atomic capacity check before marking seat CONFIRMED.
 */
async function evaluateCombinedApproval(registration, adminEmail, adminNotes) {
  if (registration.registrationApproved && registration.paymentApproved) {
    // If already confirmed, nothing changes
    if (registration.registrationStatus === 'CONFIRMED' && registration.paymentStatus === 'PAID') {
      return { success: true, confirmed: true };
    }

    const maxCapacity = SUMMIT_CONFIG.maxCapacity || 80;

    // Check if MongoDB session / transactions available (e.g. MongoDB Atlas replica set)
    const mongoose = require('mongoose');
    let session = null;
    try {
      if (mongoose.connection?.readyState === 1 && typeof mongoose.connection.startSession === 'function') {
        session = await mongoose.connection.startSession();
      }
    } catch (_) {
      session = null;
    }

    if (session) {
      try {
        session.startTransaction();
        const currentConfirmed = await SummitRegistration.countDocuments({
          _id: { $ne: registration._id },
          $or: [
            { registrationApproved: true, paymentApproved: true },
            { registrationStatus: 'CONFIRMED', paymentStatus: 'PAID' },
            { status: 'Confirmed', paymentStatus: 'PAID' },
          ],
        }).session(session);

        if (currentConfirmed >= maxCapacity) {
          await session.abortTransaction();
          session.endSession();
          return {
            success: false,
            capacityReached: true,
            error: `Investor Mission 2026 capacity (${maxCapacity} confirmed seats) has been reached. Cannot confirm additional registrations.`,
          };
        }

        // Generate secure check-in token and hash if not already generated
        if (!registration.checkInTokenHash) {
          const rawToken = crypto.randomBytes(24).toString('hex');
          registration.checkInToken = rawToken;
          registration.checkInTokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
        }

        registration.registrationStatus = 'CONFIRMED';
        registration.paymentStatus = 'PAID';
        registration.status = 'Confirmed';
        registration.registrationApproved = true;
        registration.paymentApproved = true;
        registration.approvedAt = new Date();
        registration.paymentVerifiedAt = new Date();
        registration.paymentVerifiedBy = adminEmail || 'admin@halalwealth.finance';
        registration.rejectionReason = '';
        if (adminNotes) {
          registration.adminNotes = String(adminNotes).trim();
        }

        await registration.save({ session });
        await session.commitTransaction();
        session.endSession();
      } catch (txError) {
        if (session) {
          await session.abortTransaction().catch(() => {});
          session.endSession();
        }
        throw txError;
      }
    } else {
      const currentConfirmed = await SummitRegistration.countDocuments({
        _id: { $ne: registration._id },
        $or: [
          { registrationApproved: true, paymentApproved: true },
          { registrationStatus: 'CONFIRMED', paymentStatus: 'PAID' },
          { status: 'Confirmed', paymentStatus: 'PAID' },
        ],
      });

      if (currentConfirmed >= maxCapacity) {
        return {
          success: false,
          capacityReached: true,
          error: `Investor Mission 2026 capacity (${maxCapacity} confirmed seats) has been reached. Cannot confirm additional registrations.`,
        };
      }

      if (!registration.checkInTokenHash) {
        const rawToken = crypto.randomBytes(24).toString('hex');
        registration.checkInToken = rawToken;
        registration.checkInTokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      }

      registration.registrationStatus = 'CONFIRMED';
      registration.paymentStatus = 'PAID';
      registration.status = 'Confirmed';
      registration.registrationApproved = true;
      registration.paymentApproved = true;
      registration.approvedAt = new Date();
      registration.paymentVerifiedAt = new Date();
      registration.paymentVerifiedBy = adminEmail || 'admin@halalwealth.finance';
      registration.rejectionReason = '';
      if (adminNotes) {
        registration.adminNotes = String(adminNotes).trim();
      }

      await registration.save();
    }

    // Prevent duplicate confirmation emails if already sent
    if (!registration.confirmationEmailSent && registration.confirmationEmailStatus !== 'SENT') {
      const baseUrl = process.env.PUBLIC_APP_URL || process.env.BASE_URL || 'https://halalwealth.finance';
      const checkInUrl = `${baseUrl.replace(/\/$/, '')}/api/investor-mission/checkin/verify/${registration.checkInToken || registration.registrationId}`;

      investorMissionEmailService.sendInvestorMissionConfirmation({
        recipientEmail: registration.email,
        participantName: registration.fullName || registration.name,
        registrationId: registration.registrationId,
        checkInUrl,
      })
        .then(() => {
          return SummitRegistration.updateOne(
            { _id: registration._id },
            {
              $set: {
                confirmationEmailSent: true,
                confirmationEmailStatus: 'SENT',
                confirmationEmailSentAt: new Date(),
                confirmationEmailLastAttemptAt: new Date(),
                confirmationEmailLastError: null,
                confirmationEmailNextRetryAt: null,
                confirmationEmailLockUntil: null,
              },
              $inc: { confirmationEmailAttempts: 1 },
            }
          ).catch(() => {});
        })
        .catch(err => {
          console.warn('Failed to send Investor Mission confirmation email:', err.message);
          const currentAttempts = (registration.confirmationEmailAttempts || 0) + 1;
          const nextRetryAt = typeof calculateNextRetryAt === 'function' ? calculateNextRetryAt(currentAttempts) : new Date(Date.now() + 60000);
          return SummitRegistration.updateOne(
            { _id: registration._id },
            {
              $set: {
                confirmationEmailSent: false,
                confirmationEmailStatus: 'FAILED',
                confirmationEmailLastError: String(err.message).slice(0, 500),
                confirmationEmailLastAttemptAt: new Date(),
                confirmationEmailNextRetryAt: nextRetryAt,
                confirmationEmailLockUntil: null,
              },
              $inc: { confirmationEmailAttempts: 1 },
            }
          ).catch(() => {});
        });
    }

    return { success: true, confirmed: true };
  } else {
    // One or none approved: remains PENDING_APPROVAL
    registration.registrationStatus = 'PENDING_APPROVAL';
    registration.status = 'Pending';
    if (adminNotes) {
      registration.adminNotes = String(adminNotes).trim();
    }
    await registration.save();
    return { success: true, confirmed: false };
  }
}

/**
 * POST /api/admin/summit/registrations/:registrationId/approve-registration
 * Action 1: Admin approves participant registration details.
 */
async function approveSummitRegistration(req, res) {
  try {
    const { registrationId } = req.params;
    const { adminNotes } = req.body;
    const registration = await SummitRegistration.findOne({ registrationId: String(registrationId).trim() });

    if (!registration) {
      return res.status(404).json({ message: 'Registration not found.' });
    }

    // Backend Protection: Check if participant registration & payment are already confirmed
    const isAlreadyConfirmed =
      (registration.registrationStatus === 'CONFIRMED' && registration.paymentStatus === 'PAID') ||
      (registration.registrationApproved && registration.paymentApproved);

    if (isAlreadyConfirmed) {
      return res.status(200).json({
        success: true,
        alreadyConfirmed: true,
        message: `Participant ${registration.registrationId} seat and registration details are already confirmed.`,
        data: registration,
        isConfirmed: true,
      });
    }

    registration.registrationApproved = true;
    registration.registrationApprovedAt = new Date();
    registration.registrationApprovedBy = req.admin?.email || 'admin@halalwealth.finance';
    registration.rejectionReason = '';

    const approvalResult = await evaluateCombinedApproval(registration, req.admin?.email, adminNotes);
    if (!approvalResult.success) {
      return res.status(400).json({ message: approvalResult.error });
    }

    const message = approvalResult.confirmed
      ? 'Registration and payment approved! Participant seat is now CONFIRMED.'
      : 'Registration details approved. Participant seat will be confirmed once payment is also approved.';

    return res.json({
      success: true,
      message,
      data: registration,
      isConfirmed: approvalResult.confirmed,
    });
  } catch (error) {
    console.error('Error approving registration:', error);
    return res.status(500).json({ message: 'Failed to approve registration.' });
  }
}

/**
 * POST /api/admin/summit/registrations/:registrationId/approve and /approve-payment
 * Action 2: Admin approves payment (Online UPI or Offline).
 * Automatically marks registration as CONFIRMED, reserves 1 seat in Investor Mission 2026,
 * and triggers final seat confirmation email with check-in QR code.
 */
async function approveSummitPayment(req, res) {
  try {
    const { registrationId } = req.params;
    const { adminNotes } = req.body;
    const registration = await SummitRegistration.findOne({ registrationId: String(registrationId).trim() });

    if (!registration) {
      return res.status(404).json({ message: 'Registration not found.' });
    }

    // Backend Protection: Check if already confirmed & paid - prevent re-approval or double confirmation
    const isAlreadyConfirmed =
      (registration.registrationStatus === 'CONFIRMED' && registration.paymentStatus === 'PAID') ||
      (registration.registrationApproved && registration.paymentApproved);

    if (isAlreadyConfirmed) {
      return res.status(200).json({
        success: true,
        alreadyConfirmed: true,
        message: `Participant ${registration.registrationId} seat and payment are already confirmed.`,
        data: registration,
        isConfirmed: true,
      });
    }

    // 1. Verify required registration fields are satisfied:
    const cleanName = String(registration.fullName || registration.name || '').trim();
    if (!cleanName || cleanName.length < 3) {
      return res.status(400).json({ message: 'Cannot approve: Participant name is invalid or missing.' });
    }
    if (!registration.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(registration.email)) {
      return res.status(400).json({ message: 'Cannot approve: Participant email is invalid.' });
    }

    // 2. Mark both payment and registration approved for single-click Investor Mission 2026 approval
    registration.paymentApproved = true;
    registration.paymentApprovedAt = new Date();
    registration.paymentApprovedBy = req.admin?.email || 'admin@halalwealth.finance';
    registration.registrationApproved = true;
    registration.registrationApprovedAt = registration.registrationApprovedAt || new Date();
    registration.registrationApprovedBy = req.admin?.email || 'admin@halalwealth.finance';
    registration.rejectionReason = '';

    const approvalResult = await evaluateCombinedApproval(registration, req.admin?.email, adminNotes);
    if (!approvalResult.success) {
      return res.status(400).json({
        success: false,
        capacityReached: Boolean(approvalResult.capacityReached),
        message: approvalResult.error,
      });
    }

    const message = 'Payment verified and seat officially CONFIRMED! Final seat confirmation email is being dispatched.';

    return res.json({
      success: true,
      message,
      data: registration,
      isConfirmed: approvalResult.confirmed,
    });
  } catch (error) {
    console.error('Error approving payment:', error);
    return res.status(500).json({ message: 'Failed to approve payment.' });
  }
}

/**
 * POST /api/admin/summit/registrations/:registrationId/reject-registration
 * Action 3: Admin rejects participant registration.
 */
async function rejectSummitRegistration(req, res) {
  try {
    const { registrationId } = req.params;
    const { reason, adminNotes } = req.body;
    const registration = await SummitRegistration.findOne({ registrationId: String(registrationId).trim() });

    if (!registration) {
      return res.status(404).json({ message: 'Registration not found.' });
    }

    // Backend Protection: Prevent rejecting an already confirmed & paid participant through direct API
    const isAlreadyConfirmed =
      (registration.registrationStatus === 'CONFIRMED' && registration.paymentStatus === 'PAID') ||
      (registration.registrationApproved && registration.paymentApproved) ||
      registration.status === 'Checked-In';

    if (isAlreadyConfirmed) {
      return res.status(400).json({
        success: false,
        alreadyConfirmed: true,
        message: `Cannot reject participant ${registration.registrationId}: Seat is already confirmed and payment is marked as PAID.`,
        data: registration,
      });
    }

    registration.registrationApproved = false;
    registration.registrationStatus = 'REJECTED';
    registration.status = 'Rejected';
    registration.rejectionReason = String(reason || 'Registration rejected by organizer.').trim();
    if (adminNotes) registration.adminNotes = String(adminNotes).trim();

    await registration.save();

    return res.json({
      success: true,
      message: 'Registration rejected. Seat has been released.',
      data: registration,
    });
  } catch (error) {
    console.error('Error rejecting registration:', error);
    return res.status(500).json({ message: 'Failed to reject registration.' });
  }
}

/**
 * POST /api/admin/summit/registrations/:registrationId/reject and /reject-payment
 * Action 4: Admin rejects payment proof with a reason.
 * Unconfirms seat, sets paymentStatus to REJECTED, and does not send seat confirmation email.
 */
async function rejectSummitPayment(req, res) {
  try {
    const { registrationId } = req.params;
    const { reason, adminNotes } = req.body;
    const registration = await SummitRegistration.findOne({ registrationId: String(registrationId).trim() });

    if (!registration) {
      return res.status(404).json({ message: 'Registration not found.' });
    }

    // Backend Protection: Prevent rejecting an already confirmed & paid participant through direct API
    const isAlreadyConfirmed =
      (registration.registrationStatus === 'CONFIRMED' && registration.paymentStatus === 'PAID') ||
      (registration.registrationApproved && registration.paymentApproved) ||
      registration.status === 'Checked-In';

    if (isAlreadyConfirmed) {
      return res.status(400).json({
        success: false,
        alreadyConfirmed: true,
        message: `Cannot reject participant ${registration.registrationId}: Seat is already confirmed and payment is marked as PAID.`,
        data: registration,
      });
    }

    registration.paymentApproved = false;
    registration.registrationApproved = false;
    registration.paymentStatus = 'REJECTED';
    registration.registrationStatus = 'REJECTED';
    registration.status = 'Rejected';
    registration.rejectionReason = String(reason || 'Payment verification failed. Please verify your reference or re-upload a clear receipt.').trim();
    if (adminNotes) registration.adminNotes = String(adminNotes).trim();

    await registration.save();

    return res.json({
      success: true,
      message: 'Payment rejected. Participant registration remains unconfirmed.',
      data: registration,
    });
  } catch (error) {
    console.error('Error rejecting payment:', error);
    return res.status(500).json({ message: 'Failed to reject payment.' });
  }
}

/**
 * POST /api/admin/summit/registrations/:registrationId/record-offline-payment
 * Action 5: Admin records offline payment (Cash, Bank Transfer, Venue desk, etc.)
 */
async function recordOfflinePayment(req, res) {
  try {
    const { registrationId } = req.params;
    const {
      paymentAmount = 500,
      paymentDate,
      offlinePaymentMethod = 'Cash',
      adminVerificationNotes = '',
      approvePayment = true,
    } = req.body;

    const registration = await SummitRegistration.findOne({ registrationId: String(registrationId).trim() });
    if (!registration) {
      return res.status(404).json({ message: 'Registration not found.' });
    }

    // Backend Protection: Check if already confirmed & paid
    const isAlreadyConfirmed =
      (registration.registrationStatus === 'CONFIRMED' && registration.paymentStatus === 'PAID') ||
      (registration.registrationApproved && registration.paymentApproved);

    if (approvePayment && isAlreadyConfirmed) {
      return res.status(200).json({
        success: true,
        alreadyConfirmed: true,
        message: `Participant ${registration.registrationId} seat and offline payment are already confirmed.`,
        data: registration,
        isConfirmed: true,
      });
    }

    registration.offlinePaymentRecorded = true;
    registration.paymentAmount = Number(paymentAmount) || 500;
    registration.offlinePaymentDate = paymentDate ? new Date(paymentDate) : new Date();
    registration.offlinePaymentMethod = String(offlinePaymentMethod || 'Cash').trim();
    registration.offlinePaymentRecordedBy = req.admin?.email || 'admin@halalwealth.finance';
    if (adminVerificationNotes) {
      registration.adminVerificationNotes = String(adminVerificationNotes).trim();
    }

    if (approvePayment) {
      registration.paymentApproved = true;
      registration.paymentApprovedAt = new Date();
      registration.paymentApprovedBy = req.admin?.email || 'admin@halalwealth.finance';
      registration.paymentStatus = 'PAID';
    }

    const approvalResult = await evaluateCombinedApproval(registration, req.admin?.email, adminVerificationNotes);
    if (!approvalResult.success) {
      return res.status(400).json({ message: approvalResult.error });
    }

    const message = approvalResult.confirmed
      ? 'Offline payment recorded and both approvals complete! Participant seat is now CONFIRMED.'
      : 'Offline payment recorded successfully. Participant seat will be confirmed once registration details are approved.';

    return res.json({
      success: true,
      message,
      data: registration,
      isConfirmed: approvalResult.confirmed,
    });
  } catch (error) {
    console.error('Error recording offline payment:', error);
    return res.status(500).json({ message: 'Failed to record offline payment.' });
  }
}

/**
 * POST /api/admin/summit/registrations/:registrationId/notes
 * Action 6: Admin updates verification notes.
 */
async function addAdminVerificationNotes(req, res) {
  try {
    const { registrationId } = req.params;
    const { adminVerificationNotes, adminNotes } = req.body;
    const notes = String(adminVerificationNotes || adminNotes || '').trim();

    const registration = await SummitRegistration.findOne({ registrationId: String(registrationId).trim() });
    if (!registration) {
      return res.status(404).json({ message: 'Registration not found.' });
    }

    registration.adminVerificationNotes = notes;
    if (adminNotes) registration.adminNotes = notes;
    await registration.save();

    return res.json({
      success: true,
      message: 'Verification notes updated successfully.',
      data: registration,
    });
  } catch (error) {
    console.error('Error updating verification notes:', error);
    return res.status(500).json({ message: 'Failed to update verification notes.' });
  }
}

/**
 * Render responsive HTML pass verification card for browser scanning
 */
function renderVerificationHtml({
  verified,
  registrationId,
  participantName,
  attendanceStatus,
  isAlreadyCheckedIn,
  message,
}) {
  const safeName = (participantName || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const safeRegId = (registrationId || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const safeMsg = (message || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  const badgeColor = verified ? (isAlreadyCheckedIn ? '#d97706' : '#16a34a') : '#dc2626';
  const badgeText = verified ? (isAlreadyCheckedIn ? 'ALREADY CHECKED IN' : 'VALID PASS — CONFIRMED') : 'INVALID / UNCONFIRMED';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Investor Mission 2026 – Check-In Verification</title>
  <style>
    body { margin: 0; padding: 20px; background: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b; display: flex; justify-content: center; align-items: center; min-height: 90vh; }
    .card { background: #fff; max-width: 440px; width: 100%; border-radius: 16px; box-shadow: 0 10px 25px rgba(5,55,38,0.1); overflow: hidden; border: 1px solid #e2e8f0; text-align: center; }
    .header { background: #053726; color: #fff; padding: 24px 20px; }
    .header h1 { margin: 0 0 4px; font-size: 18px; letter-spacing: 1px; color: #80df35; text-transform: uppercase; }
    .header p { margin: 0; font-size: 13px; color: #d8ae54; }
    .body { padding: 28px 24px; }
    .badge { display: inline-block; padding: 6px 14px; border-radius: 20px; color: #fff; font-size: 12px; font-weight: 700; background: ${badgeColor}; margin-bottom: 20px; letter-spacing: 0.5px; }
    .name { font-size: 20px; font-weight: 800; color: #053726; margin: 0 0 6px; }
    .reg-id { font-size: 14px; color: #64748b; font-weight: 600; margin: 0 0 20px; }
    .details { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 16px; margin: 0 0 20px; text-align: left; font-size: 13px; line-height: 1.8; }
    .details strong { color: #053726; }
    .instructions { font-size: 12px; color: #64748b; line-height: 1.5; margin: 0; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h1>Investor Mission 2026</h1>
      <p>The Halal Way of Investing</p>
    </div>
    <div class="body">
      <div class="badge">${badgeText}</div>
      ${verified ? `
        <div class="name">${safeName}</div>
        <div class="reg-id">Registration ID: <strong>${safeRegId}</strong></div>
        <div class="details">
          <div><strong>Event:</strong> Investor Mission 2026</div>
          <div><strong>Date:</strong> Sunday, 06 December 2026</div>
          <div><strong>Venue:</strong> Siruthuli Noyyal Life Centre</div>
          <div><strong>Address:</strong> Ukkadam Sungam Bypass Rd, Shanmuga Nagar, Ramanathapuram, Coimbatore, Tamil Nadu 641023, India.</div>
          <div style="margin-top: 6px;">
            <a href="https://maps.google.com/?q=Siruthuli+Noyyal+Life+Centre,+Ukkadam+Sungam+Bypass+Rd,+Shanmuga+Nagar,+Ramanathapuram,+Coimbatore,+Tamil+Nadu+641023" target="_blank" style="color: #053726; font-weight: 700; text-decoration: underline; font-size: 12px;">
              📍 Open in Google Maps &amp; Get Directions &rarr;
            </a>
          </div>
          <div style="margin-top: 6px;"><strong>Status:</strong> ${isAlreadyCheckedIn ? 'Checked-In' : 'Confirmed Attendee'}</div>
        </div>
        <p class="instructions">Please present this screen or your email QR code to the registration desk upon entrance.</p>
      ` : `
        <div style="color: #dc2626; font-weight: 600; margin-bottom: 12px;">Verification Failed</div>
        <p style="color: #64748b; font-size: 14px; margin: 0 0 16px;">${safeMsg || 'This check-in pass could not be verified.'}</p>
        <p class="instructions">If you believe this is an error, please visit the event help desk with your registration details.</p>
      `}
    </div>
  </div>
</body>
</html>`;
}

/**
 * GET /api/investor-mission/checkin/verify/:token
 * Public endpoint to verify a scanned check-in QR code token.
 * Returns safe attendee verification details without exposing private PII.
 */
async function verifyCheckInToken(req, res) {
  try {
    const rawToken = String(req.params.token || '').trim();
    if (!rawToken) {
      return res.status(400).json({ success: false, verified: false, message: 'Check-in token is missing.' });
    }

    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const registration = await SummitRegistration.findOne({
      $or: [
        { checkInTokenHash: tokenHash },
        { checkInToken: rawToken },
        { registrationId: rawToken.toUpperCase() },
      ],
    }).lean();

    const acceptsHtml = req.accepts(['json', 'html']) === 'html';

    if (!registration) {
      if (acceptsHtml) {
        return res.status(404).send(renderVerificationHtml({ verified: false, message: 'Invalid or unrecognized check-in token.' }));
      }
      return res.status(404).json({ success: false, verified: false, message: 'Invalid or unrecognized check-in token.' });
    }

    const isConfirmed = (registration.registrationApproved && registration.paymentApproved) ||
      (registration.registrationStatus === 'CONFIRMED' && registration.paymentStatus === 'PAID') ||
      (registration.status === 'Confirmed' && registration.paymentStatus === 'PAID') ||
      registration.status === 'Checked-In';

    if (!isConfirmed) {
      if (acceptsHtml) {
        return res.status(400).send(renderVerificationHtml({
          verified: false,
          registrationId: registration.registrationId,
          participantName: registration.fullName || registration.name,
          message: 'Registration is not confirmed or ₹500 payment is pending verification.',
        }));
      }
      return res.status(400).json({
        success: false,
        verified: false,
        registrationId: registration.registrationId,
        participantName: registration.fullName || registration.name,
        message: 'Registration is not confirmed or ₹500 payment is pending verification.',
      });
    }

    const isCheckedIn = registration.attendanceStatus === 'CHECKED_IN' || registration.status === 'Checked-In';

    if (acceptsHtml) {
      return res.send(renderVerificationHtml({
        verified: true,
        registrationId: registration.registrationId,
        participantName: registration.fullName || registration.name,
        attendanceStatus: registration.attendanceStatus || (isCheckedIn ? 'CHECKED_IN' : 'NOT_CHECKED_IN'),
        checkedInAt: registration.checkedInAt,
        isAlreadyCheckedIn: isCheckedIn,
      }));
    }

    return res.json({
      success: true,
      verified: true,
      registrationId: registration.registrationId,
      participantName: registration.fullName || registration.name,
      attendanceStatus: registration.attendanceStatus || (isCheckedIn ? 'CHECKED_IN' : 'NOT_CHECKED_IN'),
      checkedInAt: registration.checkedInAt,
      isAlreadyCheckedIn: isCheckedIn,
      paymentStatus: registration.paymentStatus,
      status: registration.registrationStatus,
    });
  } catch (error) {
    console.error('Error verifying check-in token:', error);
    return res.status(500).json({ success: false, message: 'Server error verifying check-in token.' });
  }
}

/**
 * POST /api/admin/investor-mission/checkin
 * Admin-protected check-in: verifies attendee and marks attendance status to CHECKED_IN.
 * Prevents duplicate check-ins.
 */
async function checkInParticipant(req, res) {
  try {
    const { token, registrationId } = req.body;
    const lookupKey = String(token || registrationId || '').trim();

    if (!lookupKey) {
      return res.status(400).json({ success: false, message: 'Token or Registration ID is required.' });
    }

    const tokenHash = crypto.createHash('sha256').update(lookupKey).digest('hex');
    const registration = await SummitRegistration.findOne({
      $or: [
        { checkInTokenHash: tokenHash },
        { checkInToken: lookupKey },
        { registrationId: lookupKey.toUpperCase() },
      ],
    });

    if (!registration) {
      return res.status(404).json({ success: false, message: 'Participant registration not found.' });
    }

    // Verify confirmation and payment
    const isConfirmed = (registration.registrationApproved && registration.paymentApproved) ||
      (registration.registrationStatus === 'CONFIRMED' && registration.paymentStatus === 'PAID') ||
      (registration.status === 'Confirmed' && registration.paymentStatus === 'PAID') ||
      registration.status === 'Checked-In';

    if (!isConfirmed) {
      return res.status(400).json({
        success: false,
        message: 'Cannot check in: Participant registration is not confirmed or payment is pending.',
        registrationId: registration.registrationId,
        participantName: registration.fullName || registration.name,
      });
    }

    // Prevent duplicate check-in
    if (registration.attendanceStatus === 'CHECKED_IN' || registration.status === 'Checked-In') {
      return res.status(409).json({
        success: false,
        alreadyCheckedIn: true,
        message: 'Already Checked In',
        registrationId: registration.registrationId,
        participantName: registration.fullName || registration.name,
        checkedInAt: registration.checkedInAt,
        checkedInBy: registration.checkedInBy,
      });
    }

    // Mark check-in
    registration.attendanceStatus = 'CHECKED_IN';
    registration.status = 'Checked-In';
    registration.checkedInAt = new Date();
    registration.checkedInBy = req.admin?.email || 'admin@halalwealth.finance';

    await registration.save();

    return res.json({
      success: true,
      message: 'Check-in successful! Attendee marked as present.',
      registrationId: registration.registrationId,
      participantName: registration.fullName || registration.name,
      checkedInAt: registration.checkedInAt,
      checkedInBy: registration.checkedInBy,
      attendanceStatus: 'CHECKED_IN',
    });
  } catch (error) {
    console.error('Error during participant check-in:', error);
    return res.status(500).json({ success: false, message: 'Server error processing check-in.' });
  }
}

/**
 * GET /api/admin/investor-mission/attendance
 * Admin-protected: Returns confirmed attendees with attendance statistics.
 */
async function getAttendanceStats(req, res) {
  try {
    let findQuery = SummitRegistration.find({
      $or: [
        { registrationApproved: true, paymentApproved: true },
        { registrationStatus: 'CONFIRMED' },
        { status: 'Confirmed' },
        { status: 'Checked-In' },
      ],
    });
    if (typeof findQuery.select === 'function') {
      findQuery = findQuery.select('-paymentScreenshotData');
    }
    const attendees = await findQuery.sort({ createdAt: -1 });

    const totalConfirmed = attendees.length;
    const totalCheckedIn = attendees.filter(a => a.attendanceStatus === 'CHECKED_IN' || a.status === 'Checked-In').length;
    const remainingNotCheckedIn = Math.max(0, totalConfirmed - totalCheckedIn);

    return res.json({
      success: true,
      stats: {
        totalConfirmed,
        totalCheckedIn,
        remainingNotCheckedIn,
      },
      attendees,
    });
  } catch (error) {
    console.error('Error fetching attendance stats:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch attendance statistics.' });
  }
}

/**
 * GET /api/admin/investor-mission/attendance/export
 * Admin-protected: Export attendance list as CSV.
 */
async function exportAttendanceCsv(req, res) {
  try {
    let findQuery = SummitRegistration.find({
      $or: [
        { registrationApproved: true, paymentApproved: true },
        { registrationStatus: 'CONFIRMED' },
        { status: 'Confirmed' },
        { status: 'Checked-In' },
      ],
    });
    if (typeof findQuery.select === 'function') {
      findQuery = findQuery.select('-paymentScreenshotData');
    }
    const attendees = await findQuery
      .sort({ registrationId: 1 })
      .lean();

    const headers = [
      'Registration ID',
      'Full Name',
      'Email',
      'Mobile Number',
      'City',
      'State',
      'Payment Status',
      'Attendance Status',
      'Checked In At',
      'Checked In By',
      'Email Status',
    ];

    const escapeCsv = (val) => {
      const str = String(val ?? '').replace(/"/g, '""');
      return `"${str}"`;
    };

    const rows = attendees.map(a => [
      escapeCsv(a.registrationId),
      escapeCsv(a.fullName || a.name),
      escapeCsv(a.email),
      escapeCsv(a.mobileNumber || a.phone),
      escapeCsv(a.city),
      escapeCsv(a.state),
      escapeCsv(a.paymentStatus),
      escapeCsv(a.attendanceStatus || (a.status === 'Checked-In' ? 'CHECKED_IN' : 'NOT_CHECKED_IN')),
      escapeCsv(a.checkedInAt ? new Date(a.checkedInAt).toISOString() : ''),
      escapeCsv(a.checkedInBy || ''),
      escapeCsv(a.confirmationEmailStatus || (a.confirmationEmailSent ? 'SENT' : 'NOT_SENT')),
    ].join(','));

    const csvContent = [headers.join(','), ...rows].join('\r\n');
    const filename = `investor-mission-attendance-${new Date().toISOString().slice(0, 10)}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(csvContent);
  } catch (error) {
    console.error('Error exporting attendance CSV:', error);
    return res.status(500).json({ success: false, message: 'Failed to export attendance CSV.' });
  }
}

/**
 * POST /api/admin/investor-mission/registrations/:registrationId/resend-confirmation
 * and /send-confirmation
 * Admin-protected: Retry or resend confirmation email with QR code.
 */
async function resendConfirmationEmail(req, res) {
  let registration = null;
  try {
    const { registrationId } = req.params;
    registration = await SummitRegistration.findOne({ registrationId: String(registrationId).trim() });

    if (!registration) {
      return res.status(404).json({ success: false, message: 'Registration not found.' });
    }

    const isConfirmed = (registration.registrationApproved && registration.paymentApproved) ||
      (registration.registrationStatus === 'CONFIRMED' && registration.paymentStatus === 'PAID') ||
      (registration.status === 'Confirmed' && registration.paymentStatus === 'PAID') ||
      registration.status === 'Checked-In';

    if (!isConfirmed) {
      return res.status(400).json({
        success: false,
        message: 'Cannot send confirmation email: Both registration and ₹500 payment must be approved first.',
      });
    }

    if (!registration.checkInTokenHash) {
      const rawToken = crypto.randomBytes(24).toString('hex');
      registration.checkInToken = rawToken;
      registration.checkInTokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      await registration.save();
    }

    const baseUrl = process.env.PUBLIC_APP_URL || process.env.BASE_URL || 'https://halalwealth.finance';
    const checkInUrl = `${baseUrl.replace(/\/$/, '')}/api/investor-mission/checkin/verify/${registration.checkInToken || registration.registrationId}`;

    await investorMissionEmailService.sendInvestorMissionConfirmation({
      recipientEmail: registration.email,
      participantName: registration.fullName || registration.name,
      registrationId: registration.registrationId,
      checkInUrl,
    });

    registration.confirmationEmailSent = true;
    registration.confirmationEmailStatus = 'SENT';
    registration.confirmationEmailSentAt = new Date();
    registration.confirmationEmailLastAttemptAt = new Date();
    registration.confirmationEmailLastError = null;
    registration.confirmationEmailNextRetryAt = null;
    registration.confirmationEmailLockUntil = null;
    registration.confirmationEmailAttempts = (registration.confirmationEmailAttempts || 0) + 1;
    await registration.save();

    return res.json({
      success: true,
      message: `Confirmation email with check-in QR code sent successfully to ${registration.email}.`,
      emailStatus: 'SENT',
      attempts: registration.confirmationEmailAttempts,
      data: {
        confirmationEmailStatus: 'SENT',
        confirmationEmailSentAt: registration.confirmationEmailSentAt,
        confirmationEmailAttempts: registration.confirmationEmailAttempts,
      },
    });
  } catch (error) {
    console.error('Error sending confirmation email:', error);
    if (registration) {
      const attempts = (registration.confirmationEmailAttempts || 0) + 1;
      const nextRetryAt = typeof calculateNextRetryAt === 'function' ? calculateNextRetryAt(attempts) : new Date(Date.now() + 60000);
      registration.confirmationEmailStatus = 'FAILED';
      registration.confirmationEmailLastError = String(error.message).slice(0, 500);
      registration.confirmationEmailLastAttemptAt = new Date();
      registration.confirmationEmailNextRetryAt = nextRetryAt;
      registration.confirmationEmailLockUntil = null;
      registration.confirmationEmailAttempts = attempts;
      await registration.save().catch(() => {});
    }
    return res.status(500).json({
      success: false,
      message: `Failed to send confirmation email: ${error.message}`,
      emailStatus: 'FAILED',
      error: error.message,
      attempts: registration?.confirmationEmailAttempts,
      data: {
        confirmationEmailStatus: 'FAILED',
        confirmationEmailLastError: registration?.confirmationEmailLastError,
        confirmationEmailAttempts: registration?.confirmationEmailAttempts,
      },
    });
  }
}

/**
 * GET & POST /api/admin/investor-mission/email-diagnostic
 * Admin-protected: Verify Resend HTTPS API (Port 443) health, latency, domain verification, and optional test send.
 */
async function getInvestorMissionEmailDiagnostic(req, res) {
  try {
    const testRecipient = req.body?.testRecipient || req.query?.testRecipient || (req.body?.sendTestEmail ? req.admin?.email : null);
    const diagnostic = await investorMissionEmailService.verifyEmailService({ testRecipient });
    return res.json(diagnostic);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      success: false,
      error: error.message,
    });
  }
}

/**
 * POST /api/admin/investor-mission/registrations/:registrationId/resend-acknowledgement
 * Admin-protected: Retry or resend the Registration Received acknowledgement email.
 */
async function resendAcknowledgementEmail(req, res) {
  try {
    const { registrationId } = req.params;
    const registration = await SummitRegistration.findOne({ registrationId: String(registrationId).trim() });

    if (!registration) {
      return res.status(404).json({ success: false, message: 'Registration not found.' });
    }

    await investorMissionEmailService.sendInvestorMissionAcknowledgement({
      recipientEmail: registration.email,
      participantName: registration.fullName || registration.name,
      registrationId: registration.registrationId,
    });

    registration.acknowledgementEmailSent = true;
    registration.acknowledgementEmailStatus = 'SENT';
    registration.acknowledgementEmailSentAt = new Date();
    registration.acknowledgementEmailLastError = null;
    await registration.save();

    return res.json({
      success: true,
      message: `Registration acknowledgement email resent successfully to ${registration.email}.`,
    });
  } catch (error) {
    console.error('Error resending acknowledgement email:', error);
    registration.acknowledgementEmailStatus = 'FAILED';
    registration.acknowledgementEmailLastError = String(error.message).slice(0, 500);
    await registration.save().catch(() => {});
    return res.status(500).json({ success: false, message: `Failed to resend acknowledgement email: ${error.message}` });
  }
}

module.exports = {
  calculateActiveSeats,
  getSummitCapacity,
  createSummitRegistration,
  getSummitPaymentDetails,
  submitSummitPaymentProof,
  getAdminSummitRegistrations,
  getAdminSummitStats,
  getPaymentReceiptFile,
  approveSummitRegistration,
  approveSummitPayment,
  rejectSummitRegistration,
  rejectSummitPayment,
  recordOfflinePayment,
  addAdminVerificationNotes,
  getNextSmallSummitRegistrationId,
  verifyCheckInToken,
  checkInParticipant,
  getAttendanceStats,
  exportAttendanceCsv,
  resendConfirmationEmail,
  resendAcknowledgementEmail,
  getInvestorMissionEmailDiagnostic,
  evaluateCombinedApproval,
};
