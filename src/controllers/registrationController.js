const Registration = require('../models/Registration');

exports.createRegistration = async (req, res) => {
  try {
    const data = { ...req.body, email: String(req.body.email || '').trim().toLowerCase() };
    const required = ['fullName', 'countryCode', 'whatsappNumber', 'email', 'ageGroup', 'gender', 'city', 'state', 'country', 'currentProfession', 'professionalExperience', 'financialInterests', 'islamicFinanceKnowledge', 'biggestFinancialChallenge', 'participationMode', 'whatsappCommunity', 'referralSource'];
    if (required.some(field => data[field] === undefined || data[field] === null || data[field] === '')) return res.status(400).json({ message: 'Please complete all required fields.' });
    if (!/^\S+@\S+\.\S+$/.test(data.email)) return res.status(400).json({ message: 'Please enter a valid email address.' });
    if (!/^\+?[1-9]\d{6,14}$/.test(`${data.countryCode}${String(data.whatsappNumber).replace(/\D/g, '')}`)) return res.status(400).json({ message: 'Please enter a valid WhatsApp number.' });
    if (!Array.isArray(data.financialInterests) || data.financialInterests.length < 1 || data.financialInterests.length > 4) return res.status(400).json({ message: 'Please select no more than 4 topics.' });
    if (data.currentProfession === 'Other' && !String(data.otherProfession || '').trim()) return res.status(400).json({ message: 'Please specify your profession.' });
    if (data.referralSource === 'Other' && !String(data.otherReferralSource || '').trim()) return res.status(400).json({ message: 'Please specify how you heard about us.' });
    if (String(data.fullName).trim().length < 2 || String(data.biggestFinancialChallenge).trim().length < 10 || String(data.biggestFinancialChallenge).length > 500) return res.status(400).json({ message: 'Please check your name and financial challenge.' });
    const existing = await Registration.findOne({ email: data.email });
    if (existing) return res.status(400).json({ message: 'This email is already registered for the summit.' });

    const count = await Registration.countDocuments();
    const registrationId = `HWS26-${String(count + 1).padStart(5, '0')}`;

    const registration = new Registration({ ...data, name: data.fullName, phone: `${data.countryCode}${String(data.whatsappNumber).replace(/\D/g, '')}`, registrationId });
    await registration.save();
    
    res.status(201).json({ success: true, message: 'Registration successful', registrationId });
  } catch (error) {
    if (error.name === 'ValidationError') return res.status(400).json({ message: 'Please check the information you entered.' });
    res.status(500).json({ message: 'We could not complete your registration right now. Please try again.' });
  }
};

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
