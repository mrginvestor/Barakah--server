const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { validateImageMagicBytes, UPLOAD_DIR } = require('../middleware/receiptUpload');

/**
 * Upload buffer to Cloudinary using their REST API if credentials are provided in process.env.
 * Supports CLOUDINARY_URL (e.g. cloudinary://api_key:api_secret@cloud_name) or discrete env vars.
 */
async function uploadToCloudinaryIfConfigured(buffer, mimeType, regId) {
  let cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  let apiKey = process.env.CLOUDINARY_API_KEY;
  let apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (process.env.CLOUDINARY_URL) {
    try {
      const parsed = new URL(process.env.CLOUDINARY_URL);
      cloudName = parsed.hostname;
      apiKey = parsed.username;
      apiSecret = parsed.password;
    } catch (_) {}
  }

  if (!cloudName || !apiKey || !apiSecret) {
    return null; // Cloudinary not configured; fallback to MongoDB Atlas buffer
  }

  return new Promise((resolve) => {
    try {
      const timestamp = Math.floor(Date.now() / 1000);
      const folder = 'investor_mission_receipts';
      const publicId = `receipt_${(regId || 'reg').replace(/[^a-zA-Z0-9_-]/g, '')}_${Date.now()}`;

      // Signature string: folder=...&public_id=...&timestamp=...<apiSecret>
      const toSign = `folder=${folder}&public_id=${publicId}&timestamp=${timestamp}${apiSecret}`;
      const signature = crypto.createHash('sha1').update(toSign).digest('hex');

      const boundary = `----CloudinaryFormBoundary${Date.now()}`;
      const fileDataUri = `data:${mimeType};base64,${buffer.toString('base64')}`;

      const postBody = [
        `--${boundary}`,
        'Content-Disposition: form-data; name="file"',
        '',
        fileDataUri,
        `--${boundary}`,
        'Content-Disposition: form-data; name="api_key"',
        '',
        apiKey,
        `--${boundary}`,
        'Content-Disposition: form-data; name="timestamp"',
        '',
        String(timestamp),
        `--${boundary}`,
        'Content-Disposition: form-data; name="folder"',
        '',
        folder,
        `--${boundary}`,
        'Content-Disposition: form-data; name="public_id"',
        '',
        publicId,
        `--${boundary}`,
        'Content-Disposition: form-data; name="signature"',
        '',
        signature,
        `--${boundary}--`,
      ].join('\r\n');

      const options = {
        hostname: 'api.cloudinary.com',
        port: 443,
        path: `/v1_1/${cloudName}/image/upload`,
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': Buffer.byteLength(postBody),
        },
        timeout: 10000,
      };

      const req = https.request(options, (res) => {
        let rawData = '';
        res.on('data', (chunk) => { rawData += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(rawData);
            if (res.statusCode === 200 && parsed.secure_url) {
              resolve(parsed.secure_url);
            } else {
              console.warn('Cloudinary upload returned non-200:', parsed?.error?.message || rawData);
              resolve(null);
            }
          } catch (_) {
            resolve(null);
          }
        });
      });

      req.on('error', (err) => {
        console.warn('Cloudinary upload error:', err.message);
        resolve(null);
      });

      req.on('timeout', () => {
        req.destroy();
        resolve(null);
      });

      req.write(postBody);
      req.end();
    } catch (err) {
      console.warn('Failed to initiate Cloudinary upload:', err.message);
      resolve(null);
    }
  });
}

/**
 * Validates uploaded receipt and stores it persistently in MongoDB and optionally Cloudinary.
 */
async function processAndStoreReceipt(file, registrationId) {
  if (!file) {
    throw new Error('No receipt file provided');
  }

  const filePath = file.path;
  if (!fs.existsSync(filePath)) {
    throw new Error('Receipt temporary file not found on disk');
  }

  // 1. Verify binary magic bytes
  const isValid = validateImageMagicBytes(filePath);
  if (!isValid) {
    try { fs.unlinkSync(filePath); } catch (_) {}
    throw new Error('Invalid image file. Only valid JPG, JPEG, PNG, and WebP images are accepted.');
  }

  // 2. Read full buffer
  const fileBuffer = fs.readFileSync(filePath);
  const mimeType = file.mimetype || 'image/jpeg';
  const size = file.size || fileBuffer.length;
  const filename = file.filename;

  // 3. Attempt cloud storage if configured
  const cloudUrl = await uploadToCloudinaryIfConfigured(fileBuffer, mimeType, registrationId);

  return {
    buffer: fileBuffer,
    mimeType,
    size,
    filename,
    cloudUrl,
    storageType: cloudUrl ? 'cloudinary' : 'mongodb',
  };
}

module.exports = {
  uploadToCloudinaryIfConfigured,
  processAndStoreReceipt,
  validateImageMagicBytes,
  UPLOAD_DIR,
};
