const test = require('node:test');
const assert = require('node:assert/strict');
const {
  EMAIL_SUBJECT,
  POSTPONEMENT_EMAIL_SUBJECT,
  ZOOM_JOINING_EMAIL_SUBJECT,
  REMINDER_ONE_HOUR_EMAIL_SUBJECT,
  ZOOM_LINK,
  ZOOM_MEETING_ID,
  ZOOM_PASSCODE,
  buildRegistrationConfirmation,
  buildPostponementAnnouncement,
  buildZoomJoiningDetails,
  buildOneHourReminder,
  DEFAULT_FEEDBACK_EMAIL_SUBJECT,
  DEFAULT_FEEDBACK_FORM_URL,
  DEFAULT_FEEDBACK_WHATSAPP_URL,
  DEFAULT_FEEDBACK_YOUTUBE_URL,
  DEFAULT_FEEDBACK_INSTAGRAM_URL,
  DEFAULT_FEEDBACK_BODY_TEXT,
  buildFeedbackEmail,
  buildCustomEmail,
  createWebinarEmailService,
} = require('./webinarEmailService');

test('builds the requested confirmation email and escapes the name in HTML', () => {
  const email = buildRegistrationConfirmation('Amina <Rahman>');

  assert.equal(EMAIL_SUBJECT, 'Thank You for Registering for Our Webinar');
  assert.equal(email.subject, EMAIL_SUBJECT);
  assert.match(email.text, /Dear Amina <Rahman>,/);
  assert.match(email.html, /Dear Amina &lt;Rahman&gt;,/);
  assert.equal(email.text, `Dear Amina <Rahman>,

Assalamu Alaikum warahmatullahi wabarakatuh!

Thank you for registering for our upcoming webinar. We’re delighted to have you join us.



We will be sharing the webinar access link with you shortly. Please keep an eye on your email for the registration/access link and further details.

In the meantime, stay connected with us to learn more about Islamic finance and Halal investments:

YouTube: https://youtube.com/@ethicalfinancebasithtamil
Instagram: https://instagram.com/ethicalfinancebasith.tamil
WhatsApp Community: https://chat.whatsapp.com/InfThev3br60wmCUWRt3tq

JazakAllah,

Halal Wealth Webinar Team`);
  assert.doesNotMatch(email.text, /\[Name\]|\{\{name\}\}/);
});

test('builds the registration confirmation email with user-provided Zoom link when details are included', () => {
  const email = buildRegistrationConfirmation('Amina', null, { includeEventDetails: true });

  assert.equal(email.subject, 'Thank You for Registering for Our Webinar');
  assert.match(email.text, /Zoom Meeting Link: https:\/\/us06web\.zoom\.us\/j\/81487983324/);
  assert.match(email.text, /Meeting ID: 814 8798 3324/);
  assert.match(email.text, /Passcode: 666991/);
  assert.match(email.html, /Click Here to Join Zoom Webinar/);
  assert.match(email.html, /https:\/\/us06web\.zoom\.us\/j\/81487983324\?pwd=iiWszjuBKKDHZ7SNibjY9aUkfFVEvS\.1/);
  assert.match(email.html, /Meeting ID: <strong style="color:#d4af5a;">814 8798 3324<\/strong>/);
  assert.match(email.html, /Passcode: <strong style="color:#d4af5a;">666991<\/strong>/);
  assert.match(email.text, /Assalamu Alaikum warahmatullahi wabarakatuh!/);
  assert.match(email.text, /We will be sharing the webinar access link with you shortly\./);
  assert.match(email.text, /YouTube: https:\/\/youtube\.com\/@ethicalfinancebasithtamil/);
});

