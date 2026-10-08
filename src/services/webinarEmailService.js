const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const SENDER_EMAIL = 'info@halalwealth.finance';
const EMAIL_SUBJECT = 'Thank You for Registering for Our Webinar';

function readFirstDefined(environment, keys) {
  for (const key of keys) {
    const value = environment?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return '';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function buildRegistrationConfirmation(recipientName, posterAttachmentPath = null) {
  const safeName = escapeHtml(recipientName);
  const posterImage = posterAttachmentPath ? '<img src="cid:webinartamil" alt="Halal Wealth Summit webinar poster" style="display:block;width:100%;max-width:560px;height:auto;border-radius:12px;border:1px solid #e7e5df;margin:0 auto 24px;" />' : '';
  const text = `Dear ${recipientName},

Greetings!

Thank you for registering for our upcoming webinar. We’re delighted to have you join us.

${posterAttachmentPath ? '[IMAGE]' : ''}

We will be sharing the webinar access link with you shortly. Please keep an eye on your email for the registration/access link and further details.

In the meantime, stay connected with us to learn more about Islamic finance and Halal investments:

YouTube: https://youtube.com/@ethicalfinancebasithtamil
Instagram: https://instagram.com/ethicalfinancebasith.tamil
WhatsApp Community: https://chat.whatsapp.com/InfThev3br60wmCUWRt3tq

Warm regards,

Halal Wealth Summit Team`;

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background-color:#f3f6f8;color:#243746;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background-color:#f3f6f8;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;border-collapse:collapse;background-color:#ffffff;border:1px solid #dfe7eb;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="padding:28px 32px 12px;background-color:#ffffff;">
                <p style="margin:0 0 10px;color:#b98a2a;font-size:12px;font-weight:700;letter-spacing:2px;">HALAL WEALTH SUMMIT</p>
                <h1 style="margin:0;color:#0e2d3d;font-size:28px;line-height:1.2;">Thank You for Registering</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 24px;color:#243746;font-size:16px;line-height:1.7;">
                <p style="margin:0 0 16px;">Dear ${safeName},</p>
                <p style="margin:0 0 16px;">Greetings!</p>
                <p style="margin:0 0 16px;">Thank you for registering for our upcoming webinar. We’re delighted to have you join us.</p>
                ${posterImage}
                <p style="margin:0 0 16px;">We will be sharing the webinar access link with you shortly. Please keep an eye on your email for the registration/access link and further details.</p>
                <p style="margin:0 0 18px;">In the meantime, stay connected with us to learn more about Islamic finance and Halal investments:</p>
                <p style="margin:0 0 8px;"><a href="https://youtube.com/@ethicalfinancebasithtamil" style="color:#0d5c7d;text-decoration:none;">YouTube</a></p>
                <p style="margin:0 0 8px;"><a href="https://instagram.com/ethicalfinancebasith.tamil" style="color:#0d5c7d;text-decoration:none;">Instagram</a></p>
                <p style="margin:0 0 24px;"><a href="https://chat.whatsapp.com/InfThev3br60wmCUWRt3tq" style="color:#0d5c7d;text-decoration:none;">WhatsApp Community</a></p>
                <p style="margin:0 0 4px;">Warm regards,</p>
                <p style="margin:0;color:#0e2d3d;font-weight:700;">Halal Wealth Summit Team</p>
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0;color:#6b7c87;font-size:12px;line-height:1.5;">Halal Wealth Summit</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject: EMAIL_SUBJECT, text, html };
}

function resolvePosterPath() {
  const candidatePaths = [
    path.join(__dirname, '..', '..', 'assets', 'webinartamil.png'),
    path.join(process.cwd(), 'assets', 'webinartamil.png'),
    path.join(process.cwd(), 'server', 'assets', 'webinartamil.png'),
  ];

  return candidatePaths.find(fs.existsSync) || candidatePaths[0];
}

function createWebinarEmailService({ createTransporter = config => nodemailer.createTransport(config) } = {}) {
  async function sendRegistrationConfirmation(recipientEmail, recipientName) {
    const environment = process.env;
    const host = readFirstDefined(environment, ['MAIL_HOST', 'SMTP_HOST']);
    const port = Number(readFirstDefined(environment, ['MAIL_PORT', 'SMTP_PORT']) || '465');
    const username = readFirstDefined(environment, ['MAIL_USERNAME', 'SMTP_USER', 'SMTP_USERNAME', 'MAIL_USER']);
    const password = readFirstDefined(environment, ['MAIL_PASSWORD', 'SMTP_PASSWORD', 'MAIL_PASS', 'SMTP_PASS']);
    const fromAddress = readFirstDefined(environment, ['MAIL_FROM', 'SMTP_FROM', 'EMAIL_FROM']) || SENDER_EMAIL;
    const fromName = readFirstDefined(environment, ['MAIL_FROM_NAME', 'SMTP_FROM_NAME']) || 'Halal Wealth Summit';
    const useSecureSocket = String(readFirstDefined(environment, ['SMTP_SECURE', 'MAIL_SECURE']) || 'true').toLowerCase() === 'true';
    const posterPath = resolvePosterPath();
    const posterExists = fs.existsSync(posterPath);
    const messageContent = buildRegistrationConfirmation(recipientName, posterExists ? posterPath : null);

    if (!host || !username || !password || !Number.isInteger(port) || port < 1) {
      throw new Error('SMTP configuration is incomplete.');
    }

    const transporter = createTransporter({
      host,
      port,
      secure: useSecureSocket || port === 465,
      requireTLS: !useSecureSocket && port !== 465,
      auth: { user: username, pass: password },
    });

    const mailOptions = {
      from: { name: fromName, address: fromAddress },
      replyTo: fromAddress,
      to: recipientEmail,
      subject: messageContent.subject,
      text: messageContent.text,
      html: messageContent.html,
      attachments: posterExists ? [{
        filename: 'webinartamil.png',
        path: posterPath,
        cid: 'webinartamil',
      }] : [],
    };

    return transporter.sendMail(mailOptions);
  }

  return { sendRegistrationConfirmation };
}

module.exports = {
  EMAIL_SUBJECT,
  buildRegistrationConfirmation,
  createWebinarEmailService,
  ...createWebinarEmailService(),
};