/**
 * Halal Wealth Summit / Webinar — Email Service Diagnostic Tool
 *
 * Verifies email service configuration (Hostinger SMTP or Resend HTTP API),
 * tests connection/authentication, and optionally submits a controlled test email.
 *
 * Usage:
 *   node server/scripts/test-email-diagnostic.js
 *   node server/scripts/test-email-diagnostic.js --send test@example.com
 */

const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config();

const { verifyEmailService, createWebinarEmailService } = require('../src/services/webinarEmailService');

function maskSecret(val) {
  if (!val) return '[NOT CONFIGURED]';
  const str = String(val).trim();
  if (str.length <= 4) return '****';
  return `[CONFIGURED: ${str.slice(0, 2)}...${str.slice(-2)}, length ${str.length}]`;
}

function maskEmail(email) {
  if (!email) return '[NOT CONFIGURED]';
  return email.replace(/(.{2})(.*)(@.*)/, '$1***$3');
}

async function runDiagnostic() {
  console.log('================================================================');
  console.log('    HALAL WEALTH WEBINAR — EMAIL SERVICE DIAGNOSTIC TOOL       ');
  console.log('================================================================');
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`Node.js: ${process.version}`);
  console.log(`Platform: ${process.platform}`);
  console.log(`Hosting Environment: ${process.env.RENDER ? 'Render (RENDER=true detected)' : 'Local / Non-Render'}`);
  console.log('----------------------------------------------------------------');

  // 1. Audit Environment Variables (without exposing secrets)
  console.log('\n[1/3] Auditing Email Environment Variables...');
  const resendApiKey = process.env.RESEND_API_KEY;
  const smtpHost = process.env.SMTP_HOST || process.env.MAIL_HOST;
  const smtpPort = process.env.SMTP_PORT || process.env.MAIL_PORT;
  const smtpSecure = process.env.SMTP_SECURE || process.env.MAIL_SECURE;
  const smtpUser = process.env.SMTP_USER || process.env.MAIL_USERNAME || process.env.MAIL_USER;
  const smtpPass = process.env.SMTP_PASS || process.env.MAIL_PASSWORD || process.env.MAIL_PASS;
  const mailFrom = process.env.RESEND_FROM || process.env.MAIL_FROM || process.env.SMTP_FROM || 'info@halalwealth.finance';
  const mailFromName = process.env.RESEND_FROM_NAME || process.env.MAIL_FROM_NAME || 'Halal Wealth Webinar';

  console.log(`  RESEND_API_KEY:       ${maskSecret(resendApiKey)}`);
  console.log(`  SMTP_HOST:            ${smtpHost || '[NOT CONFIGURED]'}`);
  console.log(`  SMTP_PORT:            ${smtpPort || '[DEFAULT: 465]'}`);
  console.log(`  SMTP_SECURE:          ${smtpSecure || '[DEFAULT: true]'}`);
  console.log(`  SMTP_USER:            ${maskEmail(smtpUser)}`);
  console.log(`  SMTP_PASS:            ${maskSecret(smtpPass)}`);
  console.log(`  MAIL_FROM:            ${mailFrom}`);
  console.log(`  MAIL_FROM_NAME:       ${mailFromName}`);

  const activeProvider = (resendApiKey && !/^(REPLACE|YOUR|<)/i.test(resendApiKey))
    ? 'Resend HTTP API (HTTPS port 443)'
    : 'Hostinger SMTP (Nodemailer)';
  console.log(`\n  Active Provider Selected: ${activeProvider}`);

  // 2. Connectivity & Authentication Verification
  console.log('\n[2/3] Testing Connection & Authentication...');
  const diagnostic = await verifyEmailService({ timeoutMs: 10000 });

  if (diagnostic.ok) {
    console.log('  STATUS: SUCCESS');
    console.log(`  Provider:     ${diagnostic.provider}`);
    console.log(`  Transport:    ${diagnostic.transport || 'N/A'}`);
    console.log(`  Host:         ${diagnostic.host || 'N/A'}`);
    console.log(`  Port:         ${diagnostic.port || 'N/A'}`);
    console.log(`  Sender:       ${diagnostic.fromAddress}`);
    console.log(`  Latency:      ${diagnostic.latencyMs} ms`);
  } else {
    console.error('  STATUS: FAILED');
    console.error(`  Provider:       ${diagnostic.provider}`);
    console.error(`  Error Code:     ${diagnostic.code}`);
    console.error(`  Category:       ${diagnostic.errorCategory}`);
    console.error(`  Message:        ${diagnostic.errorMessage}`);
    if (diagnostic.host) console.error(`  Host/Port:      ${diagnostic.host}:${diagnostic.port}`);

    if (diagnostic.code === 'RENDER_FREE_PORT_BLOCKED' || process.env.RENDER) {
      console.error('\n  [ACTION REQUIRED FOR RENDER]:');
      console.error('  Render Free blocks outbound TCP on ports 25, 465, and 587.');
      console.error('  To fix: Set RESEND_API_KEY in Render dashboard environment variables for HTTPS port 443 delivery.');
    }
  }

  // 3. Optional Controlled Test Email Submission
  const args = process.argv.slice(2);
  let targetEmail = null;
  const sendFlagIndex = args.indexOf('--send');
  if (sendFlagIndex !== -1 && args[sendFlagIndex + 1]) {
    targetEmail = args[sendFlagIndex + 1].trim();
  }

  if (targetEmail) {
    console.log(`\n[3/3] Sending Controlled Test Email to: ${maskEmail(targetEmail)}...`);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail)) {
      console.error('  ERROR: Invalid recipient email address.');
      process.exit(1);
    }

    try {
      const emailService = createWebinarEmailService();
      const testResult = await emailService.sendCustomEmail(targetEmail, {
        subject: `[Diagnostic] Halal Wealth Webinar SMTP Test - ${new Date().toISOString()}`,
        message: 'This is a controlled diagnostic test verifying email delivery from Halal Wealth Webinar.',
        recipientName: 'Administrator / Tester',
      });

      console.log('  TEST EMAIL ACCEPTED FOR TRANSMISSION:');
      console.log(`  Message ID:   ${testResult.messageId || testResult.id || 'N/A'}`);
      console.log(`  Response:     ${testResult.response || 'Accepted by provider'}`);
      console.log(`  Accepted:     ${JSON.stringify(testResult.accepted || [targetEmail])}`);
      console.log('  NOTE: Message accepted by mail server for queuing. Delivery to inbox depends on recipient MTA.');
    } catch (testError) {
      console.error('  TEST EMAIL FAILED:');
      console.error(`  Error Code:   ${testError.code || 'UNKNOWN'}`);
      console.error(`  Message:      ${testError.message}`);
      process.exit(1);
    }
  } else {
    console.log('\n[3/3] Test Email: Skipped (run with "--send <email>" to test dispatch to a specific inbox).');
  }

  console.log('\n================================================================');
  console.log(diagnostic.ok ? '    DIAGNOSTIC COMPLETED: SERVICE OPERATIONAL                   ' : '    DIAGNOSTIC COMPLETED: ISSUES DETECTED                      ');
  console.log('================================================================\n');

  if (!diagnostic.ok) {
    process.exit(1);
  }
}

runDiagnostic().catch(err => {
  console.error('Unexpected diagnostic error:', err);
  process.exit(1);
});

