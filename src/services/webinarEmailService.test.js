const test = require('node:test');
const assert = require('node:assert/strict');
const {
  EMAIL_SUBJECT,
  buildRegistrationConfirmation,
  createWebinarEmailService,
} = require('./webinarEmailService');

test('builds the requested confirmation email and escapes the name in HTML', () => {
  const email = buildRegistrationConfirmation('Amina <Rahman>');

  assert.equal(EMAIL_SUBJECT, 'Thank You for Registering for Our Webinar');
  assert.equal(email.subject, EMAIL_SUBJECT);
  assert.match(email.text, /Dear Amina <Rahman>,/);
  assert.match(email.html, /Dear Amina &lt;Rahman&gt;,/);
  assert.equal(email.text, `Dear Amina <Rahman>,

Greetings!

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

  assert.deepEqual(transportConfig, {
    host: 'smtp.provider.example',
    port: 587,
    secure: true,
    requireTLS: false,
    auth: { user: 'info@halalwealth.finance', pass: 'test-only-password' },
  });
  assert.deepEqual(message.from, { name: 'Halal Wealth Webinar', address: 'info@halalwealth.finance' });
  assert.equal(message.replyTo, 'info@halalwealth.finance');
  assert.equal(message.to, 'test@example.com');
  assert.equal(message.subject, EMAIL_SUBJECT);
  assert.match(message.text, /Dear Test User,/);
  assert.match(message.html, /Dear Test User,/);
});