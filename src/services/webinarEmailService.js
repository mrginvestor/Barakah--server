const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
let Resend;
try {
  Resend = require('resend').Resend;
} catch (_) {
  Resend = null;
}

const SENDER_EMAIL = 'info@halalwealth.finance';
const POSTER_CID = 'webinar-poster';
const DEFAULT_FROM_NAME = 'Halal Wealth Webinar';
const EMAIL_SUBJECT = 'Thank You for Registering for Our Webinar';
const POSTPONEMENT_EMAIL_SUBJECT = 'Important Update: Halal Wealth Webinar Postponed to 18 October 2026';
const ZOOM_JOINING_EMAIL_SUBJECT = 'Your Zoom Joining Link – Halal Wealth Webinar | 18 October 2026';
const REMINDER_ONE_HOUR_EMAIL_SUBJECT = 'Webinar Starting in One Hour | Halal Trade, Investments & Generational Wealth';
const DEFAULT_FEEDBACK_EMAIL_SUBJECT = 'Thank You for Attending | Feedback & Future Halal Investing Programs';
const DEFAULT_FEEDBACK_FORM_URL = 'https://forms.gle/ysMqbTQ37BSnrbGT9';
const DEFAULT_FEEDBACK_WHATSAPP_URL = 'https://chat.whatsapp.com/I9d41QdjbOGA43kYph2noq';
const DEFAULT_FEEDBACK_YOUTUBE_URL = 'https://youtube.com/@ethicalfinancebasithtamil';
const DEFAULT_FEEDBACK_INSTAGRAM_URL = 'https://instagram.com/ethicalfinancebasith.tamil';
const DEFAULT_FEEDBACK_BODY_TEXT = `Assalamu Alaikum Wr Wb,

Hope you have joined our webinar yesterday and benefited from the knowledge shared.

We would like to hear your feedback and suggestions to help us better plan our future programs.

Kindly submit this feedback form: https://forms.gle/ysMqbTQ37BSnrbGT9

We look forward to having you join our Halal Investing webinar planned for November 2026. Do stay connected with us. JazakAllah.

WhatsApp Community: https://chat.whatsapp.com/I9d41QdjbOGA43kYph2noq

YouTube: youtube.com/@ethicalfinancebasithtamil

Instagram: instagram.com/ethicalfinancebasith.tamil`;
const ZOOM_LINK = 'https://us06web.zoom.us/j/81487983324?pwd=iiWszjuBKKDHZ7SNibjY9aUkfFVEvS.1';
const ZOOM_MEETING_ID = '814 8798 3324';
const ZOOM_PASSCODE = '666991';

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

