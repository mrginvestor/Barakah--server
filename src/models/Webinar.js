const mongoose = require('mongoose');

const webinarSchema = new mongoose.Schema({
  webinarId: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
  },
  title: {
    type: String,
    required: true,
    trim: true,
  },
  topic: {
    type: String,
    required: true,
    trim: true,
  },
  date: {
    type: String,
    required: true,
    trim: true,
  },
  dateIso: {
    type: Date,
    default: null,
  },
  time: {
    type: String,
    required: true,
    trim: true,
  },
  status: {
    type: String,
    enum: ['Upcoming', 'Live', 'Completed', 'Cancelled'],
    default: 'Upcoming',
  },
  isCurrent: {
    type: Boolean,
    default: false,
  },
  description: {
    type: String,
    default: '',
    trim: true,
  },
  isRegistrationClosed: {
    type: Boolean,
    default: false,
  },
}, { timestamps: true });

webinarSchema.index({ isCurrent: 1 });

module.exports = mongoose.model('Webinar', webinarSchema);

