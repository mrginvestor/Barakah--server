const express = require('express');
const router = express.Router();
const { createRegistration, checkIn, getRegistrations } = require('../controllers/registrationController');
const { createWebinarRegistration, getWebinarRegistrations } = require('../controllers/webinarController');
const { requireAdmin } = require('../middleware/requireAdmin');

router.post('/registrations', createRegistration);
router.get('/registrations', requireAdmin, getRegistrations);
router.post('/check-in', requireAdmin, checkIn);
router.post('/webinar/register', createWebinarRegistration);
router.get('/webinar/registrations', requireAdmin, getWebinarRegistrations);

module.exports = router;
