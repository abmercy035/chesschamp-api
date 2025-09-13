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
// app.use(cors({ origin: process.env.FRONTEND_URL, credentials: true }));
app.use(cors({ origin: 'https://chess-champ.vercel.app', credentials: true }));
app.use(cookieParser());


app.use(cors({
	origin: (url, callback) => {
		const accept = [process.env.FRONTEND_URL, "http://localhost:3000", "https://chess-champ.vercel.app"];
		if (accept.includes(url)) {
			callback(null, true);
		} else {
			callback(new Error('Not allowed by CORS'));
		}
	},
	methods: [
		'GET', 'POST', 'PUT',
		'DELETE', 'PATCH', 'HEAD', 'OPTIONS'],
	allowedHeaders: [
		'Content-Type', 'Origin', 'X-Requested-With',
		'Accept', "set-cookie", "Content-Type",
		"Access-Control-Allow-Origin", "Access-Control-Allow-Credentials",
		'x-client-key', 'x-client-token', 'x-client-secret', 'Authorization',
		// Add Ably-specific headers
		'withCredentials',
		'X-Ably-Version',
		'X-Ably-Lib',
		'X-Ably-ClientId'
	],
	optionsSuccessStatus: 200,
	credentials: true,
}));

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
	.then(() => console.log('MongoDB connected'))
	.catch(err => console.error('MongoDB error:', err));


// Routes
app.use('/api/auth', require('./routes/auth.js'));
app.use('/api/game', require('./routes/game.js'));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
