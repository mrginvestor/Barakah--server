const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const QRCode = require('qrcode');

const SENDER_EMAIL = 'info@halalwealth.finance';
const DEFAULT_FROM_NAME = 'Halal Wealth';
const POSTER_CID = 'investor-mission-poster';
const QR_CID = 'participant-checkin-qr';
const EMAIL_SUBJECT = 'Your Registration is Confirmed | Investor Mission 2026 – Halal Wealth';
const REMINDER_EMAIL_SUBJECT = 'Event Reminder: Investor Mission 2026 is Tomorrow | Halal Wealth';

const OFFICIAL_VENUE = {
  name: 'Siruthuli Noyyal Life Centre',
  address: 'Ukkadam Sungam Bypass Rd, Shanmuga Nagar, Ramanathapuram, Coimbatore, Tamil Nadu 641023, India.',
  googleMapsUrl: 'https://maps.google.com/?q=Siruthuli+Noyyal+Life+Centre,+Ukkadam+Sungam+Bypass+Rd,+Shanmuga+Nagar,+Ramanathapuram,+Coimbatore,+Tamil+Nadu+641023',
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

function resolveSenderConfig(environment = process.env) {
  const rawSender = readFirstDefined(environment, ['EMAIL_FROM', 'MAIL_FROM', 'SMTP_FROM']) || SENDER_EMAIL;
  const configuredName = readFirstDefined(environment, ['EMAIL_FROM_NAME', 'MAIL_FROM_NAME', 'SMTP_FROM_NAME']) || DEFAULT_FROM_NAME;
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
  const safeUrl = escapeHtml(checkInUrl || 'https://halalwealth.finance');

  const text = `Assalamu Alaikum ${participantName || 'Valued Participant'},

Alhamdulillah!

We are pleased to confirm that your registration for INVESTOR MISSION 2026 – THE HALAL WAY OF INVESTING has been successfully approved.

Your registration and payment have been verified.

We look forward to welcoming you to an educational gathering focused on Islamic finance, halal investing and responsible wealth creation.

YOUR EVENT DETAILS:
- Event: Investor Mission 2026
- Theme: The Halal Way of Investing
- Date: Sunday, 06 December 2026
- Venue Name: ${OFFICIAL_VENUE.name}
- Full Address: ${OFFICIAL_VENUE.address}
- Google Maps Directions: ${OFFICIAL_VENUE.googleMapsUrl}
- Speaker: Abdul Basith – Licensed Financial Consultant
- Registration Fee: ₹500 (Verified & Approved)
- Registration ID: ${registrationId}

YOUR PERSONAL EVENT CHECK-IN QR CODE:
Please present the QR code attached in this email at the event entrance for registration verification and attendance check-in.
Check-in verification link: ${checkInUrl}

IMPORTANT INSTRUCTIONS:
- Keep your confirmation email accessible on the day of the event.
- Present your personal QR code at the registration desk.
- Each QR code is valid for one participant only.
- Please do not share your personal check-in QR code with others.

We look forward to seeing you at Investor Mission 2026.

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
        <span style="display:inline-block;background-color:#80df35;color:#053726;font-size:11px;font-weight:800;letter-spacing:1.5px;padding:4px 12px;border-radius:20px;text-transform:uppercase;margin-bottom:12px;">Pass & Entrance Access</span>
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
                <p style="margin:0 0 6px;color:#80df35;font-size:11px;font-weight:800;letter-spacing:2px;text-transform:uppercase;">SIO Coimbatore &bull; Halal Wealth</p>
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
                  We are pleased to confirm that your registration for <strong>INVESTOR MISSION 2026 – THE HALAL WAY OF INVESTING</strong> has been successfully approved.
                </p>
                
                <div style="background-color:#f0fdf4;border-left:4px solid #16a34a;padding:14px 18px;margin:0 0 20px;border-radius:0 8px 8px 0;">
                  <p style="margin:0;color:#166534;font-size:14px;font-weight:600;">
                    ✓ Your registration and ₹500 payment have been verified.
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
                      <td style="padding:4px 0;color:#64748b;width:140px;font-weight:600;">Event:</td>
                      <td style="padding:4px 0;color:#053726;font-weight:700;">Investor Mission 2026</td>
                    </tr>
                    <tr>
                      <td style="padding:4px 0;color:#64748b;font-weight:600;">Theme:</td>
                      <td style="padding:4px 0;color:#1e293b;font-weight:600;">The Halal Way of Investing</td>
                    </tr>
                    <tr>
                      <td style="padding:4px 0;color:#64748b;font-weight:600;">Date:</td>
                      <td style="padding:4px 0;color:#053726;font-weight:700;">Sunday, 06 December 2026</td>
                    </tr>
                    <tr>
                      <td style="padding:6px 0;color:#64748b;width:140px;font-weight:600;vertical-align:top;">Venue Name:</td>
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
                      <td style="padding:4px 0;color:#64748b;font-weight:600;">Speaker:</td>
                      <td style="padding:4px 0;color:#1e293b;font-weight:600;">Abdul Basith – Licensed Financial Consultant</td>
                    </tr>
                    <tr>
                      <td style="padding:4px 0;color:#64748b;font-weight:600;">Registration Fee:</td>
                      <td style="padding:4px 0;color:#16a34a;font-weight:700;">₹500 (Verified &amp; Paid)</td>
                    </tr>
                    <tr>
                      <td style="padding:4px 0;color:#64748b;font-weight:600;">Registration ID:</td>
                      <td style="padding:4px 0;color:#053726;font-weight:800;font-size:15px;letter-spacing:0.5px;">${safeRegId}</td>
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

    const environment = process.env;
    const { fromName, fromAddress } = resolveSenderConfig(environment);

    const host = readFirstDefined(environment, ['MAIL_HOST', 'SMTP_HOST']);
    const port = Number(readFirstDefined(environment, ['MAIL_PORT', 'SMTP_PORT']) || '465');
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

    const transportConfig = {
      host,
      port,
      secure,
      requireTLS,
      family: 4,
      pool: true,
      maxConnections: 3,
      maxMessages: 100,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
      auth: { user: username, pass: password },
    };

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

    const transporter = getTransporter(transportConfig);
    const mailOptions = {
      from: `"${fromName}" <${fromAddress}>`,
      to: cleanRecipient,
      subject: messageContent.subject,
      text: messageContent.text,
      html: messageContent.html,
      attachments,
    };

    try {
      const info = await transporter.sendMail(mailOptions);
      logger.info('INVESTOR_MISSION_CONFIRMATION_EMAIL_SENT', {
        recipient: cleanRecipient,
        registrationId,
        messageId: info.messageId,
      });
      return { success: true, messageId: info.messageId };
    } catch (sendErr) {
      logger.error('INVESTOR_MISSION_CONFIRMATION_EMAIL_FAILED', {
        recipient: cleanRecipient,
        registrationId,
        error: sendErr.message,
      });
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

    const environment = process.env;
    const { fromName, fromAddress } = resolveSenderConfig(environment);

    const host = readFirstDefined(environment, ['MAIL_HOST', 'SMTP_HOST']);
    const port = Number(readFirstDefined(environment, ['MAIL_PORT', 'SMTP_PORT']) || '465');
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

    const transportConfig = {
      host,
      port,
      secure,
      requireTLS,
      family: 4,
      pool: true,
      maxConnections: 3,
      maxMessages: 100,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
      auth: { user: username, pass: password },
    };

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

    const transporter = getTransporter(transportConfig);
    const mailOptions = {
      from: `"${fromName}" <${fromAddress}>`,
      to: cleanRecipient,
      subject: messageContent.subject,
      text: messageContent.text,
      html: messageContent.html,
      attachments,
    };

    try {
      const info = await transporter.sendMail(mailOptions);
      logger.info('INVESTOR_MISSION_REMINDER_EMAIL_SENT', {
        recipient: cleanRecipient,
        registrationId,
        messageId: info.messageId,
      });
      return { success: true, messageId: info.messageId };
    } catch (sendErr) {
      logger.error('INVESTOR_MISSION_REMINDER_EMAIL_FAILED', {
        recipient: cleanRecipient,
        registrationId,
        error: sendErr.message,
      });
      throw sendErr;
    }
  }

  return {
    sendInvestorMissionConfirmation,
    sendInvestorMissionReminder,
    buildInvestorMissionConfirmationContent,
    buildInvestorMissionReminderContent,
    generateQrBuffer,
    resolvePosterPath,
    resetTransporter,
  };
}

const defaultInvestorMissionEmailService = createInvestorMissionEmailService();

module.exports = defaultInvestorMissionEmailService;
module.exports.createInvestorMissionEmailService = createInvestorMissionEmailService;
module.exports.buildInvestorMissionConfirmationContent = buildInvestorMissionConfirmationContent;
module.exports.buildInvestorMissionReminderContent = buildInvestorMissionReminderContent;
module.exports.EMAIL_SUBJECT = EMAIL_SUBJECT;
module.exports.REMINDER_EMAIL_SUBJECT = REMINDER_EMAIL_SUBJECT;
module.exports.OFFICIAL_VENUE = OFFICIAL_VENUE;