function buildRegistrationConfirmation(recipientName, posterAttachmentPath = null, options = {}) {
  const safeName = escapeHtml(recipientName || 'there');
  const posterImage = posterAttachmentPath ? `<img src="cid:${POSTER_CID}" alt="Halal Wealth Webinar poster" style="display:block;width:100%;max-width:550px;height:auto;border:0;margin:0 auto 24px;" />` : '';

  const hasCustomDetails = Boolean(options && (options.topic || options.date || options.time || options.includeEventDetails));
  const topic = options?.topic || 'Halal Trade, Investments & Generational Wealth';
  const eventDate = options?.date || 'Sunday, November 1, 2026';
  const eventTime = options?.time || '11:00 AM IST (1:30 PM SG | 9:30 AM UAE | 8:30 AM KSA)';

  const detailsText = hasCustomDetails
    ? `\n\nEvent: Halal Wealth Webinar\nTopic: ${topic}\nDate: ${eventDate}\nTime: ${eventTime}\n`
    : '';

  const text = `Dear ${recipientName},

Assalamu Alaikum warahmatullahi wabarakatuh!

Thank you for registering for our upcoming webinar. We’re delighted to have you join us.${detailsText}${posterAttachmentPath ? '\n\n[Image: webinar-poster]\n\n' : '\n\n\n\n'}We will be sharing the webinar access link with you shortly. Please keep an eye on your email for the registration/access link and further details.

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
                ${hasCustomDetails ? `
                <div style="background-color:#f8fafc;border-left:4px solid #b98a2a;padding:16px 20px;margin:20px 0;border-radius:0 8px 8px 0;">
                  <p style="margin:0 0 6px;font-weight:700;color:#0e2d3d;">Topic: <span style="font-weight:400;color:#243746;">${escapeHtml(topic)}</span></p>
                  <p style="margin:0 0 6px;font-weight:700;color:#0e2d3d;">Date: <span style="font-weight:400;color:#243746;">${escapeHtml(eventDate)}</span></p>
                  <p style="margin:0;font-weight:700;color:#0e2d3d;">Time: <span style="font-weight:400;color:#243746;">${escapeHtml(eventTime)}</span></p>
                </div>` : ''}
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

function buildZoomJoiningDetails(recipientName, posterAttachmentPath = null) {
  const safeName = escapeHtml(recipientName || 'there');
  const posterImage = posterAttachmentPath ? `<img src="cid:${POSTER_CID}" alt="Halal Wealth Webinar poster" style="display:block;width:100%;max-width:550px;height:auto;border:0;margin:0 auto 24px;" />` : '';
  const text = `Assalamu Alaikum Wa Rahmatullahi Wa Barakatuh,

We are pleased to welcome you to our upcoming Halal Wealth Webinar.

Topic: Halal Trade, Investments & Generational Wealth

Date: Sunday, 18 October 2026

Time:
- India: 11:00 AM IST
- Singapore: 1:30 PM SGT
- UAE: 9:30 AM GST
- Saudi Arabia (KSA): 8:30 AM AST

Join the webinar using the Zoom link below:

${ZOOM_LINK}

Meeting ID: ${ZOOM_MEETING_ID}

Passcode: ${ZOOM_PASSCODE}

We encourage you to join a few minutes before the session begins.

We look forward to welcoming you to an insightful session on Halal trade, ethical investments, financial planning, and generational wealth.

JazakAllahu Khairan,

Barakah Team
Halal Wealth Webinar`;

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Your Zoom Joining Link – Halal Wealth Webinar | 18 October 2026</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f5f7f8;color:#243746;font-family:Arial,Helvetica,sans-serif;-webkit-font-smoothing:antialiased;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;background-color:#f5f7f8;width:100%;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;width:100%;max-width:620px;background-color:#ffffff;border:1px solid #dfe7eb;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(8,43,73,0.06);">
            <tr>
              <td style="padding:28px 32px 16px;background-color:#ffffff;border-bottom:1px solid #edf2f5;">
                <p style="margin:0 0 8px;color:#b98a2a;font-size:12px;font-weight:700;letter-spacing:2px;line-height:1.4;">HALAL WEALTH WEBINAR</p>
                <h1 style="margin:0;color:#0e2d3d;font-size:24px;line-height:1.3;font-weight:700;">Your Zoom Joining Link</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px;color:#243746;font-size:15px;line-height:1.7;">
                <p style="margin:0 0 16px;">Assalamu Alaikum Wa Rahmatullahi Wa Barakatuh,</p>
                <p style="margin:0 0 16px;">We are pleased to welcome you to our upcoming Halal Wealth Webinar.</p>
                
                <div style="background-color:#f8fafc;border-left:4px solid #b98a2a;padding:16px 20px;margin:20px 0;border-radius:0 8px 8px 0;">
                  <p style="margin:0 0 8px;font-weight:700;color:#0e2d3d;">Topic: <span style="font-weight:400;color:#243746;">Halal Trade, Investments &amp; Generational Wealth</span></p>
                  <p style="margin:0 0 8px;font-weight:700;color:#0e2d3d;">Date: <span style="font-weight:400;color:#243746;">Sunday, 18 October 2026</span></p>
                  <p style="margin:0 0 4px;font-weight:700;color:#0e2d3d;">Time:</p>
                  <ul style="margin:0 0 0 20px;padding:0;color:#243746;">
                    <li style="margin-bottom:4px;">India: <strong>11:00 AM IST</strong></li>
                    <li style="margin-bottom:4px;">Singapore: <strong>1:30 PM SGT</strong></li>
                    <li style="margin-bottom:4px;">UAE: <strong>9:30 AM GST</strong></li>
                    <li style="margin-bottom:4px;">Saudi Arabia (KSA): <strong>8:30 AM AST</strong></li>
                  </ul>
                </div>

                <div style="background-color:#082b49;color:#ffffff;padding:24px 20px;margin:24px 0;border-radius:10px;text-align:center;">
                  <p style="margin:0 0 12px;font-size:16px;font-weight:700;color:#ffffff;">Join the webinar using the Zoom link below:</p>
                  <p style="margin:0 0 16px;">
                    <a href="${ZOOM_LINK}" style="display:inline-block;background-color:#d4af5a;color:#082b49;font-weight:700;font-size:15px;padding:12px 24px;border-radius:6px;text-decoration:none;">Click Here to Join Zoom Webinar</a>
                  </p>
                  <p style="margin:0 0 8px;font-size:13px;color:#e6c875;word-break:break-all;">
                    <a href="${ZOOM_LINK}" style="color:#e6c875;text-decoration:underline;">${ZOOM_LINK}</a>
                  </p>
                  <div style="margin-top:16px;padding-top:14px;border-top:1px solid rgba(255,255,255,0.15);font-size:14px;">
                    <span style="color:#ffffff;margin-right:16px;">Meeting ID: <strong style="color:#d4af5a;">${ZOOM_MEETING_ID}</strong></span>
                    <span style="color:#ffffff;">Passcode: <strong style="color:#d4af5a;">${ZOOM_PASSCODE}</strong></span>
                  </div>
                </div>

                ${posterImage}

                <p style="margin:0 0 16px;">We encourage you to join a few minutes before the session begins.</p>
                <p style="margin:0 0 20px;">We look forward to welcoming you to an insightful session on Halal trade, ethical investments, financial planning, and generational wealth.</p>
                
                <p style="margin:0 0 4px;">JazakAllahu Khairan,</p>
                <p style="margin:0 0 2px;color:#0e2d3d;font-weight:700;">Barakah Team</p>
                <p style="margin:0;color:#6b7c87;font-size:14px;">Halal Wealth Webinar</p>
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0;color:#6b7c87;font-size:12px;line-height:1.5;">Halal Wealth Webinar &bull; info@halalwealth.finance</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject: ZOOM_JOINING_EMAIL_SUBJECT, text, html, safeName };
}

function buildOneHourReminder(recipientName, posterAttachmentPath = null) {
  const safeName = escapeHtml(recipientName || 'there');
  const posterImage = posterAttachmentPath ? `<img src="cid:${POSTER_CID}" alt="Halal Wealth Webinar poster" style="display:block;width:100%;max-width:550px;height:auto;border:0;margin:0 auto 24px;" />` : '';
  const text = `Assalamu Alaikum Wr Wb,

We are commencing our Tamil webinar on Halal Trade, Investments & Generational Wealth in an hour.

🗓️ Sunday, 18 October 2026
🕐 11:00 am IST (1:30 pm SG | 9:30 am UAE | 8:30 am KSA)

Link to join: ${ZOOM_LINK}

See you in a while, Insha'Allah!`;

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Webinar Starting in One Hour | Halal Trade, Investments &amp; Generational Wealth</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f5f7f8;color:#243746;font-family:Arial,Helvetica,sans-serif;-webkit-font-smoothing:antialiased;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;background-color:#f5f7f8;width:100%;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;width:100%;max-width:620px;background-color:#ffffff;border:1px solid #dfe7eb;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(8,43,73,0.06);">
            <tr>
              <td style="padding:28px 32px 16px;background-color:#ffffff;border-bottom:1px solid #edf2f5;">
                <p style="margin:0 0 8px;color:#b98a2a;font-size:12px;font-weight:700;letter-spacing:2px;line-height:1.4;">HALAL WEALTH WEBINAR</p>
                <h1 style="margin:0;color:#0e2d3d;font-size:24px;line-height:1.3;font-weight:700;">Webinar Starting in One Hour</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px;color:#243746;font-size:15px;line-height:1.7;">
                <p style="margin:0 0 16px;">Assalamu Alaikum Wr Wb,</p>
                <p style="margin:0 0 18px;">We are commencing our Tamil webinar on <strong>Halal Trade, Investments &amp; Generational Wealth</strong> in an hour.</p>

                <div style="background-color:#f8fafc;border-left:4px solid #b98a2a;padding:16px 20px;margin:20px 0;border-radius:0 8px 8px 0;">
                  <p style="margin:0 0 8px;font-weight:700;color:#0e2d3d;">🗓️ Sunday, 18 October 2026</p>
                  <p style="margin:0 0 4px;font-weight:700;color:#0e2d3d;">🕐 11:00 am IST (1:30 pm SG | 9:30 am UAE | 8:30 am KSA)</p>
                </div>

                <div style="background-color:#082b49;color:#ffffff;padding:24px 20px;margin:24px 0;border-radius:10px;text-align:center;">
                  <p style="margin:0 0 12px;font-size:16px;font-weight:700;color:#ffffff;">Join the webinar using the Zoom link below:</p>
                  <p style="margin:0 0 16px;">
                    <a href="${ZOOM_LINK}" style="display:inline-block;background-color:#d4af5a;color:#082b49;font-weight:700;font-size:15px;padding:12px 24px;border-radius:6px;text-decoration:none;">Click Here to Join Zoom Webinar</a>
                  </p>
                  <p style="margin:0 0 8px;font-size:13px;color:#e6c875;word-break:break-all;">
                    Link to join: <a href="${ZOOM_LINK}" style="color:#e6c875;text-decoration:underline;">${ZOOM_LINK}</a>
                  </p>
                  <div style="margin-top:16px;padding-top:14px;border-top:1px solid rgba(255,255,255,0.15);font-size:14px;">
                    <span style="color:#ffffff;margin-right:16px;">Meeting ID: <strong style="color:#d4af5a;">${ZOOM_MEETING_ID}</strong></span>
                    <span style="color:#ffffff;">Passcode: <strong style="color:#d4af5a;">${ZOOM_PASSCODE}</strong></span>
                  </div>
                </div>

                ${posterImage}

                <p style="margin:20px 0 16px;font-weight:600;color:#0e2d3d;">See you in a while, Insha&#39;Allah!</p>

                <p style="margin:0 0 4px;">JazakAllahu Khairan,</p>
                <p style="margin:0 0 2px;color:#0e2d3d;font-weight:700;">Barakah Team</p>
                <p style="margin:0;color:#6b7c87;font-size:14px;">Halal Wealth Webinar</p>
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0;color:#6b7c87;font-size:12px;line-height:1.5;">Halal Wealth Webinar &bull; info@halalwealth.finance</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject: REMINDER_ONE_HOUR_EMAIL_SUBJECT, text, html, safeName };
}

