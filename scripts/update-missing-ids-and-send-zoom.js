require('dotenv').config();
const mongoose = require('mongoose');
const webinarEmailService = require('../src/services/webinarEmailService');

async function executeTargetedUpdateAndEmail() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI environment variable is missing.');
  }

  console.log('Connecting to MongoDB...');
  await mongoose.connect(uri);
  const coll = mongoose.connection.collection('webinarregistrations');

  const targets = [
    {
      expectedEmail: 'basith93@hotmail.com',
      expectedName: 'Abdul Basith',
      idOid: '6aba85a0e8ef0b869a7836e0',
      assignedRegistrationId: '6aba85a0e8ef0b869a7836e0',
    },
    {
      expectedEmail: 'sheik@gmail.com',
      expectedName: 'Sheik',
      idOid: '6aba4479f71b4a5917f60894',
      assignedRegistrationId: '6aba4479f71b4a5917f60894',
    },
  ];

  const results = [];

  for (const target of targets) {
    console.log(`\n==================================================`);
    console.log(`Processing: ${target.expectedName} (${target.expectedEmail})`);

    // 1. Locate existing document by exact _id subdocument or email
    const existing = await coll.findOne({
      $or: [
        { _id: { oid: target.idOid } },
        { _id: target.idOid },
        { email: target.expectedEmail },
      ],
    });

    if (!existing) {
      console.error(`ERROR: Record not found for ${target.expectedEmail}`);
      results.push({
        fullName: target.expectedName,
        email: target.expectedEmail,
        status: 'RECORD_NOT_FOUND',
      });
      continue;
    }

    console.log('Current document found:');
    console.log('  _id:', JSON.stringify(existing._id));
    console.log('  fullName:', existing.fullName);
    console.log('  email:', existing.email);
    console.log('  current registrationId:', existing.registrationId || '— (MISSING)');

    // 2. Prepare safe updates
    const updateFields = {
      registrationId: target.assignedRegistrationId,
    };

    // If createdAt is a subdocument { date: '...' }, normalize to Date
    if (existing.createdAt && typeof existing.createdAt === 'object' && existing.createdAt.date) {
      updateFields.createdAt = new Date(existing.createdAt.date);
    }
    // If updatedAt is a subdocument { date: '...' }, normalize to Date
    if (existing.updatedAt && typeof existing.updatedAt === 'object' && existing.updatedAt.date) {
      updateFields.updatedAt = new Date(existing.updatedAt.date);
    } else {
      updateFields.updatedAt = new Date();
    }

    // 3. Execute update using exact existing _id
    const updateFilter = { _id: existing._id };
    const updateOp = await coll.updateOne(updateFilter, { $set: updateFields });
    console.log(`MongoDB update completed: matched=${updateOp.matchedCount}, modified=${updateOp.modifiedCount}`);

    // 4. Send official Zoom joining email
    let emailStatus = 'NOT_SENT';
    let emailError = null;

    try {
      console.log(`Sending Zoom joining link to ${existing.email}...`);
      const emailResult = await webinarEmailService.sendZoomJoiningLink(existing.email, existing.fullName);
      emailStatus = 'SENT';
      console.log(`Zoom joining link accepted by SMTP for ${existing.email}. Message ID:`, emailResult?.messageId);

      // Record successful delivery in database
      await coll.updateOne(updateFilter, {
        $set: {
          joiningEmailSent: true,
          joiningEmailSentAt: new Date(),
          joiningEmailLastError: null,
        },
      });
    } catch (err) {
      emailStatus = 'FAILED';
      emailError = err.message || 'Email delivery failed';
      console.error(`Zoom joining link email failed for ${existing.email}:`, emailError);

      // Record error in database
      await coll.updateOne(updateFilter, {
        $set: {
          joiningEmailSent: false,
          joiningEmailLastError: String(emailError).slice(0, 500),
        },
      });
    }

    // 5. Fetch refreshed document
    const refreshed = await coll.findOne(updateFilter);

    results.push({
      fullName: refreshed.fullName,
      email: refreshed.email,
      location: refreshed.location,
      previousRegistrationId: existing.registrationId || '—',
      assignedRegistrationId: refreshed.registrationId,
      displayId: refreshed.registrationId.slice(-8).toUpperCase(),
      emailDeliveryStatus: emailStatus,
      emailError: emailError || null,
      joiningEmailSent: refreshed.joiningEmailSent,
      joiningEmailSentAt: refreshed.joiningEmailSentAt,
    });
  }

  await mongoose.disconnect();
  console.log('\n==================================================');
  console.log('FINAL EXECUTION SUMMARY:');
  console.log(JSON.stringify(results, null, 2));
  return results;
}

if (require.main === module) {
  executeTargetedUpdateAndEmail()
    .then(() => {
      console.log('Script completed successfully.');
      process.exit(0);
    })
    .catch(err => {
      console.error('Fatal error executing update script:', err);
      process.exit(1);
    });
}

module.exports = { executeTargetedUpdateAndEmail };

