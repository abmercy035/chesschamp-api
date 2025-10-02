const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Signup
router.post('/signup', async (req, res) => {
	try {
		const { username, password, email, age, country } = req.body;

		// Validate required fields
		if (!username || !password || !email || !age || !country) {
			return res.status(400).json({ error: 'All fields are required: username, password, email, age, country' });
		}

		// Validate age
		if (age < 13 || age > 120) {
			return res.status(400).json({ error: 'Age must be between 13 and 120' });
		}

		// Check if user with username or email already exists
		const existingUser = await User.findOne({
			$or: [{ username }, { email }]
		});
		if (existingUser) {
			if (existingUser.username === username) {
				return res.status(400).json({ error: 'Username already taken' });
			}
			if (existingUser.email === email) {
				return res.status(400).json({ error: 'Email already registered' });
			}
		}

		const hash = await bcrypt.hash(password, 10);
		const user = new User({
			username,
			password: hash,
			email,
			age,
			country
		});
		await user.save();

		console.log(`✅ New user registered: ${username} from ${country}, age ${age}`);
		res.json({ message: 'Registration successful! Please login to continue.' });
	} catch (err) {
		console.error('❌ Signup error:', err);
		if (err.code === 11000) {
			// Handle duplicate key error
			const field = Object.keys(err.keyPattern)[0];
			return res.status(400).json({ error: `${field.charAt(0).toUpperCase() + field.slice(1)} already exists` });
		}
		res.status(500).json({ error: 'Server error during registration' });
	}
});

// Login
router.post('/login', async (req, res) => {
	try {
		const { username, password } = req.body;
		const user = await User.findOne({ username });
		if (!user) return res.status(400).json({ error: 'Invalid credentials' });
		const match = await bcrypt.compare(password, user.password);
		if (!match) return res.status(400).json({ error: 'Invalid credentials' });
		const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1d' });

       // Dynamic cookie configuration based on environment
        const isProduction = process.env.NODE_ENV === 'production';
		const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';

 const cookieOptions = {
            httpOnly: false,
            path: "/",
		maxAge: 24 * 60 * 60 * 1000 * 7, // 7 days
            ...(isProduction ? {
                sameSite: 'none',
                secure: true, // Required for production HTTPS
                domain: undefined // Let browser handle
            } : {
                sameSite: 'lax',
                secure: false // Allow HTTP in development
            })
        };
        
        console.log({ cookieOptions, isProduction, isHttps }, "Setting cookie with options");
        
		// console.log({ cookieOptions, tokenLength: token.length }, "Setting cookie");
    res.cookie('token', token, cookieOptions);

        res.json({ 
            message: 'Login successful',
            user: { id: user._id, username: username },
        });
	} catch (err) {
		res.status(500).json({ error: 'Server error' });
	}
});

// Middleware to verify JWT for protected routes
async function verifyToken(req, res, next) {
	const token = req.cookies.token;
	if (!token) return res.status(401).json({ error: 'Access denied' });

	try {
		const verified = jwt.verify(token, process.env.JWT_SECRET);
		if (verified) {
			const userFound = await User.findOne({ _id: verified.id }).lean();
			if (userFound) {
				req.user = { ...verified, ...userFound };
				next();
			} else {
				return res.status(401).json({ error: 'User not found' });
			}
		} else {
			return res.status(401).json({ error: 'Invalid token' });
		}
	} catch (error) {
		res.status(400).json({ error: 'Invalid token' });
	}
}

// Get current user info
router.get('/me', verifyToken, async (req, res) => {
	try {
		const user = await User.findById(req.user.id).select('-password');
		if (!user) {
			return res.status(404).json({ error: 'User not found' });
		}

		res.json({
			_id: user._id,
			username: user.username,
			profile: user.profile
		});
	} catch (error) {
		console.error('Error getting user info:', error);
		res.status(500).json({ error: 'Failed to get user info' });
	}
});

module.exports = router;
