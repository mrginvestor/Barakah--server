const express = require('express');
const router = express.Router();
const { createRegistration, checkIn, getRegistrations } = require('../controllers/registrationController');
const { createWebinarRegistration, getWebinarRegistrationStatus, getWebinarRegistrations, getWebinars } = require('../controllers/webinarController');
const {
  getSummitCapacity,
  createSummitRegistration,
  getSummitPaymentDetails,
  submitSummitPaymentProof,
  verifyCheckInToken,
} = require('../controllers/summitController');
const { receiptUpload } = require('../middleware/receiptUpload');
const { requireAdmin } = require('../middleware/requireAdmin');

// Investor Mission 2026 Registration & Payment Endpoints (Coimbatore, 50 capacity, ₹500 fee)
router.get('/investor-mission/availability', getSummitCapacity);
router.get('/investor-mission/capacity', getSummitCapacity);
router.post('/investor-mission/register', createSummitRegistration);
router.get('/investor-mission/registration/:registrationId', getSummitPaymentDetails);
router.get('/investor-mission/payment/:registrationId', getSummitPaymentDetails);
router.post('/investor-mission/payment-proof', receiptUpload.single('receipt'), submitSummitPaymentProof);
router.post('/investor-mission/payment/:registrationId/submit', receiptUpload.single('receipt'), submitSummitPaymentProof);
router.get('/investor-mission/checkin/verify/:token', verifyCheckInToken);

// DEC Summit Registration & Payment Endpoints (Separate 50-capacity event, ₹500 fee)
router.get('/dec-summit/availability', getSummitCapacity);
router.get('/dec-summit/capacity', getSummitCapacity);
router.post('/dec-summit/register', createSummitRegistration);
router.get('/dec-summit/registration/:registrationId', getSummitPaymentDetails);
router.get('/dec-summit/payment/:registrationId', getSummitPaymentDetails);
router.post('/dec-summit/payment-proof', receiptUpload.single('receipt'), submitSummitPaymentProof);
router.post('/dec-summit/payment/:registrationId/submit', receiptUpload.single('receipt'), submitSummitPaymentProof);
router.get('/dec-summit/checkin/verify/:token', verifyCheckInToken);

// Backward-compatibility aliases for /small-summit/*
router.get('/small-summit/availability', getSummitCapacity);
router.get('/small-summit/capacity', getSummitCapacity);
router.post('/small-summit/register', createSummitRegistration);
router.get('/small-summit/registration/:registrationId', getSummitPaymentDetails);
router.get('/small-summit/payment/:registrationId', getSummitPaymentDetails);
router.post('/small-summit/payment-proof', receiptUpload.single('receipt'), submitSummitPaymentProof);
router.post('/small-summit/payment/:registrationId/submit', receiptUpload.single('receipt'), submitSummitPaymentProof);
router.get('/small-summit/checkin/verify/:token', verifyCheckInToken);

// Backward-compatibility aliases for /summit/*
router.get('/summit/availability', getSummitCapacity);
router.get('/summit/capacity', getSummitCapacity);
router.post('/summit/register', createSummitRegistration);
router.get('/summit/registration/:registrationId', getSummitPaymentDetails);
router.get('/summit/payment/:registrationId', getSummitPaymentDetails);
router.post('/summit/payment-proof', receiptUpload.single('receipt'), submitSummitPaymentProof);
router.post('/summit/payment/:registrationId/submit', receiptUpload.single('receipt'), submitSummitPaymentProof);
router.get('/summit/checkin/verify/:token', verifyCheckInToken);

// Main Summit Registration Endpoints (Original 5-Step Summit 2026, 400+ participants)
router.post('/registrations', createRegistration);
router.get('/registrations', requireAdmin, getRegistrations);
router.post('/check-in', requireAdmin, checkIn);

// Webinar Endpoints
router.get('/webinars', getWebinars);
router.get('/webinar/status', getWebinarRegistrationStatus);
router.post('/webinar/register', createWebinarRegistration);
router.get('/webinar/registrations', requireAdmin, getWebinarRegistrations);

module.exports = router;
