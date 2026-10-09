const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const SENDER_EMAIL = 'info@halalwealth.finance';
const POSTER_CID = 'webinar-poster';
const DEFAULT_FROM_NAME = 'Halal Wealth Webinar';
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
  const posterImage = posterAttachmentPath ? `<img src="cid:${POSTER_CID}" alt="Halal Wealth Webinar poster" style="display:block;width:100%;max-width:550px;height:auto;border:0;margin:0 auto 24px;" />` : '';
  const text = `Dear ${recipientName},

Assalamu Alaikum!

Thank you for registering for our upcoming webinar. We’re delighted to have you join us.${posterAttachmentPath ? '\n\n[Image: webinar-poster]\n\n' : '\n\n\n\n'}We will be sharing the webinar access link with you shortly. Please keep an eye on your email for the registration/access link and further details.

In the meantime, stay connected with us to learn more about Islamic finance and Halal investments:

YouTube: https://youtube.com/@ethicalfinancebasithtamil
Instagram: https://instagram.com/ethicalfinancebasith.tamil
WhatsApp Community: https://chat.whatsapp.com/InfThev3br60wmCUWRt3tq

JazakAllah,

Halal Wealth Webinar Team`;

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Webinar Registration Confirmation</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f3f6f8;color:#243746;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;background-color:#f3f6f8;width:100%;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;width:100%;max-width:600px;background-color:#ffffff;border:1px solid #dfe7eb;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="padding:28px 32px 12px;background-color:#ffffff;">
                <p style="margin:0 0 10px;color:#b98a2a;font-size:12px;font-weight:700;letter-spacing:2px;line-height:1.4;">HALAL WEALTH WEBINAR</p>
                <h1 style="margin:0;color:#0e2d3d;font-size:28px;line-height:1.2;font-weight:700;">Thank You for Registering</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 24px;color:#243746;font-size:16px;line-height:1.7;">
                <p style="margin:0 0 16px;">Dear ${safeName},</p>
                <p style="margin:0 0 16px;">Assalamu Alaikum!</p>
                <p style="margin:0 0 16px;">Thank you for registering for our upcoming webinar. We’re delighted to have you join us.</p>
                ${posterImage}
                <p style="margin:0 0 16px;">We will be sharing the webinar access link with you shortly. Please keep an eye on your email for the registration/access link and further details.</p>
                <p style="margin:0 0 18px;">In the meantime, stay connected with us to learn more about Islamic finance and Halal investments:</p>
                <p style="margin:0 0 8px;"><a href="https://youtube.com/@ethicalfinancebasithtamil" style="color:#0d5c7d;text-decoration:none;">YouTube</a></p>
                <p style="margin:0 0 8px;"><a href="https://instagram.com/ethicalfinancebasith.tamil" style="color:#0d5c7d;text-decoration:none;">Instagram</a></p>
                <p style="margin:0 0 24px;"><a href="https://chat.whatsapp.com/InfThev3br60wmCUWRt3tq" style="color:#0d5c7d;text-decoration:none;">WhatsApp Community</a></p>
                <p style="margin:0 0 4px;">JazakAllah,</p>
                <p style="margin:0;color:#0e2d3d;font-weight:700;">Halal Wealth Webinar Team</p>
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0;color:#6b7c87;font-size:12px;line-height:1.5;">Halal Wealth Webinar</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject: EMAIL_SUBJECT, text, html };
}

function resolvePosterPath() {
  const candidatePaths = [
    path.resolve(__dirname, '..', '..', 'assets', 'webinar tamil.png'),
    path.resolve(__dirname, '..', 'assets', 'webinar tamil.png'),
  ];

  return candidatePaths.find(fs.existsSync) || candidatePaths[0];
}

