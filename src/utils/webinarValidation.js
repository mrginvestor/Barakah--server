const { parsePhoneNumberFromString } = require('libphonenumber-js/max');

const financialInterestOptions = new Set([
  // New November 1, 2026 Webinar options
  'Personal Financial Planning',
  'Halal Investments',
  'Savings and Wealth Management',
  'Business and Entrepreneurship',
  'Trade and Business Ethics',
  'Retirement Planning',
  'Generational Wealth Planning',
  'Islamic Finance Principles',
  'Learning the Basics of Finance',
  'Other',
  // Historical / legacy options for backward compatibility
  'Financial Planning',
  'Halal Investments and Wealth Management',
  'Business Growth and Trade',
  'Business Ethics',
  'Loans and Financing',
  'Investments and Wealth Management',
  'Others',
]);

const allowedAgeGroups = new Set([
  'Under 18',
  '18–24',
  '18-24',
  '25–34',
  '25-34',
  '35–44',
  '35-44',
  '45–54',
  '45-54',
  '55 and above',
  'Other',
]);

const allowedOccupations = new Set([
  'Student',
  'Salaried Employee',
  'Self-Employed',
  'Business Owner',
  'Entrepreneur / Startup Founder',
  'Homemaker',
  'Freelancer',
  'Investor',
  'Retired',
  'Unemployed / Job Seeker',
  'Other',
  // Historical / legacy
  'Founder / Owner',
  'Founder / Business Owner',
  'Co-Founder',
  'Co-Founder / Partner',
  'Managing Director / CEO',
  'Director',
  'Director / C-Level Executive',
  'Partner',
  'Finance Head / CFO',
  'Manager',
  'Senior Corporate Professional / Manager',
  'Startup Founder / Entrepreneur',
  'Startup Founder',
  'Investor / Angel Investor',
  'Self-Employed / Professional Consultant',
  'Chief Creative Officer',
]);

const allowedWebinarSources = new Set([
  'WhatsApp',
  'Friends or Family',
  'Social Media',
  'Email',
  'Website',
  'Other',
  // Historical
  'Solidarity Youth Organisation TN',
  'Instagram',
  'Facebook',
  'YouTube',
  'Friend / Colleague',
  'LinkedIn',
  'Community Financial Meetup',
  'Website - Business Registration',
]);

function getCountryName(country) {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(country) || 'the selected country';
  } catch {
    return 'the selected country';
  }
}

function validateWebinarRegistration(data = {}) {
  const errors = {};

  // Full Name
  if (!String(data.fullName || '').trim() || String(data.fullName).trim().length < 2) {
    errors.fullName = 'Please enter your full name.';
  }

  // Mobile / WhatsApp
  const phone = String(data.whatsapp || data.phone || '').trim();
  const parsedPhone = phone ? parsePhoneNumberFromString(phone) : undefined;
  const phoneCountry = String(data.phoneCountry || '').trim().toUpperCase();
  if (!phone) {
    errors.whatsapp = 'Please enter your mobile number.';
  } else if (!parsedPhone || !parsedPhone.isValid() || (phoneCountry && parsedPhone.country !== phoneCountry)) {
    errors.whatsapp = `Please enter a valid mobile number for ${phoneCountry ? getCountryName(phoneCountry) : 'the selected country'}.`;
  }

  // Email Address
  const email = String(data.email || '').trim();
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    errors.email = 'Please enter a valid email address.';
  }

  // Country (required for new registrations, or location fallback for legacy)
  const country = String(data.country || '').trim();
  const location = String(data.location || '').trim();
  if (data.country !== undefined) {
    if (!country) {
      errors.country = 'Please select your country.';
    }
  } else if (!location && !phoneCountry && (!parsedPhone || !parsedPhone.country)) {
    errors.country = 'Please select your country.';
  }

  // Age Group (optional, but conditional Other is required)
  const ageGroup = String(data.ageGroup || '').trim();
  if (ageGroup === 'Other') {
    const otherAge = String(data.otherAgeGroup || '').trim();
    if (!otherAge) {
      errors.otherAgeGroup = 'Please specify your age group.';
    }
  }

  // Occupation (required)
  const occupation = String(data.occupation || data.designation || '').trim();
  if (!occupation) {
    errors.occupation = 'Please select your occupation.';
  } else if (occupation === 'Other') {
    const otherOcc = String(data.otherOccupation || data.otherDesignation || '').trim();
    if (!otherOcc) {
      errors.otherOccupation = 'Please specify your occupation.';
    }
  }

  // Financial Interests (required, at least one)
  if (!Array.isArray(data.financialInterests) || data.financialInterests.length < 1) {
    errors.financialInterests = 'Please select at least one financial topic.';
  } else if (data.financialInterests.some(interest => !financialInterestOptions.has(interest))) {
    errors.financialInterests = 'Please select valid financial topics.';
  } else if (data.financialInterests.includes('Other') || data.financialInterests.includes('Others')) {
    const otherInterest = String(data.otherFinancialInterest || '').trim();
    if (!otherInterest) {
      errors.otherFinancialInterest = 'Please specify your financial interest.';
    }
  }

  // Webinar Source (optional, but conditional Other is required)
  const source = String(data.webinarSource || '').trim();
  if (source === 'Other') {
    const otherSource = String(data.otherWebinarSource || '').trim();
    if (!otherSource) {
      errors.otherWebinarSource = 'Please specify how you heard about us.';
    }
  }

  // Consent
  if (data.consent !== true && data.consent !== undefined && data.consent !== 'true') {
    errors.consent = 'Please confirm the information and agree to be contacted.';
  }

  return { isValid: Object.keys(errors).length === 0, errors };
}

module.exports = {
  validateWebinarRegistration,
  financialInterestOptions,
  allowedAgeGroups,
  allowedOccupations,
  allowedWebinarSources,
};
