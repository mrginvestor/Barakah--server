const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  createInvestorMissionEmailService,
  buildInvestorMissionConfirmationContent,
  buildInvestorMissionReminderContent,
  buildInvestorMissionAcknowledgementContent,
  EMAIL_SUBJECT,
  REMINDER_EMAIL_SUBJECT,
  ACKNOWLEDGEMENT_EMAIL_SUBJECT,
  OFFICIAL_VENUE,
} = require('./investorMissionEmailService');

describe('investorMissionEmailService', () => {
  it('builds confirmation content with required participant, venue and event information', () => {
    const content = buildInvestorMissionConfirmationContent({
      participantName: 'Ahmed Khan',
      registrationId: 'SS26-00012',
      checkInUrl: 'https://halalwealth.finance/api/investor-mission/checkin/verify/test-token-123',
    });

    assert.equal(content.subject, EMAIL_SUBJECT);
    assert.match(content.text, /Assalamu Alaikum Ahmed Khan/);
    assert.match(content.text, /Alhamdulillah!/);
    assert.match(content.text, /INVESTOR MISSION 2026 – THE HALAL WAY OF INVESTING/);
    assert.match(content.text, /SS26-00012/);
    assert.match(content.text, /Sunday, 06 December 2026/);
    assert.match(content.text, /Abdul Basith – Licensed Financial Consultant/);
    assert.match(content.text, /₹500/);

    // Official Venue assertions in text
    assert.match(content.text, /Siruthuli Noyyal Life Centre/);
    assert.match(content.text, /Ukkadam Sungam Bypass Rd, Shanmuga Nagar, Ramanathapuram, Coimbatore, Tamil Nadu 641023/);
    assert.match(content.text, /maps\.google\.com/);

    // HTML assertions
    assert.match(content.html, /Assalamu Alaikum Ahmed Khan/);
    assert.match(content.html, /INVESTOR MISSION 2026/);
    assert.match(content.html, /THE HALAL WAY OF INVESTING/);
    assert.match(content.html, /SS26-00012/);
    assert.match(content.html, /Siruthuli Noyyal Life Centre/);
    assert.match(content.html, /Ukkadam Sungam Bypass Rd, Shanmuga Nagar, Ramanathapuram, Coimbatore, Tamil Nadu 641023/);
    assert.match(content.html, /maps\.google\.com/);
    assert.match(content.html, /Open in Google Maps &amp; Get Directions/);
    assert.match(content.html, /cid:investor-mission-poster/);
    assert.match(content.html, /cid:participant-checkin-qr/);
  });

  it('builds reminder content with venue details and check-in QR code', () => {
    const reminder = buildInvestorMissionReminderContent({
      participantName: 'Ahmed Khan',
      registrationId: 'SS26-00012',
      checkInUrl: 'https://halalwealth.finance/api/investor-mission/checkin/verify/test-token-123',
    });

    assert.equal(reminder.subject, REMINDER_EMAIL_SUBJECT);
    assert.match(reminder.text, /Assalamu Alaikum Ahmed Khan/);
    assert.match(reminder.text, /Siruthuli Noyyal Life Centre/);
    assert.match(reminder.text, /Ukkadam Sungam Bypass Rd, Shanmuga Nagar, Ramanathapuram, Coimbatore, Tamil Nadu 641023/);
    assert.match(reminder.text, /maps\.google\.com/);
    assert.match(reminder.text, /SS26-00012/);

    // HTML assertions
    assert.match(reminder.html, /Siruthuli Noyyal Life Centre/);
    assert.match(reminder.html, /Ukkadam Sungam Bypass Rd, Shanmuga Nagar, Ramanathapuram, Coimbatore, Tamil Nadu 641023/);
    assert.match(reminder.html, /maps\.google\.com/);
    assert.match(reminder.html, /Open in Google Maps &amp; Get Directions/);
    assert.match(reminder.html, /cid:participant-checkin-qr/);
  });

  it('generates a valid QR code PNG buffer', async () => {
    const service = createInvestorMissionEmailService();
    const buffer = await service.generateQrBuffer('https://halalwealth.finance/test');
    assert.ok(Buffer.isBuffer(buffer));
    assert.ok(buffer.length > 100);
    // PNG magic bytes: 0x89 0x50 0x4E 0x47
    assert.equal(buffer[0], 0x89);
    assert.equal(buffer[1], 0x50);
    assert.equal(buffer[2], 0x4E);
    assert.equal(buffer[3], 0x47);
  });

  it('rejects invalid recipient email addresses', async () => {
    const service = createInvestorMissionEmailService();
    await assert.rejects(
      () =>
        service.sendInvestorMissionConfirmation({
          recipientEmail: 'invalid-email',
          participantName: 'Test',
          registrationId: 'SS26-00001',
        }),
      /Invalid recipient email address/
    );
  });

  it('sends email successfully using mocked transporter with inline attachments', async () => {
    let sentMail = null;
    const mockTransporter = {
      sendMail: async (options) => {
        sentMail = options;
        return { messageId: '<mock-msg-123@halalwealth.finance>' };
      },
    };

    // Provide mock env variables for SMTP configuration
    const originalEnv = { ...process.env };
    process.env.SMTP_HOST = 'smtp.test.com';
    process.env.SMTP_PORT = '465';
    process.env.SMTP_USER = 'test@halalwealth.finance';
    process.env.SMTP_PASS = 'secretpass';

    try {
      const service = createInvestorMissionEmailService({
        createTransporter: () => mockTransporter,
      });

      const res = await service.sendInvestorMissionConfirmation({
        recipientEmail: 'participant@example.com',
        participantName: 'Farhan Ali',
        registrationId: 'SS26-00005',
        checkInUrl: 'https://halalwealth.finance/api/investor-mission/checkin/verify/abc123token',
      });

      assert.equal(res.success, true);
      assert.equal(res.messageId, '<mock-msg-123@halalwealth.finance>');
      assert.ok(sentMail);
      assert.equal(sentMail.to, 'participant@example.com');
      assert.equal(sentMail.subject, EMAIL_SUBJECT);
      assert.ok(Array.isArray(sentMail.attachments));

      // QR attachment verification
      const qrAttachment = sentMail.attachments.find(a => a.cid === 'participant-checkin-qr');
      assert.ok(qrAttachment, 'Check-in QR code must be attached as CID');
      assert.equal(qrAttachment.filename, 'checkin-qr.png');
      assert.ok(Buffer.isBuffer(qrAttachment.content));
    } finally {
      process.env = originalEnv;
    }
  });

  it('builds acknowledgement content matching exact required wording and subject', () => {
    const ack = buildInvestorMissionAcknowledgementContent({
      participantName: 'Tariq Mansoor',
      registrationId: 'SS26-00045',
      includePoster: true,
    });

    assert.equal(ack.subject, 'Registration Received Successfully | Investor Mission 2026');
    assert.equal(ack.subject, ACKNOWLEDGEMENT_EMAIL_SUBJECT);

    // Text assertions
    assert.match(ack.text, /Assalamu Alaikum Tariq Mansoor,/);
    assert.match(ack.text, /Thank you for registering for Investor Mission 2026 – The Halal Way of Investing\./);
    assert.match(ack.text, /Alhamdulillah! We have successfully received your registration details\./);
    assert.match(ack.text, /Your registration is currently under verification\./);
    assert.match(ack.text, /Our team will review your registration and payment details\./);
    assert.match(ack.text, /Once the verification process is completed, we will send you a separate confirmation email as soon as possible to confirm your booking\./);
    assert.match(ack.text, /Event: Investor Mission 2026 – The Halal Way of Investing/);
    assert.match(ack.text, /Date: Sunday, 06 December 2026/);
    assert.match(ack.text, /Venue: https:\/\/maps\.app\.goo\.gl\/4hwJsFTMujiSVDMEA\./);
    assert.match(ack.text, /Registration ID: SS26-00045/);
    assert.match(ack.text, /Please keep your Registration ID for future reference\./);
    assert.match(ack.text, /We appreciate your interest and patience\. We look forward to welcoming you!/);
    assert.match(ack.text, /JazakAllahu Khairan,/);
    assert.match(ack.text, /Team Investor Mission 2026/);
    assert.match(ack.text, /SIO Coimbatore/);
    assert.match(ack.text, /SOLIDARITY TAMIL NADU/);

    // Must NOT declare booking confirmed or payment approved
    assert.doesNotMatch(ack.text, /Your registration is confirmed/i);
    assert.doesNotMatch(ack.text, /payment have been verified/i);
    assert.doesNotMatch(ack.text, /₹500 payment have been verified/i);

    // HTML assertions
    assert.match(ack.html, /Registration Received Successfully \| Investor Mission 2026/);
    assert.match(ack.html, /Assalamu Alaikum Tariq Mansoor,/);
    assert.match(ack.html, /Your registration is currently under verification\./);
    assert.match(ack.html, /SS26-00045/);
    assert.match(ack.html, /https:\/\/maps\.app\.goo\.gl\/4hwJsFTMujiSVDMEA/);
    assert.match(ack.html, /SIO Coimbatore/);
    assert.match(ack.html, /SOLIDARITY TAMIL NADU/);
    assert.match(ack.html, /cid:investor-mission-poster/);
    // Does NOT contain QR code cid
    assert.doesNotMatch(ack.html, /cid:participant-checkin-qr/);
  });

  it('sends acknowledgement email successfully using mocked transporter with poster', async () => {
    let sentMail = null;
    const mockTransporter = {
      sendMail: async (options) => {
        sentMail = options;
        return { messageId: '<ack-msg-999@halalwealth.finance>' };
      },
    };

    const originalEnv = { ...process.env };
    process.env.SMTP_HOST = 'smtp.test.com';
    process.env.SMTP_PORT = '465';
    process.env.SMTP_USER = 'test@halalwealth.finance';
    process.env.SMTP_PASS = 'secretpass';

    try {
      const service = createInvestorMissionEmailService({
        createTransporter: () => mockTransporter,
      });

      const res = await service.sendInvestorMissionAcknowledgement({
        recipientEmail: 'applicant@example.com',
        participantName: 'Zayd Ibrahim',
        registrationId: 'SS26-00077',
      });

      assert.equal(res.success, true);
      assert.equal(res.messageId, '<ack-msg-999@halalwealth.finance>');
      assert.ok(sentMail);
      assert.equal(sentMail.to, 'applicant@example.com');
      assert.equal(sentMail.subject, 'Registration Received Successfully | Investor Mission 2026');
      assert.ok(Array.isArray(sentMail.attachments));

      // Should attach the poster
      const posterAttachment = sentMail.attachments.find(a => a.cid === 'investor-mission-poster');
      assert.ok(posterAttachment, 'Poster must be attached as CID');
      assert.equal(posterAttachment.filename, 'investor-mission-poster.jpg');

      // Must NOT attach QR code
      const qrAttachment = sentMail.attachments.find(a => a.cid === 'participant-checkin-qr');
      assert.equal(qrAttachment, undefined, 'Check-in QR code must not be in acknowledgement email');
    } finally {
      process.env = originalEnv;
    }
  });
});
