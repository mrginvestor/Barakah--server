function isValidUrl(value) {
  if (!value || typeof value !== 'string') return false;
  const trimmed = value.trim();
  try {
    const url = new URL(trimmed);
    return ['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function validateWebinarRegistration(data = {}) {
  const errors = {};

  if (!String(data.fullName || '').trim() || String(data.fullName).trim().length < 2) {
    errors.fullName = 'Please enter your full name.';
  }

  const phone = String(data.phone || '').trim();
  if (!/^\d{10}$/.test(phone)) {
    errors.phone = 'Please enter a valid 10-digit mobile number.';
  }

  const email = String(data.email || '').trim();
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    errors.email = 'Please enter a valid email address.';
  }

  if (!String(data.businessName || '').trim()) {
    errors.businessName = 'Please enter your business or company name.';
  }

  if (!isValidUrl(String(data.businessWebsite || '').trim())) {
    errors.businessWebsite = 'Please enter a valid business website URL.';
  }

  if (!String(data.businessRole || '').trim()) {
    errors.businessRole = 'Please select your role in the business.';
  }

  if (!String(data.businessType || '').trim()) {
    errors.businessType = 'Please select your business type.';
  }

  if (!Array.isArray(data.financialInterests) || data.financialInterests.length < 1) {
    errors.financialInterests = 'Please select at least one financial topic.';
  }

  if (!String(data.referralSource || '').trim()) {
    errors.referralSource = 'Please tell us how you heard about this webinar.';
  }

  if (data.consent !== true) {
    errors.consent = 'Please confirm the information and agree to be contacted.';
  }

  return { isValid: Object.keys(errors).length === 0, errors };
}

module.exports = { validateWebinarRegistration, isValidUrl };
