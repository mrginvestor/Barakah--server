const crypto = require('crypto');
const SmallSummitRegistration = require('../models/SmallSummitRegistration');
const defaultEmailService = require('./investorMissionEmailService');

// Exponential backoff delays in milliseconds
const RETRY_BACKOFF_MS = [
  1 * 60 * 1000,   // Attempt 1: 1 minute
  5 * 60 * 1000,   // Attempt 2: 5 minutes
  15 * 60 * 1000,  // Attempt 3: 15 minutes
  60 * 60 * 1000,  // Attempt 4: 60 minutes
  120 * 60 * 1000, // Attempt 5: 120 minutes
];

const MAX_AUTO_ATTEMPTS = 5;
const LOCK_TIMEOUT_MS = 60 * 1000; // 1 minute concurrency lock

function calculateNextRetryAt(attemptNumber, now = new Date()) {
  const index = Math.min(Math.max(attemptNumber - 1, 0), RETRY_BACKOFF_MS.length - 1);
  const delayMs = RETRY_BACKOFF_MS[index];
  return new Date(now.getTime() + delayMs);
}

/**
 * Dispatches the Investor Mission 2026 Confirmation Email with check-in QR code.
 * Decoupled from payment approval; records persistent delivery state in MongoDB Atlas.
 */
async function dispatchConfirmationEmail(registrationId, {
  force = false,
  adminUser = null,
  model = SmallSummitRegistration,
  emailService = defaultEmailService,
  logger = console,
} = {}) {
  const cleanId = String(registrationId || '').trim();
  if (!cleanId) {
    return { success: false, error: 'Registration ID is required.' };
  }

  const registration = await model.findOne({ registrationId: cleanId });
  if (!registration) {
    return { success: false, notFound: true, error: `Registration ${cleanId} not found.` };
  }

  const isConfirmed =
    (registration.registrationApproved && registration.paymentApproved) ||
    (registration.registrationStatus === 'CONFIRMED' && registration.paymentStatus === 'PAID') ||
    (registration.status === 'Confirmed' && registration.paymentStatus === 'PAID') ||
    registration.status === 'Checked-In';

  if (!isConfirmed) {
    return {
      success: false,
      notConfirmed: true,
      error: `Registration ${cleanId} is not confirmed or payment is pending.`,
    };
  }

  // Duplicate protection: prevent resending if already SENT and not forced
  if (!force && (registration.confirmationEmailSent || registration.confirmationEmailStatus === 'SENT')) {
    return {
      success: true,
      alreadySent: true,
      emailStatus: 'SENT',
      message: `Confirmation email already sent to ${registration.email}.`,
      sentAt: registration.confirmationEmailSentAt,
      attempts: registration.confirmationEmailAttempts,
    };
  }

  // Concurrency lock check
  const now = new Date();
  if (!force && registration.confirmationEmailStatus === 'PENDING' && registration.confirmationEmailLockUntil && registration.confirmationEmailLockUntil > now) {
    return {
      success: false,
      inFlight: true,
      emailStatus: 'PENDING',
      message: `Email dispatch for ${cleanId} is currently in flight.`,
    };
  }

  // Acquire concurrency lock
  registration.confirmationEmailStatus = 'PENDING';
  registration.confirmationEmailLockUntil = new Date(now.getTime() + LOCK_TIMEOUT_MS);
  await registration.save().catch(e => logger.warn(`[RetryWorker] Lock save warning: ${e.message}`));

  // Generate check-in token if missing
  if (!registration.checkInTokenHash) {
    const rawToken = crypto.randomBytes(24).toString('hex');
    registration.checkInToken = rawToken;
    registration.checkInTokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    await registration.save().catch(e => logger.warn(`[RetryWorker] Token save warning: ${e.message}`));
  }

  const baseUrl = process.env.PUBLIC_APP_URL || process.env.BASE_URL || 'https://halalwealth.finance';
  const checkInUrl = `${baseUrl.replace(/\/$/, '')}/api/investor-mission/checkin/verify/${registration.checkInToken || registration.registrationId}`;

  const currentAttempts = (registration.confirmationEmailAttempts || 0) + 1;

  try {
    const result = await emailService.sendInvestorMissionConfirmation({
      recipientEmail: registration.email,
      participantName: registration.fullName || registration.name,
      registrationId: registration.registrationId,
      checkInUrl,
    });

    registration.confirmationEmailStatus = 'SENT';
    registration.confirmationEmailSent = true;
    registration.confirmationEmailSentAt = new Date();
    registration.confirmationEmailLastAttemptAt = new Date();
    registration.confirmationEmailLastError = null;
    registration.confirmationEmailNextRetryAt = null;
    registration.confirmationEmailLockUntil = null;
    registration.confirmationEmailAttempts = currentAttempts;
    await registration.save();

    if (typeof logger.info === 'function') {
      logger.info(`[RetryWorker] Confirmation email delivered to ${registration.email} for ${cleanId}`);
    }

    return {
      success: true,
      emailStatus: 'SENT',
      attempts: currentAttempts,
      messageId: result?.messageId,
      message: `Confirmation email with check-in QR code sent successfully to ${registration.email}.`,
    };
  } catch (sendErr) {
    const errMessage = String(sendErr.message || 'Email delivery failed').slice(0, 500);
    if (typeof logger.warn === 'function') {
      logger.warn(`[RetryWorker] Confirmation email delivery failed for ${cleanId} (attempt ${currentAttempts}): ${errMessage}`);
    }

    let nextRetryAt = null;
    if (currentAttempts < MAX_AUTO_ATTEMPTS) {
      nextRetryAt = calculateNextRetryAt(currentAttempts);
    }

    registration.confirmationEmailStatus = 'FAILED';
    registration.confirmationEmailSent = false;
    registration.confirmationEmailLastError = errMessage;
    registration.confirmationEmailLastAttemptAt = new Date();
    registration.confirmationEmailNextRetryAt = nextRetryAt;
    registration.confirmationEmailLockUntil = null;
    registration.confirmationEmailAttempts = currentAttempts;
    await registration.save().catch(e => logger.error(`[RetryWorker] Failed to save failure state: ${e.message}`));

    return {
      success: false,
      emailStatus: 'FAILED',
      attempts: currentAttempts,
      nextRetryAt,
      error: errMessage,
      message: `Failed to send confirmation email: ${errMessage}`,
    };
  }
}