test('builds the Zoom joining details email with exact details and credentials', () => {
  const email = buildZoomJoiningDetails('Brother Tariq');

  assert.equal(ZOOM_JOINING_EMAIL_SUBJECT, 'Your Zoom Joining Link – Halal Wealth Webinar | 18 October 2026');
  assert.equal(email.subject, ZOOM_JOINING_EMAIL_SUBJECT);
  assert.match(email.text, /Assalamu Alaikum Wa Rahmatullahi Wa Barakatuh/);
  assert.match(email.text, /Topic: Halal Trade, Investments & Generational Wealth/);
  assert.match(email.text, /Date: Sunday, 18 October 2026/);
  assert.match(email.text, /India: 11:00 AM IST/);
  assert.match(email.text, /Singapore: 1:30 PM SGT/);
  assert.match(email.text, /UAE: 9:30 AM GST/);
  assert.match(email.text, /Saudi Arabia \(KSA\): 8:30 AM AST/);
  assert.match(email.text, new RegExp(ZOOM_LINK.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(email.text, /Meeting ID: 814 8798 3324/);
  assert.match(email.text, /Passcode: 666991/);
  assert.match(email.text, /Barakah Team\s+Halal Wealth Webinar/);
  assert.match(email.html, /814 8798 3324/);
  assert.match(email.html, /666991/);
  assert.match(email.html, /Click Here to Join Zoom Webinar/);
});

test('builds the postponement email content with the revised webinar date and links', () => {
  const email = buildPostponementAnnouncement('Test User');

  assert.equal(email.subject, POSTPONEMENT_EMAIL_SUBJECT);
  assert.match(email.text, /Assalamu Alaikum warahmatullahi wabarakatuh/);
  assert.match(email.text, /Sunday, 18 October 2026/);
  assert.match(email.text, /NO NEED TO REGISTER AGAIN!/);
  assert.match(email.html, /https:\/\/youtube.com\/@ethicalfinancebasithtamil/);
  assert.match(email.html, /https:\/\/instagram.com\/ethicalfinancebasith.tamil/);
  assert.match(email.html, /https:\/\/chat.whatsapp.com\/InfThev3br60wmCUWRt3tq/);
});

test('sends multipart confirmation from the fixed sender using backend SMTP settings', async () => {
  const originalEnvironment = {
    SMTP_HOST: process.env.SMTP_HOST,
    SMTP_PORT: process.env.SMTP_PORT,
    SMTP_USER: process.env.SMTP_USER,
    SMTP_PASSWORD: process.env.SMTP_PASSWORD,
    MAIL_HOST: process.env.MAIL_HOST,
    MAIL_PORT: process.env.MAIL_PORT,
    MAIL_USERNAME: process.env.MAIL_USERNAME,
    MAIL_PASSWORD: process.env.MAIL_PASSWORD,
    SMTP_FROM: process.env.SMTP_FROM,
    MAIL_FROM: process.env.MAIL_FROM,
  };
  let transportConfig;
  let message;
  process.env.MAIL_HOST = 'smtp.provider.example';
  process.env.MAIL_PORT = '587';
  process.env.MAIL_USERNAME = 'info@halalwealth.finance';
  process.env.MAIL_PASSWORD = 'test-only-password';
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_PORT;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASSWORD;

  try {
    const service = createWebinarEmailService({
      createTransporter: config => {
        transportConfig = config;
        return { sendMail: async options => { message = options; return { accepted: [options.to] }; } };
      },
    });
    await service.sendRegistrationConfirmation('test@example.com', 'Test User');
  } finally {
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  assert.equal(transportConfig.host, 'smtp.provider.example');
  assert.equal(transportConfig.port, 587);
  assert.equal(transportConfig.secure, false);
  assert.equal(transportConfig.requireTLS, true);
  assert.equal(transportConfig.family, 4);
  assert.equal(transportConfig.pool, true);
  assert.equal(transportConfig.connectionTimeout, 10000);
  assert.equal(transportConfig.greetingTimeout, 10000);
  assert.equal(transportConfig.socketTimeout, 15000);
  assert.deepEqual(transportConfig.auth, { user: 'info@halalwealth.finance', pass: 'test-only-password' });
  assert.deepEqual(message.from, { name: 'Halal Wealth Webinar', address: 'info@halalwealth.finance' });
  assert.equal(message.replyTo, 'info@halalwealth.finance');
  assert.equal(message.to, 'test@example.com');
  assert.equal(message.subject, EMAIL_SUBJECT);
  assert.match(message.text, /Dear Test User,/);
  assert.match(message.html, /Dear Test User,/);
});

test('sends multipart Zoom joining email from the fixed sender with poster', async () => {
  const originalEnvironment = {
    MAIL_HOST: process.env.MAIL_HOST,
    MAIL_PORT: process.env.MAIL_PORT,
    MAIL_USERNAME: process.env.MAIL_USERNAME,
    MAIL_PASSWORD: process.env.MAIL_PASSWORD,
  };
  let message;
  process.env.MAIL_HOST = 'smtp.provider.example';
  process.env.MAIL_PORT = '465';
  process.env.MAIL_USERNAME = 'info@halalwealth.finance';
  process.env.MAIL_PASSWORD = 'test-only-password';

  try {
    const service = createWebinarEmailService({
      createTransporter: () => ({
        sendMail: async options => {
          message = options;
          return { accepted: [options.to], messageId: '<test-zoom-id@halalwealth.finance>' };
        },
      }),
    });
    const result = await service.sendZoomJoiningLink('participant@example.com', 'Ahmad Khan');
    assert.equal(result.accepted[0], 'participant@example.com');
  } finally {
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  assert.deepEqual(message.from, { name: 'Halal Wealth Webinar', address: 'info@halalwealth.finance' });
  assert.equal(message.to, 'participant@example.com');
  assert.equal(message.subject, 'Your Zoom Joining Link – Halal Wealth Webinar | 18 October 2026');
  assert.match(message.text, /814 8798 3324/);
  assert.match(message.text, /666991/);
  assert.match(message.html, /https:\/\/us06web.zoom.us\/j\/81487983324/);
  assert.equal(message.attachments.length, 1);
  assert.equal(message.attachments[0].cid, 'webinar-poster');
});

test('builds the one-hour reminder email with exact wording, times, and Zoom link', () => {
  const email = buildOneHourReminder('Sister Fatima');

  assert.equal(email.subject, 'Webinar Starting in One Hour | Halal Trade, Investments & Generational Wealth');
  assert.equal(REMINDER_ONE_HOUR_EMAIL_SUBJECT, email.subject);
  assert.match(email.text, /Assalamu Alaikum Wr Wb,/);
  assert.match(email.text, /We are commencing our Tamil webinar on Halal Trade, Investments & Generational Wealth in an hour\./);
  assert.match(email.text, /🗓️ Sunday, 18 October 2026/);
  assert.match(email.text, /🕐 11:00 am IST \(1:30 pm SG \| 9:30 am UAE \| 8:30 am KSA\)/);
  assert.match(email.text, new RegExp(ZOOM_LINK.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(email.text, /See you in a while, Insha'Allah!/);
  assert.match(email.html, /Webinar Starting in One Hour/);
  assert.match(email.html, /Assalamu Alaikum Wr Wb,/);
  assert.match(email.html, /See you in a while, Insha&#39;Allah!/);
  assert.match(email.html, new RegExp(ZOOM_LINK.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('sends multipart one-hour reminder email using mock transporter without real network/SMTP', async () => {
  const originalEnvironment = {
    MAIL_HOST: process.env.MAIL_HOST,
    MAIL_PORT: process.env.MAIL_PORT,
    MAIL_USERNAME: process.env.MAIL_USERNAME,
    MAIL_PASSWORD: process.env.MAIL_PASSWORD,
  };
  let message;
  process.env.MAIL_HOST = 'smtp.provider.example';
  process.env.MAIL_PORT = '465';
  process.env.MAIL_USERNAME = 'info@halalwealth.finance';
  process.env.MAIL_PASSWORD = 'test-only-password';

  try {
    const service = createWebinarEmailService({
      createTransporter: () => ({
        sendMail: async options => {
          message = options;
          return { accepted: [options.to], messageId: '<test-reminder-id@halalwealth.finance>' };
        },
      }),
    });
    const result = await service.sendOneHourReminder('reminder-user@example.com', 'Brother Zaid');
    assert.equal(result.accepted[0], 'reminder-user@example.com');
  } finally {
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  assert.deepEqual(message.from, { name: 'Halal Wealth Webinar', address: 'info@halalwealth.finance' });
  assert.equal(message.to, 'reminder-user@example.com');
  assert.equal(message.subject, REMINDER_ONE_HOUR_EMAIL_SUBJECT);
  assert.match(message.text, /Assalamu Alaikum Wr Wb,/);
  assert.match(message.text, /See you in a while, Insha'Allah!/);
  assert.match(message.html, /https:\/\/us06web.zoom.us\/j\/81487983324/);
  assert.equal(message.attachments.length, 1);
  assert.equal(message.attachments[0].cid, 'webinar-poster');
});

test('builds the feedback email with exact required wording, feedback URL, and community links', () => {
  const email = buildFeedbackEmail({}, 'Brother Omar');

  assert.equal(email.subject, 'Thank You for Attending | Feedback & Future Halal Investing Programs');
  assert.equal(DEFAULT_FEEDBACK_EMAIL_SUBJECT, email.subject);
  assert.match(email.text, /Assalamu Alaikum Wr Wb,/);
  assert.match(email.text, /Hope you have joined our webinar yesterday and benefited from the knowledge shared\./);
  assert.match(email.text, /We would like to hear your feedback and suggestions to help us better plan our future programs\./);
  assert.match(email.text, /Kindly submit this feedback form: https:\/\/forms\.gle\/ysMqbTQ37BSnrbGT9/);
  assert.match(email.text, /We look forward to having you join our Halal Investing webinar planned for November 2026\. Do stay connected with us\. JazakAllah\./);
  assert.match(email.text, /WhatsApp Community: https:\/\/chat\.whatsapp\.com\/I9d41QdjbOGA43kYph2noq/);
  assert.match(email.text, /YouTube: youtube\.com\/@ethicalfinancebasithtamil/);
  assert.match(email.text, /Instagram: instagram\.com\/ethicalfinancebasith\.tamil/);

  // HTML contains valid clickable HTTPS URLs
  assert.match(email.html, /href="https:\/\/forms\.gle\/ysMqbTQ37BSnrbGT9"/);
  assert.match(email.html, /href="https:\/\/chat\.whatsapp\.com\/I9d41QdjbOGA43kYph2noq"/);
  assert.match(email.html, /href="https:\/\/youtube\.com\/@ethicalfinancebasithtamil"/);
  assert.match(email.html, /href="https:\/\/instagram\.com\/ethicalfinancebasith\.tamil"/);
  assert.doesNotMatch(email.html, /Zoom/i);
  assert.doesNotMatch(email.html, /Postponed/i);
});

test('buildFeedbackEmail supports dynamic custom configuration', () => {
  const customConfig = {
    subject: 'Custom Feedback Subject',
    bodyText: 'Custom body text with updates.',
    feedbackFormUrl: 'https://forms.gle/custom123',
    whatsappUrl: 'https://chat.whatsapp.com/customGroup',
    youtubeUrl: 'https://youtube.com/@customChannel',
    instagramUrl: 'https://instagram.com/customAccount',
  };
  const email = buildFeedbackEmail(customConfig, 'Sister Maryam');
  assert.equal(email.subject, 'Custom Feedback Subject');
  assert.equal(email.text, 'Custom body text with updates.');
  assert.match(email.html, /href="https:\/\/forms\.gle\/custom123"/);
  assert.match(email.html, /href="https:\/\/chat\.whatsapp\.com\/customGroup"/);
  assert.match(email.html, /href="https:\/\/youtube\.com\/@customChannel"/);
  assert.match(email.html, /href="https:\/\/instagram\.com\/customAccount"/);
});

test('sends feedback email using mock transporter without real network/SMTP', async () => {
  const originalEnvironment = {
    MAIL_HOST: process.env.MAIL_HOST,
    MAIL_PORT: process.env.MAIL_PORT,
    MAIL_USERNAME: process.env.MAIL_USERNAME,
    MAIL_PASSWORD: process.env.MAIL_PASSWORD,
  };
  let message;
  process.env.MAIL_HOST = 'smtp.provider.example';
  process.env.MAIL_PORT = '465';
  process.env.MAIL_USERNAME = 'info@halalwealth.finance';
  process.env.MAIL_PASSWORD = 'test-only-password';

  try {
    const service = createWebinarEmailService({
      createTransporter: () => ({
        sendMail: async options => {
          message = options;
          return { accepted: [options.to], messageId: '<test-feedback-msg-id@halalwealth.finance>' };
        },
      }),
    });
    const result = await service.sendFeedbackEmail('feedback-user@example.com', 'Sister Aisha');
    assert.equal(result.accepted[0], 'feedback-user@example.com');
  } finally {
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  assert.deepEqual(message.from, { name: 'Halal Wealth Webinar', address: 'info@halalwealth.finance' });
  assert.equal(message.to, 'feedback-user@example.com');
  assert.equal(message.subject, DEFAULT_FEEDBACK_EMAIL_SUBJECT);
  assert.match(message.text, /Kindly submit this feedback form/);
  assert.match(message.html, /href="https:\/\/forms\.gle\/ysMqbTQ37BSnrbGT9"/);
});
test('builds the custom email with custom subject, message body, and HTML escaping', () => {
  const email = buildCustomEmail({
    subject: 'Special Webinar Update <Test>',
    message: 'Dear Brother,\n\nHere is the updated information.\n\nThank you.',
    recipientName: 'Brother Ahmed <Test>',
  });

  assert.equal(email.subject, 'Special Webinar Update <Test>');
  assert.equal(email.text, 'Dear Brother,\n\nHere is the updated information.\n\nThank you.');
  assert.match(email.html, /Special Webinar Update &lt;Test&gt;/);
  assert.ok(email.html.includes('<p style="margin:0 0 16px;">Dear Brother,</p>'));
  assert.ok(email.html.includes('<p style="margin:0 0 16px;">Here is the updated information.</p>'));
});

test('sends custom individual email using mock transporter without real network/SMTP', async () => {
  const originalEnvironment = {
    MAIL_HOST: process.env.MAIL_HOST,
    MAIL_PORT: process.env.MAIL_PORT,
    MAIL_USERNAME: process.env.MAIL_USERNAME,
    MAIL_PASSWORD: process.env.MAIL_PASSWORD,
  };

  let message;
  process.env.MAIL_HOST = 'smtp.hostinger.com';
  process.env.MAIL_PORT = '465';
  process.env.MAIL_USERNAME = 'info@halalwealth.finance';
  process.env.MAIL_PASSWORD = 'test-only-password';

  try {
    const service = createWebinarEmailService({
      createTransporter: () => ({
        sendMail: async options => {
          message = options;
          return { accepted: [options.to], messageId: '<test-custom-msg-id@halalwealth.finance>' };
        },
      }),
    });
    const result = await service.sendCustomEmail('participant@example.com', {
      subject: 'Custom Subject Line',
      message: 'Hello participant,\n\nThis is a manual update.',
      recipientName: 'Sister Maryam',
    });
    assert.equal(result.accepted[0], 'participant@example.com');
  } finally {
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  assert.deepEqual(message.from, { name: 'Halal Wealth Webinar', address: 'info@halalwealth.finance' });
  assert.equal(message.to, 'participant@example.com');
  assert.equal(message.subject, 'Custom Subject Line');
  assert.match(message.text, /This is a manual update/);
  assert.match(message.html, /Custom Subject Line/);
});


test('reuses the cached transporter instance across multiple email dispatches', async () => {
  let createdCount = 0;
  const originalEnvironment = {
    SMTP_HOST: process.env.SMTP_HOST,
    SMTP_PORT: process.env.SMTP_PORT,
    SMTP_USER: process.env.SMTP_USER,
    SMTP_PASSWORD: process.env.SMTP_PASSWORD,
  };
  process.env.SMTP_HOST = 'smtp.cached.example';
  process.env.SMTP_PORT = '465';
  process.env.SMTP_USER = 'cached@example.com';
  process.env.SMTP_PASSWORD = 'cached-password';

  try {
    const service = createWebinarEmailService({
      createTransporter: () => {
        createdCount++;
        return { sendMail: async () => ({ accepted: ['recipient@example.com'] }) };
      },
    });

    await service.sendRegistrationConfirmation('test1@example.com', 'User One');
    await service.sendRegistrationConfirmation('test2@example.com', 'User Two');
    await service.sendRegistrationConfirmation('test3@example.com', 'User Three');

    assert.equal(createdCount, 1, 'Transporter should be created once and reused via cache');
  } finally {
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('resolves EMAIL_FROM and EMAIL_FROM_NAME correctly with formatted strings', () => {
  const { resolveSenderConfig } = require('./webinarEmailService');
  const env1 = {
    EMAIL_FROM: 'Halal Wealth <info@halalwealth.finance>',
    MAIL_FROM: 'old@example.com',
  };
  const res1 = resolveSenderConfig(env1);
  assert.equal(res1.fromAddress, 'info@halalwealth.finance');
  assert.equal(res1.fromName, 'Halal Wealth');

  const env2 = {
    EMAIL_FROM: 'info@halalwealth.finance',
    EMAIL_FROM_NAME: 'Custom Sender',
    MAIL_FROM: 'old@example.com',
  };
  const res2 = resolveSenderConfig(env2);
  assert.equal(res2.fromAddress, 'info@halalwealth.finance');
  assert.equal(res2.fromName, 'Custom Sender');
});

test('resolves EMAIL_PROVIDER to smtp', () => {
  const { resolveProviderConfig } = require('./webinarEmailService');
  assert.equal(resolveProviderConfig({ EMAIL_PROVIDER: 'smtp' }).provider, 'smtp');
  assert.equal(resolveProviderConfig({}).provider, 'smtp');
});

test('verifyEmailService reports EMAIL_CONFIG_INCOMPLETE when SMTP credentials are missing', async () => {
  const service = createWebinarEmailService();
  const prevHost = process.env.SMTP_HOST;
  const prevUser = process.env.SMTP_USER;
  const prevPass = process.env.SMTP_PASS;
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;

  try {
    const result = await service.verifyEmailService();
    assert.equal(result.ok, false);
    assert.equal(result.code, 'EMAIL_CONFIG_INCOMPLETE');
  } finally {
    if (prevHost) process.env.SMTP_HOST = prevHost;
    if (prevUser) process.env.SMTP_USER = prevUser;
    if (prevPass) process.env.SMTP_PASS = prevPass;
  }
});

test('verifyEmailService verifies successfully with mock transporter', async () => {
  let verified = false;
  const mockCreateTransporter = () => ({
    verify: async () => { verified = true; return true; },
  });
  const service = createWebinarEmailService({ createTransporter: mockCreateTransporter });
  const prevHost = process.env.SMTP_HOST;
  const prevUser = process.env.SMTP_USER;
  const prevPass = process.env.SMTP_PASS;
  process.env.SMTP_HOST = 'smtp.hostinger.com';
  process.env.SMTP_USER = 'info@halalwealth.finance';
  process.env.SMTP_PASS = 'mockpass';

  try {
    const result = await service.verifyEmailService();
    assert.equal(result.ok, true);
    assert.equal(result.provider, 'Hostinger SMTP (Nodemailer)');
    assert.equal(verified, true);
  } finally {
    if (prevHost) process.env.SMTP_HOST = prevHost; else delete process.env.SMTP_HOST;
    if (prevUser) process.env.SMTP_USER = prevUser; else delete process.env.SMTP_USER;
    if (prevPass) process.env.SMTP_PASS = prevPass; else delete process.env.SMTP_PASS;
  }
});

test('verifyEmailService verifies port 465 uses implicit TLS and port 587 uses STARTTLS', async () => {
  let capturedConfigs = [];
  const mockCreateTransporter = config => {
    capturedConfigs.push(config);
    return {
      verify: async () => true,
    };
  };

  const service = createWebinarEmailService({ createTransporter: mockCreateTransporter });
  const prevHost = process.env.SMTP_HOST;
  const prevPort = process.env.SMTP_PORT;
  const prevUser = process.env.SMTP_USER;
  const prevPass = process.env.SMTP_PASS;

  process.env.SMTP_HOST = 'smtp.hostinger.com';
  process.env.SMTP_USER = 'info@halalwealth.finance';
  process.env.SMTP_PASS = 'mockpass';

  try {
    // 1. Test Port 465 (implicit TLS)
    process.env.SMTP_PORT = '465';
    const res465 = await service.verifyEmailService();
    assert.equal(res465.ok, true);
    assert.equal(res465.transport, 'SMTPS (Port 465)');
    assert.equal(res465.secure, true);
    assert.equal(capturedConfigs[0].secure, true);
    assert.equal(capturedConfigs[0].port, 465);

    // 2. Test Port 587 (STARTTLS)
    process.env.SMTP_PORT = '587';
    const res587 = await service.verifyEmailService();
    assert.equal(res587.ok, true);
    assert.equal(res587.transport, 'SMTP+STARTTLS (Port 587)');
    assert.equal(res587.secure, false);
    assert.equal(capturedConfigs[1].secure, false);
    assert.equal(capturedConfigs[1].requireTLS, true);
    assert.equal(capturedConfigs[1].port, 587);
  } finally {
    if (prevHost) process.env.SMTP_HOST = prevHost; else delete process.env.SMTP_HOST;
    if (prevPort) process.env.SMTP_PORT = prevPort; else delete process.env.SMTP_PORT;
    if (prevUser) process.env.SMTP_USER = prevUser; else delete process.env.SMTP_USER;
    if (prevPass) process.env.SMTP_PASS = prevPass; else delete process.env.SMTP_PASS;
  }
});

test('verifyEmailService reports safe actionable diagnostic without credentials on timeout', async () => {
  const timeoutError = new Error('Connection timeout');
  timeoutError.code = 'ETIMEDOUT';
  timeoutError.command = 'CONN';

  const mockCreateTransporter = () => ({
    verify: async () => { throw timeoutError; },
  });

  const service = createWebinarEmailService({ createTransporter: mockCreateTransporter });
  const prevHost = process.env.SMTP_HOST;
  const prevPort = process.env.SMTP_PORT;
  const prevUser = process.env.SMTP_USER;
  const prevPass = process.env.SMTP_PASS;

  process.env.SMTP_HOST = 'smtp.hostinger.com';
  process.env.SMTP_PORT = '465';
  process.env.SMTP_USER = 'info@halalwealth.finance';
  process.env.SMTP_PASS = 'superSecretPassword123';

  try {
    const res = await service.verifyEmailService();
    assert.equal(res.ok, false);
    assert.equal(res.code, 'ETIMEDOUT');
    assert.equal(res.errorCategory, 'SMTP_TIMEOUT');
    assert.equal(res.timeoutCategory, 'CONNECTION_TIMEOUT');
    assert.equal(res.host, 'smtp.hostinger.com');
    assert.equal(res.port, 465);
    assert.match(res.message, /Render Free Tier web services/);
    assert.match(res.message, /Upgrade the Render web service to a paid instance/);
    assert.doesNotMatch(res.message, /superSecretPassword123/);
    assert.doesNotMatch(res.errorMessage, /superSecretPassword123/);
  } finally {
    if (prevHost) process.env.SMTP_HOST = prevHost; else delete process.env.SMTP_HOST;
    if (prevPort) process.env.SMTP_PORT = prevPort; else delete process.env.SMTP_PORT;
    if (prevUser) process.env.SMTP_USER = prevUser; else delete process.env.SMTP_USER;
    if (prevPass) process.env.SMTP_PASS = prevPass; else delete process.env.SMTP_PASS;
  }
});