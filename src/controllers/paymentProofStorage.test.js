const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const SmallSummitRegistration = require('../models/SmallSummitRegistration');
const {
  submitSummitPaymentProof,
  getPaymentReceiptFile,
  getAdminSummitRegistrations,
} = require('./summitController');
const { processAndStoreReceipt } = require('../services/receiptStorageService');

test('processAndStoreReceipt validates magic bytes and extracts buffer', async () => {
  const tmpDir = path.resolve(__dirname, '../../test_tmp_proof');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  const validPngPath = path.join(tmpDir, 'valid.png');
  // PNG signature: 89 50 4E 47 0D 0A 1A 0A
  const validPngBuffer = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D]);
  fs.writeFileSync(validPngPath, validPngBuffer);

  try {
    const mockFile = {
      path: validPngPath,
      mimetype: 'image/png',
      size: validPngBuffer.length,
      filename: 'receipt-SS26-test-123.png',
    };

    const result = await processAndStoreReceipt(mockFile, 'SS26-00099');
    assert.strictEqual(result.mimeType, 'image/png');
    assert.strictEqual(result.filename, 'receipt-SS26-test-123.png');
    assert.ok(Buffer.isBuffer(result.buffer));
    assert.strictEqual(result.buffer.length, validPngBuffer.length);
    assert.strictEqual(result.storageType, 'mongodb');
  } finally {
    try {
      fs.unlinkSync(validPngPath);
      fs.rmdirSync(tmpDir);
    } catch (_) {}
  }
});

test('processAndStoreReceipt rejects non-image files with invalid magic bytes', async () => {
  const tmpDir = path.resolve(__dirname, '../../test_tmp_proof2');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  const invalidFilePath = path.join(tmpDir, 'fake.jpg');
  fs.writeFileSync(invalidFilePath, Buffer.from('FAKE_TEXT_NOT_IMAGE_DATA'));

  try {
    const mockFile = {
      path: invalidFilePath,
      mimetype: 'image/jpeg',
      size: 24,
      filename: 'fake.jpg',
    };

    await assert.rejects(
      async () => {
        await processAndStoreReceipt(mockFile, 'SS26-00099');
      },
      /Invalid image file/
    );
  } finally {
    try {
      if (fs.existsSync(invalidFilePath)) fs.unlinkSync(invalidFilePath);
      fs.rmdirSync(tmpDir);
    } catch (_) {}
  }
});

test('getPaymentReceiptFile streams binary buffer directly from MongoDB Atlas document', async () => {
  const origFindOne = SmallSummitRegistration.findOne;

  const mockPngBuffer = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x01, 0x02, 0x03]);
  const mockRegistration = {
    registrationId: 'SS26-00077',
    paymentScreenshot: 'receipt-SS26-00077.png',
    paymentScreenshotMimeType: 'image/png',
    paymentScreenshotSize: mockPngBuffer.length,
    paymentScreenshotData: mockPngBuffer,
  };

  SmallSummitRegistration.findOne = async () => mockRegistration;

  try {
    const req = { params: { registrationId: 'SS26-00077' } };
    const headers = {};
    let writtenBuffer = null;

    const res = {
      setHeader: (name, val) => {
        headers[name.toLowerCase()] = val;
      },
      end: (data) => {
        writtenBuffer = data;
        return data;
      },
      status: (code) => {
        return {
          json: (data) => ({ status: code, data }),
        };
      },
    };

    await getPaymentReceiptFile(req, res);

    assert.strictEqual(headers['content-type'], 'image/png');
    assert.strictEqual(headers['content-length'], mockPngBuffer.length);
    assert.ok(headers['cache-control']);
    assert.ok(headers['content-disposition'].includes('receipt-SS26-00077.png'));
    assert.deepStrictEqual(writtenBuffer, mockPngBuffer);
  } finally {
    SmallSummitRegistration.findOne = origFindOne;
  }
});

test('getPaymentReceiptFile returns structured 404 RECEIPT_FILE_UNAVAILABLE when binary is missing and file not on disk', async () => {
  const origFindOne = SmallSummitRegistration.findOne;

  const mockRegistration = {
    registrationId: 'SS26-00012',
    paymentScreenshot: 'receipt-SS26-00012-missing-on-disk.jpg',
    paymentScreenshotMimeType: 'image/jpeg',
    paymentScreenshotData: null,
    upiTransactionId: 'T2611182154068880967450',
    paymentStatus: 'REJECTED',
  };

  SmallSummitRegistration.findOne = async () => mockRegistration;

  try {
    const req = { params: { registrationId: 'SS26-00012' } };
    let responseStatus = null;
    let responseJson = null;

    const res = {
      setHeader: () => {},
      status: (code) => {
        responseStatus = code;
        return {
          json: (data) => {
            responseJson = data;
            return data;
          },
        };
      },
    };

    await getPaymentReceiptFile(req, res);

    assert.strictEqual(responseStatus, 404);
    assert.strictEqual(responseJson.code, 'RECEIPT_FILE_UNAVAILABLE');
    assert.strictEqual(responseJson.registrationId, 'SS26-00012');
    assert.strictEqual(responseJson.upiTransactionId, 'T2611182154068880967450');
  } finally {
    SmallSummitRegistration.findOne = origFindOne;
  }
});
