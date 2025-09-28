const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const Ably = require('ably');
require('dotenv').config();

const app = express();

// Initialize Ably
const ably = new Ably.Realtime(process.env.ABLY_API_KEY);
app.set('ably', ably);

console.log('🚀 Ably initialized with key:', process.env.ABLY_API_KEY ? 'Found' : 'Missing');


app.use(express.json());
app.use(cors({ origin: process.env.FRONTEND_URL, credentials: true }));
// app.use(cors({ origin: 'https://chess-champ.vercel.app', credentials: true }));
app.use(cookieParser());


// CORS Configuration for both development and production
const allowedOrigins = [
    // Development
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    
    // Production
    'https://chess-champ.vercel.app',
    
    // Backend domain (for same-origin requests)
    'https://chesschamp-api.onrender.com',
    
    // Environment variable
    process.env.FRONTEND_URL,
].filter(Boolean);

app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, Postman, etc.)
        if (!origin) return callback(null, true);
        
        if (allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            console.log('❌ CORS blocked origin:', origin);
            console.log('✅ Allowed origins:', allowedOrigins);
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'],
    allowedHeaders: [
        'Content-Type', 
        'Authorization', 
        'Origin', 
        'X-Requested-With', 
        'Accept',
        'Cookie',
        'Set-Cookie'
    ],
    credentials: true,
    optionsSuccessStatus: 200
}));

// Trust proxy for production (Heroku, Vercel, etc.)
app.set("trust proxy", 1);
app.use(function (req, res, next) {
	res.header("Access-Control-Allow-Origin", process.env.FRONTEND_URL);
	res.header("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS,POST,PUT");
	res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
	res.header('Access-Control-Allow-Credentials', true);
	next();
});


// MongoDB connection
mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => {
        console.log('MongoDB connected');

        // Start automatic game cleanup service
        const { startAutomaticCleanup } = require('./utils/gameCleanup');
        startAutomaticCleanup();
    })
	.catch(err => console.error('MongoDB error:', err));


// Routes
app.use('/api/auth', require('./routes/auth.js'));
app.use('/api/game', require('./routes/game.js'));
app.use('/api/profile', require('./routes/profile.js'));
app.use('/api/leaderboard', require('./routes/leaderboard.js'));
app.use('/api/matchmaking', require('./routes/matchmaking.js'));
app.use('/api/admin', require('./routes/admin.js'));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
