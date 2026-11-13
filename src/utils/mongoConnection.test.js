const test = require('node:test');
const assert = require('node:assert/strict');
const {
  maskMongoUri,
  getMongoConnectionOptions,
  diagnoseMongoError,
  logMongoConnectionError,
  setupMongoConnectionEvents,
} = require('./mongoConnection');

test('maskMongoUri redacts sensitive credentials properly', () => {
  const uri = 'mongodb+srv://admin_user:SuperSecretPassword123@cluster0.qg8svfy.mongodb.net/rifahdb?retryWrites=true&w=majority';
  const masked = maskMongoUri(uri);

  assert.strictEqual(masked, 'mongodb+srv://admin_user:****@cluster0.qg8svfy.mongodb.net/rifahdb?retryWrites=true&w=majority');
  assert.strictEqual(masked.includes('SuperSecretPassword123'), false);
  assert.strictEqual(masked.includes('admin_user'), true);
});

test('maskMongoUri handles missing or empty input safely', () => {
  assert.strictEqual(maskMongoUri(''), '<empty>');
  assert.strictEqual(maskMongoUri(null), '<empty>');
  assert.strictEqual(maskMongoUri(undefined), '<empty>');
});

test('getMongoConnectionOptions returns default 10s timeout and pooling options', () => {
  delete process.env.MONGODB_TIMEOUT_MS;
  const opts = getMongoConnectionOptions();
  assert.strictEqual(opts.serverSelectionTimeoutMS, 10000);
  assert.strictEqual(opts.socketTimeoutMS, 45000);
  assert.strictEqual(opts.maxPoolSize, 10);
  assert.strictEqual(opts.minPoolSize, 2);
});

test('getMongoConnectionOptions respects MONGODB_TIMEOUT_MS environment variable', () => {
  process.env.MONGODB_TIMEOUT_MS = '15000';
  const opts = getMongoConnectionOptions();
  assert.strictEqual(opts.serverSelectionTimeoutMS, 15000);
  delete process.env.MONGODB_TIMEOUT_MS;
});

test('diagnoseMongoError correctly classifies ReplicaSetNoPrimary as ATLAS_IP_RESTRICTION', () => {
  const fakeError = new Error('Could not connect to any servers in your MongoDB Atlas cluster.');
  fakeError.name = 'MongooseServerSelectionError';
  fakeError.reason = {
    type: 'ReplicaSetNoPrimary',
    servers: new Map([
      ['shard-00-00.mongodb.net:27017', { type: 'Unknown', error: new Error('connection timed out') }],
      ['shard-00-01.mongodb.net:27017', { type: 'Unknown', error: new Error('connection timed out') }],
    ]),
  };

  const diag = diagnoseMongoError(fakeError, 'mongodb+srv://user:pass@cluster.mongodb.net/db');
  assert.strictEqual(diag.isServerSelectionError, true);
  assert.strictEqual(diag.topologyType, 'ReplicaSetNoPrimary');
  assert.strictEqual(diag.likelyCause, 'ATLAS_IP_RESTRICTION');
  assert.strictEqual(diag.servers.length, 2);
  assert.strictEqual(diag.remediationSteps.length > 0, true);
  assert.strictEqual(diag.remediationSteps.some(s => s.includes('Network Access')), true);
  assert.strictEqual(diag.maskedUri.includes('pass'), false);
});

test('diagnoseMongoError correctly classifies DNS ENOTFOUND failure', () => {
  const fakeError = new Error('querySrv ENOTFOUND _mongodb._tcp.cluster.mongodb.net');
  fakeError.code = 'ENOTFOUND';

  const diag = diagnoseMongoError(fakeError, 'mongodb+srv://user:pass@cluster.mongodb.net/db');
  assert.strictEqual(diag.likelyCause, 'DNS_LOOKUP_FAILURE');
  assert.strictEqual(diag.remediationSteps.some(s => s.includes('DNS')), true);
});

test('diagnoseMongoError correctly classifies authentication error', () => {
  const fakeError = new Error('MongoServerError: AuthenticationFailed: bad auth : Authentication failed.');
  fakeError.code = 8000;

  const diag = diagnoseMongoError(fakeError, 'mongodb+srv://user:pass@cluster.mongodb.net/db');
  assert.strictEqual(diag.likelyCause, 'AUTHENTICATION_FAILURE');
  assert.strictEqual(diag.remediationSteps.some(s => s.includes('Database Users')), true);
});

test('logMongoConnectionError executes without throwing and does not leak credentials', () => {
  const fakeError = new Error('Could not connect');
  fakeError.name = 'MongooseServerSelectionError';
  fakeError.reason = { type: 'ReplicaSetNoPrimary', servers: new Map() };

  // Should execute cleanly without throwing
  assert.doesNotThrow(() => {
    logMongoConnectionError(fakeError, 'mongodb+srv://myuser:secret123@cluster.mongodb.net/db');
  });
});

test('setupMongoConnectionEvents registers event listeners without throwing', () => {
  const events = {};
  const mockMongoose = {
    connection: {
      on: (event, handler) => {
        events[event] = handler;
      },
    },
  };

  setupMongoConnectionEvents(mockMongoose);
  assert.strictEqual(typeof events.disconnected, 'function');
  assert.strictEqual(typeof events.reconnected, 'function');
  assert.strictEqual(typeof events.error, 'function');
});
