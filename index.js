const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const Ably = require('ably');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors({ origin: process.env.FRONTEND_URL, credentials: true }));
app.use(cookieParser());

// Initialize Ably
const ably = new Ably.Realtime(process.env.ABLY_API_KEY);
app.set('ably', ably);

console.log('🚀 Ably initialized with key:', process.env.ABLY_API_KEY ? 'Found' : 'Missing');

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
	.then(() => console.log('MongoDB connected'))
	.catch(err => console.error('MongoDB error:', err));

// Routes
app.use('/api/auth', require('./routes/auth.js'));
app.use('/api/game', require('./routes/game.js'));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
