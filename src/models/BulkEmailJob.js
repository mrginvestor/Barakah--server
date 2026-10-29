const mongoose = require('mongoose');

const bulkEmailJobSchema = new mongoose.Schema({
  jobId: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  type: {
    type: String,
    required: true,
    default: 'confirmation',
    enum: ['confirmation', 'postponement', 'joining', 'reminder', 'feedback'],
  },
  webinarId: {
    type: String,
    default: null,
    trim: true,
  },
  webinarVersion: {
    type: String,
    default: null,
    trim: true,
  },
  scope: {
    type: String,
    enum: ['pending_failed', 'all'],
    default: 'pending_failed',
  },
  status: {
    type: String,
    enum: ['queued', 'processing', 'completed', 'failed', 'cancelled'],
    default: 'queued',
  },
  total: {
    type: Number,
    default: 0,
  },
  processed: {
    type: Number,
    default: 0,
  },
  accepted: {
    type: Number,
    default: 0,
  },
  failed: {
    type: Number,
    default: 0,
  },
  skipped: {
    type: Number,
    default: 0,
  },
  recipientIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'WebinarRegistration',
  }],
  processedRecipientIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'WebinarRegistration',
  }],
  failedRecipients: [{
    email: { type: String, trim: true },
    registrationId: { type: String, trim: true },
    reason: { type: String, trim: true },
    timestamp: { type: Date, default: Date.now },
  }],
  errorMessage: {
    type: String,
    default: null,
  },
  startedAt: {
    type: Date,
    default: null,
  },
  completedAt: {
    type: Date,
    default: null,
  },
  createdBy: {
    type: String,
    default: 'admin',
  },
}, { timestamps: true });

bulkEmailJobSchema.index({ status: 1, createdAt: -1 });
bulkEmailJobSchema.index({ webinarId: 1, createdAt: -1 });

module.exports = mongoose.model('BulkEmailJob', bulkEmailJobSchema);