function buildFeedbackEmail(configOrName = {}, possibleName = '', posterAttachmentPath = null) {
  let config = {};
  let recipientName = '';
  if (typeof configOrName === 'string') {
    recipientName = configOrName;
    if (typeof possibleName === 'object' && possibleName !== null) {
      config = possibleName;
    }
  } else if (typeof configOrName === 'object' && configOrName !== null) {
    config = configOrName;
    recipientName = typeof possibleName === 'string' ? possibleName : '';
  }

  const subject = String(config.subject || DEFAULT_FEEDBACK_EMAIL_SUBJECT).trim();
  const feedbackFormUrl = String(config.feedbackFormUrl || DEFAULT_FEEDBACK_FORM_URL).trim();
  const whatsappUrl = String(config.whatsappUrl || DEFAULT_FEEDBACK_WHATSAPP_URL).trim();
  const youtubeUrl = String(config.youtubeUrl || DEFAULT_FEEDBACK_YOUTUBE_URL).trim();
  const instagramUrl = String(config.instagramUrl || DEFAULT_FEEDBACK_INSTAGRAM_URL).trim();
  const safeName = escapeHtml(recipientName || 'there');
  const posterImage = posterAttachmentPath ? `<img src="cid:${POSTER_CID}" alt="Halal Wealth Webinar poster" style="display:block;width:100%;max-width:550px;height:auto;border:0;margin:0 auto 24px;" />` : '';

  const text = config.bodyText ? String(config.bodyText).trim() : DEFAULT_FEEDBACK_BODY_TEXT;

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f5f7f8;color:#243746;font-family:Arial,Helvetica,sans-serif;-webkit-font-smoothing:antialiased;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;background-color:#f5f7f8;width:100%;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;width:100%;max-width:620px;background-color:#ffffff;border:1px solid #dfe7eb;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(8,43,73,0.06);">
            <tr>
              <td style="padding:28px 32px 16px;background-color:#ffffff;border-bottom:1px solid #edf2f5;">
                <p style="margin:0 0 8px;color:#b98a2a;font-size:12px;font-weight:700;letter-spacing:2px;line-height:1.4;">HALAL WEALTH WEBINAR</p>
                <h1 style="margin:0;color:#0e2d3d;font-size:24px;line-height:1.3;font-weight:700;">Thank You for Attending</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px;color:#243746;font-size:15px;line-height:1.7;">
                <p style="margin:0 0 16px;">Assalamu Alaikum Wr Wb,</p>
                <p style="margin:0 0 16px;">Hope you have joined our webinar yesterday and benefited from the knowledge shared.</p>
                <p style="margin:0 0 16px;">We would like to hear your feedback and suggestions to help us better plan our future programs.</p>

                <div style="background-color:#082b49;color:#ffffff;padding:24px 20px;margin:24px 0;border-radius:10px;text-align:center;">
                  <p style="margin:0 0 12px;font-size:16px;font-weight:700;color:#ffffff;">Kindly submit this feedback form:</p>
                  <p style="margin:0 0 16px;">
                    <a href="${escapeHtml(feedbackFormUrl)}" style="display:inline-block;background-color:#d4af5a;color:#082b49;font-weight:700;font-size:15px;padding:12px 24px;border-radius:6px;text-decoration:none;">Click Here to Submit Feedback</a>
                  </p>
                  <p style="margin:0;font-size:13px;color:#e6c875;word-break:break-all;">
                    <a href="${escapeHtml(feedbackFormUrl)}" style="color:#e6c875;text-decoration:underline;">${escapeHtml(feedbackFormUrl)}</a>
                  </p>
                </div>

                <p style="margin:0 0 20px;">We look forward to having you join our Halal Investing webinar planned for November 2026. Do stay connected with us. JazakAllah.</p>

                <div style="background-color:#f8fafc;border-left:4px solid #b98a2a;padding:16px 20px;margin:20px 0;border-radius:0 8px 8px 0;">
                  <p style="margin:0 0 8px;font-weight:700;color:#0e2d3d;">Stay Connected With Us:</p>
                  <p style="margin:0 0 10px;">
                    <strong>WhatsApp Community:</strong><br />
                    <a href="${escapeHtml(whatsappUrl)}" style="color:#0d5c7d;text-decoration:underline;">${escapeHtml(whatsappUrl)}</a>
                  </p>
                  <p style="margin:0 0 10px;">
                    <strong>YouTube:</strong><br />
                    <a href="${escapeHtml(youtubeUrl)}" style="color:#0d5c7d;text-decoration:underline;">youtube.com/@ethicalfinancebasithtamil</a>
                  </p>
                  <p style="margin:0;">
                    <strong>Instagram:</strong><br />
                    <a href="${escapeHtml(instagramUrl)}" style="color:#0d5c7d;text-decoration:underline;">instagram.com/ethicalfinancebasith.tamil</a>
                  </p>
                </div>

                ${posterImage}

                <p style="margin:20px 0 4px;">JazakAllahu Khairan,</p>
                <p style="margin:0 0 2px;color:#0e2d3d;font-weight:700;">Barakah Team</p>
                <p style="margin:0;color:#6b7c87;font-size:14px;">Halal Wealth Webinar</p>
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0;color:#6b7c87;font-size:12px;line-height:1.5;">Halal Wealth Webinar &bull; info@halalwealth.finance</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, text, html, safeName };
}


