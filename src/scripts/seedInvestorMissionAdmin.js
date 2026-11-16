const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../server/.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
require('dotenv').config();

const mongoose = require('mongoose');
const { bootstrapInvestorMissionAdmin } = require('../utils/bootstrapAdminAccounts');
const { getMongoConnectionOptions, maskMongoUri } = require('../utils/mongoConnection');

async function run() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('ERROR: MONGODB_URI is not set in environment or server/.env.');
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const forceUpdate = args.includes('--force') || args.includes('-f');
  const customPassword = args.find(arg => !arg.startsWith('-'));

  console.log('Connecting to MongoDB Atlas:', maskMongoUri(uri));
  await mongoose.connect(uri, getMongoConnectionOptions());
  console.log('Connected to MongoDB.');

  const result = await bootstrapInvestorMissionAdmin({
    customPassword,
    forceUpdate,
    logger: console,
  });

  console.log('\n--- Bootstrap Result ---');
  console.log('Username:     ', result.user.username);
  console.log('Display Name: ', result.user.displayName);
  console.log('Role:         ', result.user.role);
  console.log('Account State:', result.created ? 'CREATED NEW' : (result.updated ? 'UPDATED' : 'ALREADY EXISTS'));
  console.log('------------------------\n');

  await mongoose.disconnect();
  console.log('Disconnected from MongoDB.');
}

run().catch((err) => {
  console.error('Bootstrap failed:', err);
  process.exit(1);
});
