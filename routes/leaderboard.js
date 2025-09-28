const express = require('express');
const User = require('../models/User');
const jwt = require('jsonwebtoken');
const router = express.Router();

// Middleware to verify JWT (optional for leaderboards)
async function verifyToken(req, res, next) {
	const token = req.cookies.token;
	if (!token) {
		req.user = null;
		return next();
	}

	try {
		const verified = jwt.verify(token, process.env.JWT_SECRET);
		req.user = verified;
		next();
	} catch (err) {
		req.user = null;
		next();
	}
}

// Global ELO Rankings
router.get('/elo', verifyToken, async (req, res) => {
	try {
		const page = parseInt(req.query.page) || 1;
		const limit = parseInt(req.query.limit) || 50;
		const skip = (page - 1) * limit;

		console.log('🔍 Fetching ELO leaderboard, page:', page, 'limit:', limit);

		// Get top players by ELO rating (more inclusive query)
		const players = await User.find({
			$or: [
				{ 'profile.stats.gamesPlayed': { $gte: 1 } }, // At least 1 game
				{ 'profile.ranking.elo': { $gt: 1200 } }      // Or ELO above default
			]
		})
			.select('username profile.displayName profile.avatar profile.ranking profile.stats')
			.sort({ 'profile.ranking.elo': -1, 'profile.stats.gamesPlayed': -1 })
			.limit(limit)
			.skip(skip);

		console.log('📊 Found', players.length, 'players for ELO leaderboard');

		// If no players found, get all users as fallback
		let finalPlayers = players;
		let finalTotalPlayers = 0;

		if (players.length === 0) {
			console.log('⚠️ No players found with games, fetching all users as fallback...');
			finalPlayers = await User.find({})
				.select('username profile.displayName profile.avatar profile.ranking profile.stats')
				.sort({ 'profile.ranking.elo': -1, createdAt: -1 })
				.limit(limit)
				.skip(skip);

			finalTotalPlayers = await User.countDocuments({});
			console.log('📊 Fallback: Found', finalPlayers.length, 'total users');
		} else {
			// Get total count for pagination
			finalTotalPlayers = await User.countDocuments({
				$or: [
					{ 'profile.stats.gamesPlayed': { $gte: 1 } },
					{ 'profile.ranking.elo': { $gt: 1200 } }
				]
			});
		}

		// Format the response
		const leaderboard = finalPlayers.map((player, index) => ({
			rank: skip + index + 1,
			username: player.username,
			displayName: player.profile?.displayName || player.username,
			avatar: player.profile?.avatar || '♔',
			elo: player.profile?.ranking?.elo || 1200,
			rank_title: player.profile?.ranking?.rank || 'Novice',
			gamesPlayed: player.profile?.stats?.gamesPlayed || 0,
			wins: player.profile?.stats?.wins || 0,
			losses: player.profile?.stats?.losses || 0,
			winRate: player.profile?.stats?.winRate || 0,
			isCurrentUser: req.user ? player._id.toString() === req.user.id : false
		}));

		res.json({
			leaderboard,
			pagination: {
				currentPage: page,
				totalPages: Math.ceil(finalTotalPlayers / limit),
				totalPlayers: finalTotalPlayers,
				hasNext: page < Math.ceil(finalTotalPlayers / limit),
				hasPrev: page > 1
			}
		});

	} catch (error) {
		console.error('❌ Error fetching ELO leaderboard:', error);
		res.status(500).json({ error: 'Failed to fetch leaderboard' });
	}
});

