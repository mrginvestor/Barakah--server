const express = require('express');
const router = express.Router();
const { createRegistration, checkIn, getRegistrations } = require('../controllers/registrationController');

router.post('/registrations', createRegistration);
router.get('/registrations', getRegistrations);
router.post('/check-in', checkIn);

module.exports = router;
