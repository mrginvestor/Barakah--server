const test = require('node:test');
const assert = require('node:assert/strict');
const { validateWebinarRegistration } = require('./webinarValidation');

test('accepts a valid webinar registration payload', () => {
  const payload = {
    fullName: 'Amina Rahman',
    whatsapp: '7123456789',
    email: 'amina@example.com',
    location: 'Chennai, Tamil Nadu, India',
    designation: 'Founder / Owner',
    industry: 'Technology / IT',
    financialInterests: ['Financial Planning', 'Loans and Financing'],
    financialChallenge: 'Cash flow volatility during seasonal demand cycles.',
    webinarSource: 'LinkedIn',
    consent: true,
  };

  const result = validateWebinarRegistration(payload);
  assert.equal(result.isValid, true);
  assert.deepEqual(result.errors, {});
});

test('rejects invalid financial interests and missing consent', () => {
  const payload = {
    fullName: 'Amina Rahman',
    whatsapp: '7123456789',
    email: 'amina@example.com',
    location: 'Chennai, Tamil Nadu, India',
    designation: 'Founder / Owner',
    industry: 'Technology / IT',
    financialInterests: ['Cash Flow Management'],
    webinarSource: 'LinkedIn',
    consent: false,
  };

  const result = validateWebinarRegistration(payload);
  assert.equal(result.isValid, false);
  assert.match(result.errors.financialInterests, /valid/i);
  assert.match(result.errors.consent, /agree/i);
});

test('accepts the complete set of financial interest options', () => {
  const payload = {
    fullName: 'Zainab Fatima',
    whatsapp: '9876543210',
    email: 'zainab@custombusiness.com',
    location: 'Bangalore, Karnataka, India',
    designation: 'Chief Creative Officer',
    industry: 'Sustainable Architecture & Design',
    financialInterests: ['Financial Planning', 'Loans and Financing', 'Investments and Wealth Management', 'Business Ethics', 'Others'],
    otherFinancialInterest: 'Islamic fintech and ethical investing',
    financialChallenge: 'Scaling without interest-bearing debt.',
    webinarSource: 'Community Financial Meetup',
    consent: true,
  };

  const result = validateWebinarRegistration(payload);
  assert.equal(result.isValid, true);
  assert.deepEqual(result.errors, {});
});

test('requires a description when Others is selected', () => {
  const payload = {
    fullName: 'Amina Rahman',
    whatsapp: '7123456789',
    email: 'amina@example.com',
    designation: 'Founder / Owner',
    industry: 'Technology / IT',
    financialInterests: ['Others'],
    webinarSource: 'Website',
    consent: true,
  };

  const result = validateWebinarRegistration(payload);
  assert.equal(result.isValid, false);
  assert.match(result.errors.otherFinancialInterest, /specify/i);
});

test('requires a 10-digit phone number and an email containing @', () => {
  const payload = {
    fullName: 'Amina Rahman',
    whatsapp: '123456789',
    email: 'amina.example.com',
    location: 'Chennai, Tamil Nadu, India',
    designation: 'Founder / Owner',
    industry: 'Technology / IT',
    financialInterests: ['Financial Planning'],
    webinarSource: 'Website',
    consent: true,
  };

  const result = validateWebinarRegistration(payload);
  assert.equal(result.isValid, false);
  assert.match(result.errors.whatsapp, /10-digit/i);
  assert.match(result.errors.email, /valid email/i);
});

test('accepts a valid 10-digit Indian mobile number', () => {
  const payload = {
    fullName: 'Test User',
    whatsapp: '9876543210',
    email: 'test@example.com',
    location: 'Chennai, Tamil Nadu, India',
    designation: 'Founder / Owner',
    industry: 'Technology / IT',
    financialInterests: ['Financial Planning', 'Investments and Wealth Management'],
    financialChallenge: 'Need better financial planning and investment management.',
    webinarSource: 'WhatsApp',
    consent: true,
  };

  const result = validateWebinarRegistration(payload);
  assert.equal(result.isValid, true);
});

test('accepts the requested valid mobile numbers', () => {
  for (const whatsapp of ['9876543210', '9123456789', '8098765432', '1234567890']) {
    const result = validateWebinarRegistration({
      fullName: 'Test User',
      whatsapp,
      email: `${whatsapp}@example.com`,
      designation: 'Founder / Owner',
      industry: 'Technology / IT',
      financialInterests: ['Financial Planning'],
      webinarSource: 'Website',
      consent: true,
    });
    assert.equal(result.isValid, true, whatsapp);
  }
});

test('rejects invalid mobile numbers', () => {
  for (const whatsapp of ['987654321', '98765432101', 'abcdefghij', '98765abcde']) {
    const result = validateWebinarRegistration({
      fullName: 'Test User',
      whatsapp,
      email: 'test@example.com',
      designation: 'Founder / Owner',
      industry: 'Technology / IT',
      financialInterests: ['Financial Planning'],
      webinarSource: 'Website',
      consent: true,
    });
    assert.equal(result.isValid, false, whatsapp);
    assert.match(result.errors.whatsapp, /10-digit mobile/i, whatsapp);
  }
});