// Win Rate Rankings
router.get('/winrate', verifyToken, async (req, res) => {
	try {
		const page = parseInt(req.query.page) || 1;
		const limit = parseInt(req.query.limit) || 50;
		const skip = (page - 1) * limit;

		console.log('🔍 Fetching Win Rate leaderboard, page:', page, 'limit:', limit);

		// Get top players by win rate (more inclusive - minimum 3 games)
		const players = await User.find({
			'profile.stats.gamesPlayed': { $gte: 3 }
		})
			.select('username profile.displayName profile.avatar profile.ranking profile.stats')
			.sort({
				'profile.stats.winRate': -1,
				'profile.stats.gamesPlayed': -1
			})
			.limit(limit)
			.skip(skip);

		console.log('📊 Found', players.length, 'players for Win Rate leaderboard');

		// If no players found, get all users as fallback
		let finalPlayers = players;
		let finalTotalPlayers = 0;

		if (players.length === 0) {
			console.log('⚠️ No players found with enough games, fetching all users as fallback...');
			finalPlayers = await User.find({})
				.select('username profile.displayName profile.avatar profile.ranking profile.stats')
				.sort({ 'profile.stats.winRate': -1, 'profile.stats.gamesPlayed': -1, createdAt: -1 })
				.limit(limit)
				.skip(skip);

			finalTotalPlayers = await User.countDocuments({});
			console.log('📊 Fallback: Found', finalPlayers.length, 'total users');
		} else {
			finalTotalPlayers = await User.countDocuments({
				'profile.stats.gamesPlayed': { $gte: 3 }
			});
		}

		const leaderboard = finalPlayers.map((player, index) => ({
			rank: skip + index + 1,
			username: player.username,
			displayName: player.profile?.displayName || player.username,
			avatar: player.profile?.avatar || '♔',
			elo: player.profile?.ranking?.elo || 1200,
			rank_title: player.profile?.ranking?.rank || 'Novice',
			gamesPlayed: player.profile?.stats?.gamesPlayed || 0,
			wins: player.profile?.stats?.wins || 0,
			losses: player.profile?.stats?.losses || 0,
			winRate: player.profile?.stats?.winRate || 0,
			isCurrentUser: req.user ? player._id.toString() === req.user.id : false
		}));

		res.json({
			leaderboard,
			pagination: {
				currentPage: page,
				totalPages: Math.ceil(finalTotalPlayers / limit),
				totalPlayers: finalTotalPlayers,
				hasNext: page < Math.ceil(finalTotalPlayers / limit),
				hasPrev: page > 1
			}
		});

	} catch (error) {
		console.error('❌ Error fetching win rate leaderboard:', error);
		res.status(500).json({ error: 'Failed to fetch leaderboard' });
	}
});

// Games Played Rankings
router.get('/games', verifyToken, async (req, res) => {
	try {
		const page = parseInt(req.query.page) || 1;
		const limit = parseInt(req.query.limit) || 50;
		const skip = (page - 1) * limit;

		const players = await User.find({
			'profile.stats.gamesPlayed': { $gt: 0 }
		})
			.select('username profile.displayName profile.avatar profile.ranking profile.stats')
			.sort({ 'profile.stats.gamesPlayed': -1 })
			.limit(limit)
			.skip(skip);

		const totalPlayers = await User.countDocuments({
			'profile.stats.gamesPlayed': { $gt: 0 }
		});

		const leaderboard = players.map((player, index) => ({
			rank: skip + index + 1,
			username: player.username,
			displayName: player.profile?.displayName || player.username,
			avatar: player.profile?.avatar || '♔',
			elo: player.profile?.ranking?.elo || 1200,
			rank_title: player.profile?.ranking?.rank || 'Novice',
			gamesPlayed: player.profile?.stats?.gamesPlayed || 0,
			wins: player.profile?.stats?.wins || 0,
			losses: player.profile?.stats?.losses || 0,
			winRate: player.profile?.stats?.winRate || 0,
			isCurrentUser: req.user ? player._id.toString() === req.user.id : false
		}));

		res.json({
			leaderboard,
			pagination: {
				currentPage: page,
				totalPages: Math.ceil(totalPlayers / limit),
				totalPlayers,
				hasNext: page < Math.ceil(totalPlayers / limit),
				hasPrev: page > 1
			}
		});

	} catch (error) {
		console.error('❌ Error fetching games leaderboard:', error);
		res.status(500).json({ error: 'Failed to fetch leaderboard' });
	}
});

