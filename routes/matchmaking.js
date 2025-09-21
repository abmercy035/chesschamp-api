const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Game = require('../models/Game');
const jwt = require('jsonwebtoken');

// Middleware to verify JWT
async function verifyToken(req, res, next) {
	const token = req.cookies.token;
	var appCookies = (req?.headers?.cookie);

	console.log(appCookies);
	console.log(token);
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

// Find opponent based on ELO matching
router.post('/matchmake', verifyToken, async (req, res) => {
	try {
		const currentUserId = req.user.id;
		const currentUser = await User.findById(currentUserId);

		if (!currentUser) {
			return res.status(404).json({ error: 'User not found' });
		}

		const currentElo = currentUser.profile.ranking.elo || 1200;

		// Define ELO ranges for matchmaking (more flexible ranges)
		const eloRanges = [
			{ min: currentElo - 100, max: currentElo + 100 },   // ±100 ELO (preferred)
			{ min: currentElo - 200, max: currentElo + 200 },   // ±200 ELO (acceptable)
			{ min: currentElo - 300, max: currentElo + 300 },   // ±300 ELO (wider)
			{ min: 800, max: 2800 }                             // Any player (fallback)
		];

		console.log(`🎯 Matchmaking for ${currentUser.username} (ELO: ${currentElo})`);

		// Try each ELO range until we find a match
		for (let i = 0; i < eloRanges.length; i++) {
			const range = eloRanges[i];

			// Find available players in this ELO range
			let availablePlayers = await User.find({
				_id: { $ne: currentUserId }, // Exclude current user
				'profile.ranking.elo': {
					$gte: range.min,
					$lte: range.max
				},
				// Try to find recently active players (last 24 hours)
				'profile.lastActive': {
					$gte: new Date(Date.now() - 24 * 60 * 60 * 1000) // Active in last 24 hours
				}
			})
				.select('username profile.ranking.elo profile.displayName profile.avatar profile.lastActive profile.stats.gamesPlayed')
				.limit(10)
				.sort({
					'profile.lastActive': -1,  // Most recently active first
					'profile.ranking.elo': -1  // Higher ELO first within same activity level
				});

			// If no recently active players, find any players in this ELO range
			if (availablePlayers.length === 0) {
				availablePlayers = await User.find({
					_id: { $ne: currentUserId }, // Exclude current user
					'profile.ranking.elo': {
						$gte: range.min,
						$lte: range.max
					}
				})
					.select('username profile.ranking.elo profile.displayName profile.avatar profile.lastActive profile.stats.gamesPlayed')
					.limit(10)
					.sort({
						'profile.ranking.elo': -1  // Higher ELO first
					});
			}

			if (availablePlayers.length > 0) {
				// Pick the best match (closest ELO)
				let bestMatch = availablePlayers[0];
				let smallestEloDiff = Math.abs(currentElo - bestMatch.profile.ranking.elo);

				for (const player of availablePlayers) {
					const eloDiff = Math.abs(currentElo - player.profile.ranking.elo);
					if (eloDiff < smallestEloDiff) {
						bestMatch = player;
						smallestEloDiff = eloDiff;
					}
				}

				console.log(`✅ Match found: ${bestMatch.username} (ELO: ${bestMatch.profile.ranking.elo}, diff: ${smallestEloDiff})`);

				return res.json({
					success: true,
					match: {
						userId: bestMatch._id,
						username: bestMatch.username,
						displayName: bestMatch.profile.displayName || bestMatch.username,
						avatar: bestMatch.profile.avatar,
						elo: bestMatch.profile.ranking.elo,
						eloDifference: smallestEloDiff,
						gamesPlayed: bestMatch.profile.stats.gamesPlayed,
						matchQuality: i === 0 ? 'Perfect' : i === 1 ? 'Good' : i === 2 ? 'Fair' : 'Wide'
					}
				});
			}
		}

		// No matches found
		console.log(`❌ No matches found for ${currentUser.username}`);
		return res.json({
			success: false,
			message: 'No suitable opponents found. Try again later or create a public game.',
			suggestion: 'Consider playing against any available player or creating an open game.'
		});

	} catch (error) {
		console.error('❌ Matchmaking error:', error);
		res.status(500).json({ error: 'Failed to find match' });
	}
});

// Get matchmaking queue status
router.get('/queue', verifyToken, async (req, res) => {
	try {
		const currentUser = await User.findById(req.user.id);
		const currentElo = currentUser.profile.ranking.elo || 1200;

		// Count players in different ELO ranges
		const ranges = [
			{ name: 'Beginner', min: 800, max: 1000 },
			{ name: 'Novice', min: 1000, max: 1200 },
			{ name: 'Amateur', min: 1200, max: 1400 },
			{ name: 'Intermediate', min: 1400, max: 1600 },
			{ name: 'Advanced', min: 1600, max: 1800 },
			{ name: 'Expert', min: 1800, max: 2000 },
			{ name: 'Master', min: 2000, max: 2200 },
			{ name: 'Grandmaster', min: 2200, max: 2800 }
		];

		const queueInfo = await Promise.all(ranges.map(async (range) => {
			// First try to find recently active users (last 24 hours)
			let count = await User.countDocuments({
				'profile.ranking.elo': { $gte: range.min, $lte: range.max },
				'profile.lastActive': {
					$gte: new Date(Date.now() - 24 * 60 * 60 * 1000) // Active in last 24 hours
				}
			});

			// If no recent activity, show all users in this ELO range
			if (count === 0) {
				count = await User.countDocuments({
					'profile.ranking.elo': { $gte: range.min, $lte: range.max }
				});
			}

			return {
				...range,
				activePlayersCount: count,
				isCurrentUserRange: currentElo >= range.min && currentElo <= range.max
			};
		}));

		res.json({
			success: true,
			currentUserElo: currentElo,
			queueInfo,
			totalActivePlayers: queueInfo.reduce((sum, range) => sum + range.activePlayersCount, 0)
		});

	} catch (error) {
		console.error('❌ Queue status error:', error);
		res.status(500).json({ error: 'Failed to get queue status' });
	}
});

// Create a ranked game with matched opponent
router.post('/create-ranked-game', verifyToken, async (req, res) => {
	try {
		const { opponentId } = req.body;
		const currentUserId = req.user.id;

		if (!opponentId) {
			return res.status(400).json({ error: 'Opponent ID required' });
		}

		// Verify both users exist and get their ELO
		const currentUser = await User.findById(currentUserId);
		const opponent = await User.findById(opponentId);

		if (!currentUser || !opponent) {
			return res.status(404).json({ error: 'User(s) not found' });
		}

		const eloDifference = Math.abs(currentUser.profile.ranking.elo - opponent.profile.ranking.elo);

		// Create a new ranked game
		const game = new Game({
			host: currentUserId,
			opponent: opponentId,
			stakedPrice: 50.00,
			timeLeft: { w: 300, b: 300 }, // 5 minutes each side
			status: 'active' // Start as active since both players are matched
		});

		await game.save();

		console.log(`🎮 Ranked game created: ${game._id} (${currentUser.username} vs ${opponent.username})`);

		res.json({
			success: true,
			gameId: game._id,
			gameInfo: {
				host: {
					username: currentUser.username,
					elo: currentUser.profile.ranking.elo
				},
				opponent: {
					username: opponent.username,
					elo: opponent.profile.ranking.elo
				},
				eloDifference,
				gameType: 'ranked'
			}
		});

	} catch (error) {
		console.error('❌ Ranked game creation error:', error);
		res.status(500).json({ error: 'Failed to create ranked game' });
	}
});

module.exports = router;
