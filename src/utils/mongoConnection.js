/**
 * MongoDB Atlas Connection and Diagnostic Utilities
 *
 * Provides credential-safe URI masking, resilient Mongoose connection options,
 * and comprehensive error diagnostics for MongoDB Atlas clusters.
 */

/**
 * Redacts credentials (password) from a MongoDB URI so it is safe to log.
 * Never outputs credentials in logs or console output.
 *
 * @param {string} uri - The raw connection string
 * @returns {string} - Masked connection string (e.g. mongodb+srv://username:****@cluster/db)
 */
function maskMongoUri(uri) {
  if (!uri || typeof uri !== 'string') {
    return '<empty>';
  }
  return uri.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@');
}

/**
 * Returns resilient Mongoose connection options.
 * Increases serverSelectionTimeoutMS from 5s to 10s (or process.env.MONGODB_TIMEOUT_MS)
 * to prevent premature ReplicaSetNoPrimary errors on cloud Atlas clusters.
 *
 * @returns {object} Mongoose connection options
 */
function getMongoConnectionOptions() {
  const timeoutMs = parseInt(process.env.MONGODB_TIMEOUT_MS, 10);
  const serverSelectionTimeoutMS = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? timeoutMs
    : 10000;

  return {
    maxPoolSize: 10,
    minPoolSize: 2,
    serverSelectionTimeoutMS,
    socketTimeoutMS: 45000,
  };
}

/**
 * Diagnoses a MongoDB connection error and identifies the root cause
 * (e.g. Atlas IP whitelist restriction, DNS failure, auth error, or cluster sleep).
 *
 * @param {Error} err - The error thrown by mongoose.connect
 * @param {string} uri - The connection URI (will be masked)
 * @returns {object} Detailed diagnostic object with actionable remediation steps
 */
function diagnoseMongoError(err, uri) {
  const maskedUri = maskMongoUri(uri);
  const isServerSelectionError = err?.name === 'MongooseServerSelectionError';
  const topologyType = err?.reason?.type || 'Unknown';
  const servers = [];

  if (err?.reason?.servers && typeof err.reason.servers[Symbol.iterator] === 'function') {
    for (const [address, desc] of err.reason.servers) {
      const errMsg = desc?.error?.message || desc?.error?.code || 'No response / timed out';
      servers.push({
        address,
        type: desc?.type || 'Unknown',
        error: String(errMsg),
      });
    }
  }

  const errMessage = String(err?.message || '');
  const errCode = err?.code;

  let likelyCause = 'UNKNOWN';
  let summary = 'An unexpected error occurred while connecting to MongoDB.';
  let remediationSteps = [];

  // Check 1: DNS / SRV Resolution Failure
  if (
    errMessage.includes('querySrv ENOTFOUND') ||
    errMessage.includes('queryTxt ESERVFAIL') ||
    errMessage.includes('querySrv ESERVFAIL') ||
    errCode === 'ENOTFOUND'
  ) {
    likelyCause = 'DNS_LOOKUP_FAILURE';
    summary = 'DNS lookup failed for the MongoDB Atlas cluster SRV records.';
    remediationSteps = [
      'Verify your internet connection is active.',
      'Check if your local DNS server or ISP blocks DNS SRV/TXT records. Try switching DNS to Google (8.8.8.8) or Cloudflare (1.1.1.1).',
      'Verify the cluster hostname in MONGODB_URI is spelled correctly.',
    ];
  }
  // Check 2: Authentication Failure
  else if (
    errCode === 8000 ||
    errMessage.includes('AuthenticationFailed') ||
    errMessage.includes('bad auth') ||
    errMessage.includes('auth error')
  ) {
    likelyCause = 'AUTHENTICATION_FAILURE';
    summary = 'MongoDB Atlas authentication failed (invalid database username or password).';
    remediationSteps = [
      'Verify the database user in MongoDB Atlas (Database Access -> Database Users).',
      'Ensure the user has readWrite permissions on the target database.',
      'If the password contains special characters like @, :, /, ?, or #, URL-encode them.',
    ];
  }
  // Check 3: TLS / SSL Handshake Failure
  else if (
    errMessage.includes('CERT_') ||
    errMessage.includes('self signed certificate') ||
    errMessage.includes('UNABLE_TO_VERIFY_LEAF_SIGNATURE')
  ) {
    likelyCause = 'TLS_HANDSHAKE_FAILURE';
    summary = 'TLS / SSL handshake with MongoDB Atlas failed.';
    remediationSteps = [
      'Check if a corporate proxy, VPN, or antivirus is intercepting secure TLS connections.',
      'Ensure your system date and time are accurate.',
    ];
  }
  // Check 4: Atlas IP Access List / Whitelist restriction (ReplicaSetNoPrimary with timeouts)
  else if (
    topologyType === 'ReplicaSetNoPrimary' ||
    isServerSelectionError ||
    servers.some(s => s.error.includes('timed out') || s.error.includes('ETIMEDOUT') || s.error.includes('ECONNREFUSED'))
  ) {
    likelyCause = 'ATLAS_IP_RESTRICTION';
    summary = 'Could not reach the MongoDB Atlas cluster primary replica (ReplicaSetNoPrimary). This is almost always caused by MongoDB Atlas Network Access IP restrictions, a dynamic IP change, or outbound port 27017 blocking.';
    remediationSteps = [
      'Log in to MongoDB Atlas at https://cloud.mongodb.com',
      'Navigate to "Network Access" in the left sidebar menu under "Security".',
      'Click "+ Add IP Address".',
      'Click "Add Current IP Address" to whitelist your current public IP, or add "0.0.0.0/0" for universal development access.',
      'Wait 1 to 2 minutes for the Atlas firewall rules to apply (status will show "Active").',
      'If your cluster was paused (M0 Free Tier auto-sleep), click "Resume" in the Atlas Clusters dashboard.',
      'Verify that your local network or firewall does not block outbound TCP port 27017.',
    ];
  }

  return {
    isServerSelectionError,
    maskedUri,
    topologyType,
    servers,
    likelyCause,
    summary,
    remediationSteps,
  };
}

