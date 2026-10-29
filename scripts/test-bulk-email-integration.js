/**
 * End-to-End Bulk Email Integration Test
 *
 * Verifies:
 * 1. Database models and connection
 * 2. Bulk preview calculations
 * 3. Concurrent job blocking (mutex lock)
 * 4. Safe skipping of already-sent recipients
 * 5. Actual SMTP delivery to designated test address (info@halalwealth.finance)
 * 6. Durability and tracking of BulkEmailJob counters
 * 7. Clean scrub of all test data
 */

const path = require('path');
const dotenv = require('dotenv');
const mongoose = require('mongoose');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const WebinarRegistration = require('../src/models/WebinarRegistration');
const BulkEmailJob = require('../src/models/BulkEmailJob');
const { createBulkEmailService } = require('../src/services/bulkEmailService');
const { verifyEmailService, createWebinarEmailService } = require('../src/services/webinarEmailService');

const TEST_DESIGNATED_EMAIL = 'info@halalwealth.finance';
const TEST_TAG = `test_bulk_${Date.now()}`;

async function run() {
  console.log('================================================================');
  console.log('       HALAL WEALTH WEBINAR — BULK EMAIL INTEGRATION TEST       ');
  console.log('================================================================');

  if (!process.env.MONGODB_URI) {
    console.error('ERROR: MONGODB_URI is not set.');
    process.exit(1);
  }

  console.log('Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('MongoDB connected.');

  console.log('\n[Step 1] Verifying Hostinger SMTP connectivity...');
  const smtpStatus = await verifyEmailService();
  console.log('SMTP Verify Result:', smtpStatus);
  if (!smtpStatus.success) {
    console.error('SMTP is not ready. Aborting real email dispatch test.');
    await mongoose.disconnect();
    process.exit(1);
  }

  // Track created IDs for cleanup
  const createdRegIds = [];
  const createdJobIds = [];

  try {
    console.log('\n[Step 2] Creating isolated test registrations...');

    // Recipient A: Already sent (must be skipped by default)
    const regAlreadySent = await WebinarRegistration.create({
      fullName: 'Test Already Sent Participant',
      email: `already_${TEST_TAG}@example.com`,
      whatsapp: '+919876543210',
      designation: 'Business Owner',
      financialInterests: ['Halal Stocks'],
      webinarId: TEST_TAG,
      webinarVersion: 'Test Webinar',
      confirmationEmailSent: true,
      emailStatus: 'accepted',
      emailAttemptCount: 1,
      referenceId: `HWS-TEST-${Date.now()}-A`,
    });
    createdRegIds.push(regAlreadySent._id);

    // Recipient B: Pending with designated real mailbox info@halalwealth.finance
    const regPending = await WebinarRegistration.create({
      fullName: 'Test Designated Recipient',
      email: TEST_DESIGNATED_EMAIL,
      whatsapp: '+919876543211',
      designation: 'Professional',
      financialInterests: ['Halal Mutual Funds'],
      webinarId: TEST_TAG,
      webinarVersion: 'Test Webinar',
      confirmationEmailSent: false,
      emailStatus: 'pending',
      emailAttemptCount: 0,
      referenceId: `HWS-TEST-${Date.now()}-B`,
    });
    createdRegIds.push(regPending._id);

    console.log(`Created 2 test registrations: ${regAlreadySent._id} (already sent) and ${regPending._id} (pending).`);

    console.log('\n[Step 3] Testing Bulk Email Service on small test batch...');
    const bulkService = createBulkEmailService({
      bulkJobModel: BulkEmailJob,
      registrationModel: WebinarRegistration,
      emailService: createWebinarEmailService(),
      delayMs: 200,
    });

    const startResult = await bulkService.startJob({
      recipientIds: [regAlreadySent._id, regPending._id],
      scope: 'pending_failed',
      createdBy: 'test_runner',
    });

    console.log('Bulk Job Started:', startResult);
    createdJobIds.push(startResult.jobId);

    // Verify immediate concurrent job rejection
    console.log('\n[Step 4] Verifying concurrency protection (must reject second job)...');
    try {
      await bulkService.startJob({
        recipientIds: [regPending._id],
        scope: 'pending_failed',
      });
      console.error('FAIL: Concurrency protection did not throw!');
      process.exit(1);
    } catch (err) {
      console.log('SUCCESS: Concurrency protection properly blocked second job:', err.message);
    }

    // Wait for the background loop to complete
    console.log('\n[Step 5] Waiting for background processing loop to complete...');
    let pollCount = 0;
    let finishedJob = null;

    while (pollCount < 30) {
      await new Promise(r => setTimeout(r, 1000));
      pollCount++;
      const job = await bulkService.getJobStatus(startResult.jobId);
      console.log(`  Poll #${pollCount}: Status = ${job.status}, Processed = ${job.processed}/${job.total} (Accepted: ${job.accepted}, Skipped: ${job.skipped}, Failed: ${job.failed})`);

      if (['completed', 'failed', 'cancelled'].includes(job.status)) {
        finishedJob = job;
        break;
      }
    }

    if (!finishedJob) {
      console.error('TIMEOUT waiting for bulk job to complete.');
      process.exit(1);
    }

    console.log('\n[Step 6] Verifying Results:');
    console.log(`  Job Status:   ${finishedJob.status}`);
    console.log(`  Total:        ${finishedJob.total}`);
    console.log(`  Processed:    ${finishedJob.processed}`);
    console.log(`  Skipped:      ${finishedJob.skipped}`);
    console.log(`  Accepted:     ${finishedJob.accepted}`);
    console.log(`  Failed:       ${finishedJob.failed}`);

    if (finishedJob.skipped !== 1) {
      throw new Error(`Expected exactly 1 skipped recipient, got ${finishedJob.skipped}`);
    }
    if (finishedJob.accepted !== 1) {
      throw new Error(`Expected exactly 1 accepted recipient, got ${finishedJob.accepted}`);
    }

    // Check database records
    const checkAlreadySent = await WebinarRegistration.findById(regAlreadySent._id);
    const checkPending = await WebinarRegistration.findById(regPending._id);

    console.log('\nRegistration verification:');
    console.log(`  Already-sent record status: ${checkAlreadySent.emailStatus}, attempts: ${checkAlreadySent.emailAttemptCount}`);
    console.log(`  Pending record updated status: ${checkPending.emailStatus}, attempts: ${checkPending.emailAttemptCount}, messageId: ${checkPending.emailMessageId}`);

    if (checkAlreadySent.emailAttemptCount !== 1) {
      throw new Error(`Already sent record attempt count changed unexpectedly! Expected 1, got ${checkAlreadySent.emailAttemptCount}`);
    }
    if (checkPending.emailStatus !== 'accepted' || !checkPending.confirmationEmailSent) {
      throw new Error(`Pending record was not marked accepted! Status: ${checkPending.emailStatus}`);
    }

    console.log('\n✅ ALL BULK EMAIL INTEGRATION CHECKS PASSED WITH HOSTINGER SMTP ACCEPTANCE!');

  } finally {
    console.log('\n[Cleanup] Scrubbing test records from MongoDB...');
    if (createdRegIds.length > 0) {
      const delReg = await WebinarRegistration.deleteMany({ _id: { $in: createdRegIds } });
      console.log(`Deleted ${delReg.deletedCount} test registrations.`);
    }
    if (createdJobIds.length > 0) {
      const delJobs = await BulkEmailJob.deleteMany({ jobId: { $in: createdJobIds } });
      console.log(`Deleted ${delJobs.deletedCount} test job documents.`);
    }
    await mongoose.disconnect();
    console.log('MongoDB disconnected cleanly.');
  }
}

run().catch(err => {
  console.error('Unhandled error in integration test:', err);
  process.exit(1);
});

