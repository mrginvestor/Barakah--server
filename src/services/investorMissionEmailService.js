const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const QRCode = require('qrcode');

const SENDER_EMAIL = 'info@halalwealth.finance';
const DEFAULT_FROM_NAME = 'Investor Mission 2026';
const POSTER_CID = 'investor-mission-poster';
const QR_CID = 'participant-checkin-qr';
const EMAIL_SUBJECT = 'Your Seat is Confirmed! | Investor Mission 2026';
const REMINDER_EMAIL_SUBJECT = 'Event Reminder: Investor Mission 2026 is Tomorrow | Halal Wealth';
const ACKNOWLEDGEMENT_EMAIL_SUBJECT = 'Registration Received Successfully | Investor Mission 2026';

const OFFICIAL_VENUE = {
  name: 'Siruthuli Noyyal Life Centre',
  address: 'Ukkadam Sungam Bypass Rd, Shanmuga Nagar, Ramanathapuram, Coimbatore, Tamil Nadu 641023, India.',
  googleMapsUrl: 'https://maps.app.goo.gl/4hwJsFTMujiSVDMEA',
};

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
  return String(value || '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function resolvePosterPath() {
  const candidates = [
    path.resolve(__dirname, '../../assets/investor-mission-poster.jpg'),
    path.resolve(__dirname, '../../../client/src/assets/investor-mission-poster.jpg'),
    path.resolve(__dirname, '../../../client/public/assets/investor-mission-poster.jpg'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0];
}

function resolveSenderConfig(environment = process.env, defaultName = DEFAULT_FROM_NAME) {
  const rawSender = readFirstDefined(environment, ['INVESTOR_MISSION_EMAIL_FROM', 'EMAIL_FROM', 'MAIL_FROM', 'SMTP_FROM']) || SENDER_EMAIL;
  const configuredName = readFirstDefined(environment, ['INVESTOR_MISSION_EMAIL_FROM_NAME', 'INVESTOR_MISSION_FROM_NAME']) || defaultName;
  return {
    fromName: configuredName,
    fromAddress: rawSender.includes('<') ? rawSender.replace(/^.*<([^>]+)>.*$/, '$1') : rawSender,
  };
}

/**
 * Build HTML and Plaintext content for Investor Mission 2026 Confirmation Email
 */
function buildInvestorMissionConfirmationContent({
  participantName,
  registrationId,
  checkInUrl,
  includePoster = true,
  includeQr = true,
}) {
  const safeName = escapeHtml(participantName || 'Valued Participant');
  const safeRegId = escapeHtml(registrationId || 'Pending');

  const text = `Assalamu Alaikum ${participantName || 'Valued Participant'},

Alhamdulillah!

We are pleased to confirm that your seat for INVESTOR MISSION 2026 – THE HALAL WAY OF INVESTING is officially reserved.

We look forward to welcoming you to an educational gathering focused on Islamic finance, halal investing and responsible wealth creation.

YOUR EVENT DETAILS:
- Event: Investor Mission 2026 – The Halal Way of Investing
- Date: Sunday, 06 December 2026
- Venue: Siruthuli Noyyal Life Centre, Ukkadam Sungam Bypass Rd, Shanmuga Nagar, Ramanathapuram, Coimbatore, Tamil Nadu 641023, India.
- Google Maps link: https://maps.app.goo.gl/4hwJsFTMujiSVDMEA
- Speaker: Abdul Basith – Licensed Financial Consultant
- Registration Fee: ₹500
- Registration ID: ${registrationId}

YOUR PERSONAL EVENT CHECK-IN QR CODE:
Please present your personal check-in QR code attached to this email at the event entrance for registration verification and attendance check-in.

IMPORTANT INSTRUCTIONS:
- Keep your confirmation email accessible on the day of the event.
- Present your personal QR code at the registration desk.
- Each QR code is valid for one participant only.
- Please do not share your personal check-in QR code with others.

We look forward to seeing you at Investor Mission 2026.

JazakAllahu Khairan.

Team Investor Mission 2026
SIO Coimbatore`;

  const posterImgHtml = includePoster
    ? `
      <div style="margin:24px 0;text-align:center;">
        <img src="cid:${POSTER_CID}" alt="Investor Mission 2026 – The Halal Way of Investing" style="width:100%;max-width:520px;height:auto;border-radius:10px;border:1px solid #e2e8f0;display:block;margin:0 auto;box-shadow:0 4px 12px rgba(5,55,38,0.08);" />
      </div>`
    : '';

  const qrImgHtml = includeQr
    ? `
      <div style="background-color:#053726;border-radius:12px;padding:28px 24px;margin:28px 0;text-align:center;color:#ffffff;border:1px solid #0a4d36;">
        <span style="display:inline-block;background-color:#80df35;color:#053726;font-size:11px;font-weight:800;letter-spacing:1.5px;padding:4px 12px;border-radius:20px;text-transform:uppercase;margin-bottom:12px;">Pass &amp; Entrance Access</span>
        <h3 style="margin:0 0 8px;font-size:19px;font-weight:700;color:#ffffff;">YOUR PERSONAL EVENT CHECK-IN QR CODE</h3>
        <p style="margin:0 0 20px;font-size:14px;color:#d1e7dd;line-height:1.5;">Please present this QR code at the event entrance for registration verification and attendance check-in.</p>
        <div style="display:inline-block;background:#ffffff;padding:12px;border-radius:12px;box-shadow:0 4px 16px rgba(0,0,0,0.25);margin-bottom:12px;">
          <img src="cid:${QR_CID}" alt="Personal Check-In QR Code for ${safeName}" width="200" height="200" style="display:block;width:200px;height:200px;border:0;" />
        </div>
        <div style="margin-top:10px;">
          <p style="margin:0;font-size:15px;color:#ffffff;font-weight:600;">Registration ID: <span style="color:#80df35;font-weight:800;letter-spacing:1px;">${safeRegId}</span></p>
          <p style="margin:6px 0 0;font-size:11px;color:#a3cfbb;">Each QR code is valid for one participant only.</p>
        </div>
      </div>`
    : '';

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${EMAIL_SUBJECT}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f1f5f9;color:#1e293b;font-family:'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;line-height:1.6;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;background-color:#f1f5f9;width:100%;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;width:100%;max-width:600px;background-color:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;box-shadow:0 10px 25px rgba(5,55,38,0.06);">
            
            <!-- Header Brand Banner -->
            <tr>
              <td style="padding:32px 28px 24px;background-color:#053726;text-align:center;border-bottom:3px solid #80df35;">
                <p style="margin:0 0 6px;color:#80df35;font-size:11px;font-weight:800;letter-spacing:2px;text-transform:uppercase;">SIO Coimbatore</p>
                <h1 style="margin:0 0 6px;color:#ffffff;font-size:24px;line-height:1.25;font-weight:800;letter-spacing:0.5px;">INVESTOR MISSION 2026</h1>
                <p style="margin:0;color:#d8ae54;font-size:14px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">THE HALAL WAY OF INVESTING</p>
              </td>
            </tr>

            <!-- Main Body -->
            <tr>
              <td style="padding:32px 28px;color:#1e293b;font-size:15px;line-height:1.7;">
                <p style="margin:0 0 16px;font-size:16px;color:#053726;font-weight:700;">Assalamu Alaikum ${safeName},</p>
                
                <p style="margin:0 0 14px;font-size:18px;color:#053726;font-weight:800;">Alhamdulillah!</p>
                
                <p style="margin:0 0 16px;color:#334155;">
                  We are pleased to confirm that your seat for <strong>INVESTOR MISSION 2026 – THE HALAL WAY OF INVESTING</strong> is officially reserved.
                </p>
                
                <div style="background-color:#f0fdf4;border-left:4px solid #16a34a;padding:14px 18px;margin:0 0 20px;border-radius:0 8px 8px 0;">
                  <p style="margin:0;color:#166534;font-size:14px;font-weight:600;">
                    ✓ Your seat is officially confirmed.
                  </p>
                </div>

                <p style="margin:0 0 20px;color:#334155;">
                  We look forward to welcoming you to an educational gathering focused on Islamic finance, halal investing and responsible wealth creation.
                </p>

                <!-- Official Poster -->
                ${posterImgHtml}

                <!-- Event Details Card -->
                <div style="background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:22px 24px;margin:24px 0;">
                  <h2 style="margin:0 0 16px;font-size:16px;font-weight:800;color:#053726;letter-spacing:0.5px;border-bottom:1px solid #e2e8f0;padding-bottom:10px;">
                    YOUR EVENT DETAILS
                  </h2>
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="font-size:14px;line-height:1.8;">
                    <tr>
                      <td style="padding:6px 0;color:#64748b;width:140px;font-weight:600;vertical-align:top;">Event:</td>
                      <td style="padding:6px 0;color:#053726;font-weight:700;vertical-align:top;">Investor Mission 2026 – The Halal Way of Investing</td>
                    </tr>
                    <tr>
                      <td style="padding:6px 0;color:#64748b;font-weight:600;vertical-align:top;">Date:</td>
                      <td style="padding:6px 0;color:#053726;font-weight:700;vertical-align:top;">Sunday, 06 December 2026</td>
                    </tr>
                    <tr>
                      <td style="padding:6px 0;color:#64748b;width:140px;font-weight:600;vertical-align:top;">Venue:</td>
                      <td style="padding:6px 0;color:#1e293b;font-weight:500;line-height:1.55;vertical-align:top;">
                        <strong style="color:#053726;font-size:15px;display:block;margin-bottom:2px;">${escapeHtml(OFFICIAL_VENUE.name)}</strong>
                        ${escapeHtml(OFFICIAL_VENUE.address)}
                        <div style="margin-top:8px;">
                          <a href="${escapeHtml(OFFICIAL_VENUE.googleMapsUrl)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;background-color:#053726;color:#ffffff;font-size:12px;font-weight:700;padding:7px 14px;border-radius:6px;text-decoration:none;letter-spacing:0.3px;">
                            📍 Open in Google Maps &amp; Get Directions &rarr;
                          </a>
                        </div>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding:6px 0;color:#64748b;font-weight:600;vertical-align:top;">Speaker:</td>
                      <td style="padding:6px 0;color:#1e293b;font-weight:600;vertical-align:top;">Abdul Basith – Licensed Financial Consultant</td>
                    </tr>
                    <tr>
                      <td style="padding:6px 0;color:#64748b;font-weight:600;vertical-align:top;">Registration Fee:</td>
                      <td style="padding:6px 0;color:#053726;font-weight:700;vertical-align:top;">₹500</td>
                    </tr>
                    <tr>
                      <td style="padding:6px 0;color:#64748b;font-weight:600;vertical-align:top;">Registration ID:</td>
                      <td style="padding:6px 0;color:#053726;font-weight:800;font-size:15px;letter-spacing:0.5px;vertical-align:top;">${safeRegId}</td>
                    </tr>
                  </table>
                </div>

                <!-- Personal QR Code Box -->
                ${qrImgHtml}

                <!-- Important Instructions -->
                <div style="background-color:#fffbeb;border:1px solid #fef3c7;border-radius:12px;padding:20px 22px;margin:24px 0;">
                  <h3 style="margin:0 0 12px;font-size:15px;font-weight:800;color:#92400e;">IMPORTANT INSTRUCTIONS</h3>
                  <ul style="margin:0;padding-left:20px;color:#78350f;font-size:14px;line-height:1.7;">
                    <li style="margin-bottom:6px;">Keep your confirmation email accessible on the day of the event.</li>
                    <li style="margin-bottom:6px;">Present your personal QR code at the registration desk.</li>
                    <li style="margin-bottom:6px;">Each QR code is valid for one participant only.</li>
                    <li style="margin-bottom:0;">Please do not share your personal check-in QR code with others.</li>
                  </ul>
                </div>

                <p style="margin:24px 0 12px;color:#334155;">
                  We look forward to seeing you at Investor Mission 2026.
                </p>

                <p style="margin:0 0 20px;color:#053726;font-weight:700;">
                  JazakAllahu Khairan.
                </p>

                <!-- Closing Signature -->
                <div style="border-top:1px solid #e2e8f0;padding-top:16px;margin-top:24px;">
                  <p style="margin:0;color:#053726;font-weight:800;font-size:15px;">Team Investor Mission 2026</p>
                  <p style="margin:2px 0 0;color:#334155;font-size:14px;font-weight:600;">SIO Coimbatore</p>
                </div>
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="padding:20px 28px;background-color:#f8fafc;border-top:1px solid #e2e8f0;text-align:center;color:#64748b;font-size:12px;line-height:1.5;">
                <p style="margin:0 0 4px;font-weight:700;color:#053726;">Investor Mission 2026 &bull; SIO Coimbatore</p>
                <p style="margin:0;font-size:11px;color:#94a3b8;">This email was sent to confirm your seat reservation for Investor Mission 2026.</p>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject: EMAIL_SUBJECT, text, html };
}

