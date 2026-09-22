const test = require('node:test');
const assert = require('node:assert/strict');
const { validateWebinarRegistration } = require('./webinarValidation');

test('accepts a valid webinar registration payload', () => {
  const payload = {
    fullName: 'Amina Rahman',
    phone: '7123456789',
    email: 'amina@example.com',
    city: 'Chennai',
    businessName: 'Rahman Ventures',
    businessWebsite: 'https://www.rahmanventures.com',
    businessRole: 'Founder / Owner',
    businessType: 'Technology / IT',
    financialInterests: ['Business Financial Planning', 'Cash Flow Management'],
    financialChallenge: 'Cash flow volatility during seasonal demand cycles.',
    referralSource: 'LinkedIn',
    consent: true,
  };

  const result = validateWebinarRegistration(payload);
  assert.equal(result.isValid, true);
  assert.deepEqual(result.errors, {});
});

test('rejects invalid business website and missing consent', () => {
  const payload = {
    fullName: 'Amina Rahman',
    phone: '7123456789',
    email: 'amina@example.com',
    city: 'Chennai',
    businessName: 'Rahman Ventures',
    businessWebsite: 'not-a-url',
    businessRole: 'Founder / Owner',
    businessType: 'Technology / IT',
    financialInterests: [],
    referralSource: 'LinkedIn',
    consent: false,
  };

  const result = validateWebinarRegistration(payload);
  assert.equal(result.isValid, false);
  assert.match(result.errors.businessWebsite, /valid/i);
  assert.match(result.errors.financialInterests, /at least one/i);
  assert.match(result.errors.consent, /agree/i);
});

test('accepts custom specified answers when other options are chosen', () => {
  const payload = {
    fullName: 'Zainab Fatima',
    phone: '9876543210',
    email: 'zainab@custombusiness.com',
    city: 'Bangalore',
    businessName: 'Fatima Sustainable Design',
    businessWebsite: 'https://fatimadesign.com',
    businessRole: 'Chief Creative Officer',
    businessType: 'Sustainable Architecture & Design',
    financialInterests: ['Business Financial Planning', 'Ethical Venture Crowdfunding'],
    financialChallenge: 'Scaling without interest-bearing debt.',
    referralSource: 'Community Financial Meetup',
    consent: true,
  };

  const result = validateWebinarRegistration(payload);
  assert.equal(result.isValid, true);
  assert.deepEqual(result.errors, {});
});

test('requires a 10-digit phone number and an email containing @', () => {
  const payload = {
    fullName: 'Amina Rahman',
    phone: '123456789',
    email: 'amina.example.com',
    businessName: 'Rahman Ventures',
    businessWebsite: 'https://www.rahmanventures.com',
    businessRole: 'Founder / Owner',
    businessType: 'Technology / IT',
    financialInterests: ['Financial Planning'],
    referralSource: 'Website',
    consent: true,
  };

  const result = validateWebinarRegistration(payload);
  assert.equal(result.isValid, false);
  assert.match(result.errors.phone, /10-digit/i);
  assert.match(result.errors.email, /valid email/i);
});

test('accepts the supplied India country-code phone format after normalization', () => {
  const payload = {
    fullName: 'Test User',
    phone: '9876543210',
    email: 'test@example.com',
    businessName: 'Test Company',
    businessWebsite: 'https://example.com',
    businessRole: 'Founder / Owner',
    businessType: 'Technology / IT',
    financialInterests: ['Business Financial Planning', 'Investment Planning', 'Business Valuation'],
    financialInterestsOther: '',
    financialChallenge: 'Need better financial planning and investment management.',
    referralSource: 'WhatsApp',
    consent: true,
  };

  const result = validateWebinarRegistration(payload);
  assert.equal(result.isValid, true);
});