function buildCustomEmail({ subject, message, recipientName, posterAttachmentPath = null }) {
  const safeName = escapeHtml(recipientName || 'there');
  const safeSubject = escapeHtml(String(subject || '').trim());
  const textBody = String(message || '').trim();
  const safeHtmlBody = escapeHtml(textBody)
    .split(/\n\n+/)
    .map(para => `<p style="margin:0 0 16px;">${para.replace(/\n/g, '<br />')}</p>`)
    .join('');

  const posterImage = posterAttachmentPath ? `<img src="cid:${POSTER_CID}" alt="Halal Wealth Webinar poster" style="display:block;width:100%;max-width:550px;height:auto;border:0;margin:0 auto 24px;" />` : '';

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${safeSubject}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f5f7f8;color:#243746;font-family:Arial,Helvetica,sans-serif;-webkit-font-smoothing:antialiased;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;background-color:#f5f7f8;width:100%;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;width:100%;max-width:620px;background-color:#ffffff;border:1px solid #dfe7eb;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(8,43,73,0.06);">
            <tr>
              <td style="padding:28px 32px 16px;background-color:#ffffff;border-bottom:1px solid #edf2f5;">
                <p style="margin:0 0 8px;color:#b98a2a;font-size:12px;font-weight:700;letter-spacing:2px;line-height:1.4;">HALAL WEALTH WEBINAR</p>
                <h1 style="margin:0;color:#0e2d3d;font-size:24px;line-height:1.3;font-weight:700;">${safeSubject}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px;color:#243746;font-size:15px;line-height:1.7;">
                ${safeHtmlBody}
                ${posterImage}
                <div style="margin-top:24px;padding-top:16px;border-top:1px solid #edf2f5;font-size:13px;color:#6b7c87;">
                  <p style="margin:0 0 4px;">Halal Wealth Webinar</p>
                  <p style="margin:0;"><a href="mailto:info@halalwealth.finance" style="color:#0d5c7d;text-decoration:none;">info@halalwealth.finance</a></p>
                </div>
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0;color:#6b7c87;font-size:12px;line-height:1.5;">Halal Wealth Webinar &bull; info@halalwealth.finance</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject: String(subject || '').trim(), text: textBody, html, safeName };
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
  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT' || /timeout|timedout|greeting timeout/i.test(message)) return 'SMTP_TIMEOUT';
  if (code === 'EAUTH' || /auth|authentication|535|invalid login|credentials/i.test(message)) return 'SMTP_AUTH_FAILED';
  if (code === 'ECONNECTION' || code === 'ECONNREFUSED' || /connection|refused|dns|enotfound/i.test(message)) return 'SMTP_CONNECTION_FAILED';
  if (/rejected|message rejected|550|554|552|553|5[0-9][0-9]|bounce|recipient/i.test(message) || /rejected/i.test(code)) return 'SMTP_MESSAGE_REJECTED';
  return 'SMTP_SEND_FAILED';
}