// Monthly Leaderboard
router.get('/monthly', verifyToken, async (req, res) => {
	try {
		const page = parseInt(req.query.page) || 1;
		const limit = parseInt(req.query.limit) || 50;
		const skip = (page - 1) * limit;

		// Get current month key
		const now = new Date();
		const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

		// Find players with monthly stats
		const players = await User.find({
			[`profile.stats.monthlyStats.${monthKey}.games`]: { $gt: 0 }
		})
			.select('username profile.displayName profile.avatar profile.ranking profile.stats');

		// Sort by monthly performance (wins this month, then win rate)
		const sortedPlayers = players
			.map(player => {
				const monthlyData = player.profile?.stats?.monthlyStats?.[monthKey] || {};
				return {
					...player.toObject(),
					monthlyWins: monthlyData.wins || 0,
					monthlyGames: monthlyData.games || 0,
					monthlyWinRate: monthlyData.games > 0 ? Math.round((monthlyData.wins / monthlyData.games) * 100) : 0
				};
			})
			.sort((a, b) => {
				// Sort by monthly wins first, then by monthly win rate
				if (b.monthlyWins !== a.monthlyWins) return b.monthlyWins - a.monthlyWins;
				return b.monthlyWinRate - a.monthlyWinRate;
			});

		const totalPlayers = sortedPlayers.length;
		const paginatedPlayers = sortedPlayers.slice(skip, skip + limit);

		const leaderboard = paginatedPlayers.map((player, index) => ({
			rank: skip + index + 1,
			username: player.username,
			displayName: player.profile?.displayName || player.username,
			avatar: player.profile?.avatar || '♔',
			elo: player.profile?.ranking?.elo || 1200,
			rank_title: player.profile?.ranking?.rank || 'Novice',
			monthlyGames: player.monthlyGames,
			monthlyWins: player.monthlyWins,
			monthlyWinRate: player.monthlyWinRate,
			isCurrentUser: req.user ? player._id.toString() === req.user.id : false
		}));

		res.json({
			leaderboard,
			month: monthKey,
			pagination: {
				currentPage: page,
				totalPages: Math.ceil(totalPlayers / limit),
				totalPlayers,
				hasNext: page < Math.ceil(totalPlayers / limit),
				hasPrev: page > 1
			}
		});

	} catch (error) {
		console.error('❌ Error fetching monthly leaderboard:', error);
		res.status(500).json({ error: 'Failed to fetch leaderboard' });
	}
});

// Win Streak Leaderboard
router.get('/streaks', verifyToken, async (req, res) => {
	try {
		const page = parseInt(req.query.page) || 1;
		const limit = parseInt(req.query.limit) || 50;
		const skip = (page - 1) * limit;

		const players = await User.find({
			'profile.stats.bestWinStreak': { $gt: 0 }
		})
			.select('username profile.displayName profile.avatar profile.ranking profile.stats')
			.sort({
				'profile.stats.bestWinStreak': -1,
				'profile.stats.currentWinStreak': -1
			})
			.limit(limit)
			.skip(skip);

		const totalPlayers = await User.countDocuments({
			'profile.stats.bestWinStreak': { $gt: 0 }
		});

		const leaderboard = players.map((player, index) => ({
			rank: skip + index + 1,
			username: player.username,
			displayName: player.profile?.displayName || player.username,
			avatar: player.profile?.avatar || '♔',
			elo: player.profile?.ranking?.elo || 1200,
			rank_title: player.profile?.ranking?.rank || 'Novice',
			bestWinStreak: player.profile?.stats?.bestWinStreak || 0,
			currentWinStreak: player.profile?.stats?.currentWinStreak || 0,
			gamesPlayed: player.profile?.stats?.gamesPlayed || 0,
			isCurrentUser: req.user ? player._id.toString() === req.user.id : false
		}));

		res.json({
			leaderboard,
			pagination: {
				currentPage: page,
				totalPages: Math.ceil(totalPlayers / limit),
				totalPlayers,
				hasNext: page < Math.ceil(totalPlayers / limit),
				hasPrev: page > 1
			}
		});

	} catch (error) {
		console.error('❌ Error fetching streak leaderboard:', error);
		res.status(500).json({ error: 'Failed to fetch leaderboard' });
	}
});