/**
 * Build HTML and Plaintext content for Investor Mission 2026 Reminder Email
 */
function buildInvestorMissionReminderContent({
  participantName,
  registrationId,
  checkInUrl,
  includePoster = true,
  includeQr = true,
}) {
  const safeName = escapeHtml(participantName || 'Valued Participant');
  const safeRegId = escapeHtml(registrationId || 'Pending');
  const safeUrl = escapeHtml(checkInUrl || 'https://halalwealth.finance');

  const text = `Assalamu Alaikum ${participantName || 'Valued Participant'},

Reminder: INVESTOR MISSION 2026 – THE HALAL WAY OF INVESTING is taking place tomorrow!

We look forward to welcoming you to an insightful educational gathering focused on Islamic finance, halal investing and responsible wealth creation.

YOUR EVENT & VENUE DETAILS:
- Event: Investor Mission 2026
- Theme: The Halal Way of Investing
- Date: Sunday, 06 December 2026
- Venue Name: ${OFFICIAL_VENUE.name}
- Full Address: ${OFFICIAL_VENUE.address}
- Google Maps Directions: ${OFFICIAL_VENUE.googleMapsUrl}
- Speaker: Abdul Basith – Licensed Financial Consultant
- Registration ID: ${registrationId}

YOUR PERSONAL CHECK-IN QR CODE:
Please present your QR code at the entrance for verification and entry.
Check-in verification link: ${checkInUrl}

IMPORTANT INSTRUCTIONS:
- Keep this email or your check-in QR code accessible on your phone.
- Arrive 15 minutes before the scheduled start time for smooth check-in.
- Each QR code is valid for one participant only.
- Please do not share your personal check-in QR code with others.

JazakAllahu Khairan.

Warm Regards,
HALAL WEALTH
SIO Coimbatore & Halal Wealth
Website: https://halalwealth.finance`;

  const posterImgHtml = includePoster
    ? `
      <div style="margin:24px 0;text-align:center;">
        <img src="cid:${POSTER_CID}" alt="Investor Mission 2026 – The Halal Way of Investing" style="width:100%;max-width:520px;height:auto;border-radius:10px;border:1px solid #e2e8f0;display:block;margin:0 auto;box-shadow:0 4px 12px rgba(5,55,38,0.08);" />
      </div>`
    : '';

  const qrImgHtml = includeQr
    ? `
      <div style="background-color:#053726;border-radius:12px;padding:28px 24px;margin:28px 0;text-align:center;color:#ffffff;border:1px solid #0a4d36;">
        <span style="display:inline-block;background-color:#80df35;color:#053726;font-size:11px;font-weight:800;letter-spacing:1.5px;padding:4px 12px;border-radius:20px;text-transform:uppercase;margin-bottom:12px;">Entrance Pass</span>
        <h3 style="margin:0 0 8px;font-size:19px;font-weight:700;color:#ffffff;">YOUR EVENT CHECK-IN QR CODE</h3>
        <p style="margin:0 0 20px;font-size:14px;color:#d1e7dd;line-height:1.5;">Please present this QR code at the registration desk tomorrow for attendance check-in.</p>
        <div style="display:inline-block;background:#ffffff;padding:12px;border-radius:12px;box-shadow:0 4px 16px rgba(0,0,0,0.25);margin-bottom:12px;">
          <img src="cid:${QR_CID}" alt="Personal Check-In QR Code for ${safeName}" width="200" height="200" style="display:block;width:200px;height:200px;border:0;" />
        </div>
        <div style="margin-top:10px;">
          <p style="margin:0;font-size:15px;color:#ffffff;font-weight:600;">Registration ID: <span style="color:#80df35;font-weight:800;letter-spacing:1px;">${safeRegId}</span></p>
          <p style="margin:6px 0 0;font-size:11px;color:#a3cfbb;">Each QR code is valid for one participant only.</p>
        </div>
      </div>`
    : '';

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${REMINDER_EMAIL_SUBJECT}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f1f5f9;color:#1e293b;font-family:'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;line-height:1.6;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;background-color:#f1f5f9;width:100%;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;width:100%;max-width:600px;background-color:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;box-shadow:0 10px 25px rgba(5,55,38,0.06);">
            
            <!-- Header Brand Banner -->
            <tr>
              <td style="padding:32px 28px 24px;background-color:#053726;text-align:center;border-bottom:3px solid #80df35;">
                <p style="margin:0 0 6px;color:#80df35;font-size:11px;font-weight:800;letter-spacing:2px;text-transform:uppercase;">SIO Coimbatore &bull; Halal Wealth</p>
                <h1 style="margin:0 0 6px;color:#ffffff;font-size:24px;line-height:1.25;font-weight:800;letter-spacing:0.5px;">INVESTOR MISSION 2026</h1>
                <p style="margin:0;color:#d8ae54;font-size:14px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">EVENT REMINDER</p>
              </td>
            </tr>

            <!-- Main Body -->
            <tr>
              <td style="padding:32px 28px;color:#1e293b;font-size:15px;line-height:1.7;">
                <p style="margin:0 0 16px;font-size:16px;color:#053726;font-weight:700;">Assalamu Alaikum ${safeName},</p>
                
                <p style="margin:0 0 16px;color:#334155;">
                  This is a gentle reminder that <strong>INVESTOR MISSION 2026 – THE HALAL WAY OF INVESTING</strong> will take place tomorrow, <strong>Sunday, 06 December 2026</strong>.
                </p>

                <!-- Official Poster -->
                ${posterImgHtml}

                <!-- Event Details Card -->
                <div style="background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:22px 24px;margin:24px 0;">
                  <h2 style="margin:0 0 16px;font-size:16px;font-weight:800;color:#053726;letter-spacing:0.5px;border-bottom:1px solid #e2e8f0;padding-bottom:10px;">
                    EVENT &amp; VENUE DETAILS
                  </h2>
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="font-size:14px;line-height:1.8;">
                    <tr>
                      <td style="padding:6px 0;color:#64748b;width:140px;font-weight:600;vertical-align:top;">Event:</td>
                      <td style="padding:6px 0;color:#053726;font-weight:700;vertical-align:top;">Investor Mission 2026</td>
                    </tr>
                    <tr>
                      <td style="padding:6px 0;color:#64748b;font-weight:600;vertical-align:top;">Theme:</td>
                      <td style="padding:6px 0;color:#1e293b;font-weight:600;vertical-align:top;">The Halal Way of Investing</td>
                    </tr>
                    <tr>
                      <td style="padding:6px 0;color:#64748b;font-weight:600;vertical-align:top;">Date:</td>
                      <td style="padding:6px 0;color:#053726;font-weight:700;vertical-align:top;">Sunday, 06 December 2026</td>
                    </tr>
                    <tr>
                      <td style="padding:6px 0;color:#64748b;font-weight:600;vertical-align:top;">Venue Name:</td>
                      <td style="padding:6px 0;color:#053726;font-weight:700;font-size:15px;vertical-align:top;">${escapeHtml(OFFICIAL_VENUE.name)}</td>
                    </tr>
                    <tr>
                      <td style="padding:6px 0;color:#64748b;font-weight:600;vertical-align:top;">Full Address:</td>
                      <td style="padding:6px 0;color:#1e293b;font-weight:500;line-height:1.55;vertical-align:top;">
                        ${escapeHtml(OFFICIAL_VENUE.address)}
                        <div style="margin-top:8px;">
                          <a href="${escapeHtml(OFFICIAL_VENUE.googleMapsUrl)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;background-color:#053726;color:#ffffff;font-size:12px;font-weight:700;padding:7px 14px;border-radius:6px;text-decoration:none;letter-spacing:0.3px;">
                            📍 Open in Google Maps &amp; Get Directions &rarr;
                          </a>
                        </div>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding:6px 0;color:#64748b;font-weight:600;vertical-align:top;">Speaker:</td>
                      <td style="padding:6px 0;color:#1e293b;font-weight:600;vertical-align:top;">Abdul Basith – Licensed Financial Consultant</td>
                    </tr>
                    <tr>
                      <td style="padding:6px 0;color:#64748b;font-weight:600;vertical-align:top;">Registration ID:</td>
                      <td style="padding:6px 0;color:#053726;font-weight:800;font-size:15px;letter-spacing:0.5px;vertical-align:top;">${safeRegId}</td>
                    </tr>
                  </table>
                </div>

                <!-- Personal QR Code Box -->
                ${qrImgHtml}

                <!-- Important Instructions -->
                <div style="background-color:#fffbeb;border:1px solid #fef3c7;border-radius:12px;padding:20px 22px;margin:24px 0;">
                  <h3 style="margin:0 0 12px;font-size:15px;font-weight:800;color:#92400e;">IMPORTANT REMINDERS</h3>
                  <ul style="margin:0;padding-left:20px;color:#78350f;font-size:14px;line-height:1.7;">
                    <li style="margin-bottom:6px;">Have your check-in QR code ready upon arrival at the venue.</li>
                    <li style="margin-bottom:6px;">Registration and entry desk opens 30 minutes prior to session start.</li>
                    <li style="margin-bottom:0;">Please reach out to the help desk if you need navigation assistance.</li>
                  </ul>
                </div>

                <p style="margin:24px 0 12px;color:#334155;">
                  We look forward to an enlightening and beneficial session.
                </p>

                <p style="margin:0 0 20px;color:#053726;font-weight:700;">
                  JazakAllahu Khairan.
                </p>

                <div style="border-top:1px solid #e2e8f0;padding-top:16px;margin-top:24px;">
                  <p style="margin:0 0 4px;color:#64748b;font-size:13px;">Warm Regards,</p>
                  <p style="margin:0;color:#053726;font-weight:800;font-size:15px;">HALAL WEALTH</p>
                  <p style="margin:2px 0 0;color:#334155;font-size:13px;font-weight:600;">SIO Coimbatore &amp; Halal Wealth</p>
                  <p style="margin:6px 0 0;font-size:13px;">
                    <a href="https://halalwealth.finance" style="color:#053726;text-decoration:underline;font-weight:600;">https://halalwealth.finance</a>
                  </p>
                </div>
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="padding:20px 28px;background-color:#f8fafc;border-top:1px solid #e2e8f0;text-align:center;color:#64748b;font-size:12px;line-height:1.5;">
                <p style="margin:0 0 4px;">&copy; 2026 Halal Wealth &bull; SIO Coimbatore. All rights reserved.</p>
                <p style="margin:0;font-size:11px;color:#94a3b8;">This reminder was sent for your confirmed seat at Investor Mission 2026.</p>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject: REMINDER_EMAIL_SUBJECT, text, html };
}

