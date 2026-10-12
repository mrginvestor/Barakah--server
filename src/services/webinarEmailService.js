const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const SENDER_EMAIL = 'info@halalwealth.finance';
const POSTER_CID = 'webinar-poster';
const DEFAULT_FROM_NAME = 'Halal Wealth Webinar';
const EMAIL_SUBJECT = 'Thank You for Registering for Our Webinar';
const POSTPONEMENT_EMAIL_SUBJECT = 'Important Update: Halal Wealth Webinar Postponed to 18 October 2026';

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

Assalamu Alaikum warahmatullahi wabarakatuh!

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
                <p style="margin:0 0 16px;">Assalamu Alaikum warahmatullahi wabarakatuh!</p>
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

function buildPostponementAnnouncement(recipientName, posterAttachmentPath = null) {
  const safeName = escapeHtml(recipientName || 'there');
  const posterImage = posterAttachmentPath ? `<img src="cid:${POSTER_CID}" alt="Halal Wealth Webinar poster" style="display:block;width:100%;max-width:550px;height:auto;border:0;margin:0 auto 24px;" />` : '';
  const text = `Assalamu Alaikum warahmatullahi wabarakatuh,

IMPORTANT UPDATE: NEW WEBINAR DATE

Due to unforeseen circumstances, our live Halal Wealth Webinar, originally scheduled for Sunday, 11 October 2026, has been postponed.

Please note the revised date and time:

Date: Sunday, 18 October 2026

Time:
11:00 AM IST
1:30 PM Singapore
9:30 AM UAE
8:30 AM KSA

We sincerely apologize for any inconvenience this sudden change may cause to your weekend schedule. We truly appreciate your understanding and patience.

NO NEED TO REGISTER AGAIN!

Your existing registration remains valid. We will share the webinar joining link as we get closer to next Sunday. Please keep an eye on your email and WhatsApp messages for further updates.

In the meantime, stay connected with us to learn more about Islamic finance and Halal investments:

YouTube:
https://youtube.com/@ethicalfinancebasithtamil

Instagram:
https://instagram.com/ethicalfinancebasith.tamil

WhatsApp Community:
https://chat.whatsapp.com/InfThev3br60wmCUWRt3tq

JazakAllah Khair for your understanding and continued support.

JazakAllah,

Halal Wealth Webinar Team`;

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Important Update: Halal Wealth Webinar Postponed to 18 October 2026</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f5f7f8;color:#243746;font-family:Arial,Helvetica,sans-serif;-webkit-font-smoothing:antialiased;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;background-color:#f5f7f8;width:100%;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;width:100%;max-width:620px;background-color:#ffffff;border:1px solid #dfe7eb;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="padding:28px 32px 16px;background-color:#ffffff;border-bottom:1px solid #edf2f5;">
                <p style="margin:0 0 8px;color:#b98a2a;font-size:12px;font-weight:700;letter-spacing:2px;line-height:1.4;">HALAL WEALTH WEBINAR</p>
                <h1 style="margin:0;color:#0e2d3d;font-size:24px;line-height:1.3;font-weight:700;">Important Update: New Webinar Date</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px;color:#243746;font-size:15px;line-height:1.7;">
                <p style="margin:0 0 16px;">Assalamu Alaikum warahmatullahi wabarakatuh,</p>
                <p style="margin:0 0 16px;font-weight:700;color:#0e2d3d;">IMPORTANT UPDATE: NEW WEBINAR DATE</p>
                <p style="margin:0 0 16px;">Due to unforeseen circumstances, our live Halal Wealth Webinar, originally scheduled for Sunday, 11 October 2026, has been postponed.</p>
                
                <p style="margin:0 0 12px;font-weight:700;color:#0e2d3d;">Please note the revised date and time:</p>
                
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;background-color:#f8fafc;border-left:4px solid #b98a2a;border-radius:4px;margin:0 0 20px;">
                  <tr>
                    <td style="padding:16px 20px;">
                      <p style="margin:0 0 10px;font-size:16px;font-weight:700;color:#0e2d3d;"><strong>Date:</strong> Sunday, 18 October 2026</p>
                      <p style="margin:0 0 6px;font-weight:700;color:#0e2d3d;"><strong>Time:</strong></p>
                      <p style="margin:0 0 4px;color:#243746;">11:00 AM IST</p>
                      <p style="margin:0 0 4px;color:#243746;">1:30 PM Singapore</p>
                      <p style="margin:0 0 4px;color:#243746;">9:30 AM UAE</p>
                      <p style="margin:0;color:#243746;">8:30 AM KSA</p>
                    </td>
                  </tr>
                </table>

                ${posterImage}

                <p style="margin:0 0 16px;">We sincerely apologize for any inconvenience this sudden change may cause to your weekend schedule. We truly appreciate your understanding and patience.</p>
                
                <div style="background-color:#eef7f3;border-left:4px solid #1f785a;padding:12px 18px;margin:0 0 20px;border-radius:4px;">
                  <p style="margin:0;font-weight:700;color:#18533e;">NO NEED TO REGISTER AGAIN!</p>
                </div>

                <p style="margin:0 0 20px;">Your existing registration remains valid. We will share the webinar joining link as we get closer to next Sunday. Please keep an eye on your email and WhatsApp messages for further updates.</p>
                
                <p style="margin:0 0 14px;">In the meantime, stay connected with us to learn more about Islamic finance and Halal investments:</p>
                
                <p style="margin:0 0 10px;">
                  <strong>YouTube:</strong><br />
                  <a href="https://youtube.com/@ethicalfinancebasithtamil" style="color:#0d5c7d;text-decoration:underline;">https://youtube.com/@ethicalfinancebasithtamil</a>
                </p>
                
                <p style="margin:0 0 10px;">
                  <strong>Instagram:</strong><br />
                  <a href="https://instagram.com/ethicalfinancebasith.tamil" style="color:#0d5c7d;text-decoration:underline;">https://instagram.com/ethicalfinancebasith.tamil</a>
                </p>
                
                <p style="margin:0 0 24px;">
                  <strong>WhatsApp Community:</strong><br />
                  <a href="https://chat.whatsapp.com/InfThev3br60wmCUWRt3tq" style="color:#0d5c7d;text-decoration:underline;">https://chat.whatsapp.com/InfThev3br60wmCUWRt3tq</a>
                </p>
                
                <p style="margin:0 0 16px;">JazakAllah Khair for your understanding and continued support.</p>
                
                <p style="margin:0 0 4px;">JazakAllah,</p>
                <p style="margin:0;color:#0e2d3d;font-weight:700;">Halal Wealth Webinar Team</p>
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0;color:#6b7c87;font-size:12px;line-height:1.5;">Halal Wealth Webinar &bull; info@halalwealth.finance</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject: POSTPONEMENT_EMAIL_SUBJECT, text, html, safeName };
}

