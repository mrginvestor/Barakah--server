const test = require('node:test');
const assert = require('node:assert/strict');
const { validateWebinarRegistration } = require('./webinarValidation');

test('accepts a valid webinar registration payload', () => {
  const payload = {
    fullName: 'Amina Rahman',
    whatsapp: '+919876543210',
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
    whatsapp: '+14155552671',
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
    whatsapp: '+447911123456',
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
    whatsapp: '+971501234567',
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

test('requires an international phone number and an email containing @', () => {
  const payload = {
    fullName: 'Amina Rahman',
    whatsapp: '+999123',
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
  assert.match(result.errors.whatsapp, /valid mobile number for the selected country/i);
  assert.match(result.errors.email, /valid email/i);
});

test('accepts a valid Indian mobile number in E.164 format', () => {
  const payload = {
    fullName: 'Test User',
    whatsapp: '+919876543210',
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

test('validates the phone number against the selected country', () => {
  const payload = {
    fullName: 'Test User',
    whatsapp: '+919876543210',
    phoneCountry: 'IN',
    email: 'test@example.com',
    designation: 'Founder / Owner',
    industry: 'Technology / IT',
    financialInterests: ['Financial Planning'],
    webinarSource: 'Website',
    consent: true,
  };

  assert.equal(validateWebinarRegistration(payload).isValid, true);
  assert.equal(validateWebinarRegistration({ ...payload, phoneCountry: 'US' }).isValid, false);
});

test('rejects malformed selected country codes without throwing', () => {
  const result = validateWebinarRegistration({
    fullName: 'Test User',
    whatsapp: '+919876543210',
    phoneCountry: 'INVALID',
    email: 'test@example.com',
    designation: 'Founder / Owner',
    industry: 'Technology / IT',
    financialInterests: ['Financial Planning'],
    webinarSource: 'Website',
    consent: true,
  });

  assert.equal(result.isValid, false);
  assert.match(result.errors.whatsapp, /valid mobile number for the selected country/i);
});

test('rejects overlong, short, and duplicated-country-code Indian numbers', () => {
  for (const whatsapp of ['+9198765432101', '+91987654321', '+91+919876543210']) {
    const result = validateWebinarRegistration({
      fullName: 'Test User',
      whatsapp,
      phoneCountry: 'IN',
      email: 'test@example.com',
      designation: 'Founder / Owner',
      industry: 'Technology / IT',
      financialInterests: ['Financial Planning'],
      webinarSource: 'Website',
      consent: true,
    });
    assert.equal(result.isValid, false, whatsapp);
    assert.match(result.errors.whatsapp, /valid mobile number for India/i, whatsapp);
  }
});

test('accepts the requested valid mobile numbers', () => {
  for (const whatsapp of [
    '+919876543210',
    '+14155552671',
    '+447911123456',
    '+971501234567',
    '+966501234567',
    '+61412345678',
    '+6561234567',
    '+60123456789',
  ]) {
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
  for (const whatsapp of ['+999123', 'abcdefghij', '+1415555267']) {
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
    assert.match(result.errors.whatsapp, /valid mobile number for the selected country/i, whatsapp);
  }
});

