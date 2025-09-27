const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Middleware to verify admin access
const verifyAdmin = async (req, res, next) => {
	try {
		// Try cookie first (consistent with existing routes), then header as fallback
		let token = req.cookies.token;
		if (!token) {
			token = req.header('Authorization')?.replace('Bearer ', '');
		}

		if (!token) {
			return res.status(401).json({ message: 'Access denied. No token provided.' });
		}

		const decoded = jwt.verify(token, process.env.JWT_SECRET);
		const user = await User.findById(decoded.id); // Note: using 'id' not 'userId' to match auth.js

		if (!user) {
			return res.status(401).json({ message: 'Invalid token. User not found.' });
		}

		if (!user.isAdmin && user.role !== 'admin') {
			return res.status(403).json({ 
				message: 'Access denied. Admin privileges required.',
				userRole: user.role,
				isAdmin: user.isAdmin 
			});
		}

		req.user = user;
		next();
	} catch (error) {
		console.error('Admin auth middleware error:', error);
		res.status(401).json({ message: 'Invalid token.' });
	}
};

// Middleware to check if user is admin (for UI elements)
const checkAdmin = async (req, res, next) => {
	try {
		// Try cookie first, then header as fallback
		let token = req.cookies.token;
		if (!token) {
			token = req.header('Authorization')?.replace('Bearer ', '');
		}

		if (!token) {
			req.isAdmin = false;
			return next();
		}

		const decoded = jwt.verify(token, process.env.JWT_SECRET);
		const user = await User.findById(decoded.id); // Note: using 'id' not 'userId'

		req.isAdmin = user && (user.isAdmin || user.role === 'admin');
		req.user = user;
		next();
	} catch (error) {
		req.isAdmin = false;
		next();
	}
}; module.exports = {
	verifyAdmin,
	checkAdmin
};
