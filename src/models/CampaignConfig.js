const mongoose = require('mongoose');

const campaignConfigSchema = new mongoose.Schema({
  campaignKey: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    enum: ['post_webinar_feedback'],
  },
  name: {
    type: String,
    required: true,
    trim: true,
    default: 'Post-Webinar Feedback Campaign',
  },
  subject: {
    type: String,
    required: true,
    trim: true,
    maxlength: 250,
  },
  bodyText: {
    type: String,
    required: true,
    maxlength: 5000,
  },
  feedbackFormUrl: {
    type: String,
    trim: true,
    default: 'https://forms.gle/ysMqbTQ37BSnrbGT9',
  },
  whatsappUrl: {
    type: String,
    trim: true,
    default: 'https://chat.whatsapp.com/I9d41QdjbOGA43kYph2noq',
  },
  youtubeUrl: {
    type: String,
    trim: true,
    default: 'https://youtube.com/@ethicalfinancebasithtamil',
  },
  instagramUrl: {
    type: String,
    trim: true,
    default: 'https://instagram.com/ethicalfinancebasith.tamil',
  },
  updatedBy: {
    type: String,
    default: null,
  },
}, { timestamps: true });

module.exports = mongoose.model('CampaignConfig', campaignConfigSchema);