/**
 * Build HTML and Plaintext content for Investor Mission 2026 Registration Acknowledgement Email
 */
function buildInvestorMissionAcknowledgementContent({
  participantName,
  registrationId,
  includePoster = true,
}) {
  const safeName = escapeHtml(participantName || 'Valued Participant');
  const safeRegId = escapeHtml(registrationId || 'Pending');
  const mapsUrl = 'https://maps.app.goo.gl/4hwJsFTMujiSVDMEA';

  const text = `Assalamu Alaikum ${participantName || 'Valued Participant'},

Thank you for registering for Investor Mission 2026 – The Halal Way of Investing.

Alhamdulillah! We have successfully received your registration details.

Your registration is currently under verification. Our team will review your registration and payment details. Once the verification process is completed, we will send you a separate confirmation email as soon as possible to confirm your booking.

Event Details

- Event: Investor Mission 2026 – The Halal Way of Investing
- Date: Sunday, 06 December 2026
- Venue: ${mapsUrl}.
- Registration ID: ${registrationId}

Please keep your Registration ID for future reference.

We appreciate your interest and patience. We look forward to welcoming you!

JazakAllahu Khairan,

Team Investor Mission 2026
SIO Coimbatore
SOLIDARITY TAMIL NADU`;

  const posterImgHtml = includePoster
    ? `
      <div style="margin:24px 0;text-align:center;">
        <img src="cid:${POSTER_CID}" alt="Investor Mission 2026 – The Halal Way of Investing" style="width:100%;max-width:520px;height:auto;border-radius:10px;border:1px solid #e2e8f0;display:block;margin:0 auto;box-shadow:0 4px 12px rgba(5,55,38,0.08);" />
      </div>`
    : '';

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${ACKNOWLEDGEMENT_EMAIL_SUBJECT}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f1f5f9;color:#1e293b;font-family:'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;line-height:1.6;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;background-color:#f1f5f9;width:100%;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;width:100%;max-width:600px;background-color:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;box-shadow:0 10px 25px rgba(5,55,38,0.06);">
            
            <!-- Header Brand Banner -->
            <tr>
              <td style="padding:32px 28px 24px;background-color:#064B36;text-align:center;border-bottom:3px solid #80DF35;">
                <p style="margin:0 0 6px;color:#80DF35;font-size:11px;font-weight:800;letter-spacing:2px;text-transform:uppercase;">SIO Coimbatore &bull; SOLIDARITY TAMIL NADU</p>
                <h1 style="margin:0 0 6px;color:#ffffff;font-size:24px;line-height:1.25;font-weight:800;letter-spacing:0.5px;">INVESTOR MISSION 2026</h1>
                <p style="margin:0;color:#D8AE54;font-size:13.5px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">THE HALAL WAY OF INVESTING</p>
              </td>
            </tr>

            <!-- Main Body -->
            <tr>
              <td style="padding:32px 28px;color:#1e293b;font-size:15px;line-height:1.7;">
                <p style="margin:0 0 16px;font-size:16px;color:#064B36;font-weight:700;">Assalamu Alaikum ${safeName},</p>
                
                <p style="margin:0 0 14px;color:#334155;">
                  Thank you for registering for <strong>Investor Mission 2026 – The Halal Way of Investing</strong>.
                </p>

                <p style="margin:0 0 16px;font-size:17px;color:#064B36;font-weight:800;">
                  Alhamdulillah! We have successfully received your registration details.
                </p>
                
                <!-- Verification Notice Alert Box -->
                <div style="background-color:#f0fdf4;border:1px solid #80DF35;border-left:5px solid #138C3B;padding:16px 20px;margin:20px 0;border-radius:6px;">
                  <p style="margin:0;color:#064B36;font-size:14.5px;line-height:1.6;">
                    <strong>Your registration is currently under verification.</strong> Our team will review your registration and payment details. Once the verification process is completed, we will send you a separate confirmation email as soon as possible to confirm your booking.
                  </p>
                </div>

                <!-- Registration ID Highlight Box -->
                <div style="background-color:#f8fafc;border:2px dashed #064B36;border-radius:12px;padding:20px;margin:24px 0;text-align:center;">
                  <span style="display:inline-block;background-color:#e2e8f0;color:#475569;font-size:11px;font-weight:800;letter-spacing:1.5px;padding:3px 10px;border-radius:12px;text-transform:uppercase;">Registration ID</span>
                  <div style="margin:10px 0 6px;font-size:26px;font-weight:800;color:#064B36;letter-spacing:1.5px;font-family:'Plus Jakarta Sans',monospace,sans-serif;">
                    ${safeRegId}
                  </div>
                  <p style="margin:0;font-size:12.5px;color:#64748b;font-weight:500;">
                    Please keep your Registration ID for future reference.
                  </p>
                </div>

                <!-- Event Details Card -->
                <div style="background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:22px 24px;margin:24px 0;">
                  <h2 style="margin:0 0 16px;font-size:15px;font-weight:800;color:#064B36;letter-spacing:0.5px;border-bottom:1px solid #e2e8f0;padding-bottom:10px;text-transform:uppercase;">
                    Event Details
                  </h2>
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="font-size:14px;line-height:1.8;">
                    <tr>
                      <td style="padding:6px 0;color:#64748b;width:140px;font-weight:600;vertical-align:top;">Event:</td>
                      <td style="padding:6px 0;color:#064B36;font-weight:700;vertical-align:top;">Investor Mission 2026 – The Halal Way of Investing</td>
                    </tr>
                    <tr>
                      <td style="padding:6px 0;color:#64748b;font-weight:600;vertical-align:top;">Date:</td>
                      <td style="padding:6px 0;color:#1e293b;font-weight:700;vertical-align:top;">Sunday, 06 December 2026</td>
                    </tr>
                    <tr>
                      <td style="padding:6px 0;color:#64748b;font-weight:600;vertical-align:top;">Venue:</td>
                      <td style="padding:6px 0;color:#1e293b;vertical-align:top;">
                        <a href="${mapsUrl}" target="_blank" rel="noopener noreferrer" style="color:#138C3B;font-weight:700;text-decoration:underline;">
                          ${mapsUrl} &rarr;
                        </a>
                        <div style="margin-top:2px;font-size:12.5px;color:#64748b;">(Siruthuli Noyyal Life Centre, Coimbatore)</div>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding:6px 0;color:#64748b;font-weight:600;vertical-align:top;">Registration ID:</td>
                      <td style="padding:6px 0;color:#064B36;font-weight:800;font-size:15px;letter-spacing:0.5px;vertical-align:top;">${safeRegId}</td>
                    </tr>
                  </table>
                </div>

                <p style="margin:20px 0;color:#334155;line-height:1.6;">
                  We appreciate your interest and patience. We look forward to welcoming you!
                </p>

                <!-- Official Poster -->
                ${posterImgHtml}

                <div style="margin-top:28px;padding-top:20px;border-top:1px solid #e2e8f0;">
                  <p style="margin:0 0 12px;color:#064B36;font-weight:700;font-size:15px;">JazakAllahu Khairan,</p>
                  <p style="margin:0;color:#1e293b;line-height:1.6;">
                    <strong style="color:#064B36;">Team Investor Mission 2026</strong><br />
                    SIO Coimbatore<br />
                    SOLIDARITY TAMIL NADU
                  </p>
                </div>
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="padding:22px 28px;background-color:#032419;text-align:center;color:#a3cfbb;font-size:12px;line-height:1.6;">
                <p style="margin:0 0 6px;color:#ffffff;font-weight:700;">INVESTOR MISSION 2026</p>
                <p style="margin:0 0 8px;">Organized by SIO Coimbatore &bull; SOLIDARITY TAMIL NADU</p>
                <p style="margin:0;font-size:11px;color:#80df35;">
                  For registration inquiries or payment support: +91 6380413253 (Anas Rahman H) &bull; info@halalwealth.finance
                </p>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject: ACKNOWLEDGEMENT_EMAIL_SUBJECT, text, html };
}

