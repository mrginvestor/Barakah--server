const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  createInvestorMissionEmailService,
  buildInvestorMissionConfirmationContent,
  buildInvestorMissionReminderContent,
  EMAIL_SUBJECT,
  REMINDER_EMAIL_SUBJECT,
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
});
