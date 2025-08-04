const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true
  },
  description: String,
  startTime: {
    type: Date,
    required: true
  },
  endTime: {
    type: Date,
    required: true
  },
  speaker: {
    type: String,
    default: 'TBD'
  },
  room: {
    type: String,
    default: 'TBD'
  },
  tags: {
    type: [String],
    default: []
  }
});

const participantSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true
  },
  userName: {
    type: String,
    default: 'Anonymous'
  },
  userEmail: {
    type: String,
    default: ''
  },
  registeredAt: {
    type: Date,
    default: Date.now
  }
});

const eventSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true,
    default: ''
  },
  startDate: {
    type: Date,
    required: true
  },
  endDate: {
    type: Date,
    required: true
  },
  location: {
    type: String,
    default: 'TBD'
  },
  capacity: {
    type: Number,
    default: 0
  },
  price: {
    type: Number,
    default: 0
  },
  image: {
    type: String,
    default: ''
  },
  organizerId: {
    type: String,
    required: true
  },
  organizerName: {
    type: String,
    default: 'Anonymous'
  },
  organizerEmail: {
    type: String,
    default: ''
  },
  sessions: {
    type: [sessionSchema],
    default: []
  },
  participants: {
    type: [participantSchema],
    default: []
  },
  isPublic: {
    type: Boolean,
    default: false
  },
  tags: {
    type: [String],
    default: []
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

eventSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('Event', eventSchema);