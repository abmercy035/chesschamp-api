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

// In-memory matchmaking queue and pending matches
let matchmakingQueue = [];
let pendingMatches = new Map(); // matchId -> { player1, player2, createdAt, confirmed: {player1: boolean, player2: boolean} }

// Helper function to get ELO tier
const getEloTier = (elo) => {
	if (elo >= 2200) return { name: 'Grandmaster', color: 'text-purple-400', bg: 'bg-purple-500/20', icon: '👑' };
	if (elo >= 2000) return { name: 'Master', color: 'text-yellow-400', bg: 'bg-yellow-500/20', icon: '🏆' };
	if (elo >= 1800) return { name: 'Expert', color: 'text-red-400', bg: 'bg-red-500/20', icon: '⚔️' };
	if (elo >= 1600) return { name: 'Advanced', color: 'text-orange-400', bg: 'bg-orange-500/20', icon: '🔥' };
	if (elo >= 1400) return { name: 'Intermediate', color: 'text-blue-400', bg: 'bg-blue-500/20', icon: '⚡' };
	if (elo >= 1200) return { name: 'Amateur', color: 'text-green-400', bg: 'bg-green-500/20', icon: '🌟' };
	if (elo >= 1000) return { name: 'Novice', color: 'text-teal-400', bg: 'bg-teal-500/20', icon: '🚀' };
	return { name: 'Beginner', color: 'text-slate-400', bg: 'bg-slate-500/20', icon: '🌱' };
};

// Join matchmaking queue
router.post('/join-queue', verifyToken, async (req, res) => {
	try {
		const currentUser = await User.findById(req.user.id);
		const currentElo = currentUser.profile.ranking.elo || 1200;

		// Check if user is already in queue
		const existingIndex = matchmakingQueue.findIndex(p => p.userId.toString() === req.user.id);
		if (existingIndex !== -1) {
			return res.json({
				success: true,
				message: 'Already in matchmaking queue',
				status: 'waiting',
				queuePosition: existingIndex + 1,
				queueSize: matchmakingQueue.length
			});
		}

		console.log(`🎯 ${currentUser.username} joining matchmaking queue (ELO: ${currentElo})`);

		// Look for suitable opponent already in queue
		const ranges = [
			{ maxDiff: 100, priority: 1 },   // Very close match
			{ maxDiff: 200, priority: 2 },   // Good match
			{ maxDiff: 300, priority: 3 }    // Acceptable match
		];

		let matchedOpponent = null;
		for (const range of ranges) {
			const suitableOpponents = matchmakingQueue.filter(player => {
				const eloDiff = Math.abs(currentElo - player.elo);
				return eloDiff <= range.maxDiff;
			});

			if (suitableOpponents.length > 0) {
				// Pick the first suitable opponent (FIFO)
				matchedOpponent = suitableOpponents[0];
				break;
			}
		}

		if (matchedOpponent) {
			// Remove matched opponent from queue
			matchmakingQueue = matchmakingQueue.filter(p => p.userId.toString() !== matchedOpponent.userId.toString());

			// Create match
			const matchId = `match-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
			const eloDifference = Math.abs(currentElo - matchedOpponent.elo);

			pendingMatches.set(matchId, {
				player1: {
					userId: req.user.id,
					username: currentUser.username,
					elo: currentElo,
					avatar: getEloTier(currentElo).icon
				},
				player2: {
					userId: matchedOpponent.userId,
					username: matchedOpponent.username,
					elo: matchedOpponent.elo,
					avatar: matchedOpponent.avatar
				},
				createdAt: new Date(),
				confirmed: { player1: false, player2: false },
				eloDifference
			});

			console.log(`🎉 Match created: ${currentUser.username} vs ${matchedOpponent.username} (${matchId})`);

			// Send real-time notifications to both players
			const ably = req.app.get('ably');

			// Notify current user (player1)
			const player1Channel = ably.channels.get(`user-${req.user.id}`);
			await player1Channel.publish('matchFound', {
				matchId,
				opponent: {
					userId: matchedOpponent.userId,
					username: matchedOpponent.username,
					elo: matchedOpponent.elo,
					avatar: matchedOpponent.avatar
				},
				eloDifference,
				role: 'player1'
			});

			// Notify matched opponent (player2)
			const player2Channel = ably.channels.get(`user-${matchedOpponent.userId}`);
			await player2Channel.publish('matchFound', {
				matchId,
				opponent: {
					userId: req.user.id,
					username: currentUser.username,
					elo: currentElo,
					avatar: getEloTier(currentElo).icon
				},
				eloDifference,
				role: 'player2'
			});

			console.log(`🔔 Match notifications sent for ${matchId}`);

			return res.json({
				success: true,
				status: 'matched',
				matchId,
				opponent: {
					username: matchedOpponent.username,
					elo: matchedOpponent.elo,
					avatar: matchedOpponent.avatar
				},
				eloDifference,
				message: 'Match found! Waiting for both players to accept.'
			});
		} else {
			// Add to queue and wait
			matchmakingQueue.push({
				userId: req.user.id,
				username: currentUser.username,
				elo: currentElo,
				avatar: getEloTier(currentElo).icon,
				joinedAt: new Date()
			});

			console.log(`⏳ ${currentUser.username} added to queue (position ${matchmakingQueue.length})`);

			return res.json({
				success: true,
				status: 'waiting',
				queuePosition: matchmakingQueue.length,
				queueSize: matchmakingQueue.length,
				message: `You are #${matchmakingQueue.length} in the queue. Searching for opponents...`
			});
		}

	} catch (error) {
		console.error('❌ Queue join error:', error);
		res.status(500).json({ error: 'Failed to join matchmaking queue' });
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

// Get matchmaking queue info
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
			totalActivePlayers: queueInfo.reduce((sum, range) => sum + range.activePlayersCount, 0),
			currentQueueSize: matchmakingQueue.length,
			pendingMatches: pendingMatches.size
		});

	} catch (error) {
		console.error('❌ Queue info error:', error);
		res.status(500).json({ error: 'Failed to get queue info' });
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
