const mongoose = require('mongoose');

const recordingCampaignDeliverySchema = new mongoose.Schema({
  campaignId: {
    type: String,
    required: true,
    default: 'recording-halal-investment-retirement',
    trim: true,
  },
  registrationId: {
    type: mongoose.Schema.Types.Mixed,
    ref: 'WebinarRegistration',
    required: true,
  },
  referenceId: {
    type: String,
    default: '',
    trim: true,
  },
  recipientEmail: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
  },
  recipientName: {
    type: String,
    default: '',
    trim: true,
  },
  webinarId: {
    type: String,
    default: '',
    trim: true,
  },
  webinarVersion: {
    type: String,
    default: '',
    trim: true,
  },
  emailStatus: {
    type: String,
    enum: ['pending', 'sent', 'failed'],
    default: 'pending',
  },
  sentAt: {
    type: Date,
    default: null,
  },
  lastAttemptAt: {
    type: Date,
    default: null,
  },
  errorMessage: {
    type: String,
    default: null,
  },
  attemptCount: {
    type: Number,
    default: 0,
  },
  messageId: {
    type: String,
    default: null,
  },
}, { timestamps: true });

// Prevent duplicate campaign delivery records per registration
recordingCampaignDeliverySchema.index({ campaignId: 1, registrationId: 1 }, { unique: true });
recordingCampaignDeliverySchema.index({ campaignId: 1, emailStatus: 1 });
recordingCampaignDeliverySchema.index({ campaignId: 1, recipientEmail: 1 });

module.exports = mongoose.model('RecordingCampaignDelivery', recordingCampaignDeliverySchema);

