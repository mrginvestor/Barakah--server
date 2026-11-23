const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const {
  verifyCheckInToken,
  checkInParticipant,
  getAttendanceStats,
  exportAttendanceCsv,
  resendConfirmationEmail,
} = require('./summitController');
const SummitRegistration = require('../models/SummitRegistration');

test('verifyCheckInToken handles missing or invalid tokens', async () => {
  // Missing token
  const req1 = { params: {}, accepts: () => false };
  let status1 = null;
  let json1 = null;
  const res1 = {
    status: (s) => { status1 = s; return res1; },
    json: (j) => { json1 = j; return res1; },
  };
  await verifyCheckInToken(req1, res1);
  assert.equal(status1, 400);
  assert.equal(json1.verified, false);

  // Invalid token
  const originalFindOne = SummitRegistration.findOne;
  SummitRegistration.findOne = () => ({
    lean: async () => null,
  });

  try {
    const req2 = { params: { token: 'nonexistent-token' }, accepts: () => false };
    let status2 = null;
    let json2 = null;
    const res2 = {
      status: (s) => { status2 = s; return res2; },
      json: (j) => { json2 = j; return res2; },
    };
    await verifyCheckInToken(req2, res2);
    assert.equal(status2, 404);
    assert.equal(json2.verified, false);
  } finally {
    SummitRegistration.findOne = originalFindOne;
  }
});

test('verifyCheckInToken verifies confirmed participant and protects sensitive PII', async () => {
  const rawToken = 'test-secure-token-12345';
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  const mockRegistration = {
    registrationId: 'SS26-00042',
    fullName: 'Zayd Al-Hasan',
    email: 'zayd@secretdomain.com',
    mobileNumber: '9876543210',
    registrationApproved: true,
    paymentApproved: true,
    registrationStatus: 'CONFIRMED',
    paymentStatus: 'PAID',
    attendanceStatus: 'NOT_CHECKED_IN',
    checkInTokenHash: tokenHash,
  };

  const originalFindOne = SummitRegistration.findOne;
  SummitRegistration.findOne = () => ({
    lean: async () => mockRegistration,
  });

  try {
    const req = { params: { token: rawToken }, accepts: () => false };
    let status = null;
    let json = null;
    const res = {
      status: (s) => { status = s; return res; },
      json: (j) => { json = j; return res; },
    };

    await verifyCheckInToken(req, res);
    assert.equal(json.success, true);
    assert.equal(json.verified, true);
    assert.equal(json.registrationId, 'SS26-00042');
    assert.equal(json.participantName, 'Zayd Al-Hasan');
    assert.equal(json.attendanceStatus, 'NOT_CHECKED_IN');
    assert.equal(json.isAlreadyCheckedIn, false);
    // Ensure PII is not leaked in the public verification response
    assert.equal(json.email, undefined);
    assert.equal(json.mobileNumber, undefined);
  } finally {
    SummitRegistration.findOne = originalFindOne;
  }
});