// Get player's rank in different categories
router.get('/player-rank/:username', verifyToken, async (req, res) => {
	try {
		const { username } = req.params;

		const user = await User.findOne({ username });
		if (!user) {
			return res.status(404).json({ error: 'User not found' });
		}

		// Get ELO rank
		const eloRank = await User.countDocuments({
			'profile.ranking.elo': { $gt: user.profile?.ranking?.elo || 1200 },
			'profile.stats.gamesPlayed': { $gte: 5 }
		}) + 1;

		// Get win rate rank
		const winRateRank = await User.countDocuments({
			$or: [
				{ 'profile.stats.winRate': { $gt: user.profile?.stats?.winRate || 0 } },
				{
					'profile.stats.winRate': user.profile?.stats?.winRate || 0,
					'profile.stats.gamesPlayed': { $gt: user.profile?.stats?.gamesPlayed || 0 }
				}
			],
			'profile.stats.gamesPlayed': { $gte: 10 }
		}) + 1;

		// Get games played rank
		const gamesRank = await User.countDocuments({
			'profile.stats.gamesPlayed': { $gt: user.profile?.stats?.gamesPlayed || 0 }
		}) + 1;

		// Get streak rank
		const streakRank = await User.countDocuments({
			$or: [
				{ 'profile.stats.bestWinStreak': { $gt: user.profile?.stats?.bestWinStreak || 0 } },
				{
					'profile.stats.bestWinStreak': user.profile?.stats?.bestWinStreak || 0,
					'profile.stats.currentWinStreak': { $gt: user.profile?.stats?.currentWinStreak || 0 }
				}
			]
		}) + 1;

		res.json({
			username,
			ranks: {
				elo: eloRank,
				winRate: winRateRank,
				gamesPlayed: gamesRank,
				streak: streakRank
			},
			stats: {
				elo: user.profile?.ranking?.elo || 1200,
				winRate: user.profile?.stats?.winRate || 0,
				gamesPlayed: user.profile?.stats?.gamesPlayed || 0,
				bestWinStreak: user.profile?.stats?.bestWinStreak || 0
			}
		});

	} catch (error) {
		console.error('❌ Error fetching player rank:', error);
		res.status(500).json({ error: 'Failed to fetch player rank' });
	}
});

// Tournament endpoints temporarily disabled
// All tournament-related routes have been commented out to remove tournament functionality

module.exports = router;
router.get('/tournaments', verifyToken, async (req, res) => {
	try {
		const status = req.query.status || 'active';
		const page = parseInt(req.query.page) || 1;
		const limit = parseInt(req.query.limit) || 10;
		const skip = (page - 1) * limit;

		const tournaments = await Tournament.find({ status })
			.select('name description type format status startDate endDate participants maxParticipants')
			.populate('participants.player', 'username profile.displayName profile.avatar profile.ranking')
			.sort({ startDate: status === 'completed' ? -1 : 1 })
			.limit(limit)
			.skip(skip);

		const totalTournaments = await Tournament.countDocuments({ status });

		const tournamentData = tournaments.map(tournament => ({
			id: tournament._id,
			name: tournament.name,
			description: tournament.description,
			type: tournament.type,
			format: tournament.format,
			status: tournament.status,
			startDate: tournament.startDate,
			endDate: tournament.endDate,
			participants: tournament.participants.length,
			maxParticipants: tournament.maxParticipants,
			leaderboard: tournament.getLeaderboard().slice(0, 10) // Top 10 for preview
		}));

		res.json({
			tournaments: tournamentData,
			pagination: {
				currentPage: page,
				totalPages: Math.ceil(totalTournaments / limit),
				totalTournaments,
				hasNext: page < Math.ceil(totalTournaments / limit),
				hasPrev: page > 1
			}
		});

	} catch (error) {
		console.error('❌ Error fetching tournaments:', error);
		res.status(500).json({ error: 'Failed to fetch tournaments' });
	}
});