/**
 * Service Factory for Investor Mission Email operations
 */
function createInvestorMissionEmailService({
  createTransporter = config => nodemailer.createTransport(config),
  logger = console,
} = {}) {
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

  function resolveTransportConfig(environment = process.env, portOverride = null) {
    const host = readFirstDefined(environment, ['MAIL_HOST', 'SMTP_HOST']);
    const configuredPort = Number(readFirstDefined(environment, ['MAIL_PORT', 'SMTP_PORT']) || '465');
    const port = portOverride ? Number(portOverride) : configuredPort;
    const username = readFirstDefined(environment, ['MAIL_USERNAME', 'SMTP_USER', 'SMTP_USERNAME', 'MAIL_USER']);
    const password = readFirstDefined(environment, ['MAIL_PASSWORD', 'SMTP_PASSWORD', 'MAIL_PASS', 'SMTP_PASS']);
    const useSecureSocket = String(readFirstDefined(environment, ['SMTP_SECURE', 'MAIL_SECURE']) || 'true').toLowerCase() === 'true';

    const isPort465 = port === 465;
    const isPort587 = port === 587;
    const secure = isPort465 ? true : (isPort587 ? false : useSecureSocket);
    const requireTLS = isPort587 ? true : (!secure && port !== 465);

    if (!host || !username || !password || !Number.isInteger(port) || port < 1) {
      const error = new Error('Email service configuration is incomplete: SMTP host, user, or pass missing.');
      error.code = 'EMAIL_CONFIG_INCOMPLETE';
      throw error;
    }

    const connectionTimeout = Number(readFirstDefined(environment, ['SMTP_CONNECTION_TIMEOUT_MS']) || 15000);
    const greetingTimeout = Number(readFirstDefined(environment, ['SMTP_GREETING_TIMEOUT_MS']) || 15000);
    const socketTimeout = Number(readFirstDefined(environment, ['SMTP_SOCKET_TIMEOUT_MS']) || 25000);

    return {
      host,
      port,
      secure,
      requireTLS,
      family: 4,
      pool: false,
      connectionTimeout,
      greetingTimeout,
      socketTimeout,
      auth: { user: username, pass: password },
    };
  }

  async function sendMailWithPortFallback(mailOptions, tag = 'CONFIRMATION') {
    const environment = process.env;
    const primaryConfig = resolveTransportConfig(environment);
    const fallbackPort = primaryConfig.port === 465 ? 587 : (primaryConfig.port === 587 ? 465 : null);

    const transporter = getTransporter(primaryConfig);
    try {
      const info = await transporter.sendMail(mailOptions);
      return { info, port: primaryConfig.port };
    } catch (primaryErr) {
      resetTransporter();
      const isTimeoutOrConnError =
        /timeout/i.test(primaryErr.message) ||
        primaryErr.code === 'ETIMEDOUT' ||
        primaryErr.code === 'ESOCKETTIMEDOUT' ||
        primaryErr.code === 'ECONNRESET' ||
        primaryErr.code === 'ECONNREFUSED';

      if (fallbackPort && isTimeoutOrConnError) {
        if (typeof logger.warn === 'function') {
          logger.warn(`[${tag}] Primary SMTP port ${primaryConfig.port} failed (${primaryErr.message}). Retrying on fallback port ${fallbackPort}...`);
        }
        const fallbackConfig = resolveTransportConfig(environment, fallbackPort);
        const fallbackTransporter = createTransporter(fallbackConfig);
        try {
          const info = await fallbackTransporter.sendMail(mailOptions);
          if (typeof logger.info === 'function') {
            logger.info(`[${tag}] Email sent successfully via fallback port ${fallbackPort}.`);
          }
          return { info, port: fallbackPort };
        } catch (fallbackErr) {
          if (typeof logger.error === 'function') {
            logger.error(`[${tag}] Fallback SMTP port ${fallbackPort} also failed: ${fallbackErr.message}`);
          }
          throw fallbackErr;
        }
      }
      throw primaryErr;
    }
  }

  /**
   * Generates a PNG QR code buffer for the given URL/content
   */
  async function generateQrBuffer(content) {
    return QRCode.toBuffer(content, {
      type: 'png',
      width: 280,
      margin: 2,
      errorCorrectionLevel: 'H',
      color: {
        dark: '#053726',
        light: '#FFFFFF',
      },
    });
  }

  /**
   * Send Investor Mission Confirmation Email
   */
  async function sendInvestorMissionConfirmation({
    recipientEmail,
    participantName,
    registrationId,
    checkInUrl,
  }) {
    const cleanRecipient = typeof recipientEmail === 'string' ? recipientEmail.trim() : '';
    if (!cleanRecipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanRecipient) || cleanRecipient.length > 254) {
      const error = new Error(`Invalid recipient email address: "${cleanRecipient.slice(0, 50)}"`);
      error.code = 'INVALID_RECIPIENT_EMAIL';
      throw error;
    }

    if (!registrationId) {
      const error = new Error('Registration ID is required to generate confirmation email.');
      error.code = 'MISSING_REGISTRATION_ID';
      throw error;
    }

    const verificationUrl = checkInUrl || `https://halalwealth.finance/api/investor-mission/checkin/verify/${registrationId}`;

    // Generate QR Buffer
    let qrBuffer;
    try {
      qrBuffer = await generateQrBuffer(verificationUrl);
    } catch (qrErr) {
      logger.error('Failed to generate check-in QR code:', qrErr.message);
      throw new Error(`Failed to generate check-in QR code: ${qrErr.message}`);
    }

    const posterPath = resolvePosterPath();
    const hasPoster = fs.existsSync(posterPath);
    if (!hasPoster) {
      logger.warn(`Investor Mission poster not found at ${posterPath}; proceeding with external/hosted fallback.`);
    }

    const messageContent = buildInvestorMissionConfirmationContent({
      participantName,
      registrationId,
      checkInUrl: verificationUrl,
      includePoster: true,
      includeQr: true,
    });

    const { fromName, fromAddress } = resolveSenderConfig(process.env);

    const attachments = [
      {
        filename: 'checkin-qr.png',
        content: qrBuffer,
        cid: QR_CID,
        contentType: 'image/png',
        contentDisposition: 'inline',
      },
    ];

    if (hasPoster) {
      attachments.push({
        filename: 'investor-mission-poster.jpg',
        path: posterPath,
        cid: POSTER_CID,
        contentType: 'image/jpeg',
        contentDisposition: 'inline',
      });
    }

    const mailOptions = {
      from: `"${fromName}" <${fromAddress}>`,
      to: cleanRecipient,
      subject: messageContent.subject,
      text: messageContent.text,
      html: messageContent.html,
      attachments,
    };

    try {
      const { info, port } = await sendMailWithPortFallback(mailOptions, 'INVESTOR_MISSION_CONFIRMATION');
      if (typeof logger.info === 'function') {
        logger.info('INVESTOR_MISSION_CONFIRMATION_EMAIL_SENT', {
          recipient: cleanRecipient,
          registrationId,
          messageId: info?.messageId,
          port,
        });
      }
      return { success: true, messageId: info?.messageId, port };
    } catch (sendErr) {
      if (typeof logger.error === 'function') {
        logger.error('INVESTOR_MISSION_CONFIRMATION_EMAIL_FAILED', {
          recipient: cleanRecipient,
          registrationId,
          error: sendErr.message,
        });
      }
      throw sendErr;
    }
  }

  /**
   * Send Investor Mission Reminder Email
   */
  async function sendInvestorMissionReminder({
    recipientEmail,
    participantName,
    registrationId,
    checkInUrl,
  }) {
    const cleanRecipient = typeof recipientEmail === 'string' ? recipientEmail.trim() : '';
    if (!cleanRecipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanRecipient) || cleanRecipient.length > 254) {
      const error = new Error(`Invalid recipient email address: "${cleanRecipient.slice(0, 50)}"`);
      error.code = 'INVALID_RECIPIENT_EMAIL';
      throw error;
    }

    if (!registrationId) {
      const error = new Error('Registration ID is required to generate reminder email.');
      error.code = 'MISSING_REGISTRATION_ID';
      throw error;
    }

    const verificationUrl = checkInUrl || `https://halalwealth.finance/api/investor-mission/checkin/verify/${registrationId}`;

    let qrBuffer;
    try {
      qrBuffer = await generateQrBuffer(verificationUrl);
    } catch (qrErr) {
      logger.error('Failed to generate check-in QR code for reminder:', qrErr.message);
      throw new Error(`Failed to generate check-in QR code: ${qrErr.message}`);
    }

    const posterPath = resolvePosterPath();
    const hasPoster = fs.existsSync(posterPath);

    const messageContent = buildInvestorMissionReminderContent({
      participantName,
      registrationId,
      checkInUrl: verificationUrl,
      includePoster: true,
      includeQr: true,
    });

    const { fromName, fromAddress } = resolveSenderConfig(process.env);

    const attachments = [
      {
        filename: 'checkin-qr.png',
        content: qrBuffer,
        cid: QR_CID,
        contentType: 'image/png',
        contentDisposition: 'inline',
      },
    ];

    if (hasPoster) {
      attachments.push({
        filename: 'investor-mission-poster.jpg',
        path: posterPath,
        cid: POSTER_CID,
        contentType: 'image/jpeg',
        contentDisposition: 'inline',
      });
    }

    const mailOptions = {
      from: `"${fromName}" <${fromAddress}>`,
      to: cleanRecipient,
      subject: messageContent.subject,
      text: messageContent.text,
      html: messageContent.html,
      attachments,
    };

    try {
      const { info, port } = await sendMailWithPortFallback(mailOptions, 'INVESTOR_MISSION_REMINDER');
      if (typeof logger.info === 'function') {
        logger.info('INVESTOR_MISSION_REMINDER_EMAIL_SENT', {
          recipient: cleanRecipient,
          registrationId,
          messageId: info?.messageId,
          port,
        });
      }
      return { success: true, messageId: info?.messageId, port };
    } catch (sendErr) {
      if (typeof logger.error === 'function') {
        logger.error('INVESTOR_MISSION_REMINDER_EMAIL_FAILED', {
          recipient: cleanRecipient,
          registrationId,
          error: sendErr.message,
        });
      }
      throw sendErr;
    }
  }

  /**
   * Send Investor Mission Registration Acknowledgement Email
   */
  async function sendInvestorMissionAcknowledgement({
    recipientEmail,
    participantName,
    registrationId,
  }) {
    const cleanRecipient = typeof recipientEmail === 'string' ? recipientEmail.trim() : '';
    if (!cleanRecipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanRecipient) || cleanRecipient.length > 254) {
      const error = new Error(`Invalid recipient email address: "${cleanRecipient.slice(0, 50)}"`);
      error.code = 'INVALID_RECIPIENT_EMAIL';
      throw error;
    }

    if (!registrationId) {
      const error = new Error('Registration ID is required to send acknowledgement email.');
      error.code = 'MISSING_REGISTRATION_ID';
      throw error;
    }

    const posterPath = resolvePosterPath();
    const hasPoster = fs.existsSync(posterPath);

    const messageContent = buildInvestorMissionAcknowledgementContent({
      participantName,
      registrationId,
      includePoster: hasPoster,
    });

    const { fromName, fromAddress } = resolveSenderConfig(process.env);

    const attachments = [];
    if (hasPoster) {
      attachments.push({
        filename: 'investor-mission-poster.jpg',
        path: posterPath,
        cid: POSTER_CID,
        contentType: 'image/jpeg',
        contentDisposition: 'inline',
      });
    }

    const mailOptions = {
      from: `"${fromName}" <${fromAddress}>`,
      to: cleanRecipient,
      subject: messageContent.subject,
      text: messageContent.text,
      html: messageContent.html,
      attachments,
    };

    try {
      const { info, port } = await sendMailWithPortFallback(mailOptions, 'INVESTOR_MISSION_ACKNOWLEDGEMENT');
      if (typeof logger.info === 'function') {
        logger.info('INVESTOR_MISSION_ACKNOWLEDGEMENT_EMAIL_SENT', {
          recipient: cleanRecipient,
          registrationId,
          messageId: info?.messageId,
          port,
        });
      }
      return { success: true, messageId: info?.messageId, port };
    } catch (sendErr) {
      if (typeof logger.error === 'function') {
        logger.error('INVESTOR_MISSION_ACKNOWLEDGEMENT_EMAIL_FAILED', {
          recipient: cleanRecipient,
          registrationId,
          error: sendErr.message,
        });
      }
      throw sendErr;
    }
  }

  /**
   * Diagnostic verification of SMTP connection without sending email
   */
  async function verifyEmailService({ timeoutMs = 12000 } = {}) {
    const environment = process.env;
    let primaryConfig;
    try {
      primaryConfig = resolveTransportConfig(environment);
    } catch (cfgErr) {
      return {
        ok: false,
        success: false,
        code: cfgErr.code || 'EMAIL_CONFIG_INCOMPLETE',
        message: cfgErr.message,
        host: environment.SMTP_HOST || environment.EMAIL_HOST || 'smtp.hostinger.com',
        port: Number(environment.SMTP_PORT || environment.EMAIL_PORT) || 465,
      };
    }

    const testTransporter = createTransporter({
      ...primaryConfig,
      connectionTimeout: timeoutMs,
      greetingTimeout: timeoutMs,
      socketTimeout: timeoutMs + 3000,
    });

    const startTime = Date.now();
    try {
      await testTransporter.verify();
      const latencyMs = Date.now() - startTime;
      return {
        ok: true,
        success: true,
        provider: 'Hostinger SMTP (Nodemailer)',
        host: primaryConfig.host,
        port: primaryConfig.port,
        secure: primaryConfig.secure,
        authenticatedUser: primaryConfig.auth?.user,
        latencyMs,
        message: `SMTP connected successfully to ${primaryConfig.host}:${primaryConfig.port} in ${latencyMs}ms.`,
      };
    } catch (primaryErr) {
      const fallbackPort = primaryConfig.port === 465 ? 587 : (primaryConfig.port === 587 ? 465 : null);
      if (fallbackPort) {
        try {
          const fallbackConfig = resolveTransportConfig(environment, fallbackPort);
          const fallbackTransporter = createTransporter({
            ...fallbackConfig,
            connectionTimeout: timeoutMs,
            greetingTimeout: timeoutMs,
            socketTimeout: timeoutMs + 3000,
          });
          const fbStartTime = Date.now();
          await fallbackTransporter.verify();
          const fbLatency = Date.now() - fbStartTime;
          return {
            ok: true,
            success: true,
            provider: 'Hostinger SMTP (Nodemailer)',
            host: fallbackConfig.host,
            port: fallbackConfig.port,
            secure: fallbackConfig.secure,
            authenticatedUser: fallbackConfig.auth?.user,
            latencyMs: fbLatency,
            message: `SMTP connected on fallback port ${fallbackPort} in ${fbLatency}ms (primary port ${primaryConfig.port} failed: ${primaryErr.message}).`,
          };
        } catch (_) {}
      }

      const latencyMs = Date.now() - startTime;
      return {
        ok: false,
        success: false,
        provider: 'Hostinger SMTP (Nodemailer)',
        code: primaryErr.code || 'SMTP_VERIFY_FAILED',
        error: primaryErr.message,
        message: `SMTP verification failed on port ${primaryConfig.port}: ${primaryErr.message}`,
        host: primaryConfig.host,
        port: primaryConfig.port,
        secure: primaryConfig.secure,
        latencyMs,
      };
    }
  }

  return {
    sendInvestorMissionConfirmation,
    sendInvestorMissionReminder,
    sendInvestorMissionAcknowledgement,
    buildInvestorMissionConfirmationContent,
    buildInvestorMissionReminderContent,
    buildInvestorMissionAcknowledgementContent,
    generateQrBuffer,
    resolvePosterPath,
    verifyEmailService,
    resetTransporter,
  };
}

const defaultInvestorMissionEmailService = createInvestorMissionEmailService();

module.exports = defaultInvestorMissionEmailService;
module.exports.createInvestorMissionEmailService = createInvestorMissionEmailService;
module.exports.buildInvestorMissionConfirmationContent = buildInvestorMissionConfirmationContent;
module.exports.buildInvestorMissionReminderContent = buildInvestorMissionReminderContent;
module.exports.buildInvestorMissionAcknowledgementContent = buildInvestorMissionAcknowledgementContent;
module.exports.EMAIL_SUBJECT = EMAIL_SUBJECT;
module.exports.REMINDER_EMAIL_SUBJECT = REMINDER_EMAIL_SUBJECT;
module.exports.ACKNOWLEDGEMENT_EMAIL_SUBJECT = ACKNOWLEDGEMENT_EMAIL_SUBJECT;
module.exports.OFFICIAL_VENUE = OFFICIAL_VENUE;