function resolvePosterPath() {
  const candidatePaths = [
    path.resolve(__dirname, '..', '..', 'assets', 'webinar tamil.png'),
    path.resolve(__dirname, '..', 'assets', 'webinar tamil.png'),
    path.resolve(process.cwd(), 'server', 'assets', 'webinar tamil.png'),
    path.resolve(process.cwd(), 'assets', 'webinar tamil.png'),
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

function classifySmtpError(error) {
  const code = String(error?.code || '').toUpperCase();
  const message = String(error?.message || error?.response || '').toLowerCase();
  if (code === 'EAUTH' || /auth|authentication|535|invalid login|credentials/i.test(message)) return 'SMTP_AUTH_FAILED';
  if (code === 'ECONNECTION' || code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || /connection|refused|timeout|dns|enotfound/i.test(message)) return 'SMTP_CONNECTION_FAILED';
  if (/rejected|message rejected|550|554|552|553|5[0-9][0-9]|bounce|recipient/i.test(message) || /rejected/i.test(code)) return 'SMTP_MESSAGE_REJECTED';
  return 'SMTP_SEND_FAILED';
}

function createPosterAttachment(posterPath) {
  if (!posterPath || !fs.existsSync(posterPath)) return [];
  return [{
    filename: 'webinar-poster.png',
    path: posterPath,
    cid: POSTER_CID,
    contentType: 'image/png',
    contentDisposition: 'inline',
  }];
}

function createWebinarEmailService({ createTransporter = config => nodemailer.createTransport(config), logger = console } = {}) {
  async function sendMailForTemplate(recipientEmail, messageContent, purpose = 'webinar email') {
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

    logger.info(`${purpose} configuration check`, {
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

    const generatedMessageId = `<${Date.now()}.${Math.random().toString(36).slice(2)}@halalwealth.finance>`;
    const mailOptions = {
      from: { name: fromName, address: fromAddress },
      replyTo: replyToAddress,
      to: recipientEmail,
      subject: messageContent.subject,
      text: messageContent.text,
      html: messageContent.html,
      messageId: generatedMessageId,
      date: new Date(),
      headers: {
        'X-Entity-Ref-ID': generatedMessageId,
      },
      attachments: createPosterAttachment(posterPath),
    };

    try {
      const info = await transporter.sendMail(mailOptions);
      logger.info(`SMTP message accepted for ${purpose}`, {
        status: 'SMTP_ACCEPTED',
        note: 'Accepted by SMTP server for queuing/dispatch. Note: SMTP acceptance does not guarantee inbox placement, which depends on recipient spam filters and DKIM/SPF verification.',
        messageId: getSafeMessageId(info) || generatedMessageId,
        acceptedCount: Array.isArray(info?.accepted) ? info.accepted.length : 0,
        rejectedCount: Array.isArray(info?.rejected) ? info.rejected.length : 0,
      });
      return info;
    } catch (error) {
      const safeMessage = sanitizeLogValue(error && (error.message || error.response || error.code || 'SMTP send failure'));
      logger.error(`${purpose} SMTP send failed`, {
        status: classifySmtpError(error),
        code: error.code || 'SMTP_SEND_FAILED',
        response: safeMessage,
        host,
        port,
        secure: useSecureSocket || port === 465,
      });
      throw error;
    }
  }

  async function sendRegistrationConfirmation(recipientEmail, recipientName) {
    const messageContent = buildRegistrationConfirmation(recipientName, resolvePosterPath());
    return sendMailForTemplate(recipientEmail, messageContent, 'webinar confirmation');
  }

  async function sendPostponementAnnouncement(recipientEmail, recipientName) {
    const messageContent = buildPostponementAnnouncement(recipientName, resolvePosterPath());
    return sendMailForTemplate(recipientEmail, messageContent, 'webinar postponement announcement');
  }

  return { sendRegistrationConfirmation, sendPostponementAnnouncement };
}

module.exports = {
  EMAIL_SUBJECT,
  POSTPONEMENT_EMAIL_SUBJECT,
  POSTER_CID,
  buildRegistrationConfirmation,
  buildPostponementAnnouncement,
  createWebinarEmailService,
  ...createWebinarEmailService(),
};