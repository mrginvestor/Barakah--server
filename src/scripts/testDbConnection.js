/**
 * MongoDB Atlas Connection Test & Diagnostic Script
 *
 * Verifies DNS resolution, TLS handshake, replica set discovery,
 * and database authentication without modifying any data.
 *
 * Usage:
 *   node src/scripts/testDbConnection.js
 *   or from project root:
 *   node server/src/scripts/testDbConnection.js
 */

const path = require('path');
const dns = require('dns').promises;

// Load environment variables reliably regardless of working directory
require('dotenv').config({ path: path.resolve(__dirname, '../../../server/.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
require('dotenv').config();

const mongoose = require('mongoose');
const {
  maskMongoUri,
  getMongoConnectionOptions,
  logMongoConnectionError,
} = require('../utils/mongoConnection');

async function testConnection() {
  const uri = process.env.MONGODB_URI;

  console.log('================================================================================');
  console.log(' MONGODB ATLAS CONNECTION DIAGNOSTIC TOOL');
  console.log('================================================================================');

  if (!uri) {
    console.error('ERROR: MONGODB_URI is not defined in your environment or server/.env file.');
    process.exit(1);
  }

  const maskedUri = maskMongoUri(uri);
  console.log(`Connection URI:  ${maskedUri}`);

  // Extract cluster hostname
  const isSrv = uri.startsWith('mongodb+srv://');
  console.log(`SRV Protocol:    ${isSrv ? 'Yes (mongodb+srv://)' : 'No (mongodb://)'}`);

  const match = uri.match(/@([^/?]+)/);
  const clusterHost = match ? match[1] : null;

  if (clusterHost && isSrv) {
    console.log(`Cluster Host:    ${clusterHost}`);
    console.log('\n[1/3] Testing DNS SRV & TXT records...');
    try {
      const srvRecords = await dns.resolveSrv(`_mongodb._tcp.${clusterHost}`);
      console.log(`  ✓ DNS SRV resolution succeeded (${srvRecords.length} replica nodes found):`);
      for (const rec of srvRecords) {
        console.log(`    - ${rec.name}:${rec.port} (priority: ${rec.priority}, weight: ${rec.weight})`);
      }
    } catch (err) {
      console.error(`  ✗ DNS SRV resolution failed: ${err.code} (${err.message})`);
      console.error('    Check your DNS provider or internet connection. Try using 8.8.8.8 / 1.1.1.1.');
    }

    try {
      const txtRecords = await dns.resolveTxt(clusterHost);
      console.log(`  ✓ DNS TXT record resolved: ${txtRecords.flat().join(' ')}`);
    } catch (err) {
      console.warn(`  ! DNS TXT resolution notice: ${err.code} (${err.message})`);
    }
  }

  console.log('\n[2/3] Connecting to MongoDB Atlas via Mongoose...');
  const options = getMongoConnectionOptions();
  console.log(`  Timeout configured: ${options.serverSelectionTimeoutMS}ms`);

  const startTime = Date.now();
  try {
    await mongoose.connect(uri, options);
    const elapsed = Date.now() - startTime;
    console.log(`  ✓ Connected to MongoDB Atlas successfully in ${elapsed}ms!`);

    console.log('\n[3/3] Testing database ping & read capability...');
    const adminDb = mongoose.connection.db.admin();
    const pingResult = await adminDb.ping();
    console.log(`  ✓ Database ping returned:`, pingResult);

    const dbName = mongoose.connection.name;
    console.log(`  ✓ Active Database: ${dbName}`);

    // List collections to verify read access without modifying any records
    const collections = await mongoose.connection.db.listCollections().toArray();
    console.log(`  ✓ Collections found (${collections.length}): ${collections.map(c => c.name).join(', ')}`);

    console.log('\n================================================================================');
    console.log(' ALL DATABASE CHECKS PASSED SUCCESSFULLY!');
    console.log(' Your backend can connect to MongoDB Atlas without issues.');
    console.log('================================================================================\n');

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    const elapsed = Date.now() - startTime;
    console.error(`\nConnection attempt failed after ${elapsed}ms.`);
    logMongoConnectionError(err, uri);
    process.exit(1);
  }
}

testConnection();
