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
    assert.match(content.text, /maps\.(app\.goo\.gl|google\.com)/);

    // Negative assertions for branding purity
    assert.doesNotMatch(content.subject, /Halal Wealth/i);
    assert.doesNotMatch(content.text, /Halal Wealth/i);
    assert.doesNotMatch(content.html, /Halal Wealth/i);
    assert.doesNotMatch(content.text, /Verified & Paid/i);
    assert.doesNotMatch(content.html, /Verified & Paid/i);

    // Fee displayed cleanly without payment status descriptions
    assert.match(content.text, /Registration Fee: ₹500/);
    assert.doesNotMatch(content.text, /Registration Fee: ₹500 \(/i);

    // Signatures
    assert.match(content.text, /Team Investor Mission 2026/);
    assert.match(content.text, /SIO Coimbatore/);

    // HTML assertions
    assert.match(content.html, /Assalamu Alaikum Ahmed Khan/);
    assert.match(content.html, /INVESTOR MISSION 2026/);
    assert.match(content.html, /THE HALAL WAY OF INVESTING/);
    assert.match(content.html, /SS26-00012/);
    assert.match(content.html, /Siruthuli Noyyal Life Centre/);
    assert.match(content.html, /Ukkadam Sungam Bypass Rd, Shanmuga Nagar, Ramanathapuram, Coimbatore, Tamil Nadu 641023/);
    assert.match(content.html, /maps\.(app\.goo\.gl|google\.com)/);
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
    assert.match(reminder.text, /maps\.(app\.goo\.gl|google\.com)/);
    assert.match(reminder.text, /SS26-00012/);

    // HTML assertions
    assert.match(reminder.html, /Siruthuli Noyyal Life Centre/);
    assert.match(reminder.html, /Ukkadam Sungam Bypass Rd, Shanmuga Nagar, Ramanathapuram, Coimbatore, Tamil Nadu 641023/);
    assert.match(reminder.html, /maps\.(app\.goo\.gl|google\.com)/);
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

  it('dispatches confirmation email via Resend SDK over HTTPS port 443 with inline CID attachments', async () => {
    let capturedPayload = null;
    const mockResend = {
      emails: {
        send: async (payload) => {
          capturedPayload = payload;
          return { data: { id: 're_mock_test_12345' }, error: null };
        },
      },
    };

    const originalEnv = { ...process.env };
    process.env.RESEND_API_KEY = 're_test_mock_secret_key';
    process.env.EMAIL_FROM = 'info@halalwealth.finance';
    process.env.EMAIL_FROM_NAME = 'Investor Mission 2026';

    try {
      const service = createInvestorMissionEmailService({ resendClient: mockResend });
      const result = await service.sendInvestorMissionConfirmation({
        recipientEmail: 'verified.investor@example.com',
        participantName: 'Salim Merchant',
        registrationId: 'SS26-00050',
        checkInUrl: 'https://halalwealth.finance/api/investor-mission/checkin/verify/salim50',
      });

      assert.equal(result.success, true);
      assert.equal(result.messageId, 're_mock_test_12345');
      assert.equal(result.port, 443);

      assert.ok(capturedPayload);
      assert.equal(capturedPayload.to[0], 'verified.investor@example.com');
      assert.equal(capturedPayload.from, '"Investor Mission 2026" <info@halalwealth.finance>');
      assert.equal(capturedPayload.subject, EMAIL_SUBJECT);
      assert.ok(Array.isArray(capturedPayload.attachments));

      // QR attachment check
      const qrAtt = capturedPayload.attachments.find(a => a.contentId === 'participant-checkin-qr');
      assert.ok(qrAtt, 'Must include QR code with contentId participant-checkin-qr');
      assert.equal(qrAtt.filename, 'checkin-qr.png');
    } finally {
      process.env = originalEnv;
    }
  });

  it('executes live diagnostic verifying Resend API key, authentication, domain, and test email submission', async () => {
    let sentTestEmail = null;
    const mockResend = {
      apiKeys: {
        list: async () => ({ data: [{ id: 'key_1', name: 'Default' }], error: null }),
      },
      domains: {
        list: async () => ({
          data: {
            data: [
              { name: 'halalwealth.finance', status: 'verified' },
            ],
          },
          error: null,
        }),
      },
      emails: {
        send: async (payload) => {
          sentTestEmail = payload;
          return { data: { id: 're_diagnostic_test_id' }, error: null };
        },
      },
    };

    const originalEnv = { ...process.env };
    process.env.RESEND_API_KEY = 're_test_diagnostic_key';
    process.env.EMAIL_FROM = 'info@halalwealth.finance';
    process.env.EMAIL_FROM_NAME = 'Investor Mission 2026';

    try {
      const service = createInvestorMissionEmailService({ resendClient: mockResend });
      const diagnostic = await service.verifyEmailService({ testRecipient: 'admin@halalwealth.finance' });

      assert.equal(diagnostic.ok, true);
      assert.equal(diagnostic.resendApiConfig, 'READY');
      assert.equal(diagnostic.senderConfig, 'READY');
      assert.equal(diagnostic.apiAuthentication, 'SUCCESS');
      assert.equal(diagnostic.domainVerification, 'VERIFIED');
      assert.equal(diagnostic.testEmailStatus, 'ACCEPTED');
      assert.equal(diagnostic.testEmailId, 're_diagnostic_test_id');
      assert.equal(diagnostic.smtpBypassed, true);
      assert.equal(diagnostic.transport, 'HTTPS Port 443');

      assert.ok(sentTestEmail);
      assert.equal(sentTestEmail.to[0], 'admin@halalwealth.finance');
    } finally {
      process.env = originalEnv;
    }
  });

  it('sanitizes secrets from error messages when Resend API fails', async () => {
    const mockResend = {
      emails: {
        send: async () => ({
          data: null,
          error: {
            statusCode: 403,
            name: 'forbidden',
            message: 'Invalid API key re_super_secret_123456789 provided for Bearer auth',
          },
        }),
      },
    };

    const originalEnv = { ...process.env };
    process.env.RESEND_API_KEY = 're_super_secret_123456789';

    try {
      const service = createInvestorMissionEmailService({ resendClient: mockResend });
      await assert.rejects(
        () =>
          service.sendInvestorMissionConfirmation({
            recipientEmail: 'participant@example.com',
            participantName: 'Test',
            registrationId: 'SS26-00001',
          }),
        (err) => {
          assert.doesNotMatch(err.message, /re_super_secret_123456789/);
          assert.match(err.message, /re_\*\*\*/);
          return true;
        }
      );
    } finally {
      process.env = originalEnv;
    }
  });
});