function classifyResendError(error) {
  const code = String(error?.code || '').toUpperCase();
  const name = String(error?.name || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  const statusCode = error?.statusCode || error?.status;

  if (statusCode === 401 || statusCode === 403 || /api_key|api key|invalid api|unauthorized|forbidden|not authorized/i.test(message) || name.includes('auth')) {
    return 'RESEND_AUTH_FAILED';
  }
  if (statusCode === 429 || /rate limit|too many requests|quota/i.test(message)) {
    return 'RESEND_RATE_LIMITED';
  }
  if (statusCode === 422 || /domain|not verified|sender|onboarding@resend.dev/i.test(message) || name.includes('domain')) {
    return 'RESEND_DOMAIN_NOT_VERIFIED';
  }
  if (/timeout|timed out|abort|econnreset|etimedout|fetch failed/i.test(message) || code === 'ETIMEDOUT') {
    return 'RESEND_NETWORK_TIMEOUT';
  }
  return error?.code || 'RESEND_API_ERROR';
}

function createResendPosterAttachment(posterPath) {
  if (!posterPath || !fs.existsSync(posterPath)) return [];
  try {
    const fileBuffer = fs.readFileSync(posterPath);
    return [{
      filename: 'webinar-poster.png',
      content: fileBuffer.toString('base64'),
      contentType: 'image/png',
      contentId: POSTER_CID,
      content_id: POSTER_CID,
    }];
  } catch (_) {
    return [];
  }
}

function isPlaceholderValue(value) {
  if (!value) return true;
  const trimmed = String(value).trim();
  return /^(REPLACE_WITH|your_|placeholder|test-only)/i.test(trimmed);
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

function createWebinarEmailService({ resendClient = null, createTransporter = config => nodemailer.createTransport(config), logger = console } = {}) {
  let cachedTransporter = null;
  let cachedKey = null;

  function getTransporter(transportConfig) {
    const key = `${transportConfig.host}:${transportConfig.port}:${transportConfig.auth?.user}:${transportConfig.secure}:${Boolean(transportConfig.pool)}`;
    if (cachedTransporter && cachedKey === key) {
      return cachedTransporter;
    }
    cachedTransporter = createTransporter(transportConfig);
    cachedKey = key;
    return cachedTransporter;
  }

  function resetTransporter() {
    if (cachedTransporter && typeof cachedTransporter.close === 'function') {
      try { cachedTransporter.close(); } catch (_) {}
    }
    cachedTransporter = null;
    cachedKey = null;
  }
  async function sendMailForTemplate(recipientEmail, messageContent, purpose = 'webinar email') {
    const cleanRecipient = typeof recipientEmail === 'string' ? recipientEmail.trim() : '';
    if (!cleanRecipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanRecipient) || cleanRecipient.length > 254) {
      const error = new Error(`Invalid recipient email address: "${cleanRecipient.slice(0, 50)}"`);
      error.code = 'INVALID_RECIPIENT_EMAIL';
      logger.error('EMAIL_SEND_FAILED', {
        stage: 'EMAIL_SEND_FAILED',
        purpose,
        code: error.code,
        status: 'INVALID_RECIPIENT_EMAIL',
        recipient: sanitizeLogValue(cleanRecipient),
        response: error.message,
        timestamp: new Date().toISOString(),
      });
      throw error;
    }

    if (!messageContent || !messageContent.subject || (!messageContent.text && !messageContent.html)) {
      const error = new Error('Email messageContent must include subject, text fallback, and HTML.');
      error.code = 'INVALID_MESSAGE_CONTENT';
      throw error;
    }

    const environment = process.env;
    const resendApiKey = readFirstDefined(environment, ['RESEND_API_KEY']);
    const hasValidResendKey = Boolean(resendApiKey && !isPlaceholderValue(resendApiKey));
    const useResend = Boolean(resendClient || hasValidResendKey);

    const fromAddress = readFirstDefined(environment, ['RESEND_FROM', 'MAIL_FROM', 'SMTP_FROM', 'EMAIL_FROM']) || SENDER_EMAIL;
    const fromName = readFirstDefined(environment, ['RESEND_FROM_NAME', 'MAIL_FROM_NAME', 'SMTP_FROM_NAME']) || DEFAULT_FROM_NAME;
    const replyToAddress = readFirstDefined(environment, ['RESEND_REPLY_TO', 'MAIL_REPLY_TO', 'SMTP_REPLY_TO', 'REPLY_TO']) || fromAddress;
    const posterPath = resolvePosterPath();
    const generatedMessageId = `<${Date.now()}.${Math.random().toString(36).slice(2)}@halalwealth.finance>`;

    if (!fs.existsSync(posterPath)) {
      if (typeof logger.warn === 'function') {
        logger.warn(`${purpose}: Webinar poster asset not found at ${posterPath}; proceeding without inline poster.`);
      }
    }

    // 1. Resend HTTP API Delivery (Primary for Render Free & cloud hosting)
    if (useResend) {
      logger.info('SMTP_CONFIGURATION_CHECK', {
        stage: 'SMTP_CONFIGURATION_CHECK',
        purpose,
        provider: 'Resend HTTP API',
        transport: 'HTTPS (Port 443)',
        fromAddress,
        fromName,
        replyToAddress,
        authConfigured: Boolean(resendApiKey),
        timestamp: new Date().toISOString(),
      });

      let client = resendClient;
      if (!client) {
        if (!Resend) {
          const error = new Error('The "resend" package is required for HTTP email delivery.');
          error.code = 'RESEND_PACKAGE_MISSING';
          throw error;
        }
        client = new Resend(resendApiKey);
      }

      const attachments = createResendPosterAttachment(posterPath);
      const emailPayload = {
        from: `${fromName} <${fromAddress}>`,
        to: [recipientEmail],
        reply_to: replyToAddress,
        subject: messageContent.subject,
        text: messageContent.text,
        html: messageContent.html,
        headers: {
          'X-Entity-Ref-ID': generatedMessageId,
        },
      };
      if (attachments.length > 0) {
        emailPayload.attachments = attachments;
      }

      try {
        const response = await client.emails.send(emailPayload);
        if (response && response.error) {
          const error = new Error(response.error.message || 'Resend email delivery rejected');
          error.name = response.error.name || 'ResendError';
          error.code = classifyResendError(response.error);
          error.statusCode = response.error.statusCode || 400;
          throw error;
        }
        const messageId = response?.data?.id || generatedMessageId;
        logger.info('EMAIL_SEND_ACCEPTED', {
          stage: 'EMAIL_SEND_ACCEPTED',
          purpose,
          status: 'RESEND_ACCEPTED',
          provider: 'Resend HTTP API',
          messageId,
          recipient: sanitizeLogValue(cleanRecipient),
          sender: fromAddress,
          note: 'Accepted by Resend API for transmission. Final delivery confirmed only if delivery webhook events configured.',
          timestamp: new Date().toISOString(),
        });
        return {
          status: 'RESEND_ACCEPTED',
          id: messageId,
          messageId,
          accepted: [recipientEmail],
          rejected: [],
        };
      } catch (error) {
        const errorStatus = classifyResendError(error);
        error.code = errorStatus;
        const safeMessage = sanitizeLogValue(error && (error.message || error.code || 'Resend delivery failure'));
        logger.error('EMAIL_SEND_FAILED', {
          stage: 'EMAIL_SEND_FAILED',
          purpose,
          status: errorStatus,
          code: error.code || 'RESEND_SEND_FAILED',
          errorCategory: errorStatus,
          response: safeMessage,
          recipient: sanitizeLogValue(cleanRecipient),
          sender: fromAddress,
          timestamp: new Date().toISOString(),
        });
        throw error;
      }
    }

    // 2. SMTP Transport (For unit tests with mock createTransporter, or local dev)
    const host = readFirstDefined(environment, ['MAIL_HOST', 'SMTP_HOST']);
    const port = Number(readFirstDefined(environment, ['MAIL_PORT', 'SMTP_PORT']) || '465');
    const username = readFirstDefined(environment, ['MAIL_USERNAME', 'SMTP_USER', 'SMTP_USERNAME', 'MAIL_USER']);
    const password = readFirstDefined(environment, ['MAIL_PASSWORD', 'SMTP_PASSWORD', 'MAIL_PASS', 'SMTP_PASS']);
    const useSecureSocket = String(readFirstDefined(environment, ['SMTP_SECURE', 'MAIL_SECURE']) || 'true').toLowerCase() === 'true';

    // On Render Free without RESEND_API_KEY, explicitly fail with guidance
    // rather than hanging on blocked outbound ports (25, 465, 587)
    if (process.env.RENDER && !process.env.ALLOW_SMTP_ON_RENDER && !resendClient && !hasValidResendKey) {
      const error = new Error('Outbound SMTP ports (25, 465, 587) are blocked on Render Free. Please set RESEND_API_KEY in Render environment variables for HTTP email delivery.');
      error.code = 'RESEND_KEY_MISSING';
      logger.error('EMAIL_SEND_FAILED', {
        stage: 'EMAIL_SEND_FAILED',
        purpose,
        code: error.code,
        status: 'RESEND_KEY_MISSING',
        recipient: sanitizeLogValue(cleanRecipient),
        response: error.message,
        timestamp: new Date().toISOString(),
      });
      throw error;
    }

    const isPort465 = port === 465;
    const isPort587 = port === 587;
    const secure = isPort465 ? true : (isPort587 ? false : useSecureSocket);
    const requireTLS = isPort587 ? true : (!secure && port !== 465);

    logger.info('SMTP_CONFIGURATION_CHECK', {
      stage: 'SMTP_CONFIGURATION_CHECK',
      purpose,
      provider: 'Hostinger SMTP (Nodemailer)',
      smtpConfigured: Boolean(host && username && password && Number.isInteger(port) && port > 0),
      hostConfigured: Boolean(host),
      host: host || 'not configured',
      port,
      secure,
      usernameConfigured: Boolean(username),
      fromAddressConfigured: Boolean(fromAddress),
      fromAddress,
      fromName,
      timestamp: new Date().toISOString(),
    });

    if (!host || !username || !password || !Number.isInteger(port) || port < 1) {
      const error = new Error('Email service configuration is incomplete: set RESEND_API_KEY for HTTP delivery, or SMTP credentials.');
      error.code = 'EMAIL_CONFIG_INCOMPLETE';
      throw error;
    }

    const connectionTimeout = Number(readFirstDefined(environment, ['SMTP_CONNECTION_TIMEOUT_MS']) || 10000);
    const greetingTimeout = Number(readFirstDefined(environment, ['SMTP_GREETING_TIMEOUT_MS']) || 10000);
    const socketTimeout = Number(readFirstDefined(environment, ['SMTP_SOCKET_TIMEOUT_MS']) || 15000);

    const transportConfig = {
      host,
      port,
      secure,
      requireTLS,
      family: 4,
      pool: true,
      maxConnections: 3,
      maxMessages: 100,
      connectionTimeout,
      greetingTimeout,
      socketTimeout,
      auth: { user: username, pass: password },
    };

    const transporter = getTransporter(transportConfig);

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
      const safeMessageId = getSafeMessageId(info) || generatedMessageId;
      logger.info('EMAIL_SEND_ACCEPTED', {
        stage: 'EMAIL_SEND_ACCEPTED',
        purpose,
        status: 'SMTP_ACCEPTED',
        provider: 'Hostinger SMTP (Nodemailer)',
        note: 'Accepted by SMTP server for transmission. Final delivery confirmed only if delivery events/DSN available.',
        messageId: safeMessageId,
        recipient: sanitizeLogValue(cleanRecipient),
        acceptedCount: Array.isArray(info?.accepted) ? info.accepted.length : 1,
        rejectedCount: Array.isArray(info?.rejected) ? info.rejected.length : 0,
        timestamp: new Date().toISOString(),
      });
      return info;
    } catch (error) {
      const errorStatus = classifySmtpError(error);
      const safeMessage = sanitizeLogValue(error && (error.message || error.response || error.code || 'SMTP send failure'));
      logger.error('EMAIL_SEND_FAILED', {
        stage: 'EMAIL_SEND_FAILED',
        purpose,
        status: errorStatus,
        code: error.code || 'SMTP_SEND_FAILED',
        errorCategory: errorStatus,
        response: safeMessage,
        recipient: sanitizeLogValue(cleanRecipient),
        host,
        port,
        secure: transportConfig.secure,
        timestamp: new Date().toISOString(),
      });
      if (errorStatus === 'SMTP_TIMEOUT' || errorStatus === 'SMTP_CONNECTION_FAILED') {
        resetTransporter();
      }
      throw error;
    }
  }
  async function sendRegistrationConfirmation(recipientEmail, recipientName, options = { includeEventDetails: true }) {
    const messageContent = buildRegistrationConfirmation(recipientName, resolvePosterPath(), options);
    return sendMailForTemplate(recipientEmail, messageContent, 'webinar confirmation');
  }

  async function sendPostponementAnnouncement(recipientEmail, recipientName) {
    const messageContent = buildPostponementAnnouncement(recipientName, resolvePosterPath());
    return sendMailForTemplate(recipientEmail, messageContent, 'webinar postponement announcement');
  }

  async function sendZoomJoiningLink(recipientEmail, recipientName) {
    const messageContent = buildZoomJoiningDetails(recipientName, resolvePosterPath());
    return sendMailForTemplate(recipientEmail, messageContent, 'webinar zoom joining link');
  }

  async function sendOneHourReminder(recipientEmail, recipientName) {
    const messageContent = buildOneHourReminder(recipientName, resolvePosterPath());
    return sendMailForTemplate(recipientEmail, messageContent, 'webinar one-hour reminder');
  }

  async function sendFeedbackEmail(recipientEmail, recipientName, campaignConfig = {}) {
    const messageContent = buildFeedbackEmail(campaignConfig, recipientName, resolvePosterPath());
    return sendMailForTemplate(recipientEmail, messageContent, 'webinar feedback email');
  }

  
  async function sendCustomEmail(recipientEmail, { subject, message, recipientName }) {
    const messageContent = buildCustomEmail({ subject, message, recipientName, posterAttachmentPath: resolvePosterPath() });
    return sendMailForTemplate(recipientEmail, messageContent, 'individual participant email');
  }

  async function verifyEmailService({ timeoutMs = 10000 } = {}) {
    const environment = process.env;
    const resendApiKey = readFirstDefined(environment, ['RESEND_API_KEY']);
    const hasValidResendKey = Boolean(resendApiKey && !isPlaceholderValue(resendApiKey));
    const useResend = Boolean(resendClient || hasValidResendKey);
    const fromAddress = readFirstDefined(environment, ['RESEND_FROM', 'MAIL_FROM', 'SMTP_FROM', 'EMAIL_FROM']) || SENDER_EMAIL;
    const fromName = readFirstDefined(environment, ['RESEND_FROM_NAME', 'MAIL_FROM_NAME', 'SMTP_FROM_NAME']) || DEFAULT_FROM_NAME;

    if (useResend) {
      return {
        ok: true,
        provider: 'Resend HTTP API',
        transport: 'HTTPS (Port 443)',
        fromAddress,
        fromName,
        resendConfigured: true,
        renderCompatible: true,
        latencyMs: 0,
      };
    }

    const host = readFirstDefined(environment, ['MAIL_HOST', 'SMTP_HOST']);
    const port = Number(readFirstDefined(environment, ['MAIL_PORT', 'SMTP_PORT']) || '465');
    const username = readFirstDefined(environment, ['MAIL_USERNAME', 'SMTP_USER', 'SMTP_USERNAME', 'MAIL_USER']);
    const password = readFirstDefined(environment, ['MAIL_PASSWORD', 'SMTP_PASSWORD', 'MAIL_PASS', 'SMTP_PASS']);
    const useSecureSocket = String(readFirstDefined(environment, ['SMTP_SECURE', 'MAIL_SECURE']) || 'true').toLowerCase() === 'true';

    const isConfigured = Boolean(host && username && password && Number.isInteger(port) && port > 0);
    if (!isConfigured) {
      return {
        ok: false,
        provider: 'Hostinger SMTP (Nodemailer)',
        code: 'EMAIL_CONFIG_INCOMPLETE',
        errorCategory: 'CONFIG_INCOMPLETE',
        errorMessage: 'Email service configuration is incomplete: SMTP host, user, or pass missing, and RESEND_API_KEY not configured.',
        host: host || 'not set',
        port,
        fromAddress,
      };
    }

    if (process.env.RENDER && !process.env.ALLOW_SMTP_ON_RENDER && !resendClient) {
      return {
        ok: false,
        provider: 'Hostinger SMTP (Nodemailer)',
        code: 'RENDER_FREE_PORT_BLOCKED',
        errorCategory: 'HOSTING_PORT_BLOCKED',
        errorMessage: 'Outbound SMTP ports (25, 465, 587) are blocked on Render Free. Configure RESEND_API_KEY for HTTP delivery.',
        host,
        port,
        fromAddress,
      };
    }

    const isPort465 = port === 465;
    const isPort587 = port === 587;
    const secure = isPort465 ? true : (isPort587 ? false : useSecureSocket);
    const requireTLS = isPort587 ? true : (!secure && port !== 465);

    const startTime = Date.now();
    try {
      const transporter = createTransporter({
        host,
        port,
        secure,
        requireTLS,
        family: 4,
        auth: { user: username, pass: password },
        connectionTimeout: timeoutMs,
        greetingTimeout: timeoutMs,
        socketTimeout: timeoutMs + 5000,
      });

      await transporter.verify();
      const latencyMs = Date.now() - startTime;
      return {
        ok: true,
        provider: 'Hostinger SMTP (Nodemailer)',
        transport: secure ? `SMTPS (Port ${port})` : `SMTP+STARTTLS (Port ${port})`,
        host,
        port,
        secure,
        fromAddress,
        fromName,
        authenticatedUser: username,
        latencyMs,
      };
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      const errorCategory = classifySmtpError(error);
      return {
        ok: false,
        provider: 'Hostinger SMTP (Nodemailer)',
        code: error.code || 'SMTP_VERIFY_FAILED',
        errorCategory,
        errorMessage: sanitizeLogValue(error.message || 'SMTP connection/auth failed'),
        host,
        port,
        secure,
        latencyMs,
      };
    }
  }

  return { sendRegistrationConfirmation, sendPostponementAnnouncement, sendZoomJoiningLink, sendOneHourReminder, sendFeedbackEmail, sendCustomEmail, verifyEmailService, resetTransporter };
}

module.exports = {
  EMAIL_SUBJECT,
  POSTPONEMENT_EMAIL_SUBJECT,
  ZOOM_JOINING_EMAIL_SUBJECT,
  REMINDER_ONE_HOUR_EMAIL_SUBJECT,
  DEFAULT_FEEDBACK_EMAIL_SUBJECT,
  DEFAULT_FEEDBACK_FORM_URL,
  DEFAULT_FEEDBACK_WHATSAPP_URL,
  DEFAULT_FEEDBACK_YOUTUBE_URL,
  DEFAULT_FEEDBACK_INSTAGRAM_URL,
  DEFAULT_FEEDBACK_BODY_TEXT,
  ZOOM_LINK,
  ZOOM_MEETING_ID,
  ZOOM_PASSCODE,
  POSTER_CID,
  buildRegistrationConfirmation,
  buildPostponementAnnouncement,
  buildZoomJoiningDetails,
  buildOneHourReminder,
  buildFeedbackEmail,
  buildCustomEmail,
  createWebinarEmailService,
  classifyResendError,
  createResendPosterAttachment,
  verifyEmailService: (...args) => createWebinarEmailService().verifyEmailService(...args),
  ...createWebinarEmailService(),
};