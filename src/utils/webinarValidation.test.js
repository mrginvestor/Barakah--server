const test = require('node:test');
const assert = require('node:assert/strict');
const { validateWebinarRegistration } = require('./webinarValidation');

test('accepts a valid webinar registration payload', () => {
  const payload = {
    fullName: 'Amina Rahman',
    phone: '+917123456789',
    email: 'amina@example.com',
    city: 'Chennai',
    businessName: 'Rahman Ventures',
    businessWebsite: 'https://www.rahmanventures.com',
    businessRole: 'Founder / Owner',
    businessType: 'Technology / IT',
    businessAge: '3–5 years',
    employeeCount: '11–25',
    annualTurnover: '₹1 – ₹5 Crores',
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
    phone: '+917123456789',
    email: 'amina@example.com',
    city: 'Chennai',
    businessName: 'Rahman Ventures',
    businessWebsite: 'not-a-url',
    businessRole: 'Founder / Owner',
    businessType: 'Technology / IT',
    businessAge: '3–5 years',
    employeeCount: '11–25',
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
