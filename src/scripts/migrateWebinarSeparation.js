require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const mongoose = require('mongoose');
const Webinar = require('../models/Webinar');
const WebinarRegistration = require('../models/WebinarRegistration');

async function migrate() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set in environment variables.');
    process.exit(1);
  }

  console.log('Connecting to MongoDB...');
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10000,
  });
  console.log('Connected to MongoDB successfully.');

  try {
    // 1. Seed or update Webinar metadata records
    console.log('Upserting Webinar metadata...');
    await Webinar.findOneAndUpdate(
      { webinarId: 'halal-wealth-nov-2026' },
      {
        $set: {
          webinarId: 'halal-wealth-nov-2026',
          title: 'Halal Wealth Webinar',
          topic: 'Halal Trade, Investments & Generational Wealth',
          date: 'Sunday, November 1, 2026',
          dateIso: new Date('2026-11-01T05:30:00.000Z'),
          time: '11:00 AM IST | 1:30 PM SGT | 9:30 AM GST | 8:30 AM AST',
          status: 'Upcoming',
          isCurrent: true,
          description: 'Live interactive webinar on Halal trade, investments, and generational wealth.',
          isRegistrationClosed: false,
        },
      },
      { upsert: true, new: true },
    );

    await Webinar.findOneAndUpdate(
      { webinarId: 'halal-wealth-oct-2026' },
      {
        $set: {
          webinarId: 'halal-wealth-oct-2026',
          title: 'Halal Wealth Webinar',
          topic: 'Halal Trade, Investments & Generational Wealth',
          date: 'Sunday, October 18, 2026',
          dateIso: new Date('2026-10-18T05:30:00.000Z'),
          time: '11:00 AM IST | 1:30 PM SGT | 9:30 AM GST | 8:30 AM AST',
          status: 'Completed',
          isCurrent: false,
          description: 'Previous inaugural webinar held on October 18, 2026.',
          isRegistrationClosed: true,
        },
      },
      { upsert: true, new: true },
    );
    console.log('Webinar metadata records upserted successfully.');

    // 2. Inspect current registrations
    const totalCount = await WebinarRegistration.countDocuments();
    console.log(`Current total registrations in database: ${totalCount}`);

    // Update November 1 registrations
    const nov1Result = await WebinarRegistration.updateMany(
      {
        $or: [
          { webinarVersion: 'November 1, 2026 Webinar' },
          { webinarId: 'halal-wealth-nov-2026' },
        ],
      },
      {
        $set: {
          webinarId: 'halal-wealth-nov-2026',
          webinarVersion: 'November 1, 2026 Webinar',
        },
      },
    );
    console.log(`Updated November 1 registrations: matched ${nov1Result.matchedCount}, modified ${nov1Result.modifiedCount}`);

    // Update October 18 historical registrations
    const oct18Result = await WebinarRegistration.updateMany(
      {
        $or: [
          { webinarId: 'halal-wealth-oct-2026' },
          { webinarId: { $in: [null, undefined, ''] } },
          { webinarVersion: { $nin: ['November 1, 2026 Webinar'] } },
        ],
        webinarId: { $ne: 'halal-wealth-nov-2026' },
      },
      {
        $set: {
          webinarId: 'halal-wealth-oct-2026',
          webinarVersion: 'October 2026 Webinar',
        },
      },
    );
    console.log(`Updated October 18 registrations: matched ${oct18Result.matchedCount}, modified ${oct18Result.modifiedCount}`);

    // 3. Verify counts
    const afterTotal = await WebinarRegistration.countDocuments();
    const novCount = await WebinarRegistration.countDocuments({ webinarId: 'halal-wealth-nov-2026' });
    const octCount = await WebinarRegistration.countDocuments({ webinarId: 'halal-wealth-oct-2026' });

    console.log('--- Migration Verification ---');
    console.log(`Total records: ${afterTotal} (Must match pre-migration: ${totalCount})`);
    console.log(`November 1 records: ${novCount}`);
    console.log(`October 18 records: ${octCount}`);

    if (novCount + octCount !== afterTotal) {
      console.warn(`WARNING: Some records do not have either webinarId! (Total: ${afterTotal}, Sum: ${novCount + octCount})`);
    } else {
      console.log('Verification SUCCESS: All records partitioned accurately without any data loss!');
    }
  } catch (error) {
    console.error('Migration failed:', error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    console.log('MongoDB disconnected.');
  }
}

migrate();