// Tournament Specific Leaderboard
router.get('/tournament/:tournamentId', verifyToken, async (req, res) => {
	try {
		const { tournamentId } = req.params;

		const tournament = await Tournament.findById(tournamentId)
			.populate('participants.player', 'username profile.displayName profile.avatar profile.ranking');

		if (!tournament) {
			return res.status(404).json({ error: 'Tournament not found' });
		}

		const leaderboard = tournament.getLeaderboard().map((entry, index) => ({
			...entry,
			username: entry.player.username,
			displayName: entry.player.profile?.displayName || entry.player.username,
			avatar: entry.player.profile?.avatar || '♔',
			elo: entry.player.profile?.ranking?.elo || 1200,
			rank_title: entry.player.profile?.ranking?.rank || 'Novice',
			isCurrentUser: req.user ? entry.player._id.toString() === req.user.id : false
		}));

		res.json({
			tournament: {
				id: tournament._id,
				name: tournament.name,
				description: tournament.description,
				type: tournament.type,
				format: tournament.format,
				status: tournament.status,
				startDate: tournament.startDate,
				endDate: tournament.endDate,
				currentRound: tournament.currentRound,
				totalRounds: tournament.totalRounds
			},
			leaderboard
		});

	} catch (error) {
		console.error('❌ Error fetching tournament leaderboard:', error);
		res.status(500).json({ error: 'Failed to fetch tournament leaderboard' });
	}
});

// Seasonal Championships
router.get('/seasonal', verifyToken, async (req, res) => {
	try {
		const year = parseInt(req.query.year) || new Date().getFullYear();
		const month = req.query.month ? parseInt(req.query.month) : null;
		const quarter = req.query.quarter ? parseInt(req.query.quarter) : null;

		let seasonFilter = { 'season.year': year };
		if (month) seasonFilter['season.month'] = month;
		if (quarter) seasonFilter['season.quarter'] = quarter;

		const tournaments = await Tournament.find({
			type: 'seasonal',
			...seasonFilter,
			status: { $in: ['completed', 'active'] }
		})
			.populate('participants.player', 'username profile.displayName profile.avatar profile.ranking')
			.sort({ 'season.month': -1, 'season.quarter': -1 });

		// Aggregate seasonal standings
		const seasonalStandings = {};

		tournaments.forEach(tournament => {
			tournament.participants.forEach(participant => {
				const playerId = participant.player._id.toString();
				if (!seasonalStandings[playerId]) {
					seasonalStandings[playerId] = {
						player: participant.player,
						tournaments: 0,
						totalScore: 0,
						wins: 0,
						losses: 0,
						draws: 0,
						averageScore: 0
					};
				}

				seasonalStandings[playerId].tournaments += 1;
				seasonalStandings[playerId].totalScore += participant.score;
				seasonalStandings[playerId].wins += participant.wins;
				seasonalStandings[playerId].losses += participant.losses;
				seasonalStandings[playerId].draws += participant.draws;
			});
		});

		// Calculate averages and sort
		const leaderboard = Object.values(seasonalStandings)
			.map(entry => ({
				...entry,
				averageScore: entry.tournaments > 0 ? (entry.totalScore / entry.tournaments).toFixed(1) : 0,
				username: entry.player.username,
				displayName: entry.player.profile?.displayName || entry.player.username,
				avatar: entry.player.profile?.avatar || '♔',
				elo: entry.player.profile?.ranking?.elo || 1200,
				rank_title: entry.player.profile?.ranking?.rank || 'Novice',
				isCurrentUser: req.user ? entry.player._id.toString() === req.user.id : false
			}))
			.sort((a, b) => {
				// Sort by total score, then by tournaments played
				if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
				return b.tournaments - a.tournaments;
			})
			.map((entry, index) => ({ ...entry, rank: index + 1 }));

		res.json({
			season: { year, month, quarter },
			tournaments: tournaments.length,
			leaderboard: leaderboard.slice(0, 50) // Top 50
		});

	} catch (error) {
		console.error('❌ Error fetching seasonal leaderboard:', error);
		res.status(500).json({ error: 'Failed to fetch seasonal leaderboard' });
	}
});

module.exports = router;
