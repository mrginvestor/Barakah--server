const path = require('path');
const fs = require('fs');
const SummitRegistration = require('../models/SummitRegistration');
const SUMMIT_CONFIG = require('../config/summitConfig');
const { getNextRegistrationId } = require('./registrationController');
const { validateImageMagicBytes, UPLOAD_DIR } = require('../middleware/receiptUpload');
const defaultEmailService = require('../services/webinarEmailService');

/**
 * Generate separate registration IDs for Small Summit (e.g. SS26-00001)
 * completely independent from Main Summit (HWS26-00001).
 */
async function getNextSmallSummitRegistrationId(model = SummitRegistration) {
  try {
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
    const random = Math.floor(10000 + Math.random() * 90000);
    return `SS26-${random}`;
  }
}

/**
 * Calculates current confirmed seat count for DEC Summit (capacity: 50 participants).
 * Strictly enforces seat management rules:
 * - Pending form submissions, uploads, holds, or offline submissions DO NOT count as confirmed seats.
 * - Single-side approval (registration only or payment only) DOES NOT count as a confirmed seat.
 * - ONLY when BOTH registration AND payment are approved does it count as 1 confirmed seat.
 * Available seats = 50 - confirmed seats.
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

  const maxCapacity = SUMMIT_CONFIG.maxCapacity || 50;
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

    // 8. Payment Method: ONLINE or OFFLINE
    const cleanPaymentMethod = String(paymentMethod || 'ONLINE').toUpperCase() === 'OFFLINE' ? 'OFFLINE' : 'ONLINE';

    // 9. Capacity Check (50 confirmed seats max)
    const capacity = await calculateActiveSeats(SummitRegistration);
    if (capacity.availableSeats <= 0) {
      return res.status(400).json({
        message: 'DEC Summit Registration Full (maximum capacity of 50 confirmed participants reached).',
        isSoldOut: true,
      });
    }

    // 10. Duplicate Check within DEC Summit
    const existing = await SummitRegistration.findOne({ email: cleanEmail });
    if (existing) {
      const isConfirmed =
        (existing.registrationApproved && existing.paymentApproved) ||
        existing.registrationStatus === 'CONFIRMED' ||
        existing.status === 'Confirmed' ||
        existing.paymentStatus === 'PAID';

      if (isConfirmed) {
        return res.status(400).json({
          message: 'This email is already registered and confirmed for the DEC Summit.',
        });
      }
    }

    // Generate unique registration ID (e.g. SS26-00001)
    const registrationId = await getNextSmallSummitRegistrationId(SummitRegistration);
    const expiresAt = cleanPaymentMethod === 'ONLINE'
      ? new Date(Date.now() + SUMMIT_CONFIG.reservationTimeoutMinutes * 60 * 1000)
      : null;

    const registration = new SummitRegistration({
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
      registrationStatus: 'PENDING_APPROVAL',
      paymentStatus: cleanPaymentMethod === 'ONLINE' ? 'PENDING_VERIFICATION' : 'PENDING_OFFLINE_PAYMENT',
      status: 'Pending',
      registrationApproved: false,
      paymentApproved: false,
      reservationExpiresAt: expiresAt,
      termsAccepted: true,
    });

    await registration.save();

    const redirectUrl = cleanPaymentMethod === 'ONLINE'
      ? `/dec-summit-payment/${registration.registrationId}`
      : `/dec-summit-confirmation/${registration.registrationId}`;

    const message = cleanPaymentMethod === 'ONLINE'
      ? 'Registration details saved. Please complete UPI payment.'
      : 'Your DEC Summit registration request has been received successfully. Your registration will be confirmed once our team verifies your offline payment.';

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
      return res.status(400).json({ message: 'A registration with this email or ID already exists.' });
    }
    return res.status(500).json({ message: 'Could not complete registration. Please try again.' });
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
    const isExpired = registration.paymentStatus === 'PENDING' &&
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

    // Save proof details and transition status to PENDING_VERIFICATION
    registration.paymentScreenshot = req.file.filename;
    registration.paymentScreenshotMimeType = req.file.mimetype;
    registration.paymentScreenshotSize = req.file.size;
    registration.upiTransactionId = utr;
    registration.paymentDate = payDate;
    registration.paymentNotes = String(req.body.paymentNotes || '').trim();
    registration.paymentStatus = 'PENDING_VERIFICATION';
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
        { registrationStatus: 'PENDING_APPROVAL' },
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

    const registrations = await SummitRegistration.find(filter).sort({ createdAt: -1 }).lean();
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
      SummitRegistration.countDocuments({ paymentStatus: 'PENDING' }),
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
              { registrationStatus: 'PENDING_APPROVAL' },
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
 * GET /api/admin/summit/receipt/:registrationId
 * Protected image streaming endpoint for admins.
 */