/**
 * Scans MongoDB Atlas for confirmed registrations whose confirmation email is FAILED or PENDING,
 * and retries them if their nextRetryAt timer has elapsed.
 */
async function processPendingRetryQueue({
  model = SmallSummitRegistration,
  emailService = defaultEmailService,
  batchSize = 5,
  logger = console,
} = {}) {
  const now = new Date();

  const pendingRegistrations = await model.find({
    confirmationEmailSent: { $ne: true },
    confirmationEmailStatus: { $in: ['FAILED', 'PENDING'] },
    confirmationEmailAttempts: { $lt: MAX_AUTO_ATTEMPTS },
    $and: [
      {
        $or: [
          { confirmationEmailNextRetryAt: { $lte: now } },
          { confirmationEmailNextRetryAt: null, confirmationEmailAttempts: 0 },
        ],
      },
      {
        $or: [
          { confirmationEmailLockUntil: { $lt: now } },
          { confirmationEmailLockUntil: null },
          { confirmationEmailLockUntil: { $exists: false } },
        ],
      },
      {
        $or: [
          { registrationApproved: true, paymentApproved: true },
          { registrationStatus: 'CONFIRMED' },
          { status: 'Confirmed' },
          { status: 'Checked-In' },
        ],
      },
    ],
  })
    .select('registrationId email')
    .limit(batchSize)
    .lean();

  if (!pendingRegistrations.length) {
    return { processed: 0, successes: 0, failures: 0 };
  }

  if (typeof logger.info === 'function') {
    logger.info(`[RetryWorker] Found ${pendingRegistrations.length} pending Investor Mission confirmation emails to retry.`);
  }

  let successes = 0;
  let failures = 0;

  for (const reg of pendingRegistrations) {
    try {
      const res = await dispatchConfirmationEmail(reg.registrationId, {
        force: false,
        model,
        emailService,
        logger,
      });
      if (res.success) successes++;
      else failures++;
    } catch (e) {
      failures++;
      if (typeof logger.error === 'function') {
        logger.error(`[RetryWorker] Error retrying ${reg.registrationId}: ${e.message}`);
      }
    }
  }

  return { processed: pendingRegistrations.length, successes, failures };
}

let workerTimer = null;
let isRunning = false;

function startInvestorMissionRetryWorker({
  intervalMs = 60000,
  initialDelayMs = 10000,
  model = SmallSummitRegistration,
  emailService = defaultEmailService,
  logger = console,
} = {}) {
  if (workerTimer) {
    return;
  }

  const runTick = async () => {
    if (isRunning) return;
    isRunning = true;
    try {
      await processPendingRetryQueue({ model, emailService, logger });
    } catch (err) {
      if (typeof logger.warn === 'function') {
        logger.warn(`[RetryWorker] Tick error: ${err.message}`);
      }
    } finally {
      isRunning = false;
    }
  };

  const initialTimeout = setTimeout(() => {
    runTick().catch(() => {});
    workerTimer = setInterval(runTick, intervalMs);
    if (workerTimer && typeof workerTimer.unref === 'function') {
      workerTimer.unref();
    }
  }, initialDelayMs);

  if (initialTimeout && typeof initialTimeout.unref === 'function') {
    initialTimeout.unref();
  }
}

function stopInvestorMissionRetryWorker() {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
  }
  isRunning = false;
}

module.exports = {
  dispatchConfirmationEmail,
  processPendingRetryQueue,
  startInvestorMissionRetryWorker,
  stopInvestorMissionRetryWorker,
  calculateNextRetryAt,
  MAX_AUTO_ATTEMPTS,
  RETRY_BACKOFF_MS,
};
