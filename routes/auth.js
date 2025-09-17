const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Signup
router.post('/signup', async (req, res) => {
	try {
		const { username, password } = req.body;
		if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
		const exists = await User.findOne({ username });
		if (exists) return res.status(400).json({ error: 'User exists' });
		const hash = await bcrypt.hash(password, 10);
		const user = new User({ username, password: hash });
		await user.save();
		res.json({ message: 'Signup successful' });
	} catch (err) {
		res.status(500).json({ error: 'Server error' });
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
        

		// // Improved cookie configuration for cross-origin
		// const cookieOptions = {
		// 	httpOnly: false, // Allow frontend to read the cookie
		// 	sameSite: 'none', // Required for cross-origin requests
		// 	secure: true, // Required when sameSite=none (even in development)
		// 	path: "/",
		// 	maxAge: 24 * 60 * 60 * 1000, // 1 day
		// 	domain: undefined // Let browser handle domain
		// };

 const cookieOptions = {
            httpOnly: false,
            path: "/",
            maxAge: 24 * 60 * 60 * 1000, // 1 day
            // Production: secure cookies with sameSite none for cross-origin
            // Development: lax cookies for same-origin
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

module.exports = router;
