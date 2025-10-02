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

// Confirm match acceptance
router.post('/confirm-match', verifyToken, async (req, res) => {
	try {
		const { matchId, accept } = req.body;
		const userId = req.user.id;

		if (!matchId) {
			return res.status(400).json({ error: 'Match ID required' });
		}

		const match = pendingMatches.get(matchId);
		if (!match) {
			return res.status(404).json({ error: 'Match not found or expired' });
		}

		// Check if user is part of this match
		const isPlayer1 = match.player1.userId.toString() === userId;
		const isPlayer2 = match.player2.userId.toString() === userId;

		if (!isPlayer1 && !isPlayer2) {
			return res.status(403).json({ error: 'Not authorized for this match' });
		}

		if (!accept) {
			// Player declined - notify other player and remove match
			const ably = req.app.get('ably');
			const otherPlayer = isPlayer1 ? match.player2 : match.player1;
			
			const otherPlayerChannel = ably.channels.get(`user-${otherPlayer.userId}`);
			await otherPlayerChannel.publish('matchDeclined', {
				matchId,
				message: 'Your opponent declined the match'
			});

			// Put the other player back in queue
			matchmakingQueue.push({
				userId: otherPlayer.userId,
				username: otherPlayer.username,
				elo: otherPlayer.elo,
				avatar: otherPlayer.avatar,
				joinedAt: new Date()
			});

			pendingMatches.delete(matchId);
			console.log(`❌ Match declined by ${isPlayer1 ? 'player1' : 'player2'}: ${matchId}`);

			return res.json({
				success: true,
				message: 'Match declined. Other player has been notified.'
			});
		}

		// Player accepted - mark confirmation
		if (isPlayer1) {
			match.confirmed.player1 = true;
		} else {
			match.confirmed.player2 = true;
		}

		console.log(`✅ ${isPlayer1 ? 'Player1' : 'Player2'} accepted match ${matchId}`);

		// Check if both players have confirmed
		if (match.confirmed.player1 && match.confirmed.player2) {
			// Both confirmed - create the game!
			const game = new Game({
				host: match.player1.userId,
				opponent: match.player2.userId,
				stakedPrice: 50.00,
				timeLeft: { w: 300, b: 300 }, // 5 minutes each side
				status: 'active',
				gameType: 'ranked'
			});

			await game.save();
			console.log(`🎮 Ranked game created: ${game._id} (${match.player1.username} vs ${match.player2.username})`);

			// Notify both players that game is starting
			const ably = req.app.get('ably');
			
			const player1Channel = ably.channels.get(`user-${match.player1.userId}`);
			const player2Channel = ably.channels.get(`user-${match.player2.userId}`);

			const gameStartMessage = {
				gameId: game._id,
				message: 'Both players accepted! Game is starting...',
				gameInfo: {
					white: match.player1.username,
					black: match.player2.username
				}
			};

			await player1Channel.publish('gameStarting', gameStartMessage);
			await player2Channel.publish('gameStarting', gameStartMessage);

			// Remove match from pending
			pendingMatches.delete(matchId);

			return res.json({
				success: true,
				status: 'game_starting',
				gameId: game._id,
				message: 'Both players accepted! Redirecting to game...'
			});
		} else {
			// Waiting for other player
			return res.json({
				success: true,
				status: 'waiting_for_opponent',
				message: 'You accepted! Waiting for your opponent to accept...'
			});
		}

	} catch (error) {
		console.error('❌ Match confirmation error:', error);
		res.status(500).json({ error: 'Failed to confirm match' });
	}
});

// Leave matchmaking queue
router.post('/leave-queue', verifyToken, async (req, res) => {
	try {
		const userId = req.user.id;

		// Remove from queue
		const initialLength = matchmakingQueue.length;
		matchmakingQueue = matchmakingQueue.filter(p => p.userId.toString() !== userId);

		const removed = initialLength - matchmakingQueue.length;
		console.log(`🚪 User ${userId} left queue (${removed} removed)`);

		res.json({
			success: true,
			message: 'Left matchmaking queue'
		});

	} catch (error) {
		console.error('❌ Leave queue error:', error);
		res.status(500).json({ error: 'Failed to leave queue' });
	}
});

// Get queue status
router.get('/queue-status', verifyToken, async (req, res) => {
	try {
		const userId = req.user.id;

		// Check if user is in queue
		const queuePosition = matchmakingQueue.findIndex(p => p.userId.toString() === userId);
		const inQueue = queuePosition !== -1;

		// Check if user has pending matches
		let pendingMatch = null;
		for (const [matchId, match] of pendingMatches.entries()) {
			if (match.player1.userId.toString() === userId || match.player2.userId.toString() === userId) {
				pendingMatch = { matchId, ...match };
				break;
			}
		}

		res.json({
			success: true,
			inQueue,
			queuePosition: inQueue ? queuePosition + 1 : null,
			queueSize: matchmakingQueue.length,
			pendingMatch
		});

	} catch (error) {
		console.error('❌ Queue status error:', error);
		res.status(500).json({ error: 'Failed to get queue status' });
	}
});

// Cleanup expired matches every 30 seconds
setInterval(() => {
	const now = new Date();
	const expiredMatches = [];

	for (const [matchId, match] of pendingMatches.entries()) {
		const age = now - match.createdAt;
		if (age > 60000) { // 60 second timeout
			expiredMatches.push(matchId);
		}
	}

	for (const matchId of expiredMatches) {
		const match = pendingMatches.get(matchId);
		if (match) {
			// Put both players back in queue if they haven't confirmed
			if (!match.confirmed.player1) {
				matchmakingQueue.push({
					userId: match.player1.userId,
					username: match.player1.username,
					elo: match.player1.elo,
					avatar: match.player1.avatar,
					joinedAt: new Date()
				});
			}
			if (!match.confirmed.player2) {
				matchmakingQueue.push({
					userId: match.player2.userId,
					username: match.player2.username,
					elo: match.player2.elo,
					avatar: match.player2.avatar,
					joinedAt: new Date()
				});
			}
			pendingMatches.delete(matchId);
			console.log(`⏰ Expired match removed: ${matchId}`);
		}
	}
}, 30000);

module.exports = router;
