require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const mongoose = require('mongoose');
const Webinar = require('../models/Webinar');
const WebinarRegistration = require('../models/WebinarRegistration');
const { buildRegistrationFilter, buildWebinarScope } = require('../controllers/adminRegistrationController');

async function runLiveVerification() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set in environment variables.');
    process.exit(1);
  }

  console.log('Connecting to MongoDB...');
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  console.log('Connected to MongoDB successfully.\n');

  try {
    // 1. Verify Webinar collection
    const webinars = await Webinar.find().sort({ dateIso: -1 }).lean();
    console.log(`Webinars found in database (${webinars.length}):`);
    webinars.forEach(w => {
      console.log(` - [${w.webinarId}] ${w.title} (${w.date}) | Status: ${w.status} | Current: ${w.isCurrent}`);
    });

    // 2. Verify total records & partitioned records
    const totalCount = await WebinarRegistration.countDocuments();
    const novFilter = buildRegistrationFilter({ webinarId: 'halal-wealth-nov-2026' });
    const octFilter = buildRegistrationFilter({ webinarId: 'halal-wealth-oct-2026' });

    const novCount = await WebinarRegistration.countDocuments(novFilter);
    const octCount = await WebinarRegistration.countDocuments(octFilter);

    console.log('\n--- Partitioning Verification ---');
    console.log(`Total registrations: ${totalCount} (Requirement: Exactly 206 preserved)`);
    console.log(`November 1 webinar registrations: ${novCount} (Requirement: 1)`);
    console.log(`October 18 webinar registrations: ${octCount} (Requirement: 205)`);

    if (totalCount !== 206) {
      throw new Error(`Data safety violation! Expected 206 total documents, got ${totalCount}`);
    }
    if (novCount !== 1) {
      throw new Error(`Unexpected November count! Expected 1 document, got ${novCount}`);
    }
    if (octCount !== 205) {
      throw new Error(`Unexpected October count! Expected 205 documents, got ${octCount}`);
    }

    // 3. Verify specific records
    const novUser = await WebinarRegistration.findOne({ webinarId: 'halal-wealth-nov-2026' }).lean();
    console.log('\n--- November 1 Participant Verification ---');
    console.log(`Name: ${novUser.fullName}`);
    console.log(`Email: ${novUser.email}`);
    console.log(`Registration ID: ${novUser.registrationId}`);
    console.log(`Webinar ID: ${novUser.webinarId}`);
    console.log(`Webinar Version: ${novUser.webinarVersion}`);

    const basith = await WebinarRegistration.findOne({ email: 'basith93@hotmail.com' }).lean();
    console.log('\n--- Historical Participant Verification (Abdul Basith) ---');
    console.log(`Name: ${basith.fullName}`);
    console.log(`Email: ${basith.email}`);
    console.log(`Registration ID: ${basith.registrationId}`);
    console.log(`Webinar ID: ${basith.webinarId}`);
    console.log(`Webinar Version: ${basith.webinarVersion}`);

    const sheik = await WebinarRegistration.findOne({ email: 'sheik@gmail.com' }).lean();
    console.log('\n--- Historical Participant Verification (Sheik) ---');
    console.log(`Name: ${sheik.fullName}`);
    console.log(`Email: ${sheik.email}`);
    console.log(`Registration ID: ${sheik.registrationId}`);
    console.log(`Webinar ID: ${sheik.webinarId}`);
    console.log(`Webinar Version: ${sheik.webinarVersion}`);

    console.log('\n>>> LIVE VERIFICATION COMPLETED WITH ZERO DATA LOSS AND 100% SUCCESS! <<<');
  } catch (error) {
    console.error('Live verification failed:', error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    console.log('MongoDB connection closed.');
  }
}

runLiveVerification();