test('checkInParticipant marks attendee as CHECKED_IN and prevents duplicate check-in', async () => {
  let savedData = null;
  const mockRegistration = {
    registrationId: 'SS26-00010',
    fullName: 'Bilal Farooq',
    registrationApproved: true,
    paymentApproved: true,
    registrationStatus: 'CONFIRMED',
    paymentStatus: 'PAID',
    attendanceStatus: 'NOT_CHECKED_IN',
    status: 'Confirmed',
    save: async function () {
      savedData = { ...this };
      return this;
    },
  };

  const originalFindOne = SummitRegistration.findOne;
  SummitRegistration.findOne = () => mockRegistration;

  try {
    // 1. Initial successful check-in
    const req1 = {
      body: { registrationId: 'SS26-00010' },
      admin: { email: 'staff@halalwealth.finance' },
    };
    let json1 = null;
    const res1 = { json: (j) => { json1 = j; return res1; } };

    await checkInParticipant(req1, res1);
    assert.equal(json1.success, true);
    assert.equal(json1.registrationId, 'SS26-00010');
    assert.equal(savedData.attendanceStatus, 'CHECKED_IN');
    assert.equal(savedData.status, 'Checked-In');
    assert.equal(savedData.checkedInBy, 'staff@halalwealth.finance');
    assert.ok(savedData.checkedInAt);

    // 2. Duplicate check-in attempt
    let status2 = null;
    let json2 = null;
    const res2 = {
      status: (s) => { status2 = s; return res2; },
      json: (j) => { json2 = j; return res2; },
    };

    await checkInParticipant(req1, res2);
    assert.equal(status2, 409);
    assert.equal(json2.alreadyCheckedIn, true);
    assert.equal(json2.message, 'Already Checked In');
    assert.equal(json2.registrationId, 'SS26-00010');
  } finally {
    SummitRegistration.findOne = originalFindOne;
  }
});

test('getAttendanceStats aggregates confirmed, checked-in, and remaining attendees', async () => {
  const mockAttendees = [
    { registrationId: 'SS26-00001', attendanceStatus: 'CHECKED_IN', status: 'Checked-In' },
    { registrationId: 'SS26-00002', attendanceStatus: 'CHECKED_IN', status: 'Checked-In' },
    { registrationId: 'SS26-00003', attendanceStatus: 'NOT_CHECKED_IN', status: 'Confirmed' },
    { registrationId: 'SS26-00004', attendanceStatus: 'NOT_CHECKED_IN', status: 'Confirmed' },
  ];

  const originalFind = SummitRegistration.find;
  SummitRegistration.find = () => ({
    select: () => ({
      sort: async () => mockAttendees,
    }),
    sort: async () => mockAttendees,
  });

  try {
    const req = {};
    let json = null;
    const res = { json: (j) => { json = j; return res; } };

    await getAttendanceStats(req, res);
    assert.equal(json.success, true);
    assert.equal(json.stats.totalConfirmed, 4);
    assert.equal(json.stats.totalCheckedIn, 2);
    assert.equal(json.stats.remainingNotCheckedIn, 2);
  } finally {
    SummitRegistration.find = originalFind;
  }
});

test('exportAttendanceCsv formats valid CSV with proper headers', async () => {
  const mockAttendees = [
    {
      registrationId: 'SS26-00001',
      fullName: 'Rashid Khan',
      email: 'rashid@example.com',
      mobileNumber: '9876543211',
      city: 'Coimbatore',
      state: 'Tamil Nadu',
      paymentStatus: 'PAID',
      attendanceStatus: 'CHECKED_IN',
      checkedInAt: new Date('2026-12-06T09:30:00Z'),
      checkedInBy: 'admin@halalwealth.finance',
      confirmationEmailStatus: 'SENT',
    },
  ];

  const originalFind = SummitRegistration.find;
  SummitRegistration.find = () => ({
    select: () => ({
      sort: () => ({
        lean: async () => mockAttendees,
      }),
    }),
    sort: () => ({
      lean: async () => mockAttendees,
    }),
  });

  try {
    const req = {};
    let headers = {};
    let sentBody = '';
    const res = {
      setHeader: (k, v) => { headers[k] = v; },
      send: (b) => { sentBody = b; return res; },
    };

    await exportAttendanceCsv(req, res);
    assert.equal(headers['Content-Type'], 'text/csv; charset=utf-8');
    assert.match(headers['Content-Disposition'], /attachment; filename="investor-mission-attendance/);
    assert.match(sentBody, /Registration ID,Full Name,Email,Mobile Number/);
    assert.match(sentBody, /"SS26-00001","Rashid Khan","rashid@example.com"/);
    assert.match(sentBody, /"CHECKED_IN"/);
  } finally {
    SummitRegistration.find = originalFind;
  }
});
