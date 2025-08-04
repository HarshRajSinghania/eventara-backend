require('dotenv').config();
const express = require('express');
const { ClerkExpressRequireAuth } = require('@clerk/clerk-sdk-node');
const cors = require('cors');
const mongoose = require('mongoose');
const Event = require('./models/Event');

const app = express();
const port = process.env.PORT || 5000;

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/eventara', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('Connected to MongoDB'))
.catch(err => console.error('MongoDB connection error:', err));

app.use(cors({
  origin: process.env.FRONTEND_URL, // Should be http://localhost:5173
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));
app.use(express.json());

// Auth middleware for protected routes
const authMiddleware = ClerkExpressRequireAuth();

// Public routes (no auth required)
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Protected API routes
app.get('/api/protected', authMiddleware, (req, res) => {
  res.json({
    message: 'Authenticated route',
    user: req.auth
  });
});

// Create event with sessions
const Joi = require('joi');

const eventSchema = Joi.object({
  title: Joi.string().trim().required(),
  description: Joi.string().trim().allow(''),
  startDate: Joi.date().required().messages({ 
    'date.base': 'Start date must be a valid date',
    'any.required': 'Start date is required'
  }),
  endDate: Joi.date().min(Joi.ref('startDate')).required().messages({
    'date.base': 'End date must be a valid date',
    'date.min': 'End date must be after start date',
    'any.required': 'End date is required'
  }),
  location: Joi.string().trim().allow(''),
  capacity: Joi.number().min(0).default(0),
  price: Joi.number().min(0).default(0),
  image: Joi.string().allow(''),
  sessions: Joi.array().items(
    Joi.object({
      title: Joi.string().required(),
      startTime: Joi.date().iso().required().messages({
        'date.iso': 'Session start time must be in ISO 8601 format',
        'any.required': 'Session start time is required'
      }),
      endTime: Joi.date().iso().min(Joi.ref('startTime')).required().messages({
        'date.iso': 'Session end time must be in ISO 8601 format',
        'date.min': 'Session end time must be after start time',
        'any.required': 'Session end time is required'
      })
    })
  ),
  isPublic: Joi.boolean()
});

app.post('/api/events', authMiddleware, async (req, res) => {
  try {
    // Validate request body
    console.log('=== Validation Debug ===');
    console.log('Raw request body:', JSON.stringify(req.body, null, 2));
    
    const { error, value } = eventSchema.validate(req.body, {
      abortEarly: false,
      convert: true,
      stripUnknown: true
    });

    if (error) {
      console.log('Validation errors:', error.details);
      return res.status(400).json({
        error: 'Validation failed',
        details: error.details.map(d => ({
          field: d.path.join('.'),
          message: d.message,
          value: d.context?.value
        }))
      });
    }

    console.log('=== Event Creation Request ===');
    console.log('Auth User:', req.auth?.userId);
    console.log('Validated Body:', JSON.stringify(value, null, 2));
    
    const { title, description, startDate, endDate, location, capacity, price, image, sessions: eventSessions, isPublic } = value;

    // Validate required fields
    if (!title || !title.trim()) {
      console.error('Missing required field: title');
      return res.status(400).json({ error: 'Title is required' });
    }

    if (!startDate || !endDate) {
      console.error('Missing required date fields:', { startDate, endDate });
      return res.status(400).json({ error: 'Start date and end date are required' });
    }

    console.log('Creating event with validated data:', {
      title,
      description: description?.substring(0, 50) + '...',
      startDate,
      endDate,
      location,
      capacity,
      price,
      sessionsCount: eventSessions?.length || 0,
      isPublic
    });

    const newEvent = new Event({
      title: title.trim(),
      description: description?.trim() || '',
      startDate,
      endDate,
      location: location?.trim() || 'TBD',
      capacity: parseInt(capacity) || 0,
      price: parseFloat(price) || 0,
      image: image?.trim() || '',
      organizerId: req.auth.userId,
      organizerName: req.auth.user?.name || 'Anonymous',
      organizerEmail: req.auth.user?.email || '',
      sessions: eventSessions || [],
      isPublic: isPublic || false
    });

    console.log('Validating event...');
    await newEvent.validate();
    console.log('Validation passed');

    const savedEvent = await newEvent.save();
    console.log('Event saved successfully:', savedEvent._id);

    res.status(201).json({
      success: true,
      event: savedEvent,
      sessions: savedEvent.sessions
    });
  } catch (error) {
    console.error('=== Error creating event ===');
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    
    if (error.name === 'ValidationError') {
      console.error('Validation errors:', Object.keys(error.errors).map(key => ({
        field: key,
        message: error.errors[key].message
      })));
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors
      });
    }
    
    res.status(500).json({ error: 'Failed to create event' });
  }
});

