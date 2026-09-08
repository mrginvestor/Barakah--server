const express = require('express');
const router = express.Router();
const { createRegistration, checkIn, getRegistrations } = require('../controllers/registrationController');
const { createWebinarRegistration, getWebinarRegistrations } = require('../controllers/webinarController');

router.post('/registrations', createRegistration);
router.get('/registrations', getRegistrations);
router.post('/check-in', checkIn);
router.post('/webinar/register', createWebinarRegistration);
router.get('/webinar/registrations', getWebinarRegistrations);

module.exports = router;