/**
 * Formats and prints a detailed, credential-safe MongoDB connection error report.
 *
 * @param {Error} err - The connection error
 * @param {string} uri - The connection URI
 */
function logMongoConnectionError(err, uri) {
  const diag = diagnoseMongoError(err, uri);

  console.error('\n================================================================================');
  console.error(' [MONGODB ATLAS CONNECTION ERROR]');
  console.error('================================================================================');
  console.error(`Target Cluster: ${diag.maskedUri}`);
  console.error(`Error Type:     ${err?.name || 'Error'} (${diag.topologyType})`);
  console.error(`Diagnosis:      ${diag.summary}`);

  if (diag.servers.length > 0) {
    console.error('\nReplica Node Status:');
    for (const s of diag.servers) {
      console.error(`  - ${s.address} (${s.type}): ${s.error}`);
    }
  }

  if (diag.remediationSteps.length > 0) {
    console.error('\nActionable Resolution Steps:');
    diag.remediationSteps.forEach((step, idx) => {
      console.error(`  ${idx + 1}. ${step}`);
    });
  }
  console.error('================================================================================\n');
}

/**
 * Attaches runtime lifecycle event listeners to the Mongoose connection.
 *
 * @param {import('mongoose')} mongooseInstance
 */
function setupMongoConnectionEvents(mongooseInstance) {
  if (!mongooseInstance?.connection) return;

  mongooseInstance.connection.on('disconnected', () => {
    console.warn('MongoDB disconnected. Attempting to reconnect...');
  });

  mongooseInstance.connection.on('reconnected', () => {
    console.log('MongoDB reconnected successfully.');
  });

  mongooseInstance.connection.on('error', (err) => {
    console.error('MongoDB runtime error:', err?.message || err);
  });
}

module.exports = {
  maskMongoUri,
  getMongoConnectionOptions,
  diagnoseMongoError,
  logMongoConnectionError,
  setupMongoConnectionEvents,
};