function sanitizeLogValue(value) {
  return String(value || '')
    .replace(/(password|pass|token|secret|authorization)=([^\s,]+)/gi, '$1=[REDACTED]')
    .replace(/([A-Za-z0-9_.+-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, '[REDACTED_EMAIL]')
    .slice(0, 500);
}

function getSafeMessageId(messageInfo) {
  const rawValue = messageInfo && (messageInfo.messageId || messageInfo.response || messageInfo.envelope?.messageId);
  if (!rawValue) return 'unknown';
  return String(rawValue).replace(/\s+/g, '').slice(0, 64);
}

function createWebinarEmailService({ createTransporter = config => nodemailer.createTransport(config), logger = console } = {}) {
  async function sendRegistrationConfirmation(recipientEmail, recipientName) {
    const environment = process.env;
    const host = readFirstDefined(environment, ['MAIL_HOST', 'SMTP_HOST']);
    const port = Number(readFirstDefined(environment, ['MAIL_PORT', 'SMTP_PORT']) || '465');
    const username = readFirstDefined(environment, ['MAIL_USERNAME', 'SMTP_USER', 'SMTP_USERNAME', 'MAIL_USER']);
    const password = readFirstDefined(environment, ['MAIL_PASSWORD', 'SMTP_PASSWORD', 'MAIL_PASS', 'SMTP_PASS']);
    const fromAddress = readFirstDefined(environment, ['MAIL_FROM', 'SMTP_FROM', 'EMAIL_FROM']) || SENDER_EMAIL;
    const fromName = readFirstDefined(environment, ['MAIL_FROM_NAME', 'SMTP_FROM_NAME']) || DEFAULT_FROM_NAME;
    const replyToAddress = readFirstDefined(environment, ['MAIL_REPLY_TO', 'SMTP_REPLY_TO', 'REPLY_TO']) || fromAddress;
    const useSecureSocket = String(readFirstDefined(environment, ['SMTP_SECURE', 'MAIL_SECURE']) || 'true').toLowerCase() === 'true';
    const posterPath = resolvePosterPath();

    logger.info('Webinar confirmation email configuration check', {
      smtpConfigured: Boolean(host && username && password && Number.isInteger(port) && port > 0),
      hostConfigured: Boolean(host),
      usernameConfigured: Boolean(username),
      fromAddressConfigured: Boolean(fromAddress),
      fromName,
    });

    if (!fs.existsSync(posterPath)) {
      const error = new Error(`Webinar poster asset is missing: ${posterPath}`);
      error.code = 'POSTER_MISSING';
      throw error;
    }

    const messageContent = buildRegistrationConfirmation(recipientName, posterPath);

    if (!host || !username || !password || !Number.isInteger(port) || port < 1) {
      const error = new Error('SMTP configuration is incomplete.');
      error.code = 'SMTP_CONFIG_INCOMPLETE';
      throw error;
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
      replyTo: replyToAddress,
      to: recipientEmail,
      subject: messageContent.subject,
      text: messageContent.text,
      html: messageContent.html,
      attachments: [{
        filename: 'webinar-poster.png',
        path: posterPath,
        cid: POSTER_CID,
        contentType: 'image/png',
      }],
    };

    try {
      const info = await transporter.sendMail(mailOptions);
      logger.info('SMTP message accepted for webinar confirmation', {
        messageId: getSafeMessageId(info),
        acceptedCount: Array.isArray(info?.accepted) ? info.accepted.length : 0,
        rejectedCount: Array.isArray(info?.rejected) ? info.rejected.length : 0,
      });
      return info;
    } catch (error) {
      const safeMessage = sanitizeLogValue(error && (error.message || error.response || error.code || 'SMTP send failure'));
      logger.error('Webinar confirmation SMTP send failed', {
        code: error && error.code ? String(error.code) : 'SMTP_SEND_FAILED',
        response: safeMessage,
        host,
        port,
        secure: useSecureSocket || port === 465,
      });
      throw error;
    }
  }

  return { sendRegistrationConfirmation };
}

module.exports = {
  EMAIL_SUBJECT,
  POSTER_CID,
  buildRegistrationConfirmation,
  createWebinarEmailService,
  ...createWebinarEmailService(),
};