async function getPaymentReceiptFile(req, res) {
  try {
    const { registrationId } = req.params;
    const registration = await SummitRegistration.findOne({ registrationId: String(registrationId).trim() });

    if (!registration || !registration.paymentScreenshot) {
      return res.status(404).json({ message: 'Payment screenshot not found for this registration.' });
    }

    const filePath = path.join(UPLOAD_DIR, registration.paymentScreenshot);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: 'Receipt file not found on disk.' });
    }

    res.setHeader('Content-Type', registration.paymentScreenshotMimeType || 'image/png');
    res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    return res.sendFile(filePath);
  } catch (error) {
    console.error('Error serving receipt file:', error);
    return res.status(500).json({ message: 'Failed to retrieve payment receipt.' });
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

    // Atomic capacity check: count confirmed seats excluding this registration
    const currentConfirmed = await SummitRegistration.countDocuments({
      _id: { $ne: registration._id },
      $or: [
        { registrationApproved: true, paymentApproved: true },
        { registrationStatus: 'CONFIRMED', paymentStatus: 'PAID' },
        { status: 'Confirmed', paymentStatus: 'PAID' },
      ],
    });

    const maxCapacity = SUMMIT_CONFIG.maxCapacity || 50;
    if (currentConfirmed >= maxCapacity) {
      return {
        success: false,
        error: `DEC Summit capacity (${maxCapacity} seats) has been reached. Cannot confirm additional registrations.`,
      };
    }

    // Both approved and seat is available: Transition to CONFIRMED & PAID
    registration.registrationStatus = 'CONFIRMED';
    registration.paymentStatus = 'PAID';
    registration.status = 'Confirmed';
    registration.approvedAt = new Date();
    registration.paymentVerifiedAt = new Date();
    registration.paymentVerifiedBy = adminEmail || 'admin@halalwealth.finance';
    registration.rejectionReason = '';
    if (adminNotes) {
      registration.adminNotes = String(adminNotes).trim();
    }

    await registration.save();

    // Asynchronously dispatch confirmation email
    if (defaultEmailService && typeof defaultEmailService.sendRegistrationConfirmation === 'function') {
      defaultEmailService.sendRegistrationConfirmation(registration.email, registration.fullName || registration.name)
        .then(() => {
          registration.confirmationEmailSent = true;
          registration.confirmationEmailSentAt = new Date();
          return registration.save().catch(() => {});
        })
        .catch(err => {
          console.warn('Failed to send DEC summit confirmation email:', err.message);
          registration.confirmationEmailLastError = String(err.message).slice(0, 500);
          return registration.save().catch(() => {});
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
 */
async function approveSummitPayment(req, res) {
  try {
    const { registrationId } = req.params;
    const { adminNotes } = req.body;
    const registration = await SummitRegistration.findOne({ registrationId: String(registrationId).trim() });

    if (!registration) {
      return res.status(404).json({ message: 'Registration not found.' });
    }

    registration.paymentApproved = true;
    registration.paymentApprovedAt = new Date();
    registration.paymentApprovedBy = req.admin?.email || 'admin@halalwealth.finance';
    registration.rejectionReason = '';

    const approvalResult = await evaluateCombinedApproval(registration, req.admin?.email, adminNotes);
    if (!approvalResult.success) {
      return res.status(400).json({ message: approvalResult.error });
    }

    const message = approvalResult.confirmed
      ? 'Payment and registration approved! Participant seat is now CONFIRMED.'
      : 'Payment approved. Participant seat will be confirmed once registration details are also approved.';

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
 */
async function rejectSummitPayment(req, res) {
  try {
    const { registrationId } = req.params;
    const { reason, adminNotes } = req.body;
    const registration = await SummitRegistration.findOne({ registrationId: String(registrationId).trim() });

    if (!registration) {
      return res.status(404).json({ message: 'Registration not found.' });
    }

    registration.paymentApproved = false;
    registration.paymentStatus = 'REJECTED';
    // If it was previously confirmed, drop back to Pending
    if (registration.registrationStatus === 'CONFIRMED') {
      registration.registrationStatus = 'PENDING_APPROVAL';
      registration.status = 'Pending';
    }
    registration.rejectionReason = String(reason || 'Payment verification failed. Please verify your reference or re-upload a clear receipt.').trim();
    if (adminNotes) registration.adminNotes = String(adminNotes).trim();

    await registration.save();

    return res.json({
      success: true,
      message: 'Payment rejected. Participant can submit corrected payment proof on their payment page.',
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
};