// Get events for a user
app.get('/api/events', authMiddleware, async (req, res) => {
  try {
    const userEvents = await Event.find({ organizerId: req.auth.userId })
      .sort({ createdAt: -1 });
    res.json(userEvents);
  } catch (error) {
    console.error('Error fetching events:', error);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// Get public events (excluding user's own events)
app.get('/api/events/public', authMiddleware, async (req, res) => {
  try {
    const publicEvents = await Event.find({
      isPublic: true,
      organizerId: { $ne: req.auth.userId }
    })
    .sort({ createdAt: -1 })
    .limit(20);
    
    res.json(publicEvents);
  } catch (error) {
    console.error('Error fetching public events:', error);
    res.status(500).json({ error: 'Failed to fetch public events' });
  }
});

// Get events user has joined
app.get('/api/events/joined', authMiddleware, async (req, res) => {
  try {
    const joinedEvents = await Event.find({
      'participants.userId': req.auth.userId
    })
    .sort({ createdAt: -1 });
    
    res.json(joinedEvents);
  } catch (error) {
    console.error('Error fetching joined events:', error);
    res.status(500).json({ error: 'Failed to fetch joined events' });
  }
});

// Get event with sessions
app.get('/api/events/:id', authMiddleware, async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    res.json(event);
  } catch (error) {
    console.error('Error fetching event:', error);
    res.status(500).json({ error: 'Failed to fetch event' });
  }
});

// Join an event
app.post('/api/events/:id/join', authMiddleware, async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Check if already joined
    const alreadyJoined = event.participants.some(
      p => p.userId === req.auth.userId
    );
    
    if (alreadyJoined) {
      return res.status(400).json({ error: 'Already joined this event' });
    }

    // Check capacity
    if (event.participants.length >= event.capacity) {
      return res.status(400).json({ error: 'Event is full' });
    }

    // Add participant
    event.participants.push({
      userId: req.auth.userId,
      userName: req.auth.user?.name || 'Anonymous',
      userEmail: req.auth.user?.email || ''
    });

    await event.save();

    res.json({
      success: true,
      message: 'Successfully joined event',
      participants: event.participants.length
    });
  } catch (error) {
    console.error('Error joining event:', error);
    res.status(500).json({ error: 'Failed to join event' });
  }
});

// Leave an event
app.post('/api/events/:id/leave', authMiddleware, async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Remove participant
    event.participants = event.participants.filter(
      p => p.userId !== req.auth.userId
    );

    await event.save();

    res.json({
      success: true,
      message: 'Successfully left event',
      participants: event.participants.length
    });
  } catch (error) {
    console.error('Error leaving event:', error);
    res.status(500).json({ error: 'Failed to leave event' });
  }
});

// Update event
app.put('/api/events/:id', authMiddleware, async (req, res) => {
  try {
    const event = await Event.findOne({
      _id: req.params.id,
      organizerId: req.auth.userId
    });

    if (!event) {
      return res.status(404).json({ error: 'Event not found or not authorized' });
    }

    const updatedEvent = await Event.findByIdAndUpdate(
      req.params.id,
      { ...req.body, updatedAt: Date.now() },
      { new: true, runValidators: true }
    );

    res.json(updatedEvent);
  } catch (error) {
    console.error('Error updating event:', error);
    res.status(500).json({ error: 'Failed to update event' });
  }
});

// Delete event
app.delete('/api/events/:id', authMiddleware, async (req, res) => {
  try {
    const event = await Event.findByIdAndDelete(req.params.id);
    
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting event:', error);
    res.status(500).json({ error: 'Failed to delete event' });
  }
});

// Session management endpoints
app.post('/api/events/:eventId/sessions', authMiddleware, async (req, res) => {
  try {
    const { title, description, startTime, endTime, speaker, room, tags } = req.body;
    
    const event = await Event.findById(req.params.eventId);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Ensure the user owns this event
    if (event.organizerId !== req.auth.userId) {
      return res.status(403).json({ error: 'Not authorized to modify this event' });
    }

    const newSession = {
      title,
      description,
      startTime: new Date(startTime),
      endTime: new Date(endTime),
      speaker,
      room,
      tags: tags || []
    };

    event.sessions.push(newSession);
    await event.save();

    res.status(201).json(newSession);
  } catch (error) {
    console.error('Error creating session:', error);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

app.put('/api/sessions/:id', authMiddleware, async (req, res) => {
  try {
    const { eventId, ...updateData } = req.body;
    
    const event = await Event.findOne({
      'sessions._id': req.params.id,
      organizerId: req.auth.userId
    });

    if (!event) {
      return res.status(404).json({ error: 'Session not found or not authorized' });
    }

    const session = event.sessions.id(req.params.id);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    Object.assign(session, updateData);
    await event.save();

    res.json(session);
  } catch (error) {
    console.error('Error updating session:', error);
    res.status(500).json({ error: 'Failed to update session' });
  }
});

app.delete('/api/sessions/:id', authMiddleware, async (req, res) => {
  try {
    const event = await Event.findOne({
      'sessions._id': req.params.id,
      organizerId: req.auth.userId
    });

    if (!event) {
      return res.status(404).json({ error: 'Session not found or not authorized' });
    }

    event.sessions.id(req.params.id).remove();
    await event.save();

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting session:', error);
    res.status(500).json({ error: 'Failed to delete session' });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});