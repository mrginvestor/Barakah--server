/**
 * Halal Wealth Summit / Webinar — Email Service Diagnostic Tool
 *
 * Verifies email service configuration (Hostinger SMTP via Nodemailer),
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

const args = process.argv.slice(2);

const { verifyEmailService, createWebinarEmailService, resolveSenderConfig, resolveProviderConfig } = require('../src/services/webinarEmailService');

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
  console.log('----------------------------------------------------------------');

  // 1. Audit Environment Variables (without exposing secrets)
  console.log('\n[1/3] Auditing Email Environment Variables...');
  const emailProvider = process.env.EMAIL_PROVIDER || 'smtp';
  const senderConfig = resolveSenderConfig(process.env);
  const providerConfig = resolveProviderConfig(process.env);

  const smtpHost = process.env.SMTP_HOST || process.env.MAIL_HOST;
  const smtpPort = process.env.SMTP_PORT || process.env.MAIL_PORT;
  const smtpSecure = process.env.SMTP_SECURE || process.env.MAIL_SECURE;
  const smtpUser = process.env.SMTP_USER || process.env.MAIL_USERNAME || process.env.MAIL_USER;
  const smtpPass = process.env.SMTP_PASS || process.env.MAIL_PASSWORD || process.env.MAIL_PASS;

  console.log(`  EMAIL_PROVIDER:       ${emailProvider} (Resolved: ${providerConfig.provider})`);
  console.log(`  EMAIL_FROM:           ${senderConfig.fromAddress}`);
  console.log(`  EMAIL_FROM_NAME:      ${senderConfig.fromName}`);
  console.log(`  EMAIL_REPLY_TO:       ${senderConfig.replyToAddress}`);
  console.log(`  SMTP_HOST:            ${smtpHost || '[NOT CONFIGURED]'}`);
  console.log(`  SMTP_PORT:            ${smtpPort || '[DEFAULT: 465]'}`);
  console.log(`  SMTP_SECURE:          ${smtpSecure || '[DEFAULT: true]'}`);
  console.log(`  SMTP_USER:            ${maskEmail(smtpUser)}`);
  console.log(`  SMTP_PASS:            ${maskSecret(smtpPass)}`);
  console.log('\n  Active Provider Selected: Hostinger SMTP (Nodemailer)');

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
    console.error(`  Provider:         ${diagnostic.provider}`);
    console.error(`  Error Code:       ${diagnostic.code}`);
    console.error(`  Category:         ${diagnostic.errorCategory}`);
    if (diagnostic.timeoutCategory) {
      console.error(`  Timeout Category: ${diagnostic.timeoutCategory}`);
    }
    if (diagnostic.host) {
      console.error(`  Host/Port:        ${diagnostic.host}:${diagnostic.port} (${diagnostic.secure ? 'secure: true, implicit TLS' : 'secure: false, STARTTLS'})`);
    }
    console.error(`  Message:          ${diagnostic.errorMessage}`);
  }

  // 3. Optional Controlled Test Email Submission
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
        subject: `[Diagnostic] Halal Wealth Webinar Test - ${new Date().toISOString()}`,
        message: 'This is a controlled diagnostic test verifying email delivery from Halal Wealth Webinar via Hostinger SMTP.',
        recipientName: 'Administrator / Tester',
      });

      console.log('  TEST EMAIL ACCEPTED FOR TRANSMISSION:');
      console.log(`  Message ID:   ${testResult.messageId || testResult.id || 'N/A'}`);
      console.log(`  Response:     ${testResult.response || 'Accepted by provider'}`);
      console.log(`  Accepted:     ${JSON.stringify(testResult.accepted || [targetEmail])}`);
      console.log('  NOTE: Message accepted by mail server for queuing.');
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

