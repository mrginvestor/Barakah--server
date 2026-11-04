const mongoose = require('../node_modules/mongoose');
const dotenv = require('../node_modules/dotenv');
dotenv.config({ path: 'server/.env' });

const Webinar = require('../src/models/Webinar');

async function updateNovWebinar() {
  await mongoose.connect(process.env.MONGODB_URI);
  const updated = await Webinar.findOneAndUpdate(
    { webinarId: 'halal-wealth-nov-2026' },
    { $set: { isRegistrationClosed: true, registrationOpen: false } },
    { new: true }
  );
  console.log('Updated November 1 Webinar:', updated);
  await mongoose.disconnect();
}
updateNovWebinar().catch(console.error);

