const crypto = require('crypto');
const BulkEmailJob = require('../models/BulkEmailJob');
const WebinarRegistration = require('../models/WebinarRegistration');
const defaultEmailService = require('./webinarEmailService');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isPermanentError(error) {
  if (!error) return false;
  const message = String(error.message || '').toLowerCase();
  const code = String(error.code || '').toLowerCase();
  const responseCode = Number(error.responseCode || error.status || 0);

  if (responseCode >= 500 && responseCode <= 599) return true;
  if (/550|501|553|5\.1\.1|5\.1\.2|invalid recipient|no such user|user unknown|mailbox unavailable|address rejected|recipient address rejected|recipient syntax/i.test(message)) {
    return true;
  }
  if (/invalid email|malformed email|syntax error/i.test(message)) {
    return true;
  }
  return false;
}

function createBulkEmailService({
  bulkJobModel = BulkEmailJob,
  registrationModel = WebinarRegistration,
  emailService = defaultEmailService,
  delayMs = null,
  maxRetries = 2,
  logger = console,
} = {}) {
  let activeJobId = null;
  const inFlightRecipients = new Set();
  const cancellationRequests = new Set();

  function getDelay() {
    if (delayMs !== null && delayMs !== undefined) return delayMs;
    const envDelay = Number(process.env.BULK_EMAIL_DELAY_MS);
    return Number.isFinite(envDelay) && envDelay >= 0 ? envDelay : 600;
  }

  function isJobActive() {
    return Boolean(activeJobId);
  }

  function getActiveJobId() {
    return activeJobId;
  }

  async function getActiveJob() {
    if (activeJobId) {
      const live = await bulkJobModel.findOne({ jobId: activeJobId });
      if (live) return live;
    }
    const running = await bulkJobModel.findOne({
      status: { $in: ['processing', 'queued'] },
    }).sort({ createdAt: -1 });

    if (running) {
      activeJobId = running.jobId;
      return running;
    }

    // Return the latest job created in the last 1 hour if any
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    return bulkJobModel.findOne({ createdAt: { $gte: oneHourAgo } }).sort({ createdAt: -1 });
  }

  async function getJobStatus(jobId) {
    if (!jobId) return null;
    return bulkJobModel.findOne({ jobId: String(jobId).trim() });
  }

  async function cancelJob(jobId) {
    const cleanId = String(jobId || '').trim();
    if (!cleanId) return false;
    cancellationRequests.add(cleanId);

    const job = await bulkJobModel.findOne({ jobId: cleanId });
    if (!job) return false;

    if (job.status === 'queued') {
      job.status = 'cancelled';
      job.completedAt = new Date();
      await job.save();
      if (activeJobId === cleanId) activeJobId = null;
      return true;
    }

    return true;
  }

  async function recoverStalledJobs() {
    try {
      const stalled = await bulkJobModel.find({
        status: { $in: ['queued', 'processing'] },
      });
      for (const job of stalled) {
        if (job.jobId !== activeJobId) {
          job.status = 'failed';
          job.errorMessage = 'Job was interrupted by a server restart. Processed recipients were recorded and will not be duplicated.';
          job.completedAt = new Date();
          await job.save();
        }
      }
    } catch (err) {
      logger.error?.('Error recovering stalled bulk email jobs:', err.message);
    }
  }

  async function sendSingleRecipientWithRetry(registration, { emailType = 'confirmation' } = {}) {
    let lastError = null;
    const maxAttempts = Math.max(1, maxRetries + 1);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        let result;
        if (emailType === 'confirmation') {
          result = await emailService.sendRegistrationConfirmation(registration.email, registration.fullName);
        } else {
          throw new Error(`Unsupported email type: ${emailType}`);
        }
        return { success: true, result, attempts: attempt, isPermanent: false };
      } catch (err) {
        lastError = err;
        const permanent = isPermanentError(err);
        if (permanent || attempt >= maxAttempts) {
          return {
            success: false,
            error: err,
            attempts: attempt,
            isPermanent: permanent,
          };
        }
        // Temporary error retry backoff
        await sleep(Math.min(3000, 1000 * attempt));
      }
    }

    return {
      success: false,
      error: lastError,
      attempts: maxAttempts,
      isPermanent: false,
    };
  }

  async function executeJobLoop(jobId, recipientIds, scope, includeSent) {
    activeJobId = jobId;
    const interMessageDelay = getDelay();

    try {
      await bulkJobModel.updateOne(
        { jobId },
        { $set: { status: 'processing', startedAt: new Date() } },
      );

      for (const rawId of recipientIds) {
        if (cancellationRequests.has(jobId)) {
          await bulkJobModel.updateOne(
            { jobId },
            { $set: { status: 'cancelled', completedAt: new Date() } },
          );
          cancellationRequests.delete(jobId);
          return;
        }

        const recipientIdStr = String(rawId);

        // Concurrency lock check per recipient
        if (inFlightRecipients.has(recipientIdStr)) {
          // If another operation is sending to this recipient right now, wait briefly or skip
          await sleep(500);
        }
        inFlightRecipients.add(recipientIdStr);

        try {
          // Re-fetch current state to guarantee fresh data
          const registration = await registrationModel.findById(rawId);
          if (!registration) {
            await bulkJobModel.updateOne(
              { jobId },
              {
                $inc: { processed: 1, failed: 1 },
                $push: {
                  processedRecipientIds: rawId,
                  failedRecipients: {
                    email: 'unknown',
                    registrationId: recipientIdStr,
                    reason: 'Registration record not found in database.',
                    timestamp: new Date(),
                  },
                },
              },
            );
            continue;
          }

          // Safe duplicate check
          const isAlreadySent = registration.confirmationEmailSent === true ||
            registration.emailStatus === 'accepted' ||
            registration.emailStatus === 'delivered';

          if (isAlreadySent && !includeSent && scope !== 'all') {
            await bulkJobModel.updateOne(
              { jobId },
              {
                $inc: { processed: 1, skipped: 1 },
                $push: { processedRecipientIds: rawId },
              },
            );
            continue;
          }

          // Skip permanently bounced addresses
          if (registration.emailStatus === 'bounced' && !includeSent) {
            await bulkJobModel.updateOne(
              { jobId },
              {
                $inc: { processed: 1, skipped: 1 },
                $push: { processedRecipientIds: rawId },
              },
            );
            continue;
          }

          // Perform send with retry
          const sendOutcome = await sendSingleRecipientWithRetry(registration, { emailType: 'confirmation' });

          if (sendOutcome.success) {
            const messageId = sendOutcome.result?.messageId || null;
            await registrationModel.updateOne(
              { _id: rawId },
              {
                $set: {
                  confirmationEmailSent: true,
                  confirmationEmailSentAt: new Date(),
                  confirmationEmailLastError: null,
                  emailStatus: 'accepted',
                  emailLastAttemptAt: new Date(),
                  emailLastError: null,
                  emailProvider: 'smtp',
                  ...(messageId ? { emailMessageId: messageId } : {}),
                },
                $inc: { emailAttemptCount: sendOutcome.attempts },
              },
            );

            await bulkJobModel.updateOne(
              { jobId },
              {
                $inc: { processed: 1, accepted: 1 },
                $push: { processedRecipientIds: rawId },
              },
            );
          } else {
            const errorMsg = sendOutcome.error?.message || 'SMTP delivery failed.';
            const finalStatus = sendOutcome.isPermanent ? 'bounced' : 'failed';

            await registrationModel.updateOne(
              { _id: rawId },
              {
                $set: {
                  confirmationEmailSent: false,
                  confirmationEmailLastError: String(errorMsg).slice(0, 500),
                  emailStatus: finalStatus,
                  emailLastAttemptAt: new Date(),
                  emailLastError: String(errorMsg).slice(0, 500),
                  emailProvider: 'smtp',
                },
                $inc: { emailAttemptCount: sendOutcome.attempts },
              },
            );

            await bulkJobModel.updateOne(
              { jobId },
              {
                $inc: { processed: 1, failed: 1 },
                $push: {
                  processedRecipientIds: rawId,
                  failedRecipients: {
                    email: registration.email || 'unknown',
                    registrationId: registration.registrationId || registration.referenceId || recipientIdStr,
                    reason: errorMsg,
                    timestamp: new Date(),
                  },
                },
              },
            );
          }
        } catch (itemErr) {
          logger.error?.('Error processing recipient in bulk loop:', itemErr.message);
          await bulkJobModel.updateOne(
            { jobId },
            {
              $inc: { processed: 1, failed: 1 },
              $push: {
                processedRecipientIds: rawId,
                failedRecipients: {
                  email: 'unknown',
                  registrationId: recipientIdStr,
                  reason: itemErr.message || 'Unexpected processing error.',
                  timestamp: new Date(),
                },
              },
            },
          );
        } finally {
          inFlightRecipients.delete(recipientIdStr);
        }

        // Delay between dispatches to adhere to Hostinger SMTP rate limits
        if (interMessageDelay > 0) {
          await sleep(interMessageDelay);
        }
      }

      await bulkJobModel.updateOne(
        { jobId },
        { $set: { status: 'completed', completedAt: new Date() } },
      );
    } catch (loopError) {
      logger.error?.('Bulk job execution encountered fatal error:', loopError);
      await bulkJobModel.updateOne(
        { jobId },
        {
          $set: {
            status: 'failed',
            errorMessage: loopError.message || 'Fatal error occurred during bulk processing.',
            completedAt: new Date(),
          },
        },
      );
    } finally {
      if (activeJobId === jobId) {
        activeJobId = null;
      }
      cancellationRequests.delete(jobId);
    }
  }

  async function startJob({
    webinarId = null,
    webinarVersion = null,
    scope = 'pending_failed',
    includeSent = false,
    forceBounced = false,
    createdBy = 'admin',
    recipientIds = null,
  } = {}) {
    if (activeJobId) {
      throw new Error(`A bulk email job is already running (${activeJobId}). Please wait for it to complete.`);
    }

    let finalRecipients = [];

    if (Array.isArray(recipientIds) && recipientIds.length > 0) {
      finalRecipients = recipientIds;
    } else {
      // Build webinar query
      const query = {};
      if (webinarId && webinarId !== 'all') {
        const cleanWid = String(webinarId).trim().toLowerCase();
        if (cleanWid === 'halal-wealth-nov-2026' || cleanWid.includes('november') || cleanWid === 'nov1') {
          query.$or = [
            { webinarId: 'halal-wealth-nov-2026' },
            { webinarVersion: 'November 1, 2026 Webinar' },
          ];
        } else if (cleanWid === 'halal-wealth-oct-2026' || cleanWid.includes('october') || cleanWid === 'previous') {
          query.$or = [
            { webinarId: 'halal-wealth-oct-2026' },
            { webinarVersion: 'October 2026 Webinar' },
          ];
        } else {
          query.webinarId = cleanWid;
        }
      } else if (webinarVersion) {
        query.webinarVersion = webinarVersion;
      }

      // Filter by scope
      if (scope === 'pending_failed' && !includeSent) {
        const statusConditions = [
          { confirmationEmailSent: { $ne: true } },
          { emailStatus: { $in: ['pending', 'failed', 'delivery_unknown', null] } },
        ];
        if (!forceBounced) {
          statusConditions.push({ emailStatus: { $ne: 'bounced' } });
        }
        query.$and = statusConditions;
      } else if (!forceBounced && !includeSent) {
        query.emailStatus = { $ne: 'bounced' };
      }

      const queryRes = registrationModel.find(query, { _id: 1, email: 1 });
      const docs = await (typeof queryRes?.sort === 'function' ? queryRes.sort({ createdAt: -1 }) : queryRes);
      finalRecipients = (docs || []).map(doc => doc._id);
    }

    if (!finalRecipients || finalRecipients.length === 0) {
      return {
        jobId: null,
        total: 0,
        status: 'completed',
        message: 'No eligible recipients found.',
      };
    }

    const jobId = `bulk_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    activeJobId = jobId;

    const newJob = new bulkJobModel({
      jobId,
      type: 'confirmation',
      webinarId: webinarId || null,
      webinarVersion: webinarVersion || null,
      scope: scope === 'all' ? 'all' : 'pending_failed',
      status: 'queued',
      total: finalRecipients.length,
      processed: 0,
      accepted: 0,
      failed: 0,
      skipped: 0,
      recipientIds: finalRecipients,
      processedRecipientIds: [],
      failedRecipients: [],
      createdBy,
    });

    try {
      await newJob.save();
    } catch (saveError) {
      activeJobId = null;
      throw saveError;
    }

    // Launch background loop non-blockingly
    setImmediate(() => {
      executeJobLoop(jobId, finalRecipients, scope, includeSent).catch(err => {
        logger.error?.('Unhandled rejection in executeJobLoop:', err);
      });
    });

    return {
      jobId,
      total: finalRecipients.length,
      status: 'queued',
      message: 'Bulk email job queued successfully.',
    };
  }

  return {
    isJobActive,
    getActiveJobId,
    getActiveJob,
    getJobStatus,
    cancelJob,
    recoverStalledJobs,
    startJob,
    sendSingleRecipientWithRetry,
    isPermanentError,
  };
}

const defaultBulkEmailService = createBulkEmailService();

module.exports = {
  createBulkEmailService,
  defaultBulkEmailService,
  isPermanentError,
  sleep,
};
