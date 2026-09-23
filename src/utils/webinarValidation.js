const financialInterestOptions = new Set(['Financial Planning', 'Loans and Financing', 'Investments and Wealth Management', 'Business Ethics', 'Others']);

function validateWebinarRegistration(data = {}) {
  const errors = {};

  if (!String(data.fullName || '').trim() || String(data.fullName).trim().length < 2) {
    errors.fullName = 'Please enter your full name.';
  }

  const phone = String(data.whatsapp || data.phone || '').trim();
  if (!/^\d{10}$/.test(phone)) {
    errors.whatsapp = 'Please enter a valid 10-digit mobile number.';
  }

  const email = String(data.email || '').trim();
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    errors.email = 'Please enter a valid email address.';
  }

  if (!String(data.designation || '').trim()) {
    errors.designation = 'Please select your designation or occupation.';
  }

  if (!String(data.industry || '').trim()) {
    errors.industry = 'Please select your industry.';
  }

  if (!Array.isArray(data.financialInterests) || data.financialInterests.length < 1) {
    errors.financialInterests = 'Please select at least one financial topic.';
  } else if (data.financialInterests.some(interest => !financialInterestOptions.has(interest))) {
    errors.financialInterests = 'Please select valid financial topics.';
  } else if (data.financialInterests.includes('Others') && !String(data.otherFinancialInterest || '').trim()) {
    errors.otherFinancialInterest = 'Please specify your financial interest.';
  }

  if (!String(data.webinarSource || '').trim()) {
    errors.webinarSource = 'Please tell us how you heard about this webinar.';
  }

  if (data.consent !== true) {
    errors.consent = 'Please confirm the information and agree to be contacted.';
  }

  return { isValid: Object.keys(errors).length === 0, errors };
}

module.exports = { validateWebinarRegistration };
