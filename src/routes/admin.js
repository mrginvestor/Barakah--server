const express = require('express');
const rateLimit = require('express-rate-limit');
const { createAdminAuthController } = require('../controllers/adminAuthController');
const { createAdminRegistrationController } = require('../controllers/adminRegistrationController');
const { requireAdmin } = require('../middleware/requireAdmin');

const router = express.Router();
const authController = createAdminAuthController();
const registrationController = createAdminRegistrationController();
const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { message: 'Too many login attempts. Please try again later.' },
});

router.post('/login', loginRateLimit, authController.login);
router.use(requireAdmin);
router.get('/session', authController.getSession);
router.get('/registrations/export', registrationController.exportCsv);
router.get('/registrations', registrationController.list);
router.get('/registrations/:id', registrationController.getById);
router.post('/registrations/:id/send-confirmation', registrationController.sendConfirmation);
router.post('/registrations/send-confirmations', registrationController.sendBulkConfirmations);
router.post('/registrations/resend-confirmations', registrationController.resendBulkConfirmations);
router.put('/registrations/:id/status', registrationController.updateStatus);

module.exports = router;