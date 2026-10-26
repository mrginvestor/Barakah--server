const fs = require('fs');
const path = require('path');

const file = path.resolve(__dirname, '../controllers/adminRegistrationController.js');
let content = fs.readFileSync(file, 'utf8');

const target = '  return {\r\n    list,';
const targetLF = '  return {\n    list,';

const methodCode = `  async function getWebinars(req, res) {
    try {
      let webinars = [];
      if (typeof webinarModel?.find === 'function') {
        webinars = await webinarModel.find().sort({ dateIso: -1, createdAt: -1 }).lean();
      }
      if (!webinars || webinars.length === 0) {
        webinars = [
          {
            webinarId: 'halal-wealth-nov-2026',
            title: 'Halal Wealth Webinar',
            topic: 'Halal Trade, Investments & Generational Wealth',
            date: 'Sunday, November 1, 2026',
            time: '11:00 AM IST | 1:30 PM SGT | 9:30 AM GST | 8:30 AM AST',
            status: 'Upcoming',
            isCurrent: true,
            isRegistrationClosed: false,
          },
          {
            webinarId: 'halal-wealth-oct-2026',
            title: 'Halal Wealth Webinar',
            topic: 'Halal Trade, Investments & Generational Wealth',
            date: 'Sunday, October 18, 2026',
            time: '11:00 AM IST | 1:30 PM SGT | 9:30 AM GST | 8:30 AM AST',
            status: 'Completed',
            isCurrent: false,
            isRegistrationClosed: true,
          },
        ];
      }

      const webinarsWithCounts = await Promise.all(
        webinars.map(async (webinar) => {
          let count = 0;
          try {
            if (typeof registrationModel.countDocuments === 'function') {
              count = await registrationModel.countDocuments({
                $or: [
                  { webinarId: webinar.webinarId },
                  ...(webinar.webinarId === 'halal-wealth-nov-2026' ? [{ webinarVersion: 'November 1, 2026 Webinar' }] : []),
                  ...(webinar.webinarId === 'halal-wealth-oct-2026' ? [{ webinarVersion: 'October 2026 Webinar' }] : []),
                ],
              });
            }
          } catch (_) {}
          return {
            ...webinar,
            participantCount: count,
          };
        })
      );

      return res.json({ success: true, data: webinarsWithCounts });
    } catch (error) {
      safeLogger.error('Admin get webinars failed.', { code: error.code || 'ADMIN_GET_WEBINARS_FAILED' });
      return res.status(500).json({ success: false, message: 'Webinars could not be loaded.' });
    }
  }

  return {
    getWebinars,
    list,`;

if (content.includes(target)) {
  content = content.replace(target, methodCode.replace(/\n/g, '\r\n'));
  fs.writeFileSync(file, content, 'utf8');
  console.log('Successfully injected getWebinars (CRLF)');
} else if (content.includes(targetLF)) {
  content = content.replace(targetLF, methodCode);
  fs.writeFileSync(file, content, 'utf8');
  console.log('Successfully injected getWebinars (LF)');
} else {
  console.error('Could not find target return block in', file);
}

