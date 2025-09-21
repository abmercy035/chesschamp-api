const express = require('express');
const User = require('../models/User');
const jwt = require('jsonwebtoken');
const router = express.Router();

// Middleware to verify JWT
async function verifyToken(req, res, next) {
	const token = req.cookies.token;
	if (!token) return res.status(401).json({ error: 'Access denied' });

	try {
		const verified = jwt.verify(token, process.env.JWT_SECRET);
		req.user = verified;
		next();
	} catch (err) {
		res.status(400).json({ error: 'Invalid token' });
	}
}

// Get user profile
router.get('/', verifyToken, async (req, res) => {
	try {
		const user = await User.findById(req.user.id);
		if (!user) {
			return res.status(404).json({ error: 'User not found' });
		}

		// Return the profile data
		res.json({
			username: user.username,
			displayName: user.profile?.displayName || user.username,
			avatar: user.profile?.avatar || '♔',
			joinDate: user.profile?.joinDate || user.createdAt,
			lastActive: user.profile?.lastActive || user.updatedAt,
			stats: user.profile?.stats || {
				gamesPlayed: 0,
				wins: 0,
				losses: 0,
				draws: 0,
				winRate: 0,
				winsByCheckmate: 0,
				winsByTimeout: 0,
				winsByResignation: 0,
				drawsByAgreement: 0,
				drawsByStalemate: 0,
				drawsByRepetition: 0,
				totalPlayTime: 0,
				averageGameTime: 0,
				fastestWin: null,
				longestGame: null,
				currentWinStreak: 0,
				bestWinStreak: 0,
				currentLossStreak: 0,
				totalMoves: 0,
				averageMovesPerGame: 0,
				monthlyStats: {}
			},
			achievements: user.profile?.achievements || {
				firstWin: false,
				tenWins: false,
				hundredWins: false,
				winStreak5: false,
				winStreak10: false,
				fastWinner: false,
				timemaster: false,
				survivor: false,
				drawMaster: false,
				veteran: false,
				monthly: false,
				comeback: false
			},
			preferences: user.profile?.preferences || {
				theme: 'dark',
				boardStyle: 'classic',
				pieceStyle: 'traditional',
				soundEffects: true,
				showCoordinates: true,
				highlightMoves: true,
				autoQueen: false,
				confirmMoves: false,
				animationSpeed: 'normal'
			},
			ranking: user.profile?.ranking || {
				elo: 1200,
				rank: 'Novice',
				peakElo: 1200,
				seasonRank: 'Unranked'
			}
		});
	} catch (error) {
		console.error('❌ Error fetching profile:', error);
		res.status(500).json({ error: 'Failed to fetch profile' });
	}
});

// Update user profile
router.put('/', verifyToken, async (req, res) => {
	try {
		const { displayName, avatar } = req.body;

		const updateData = {
			'profile.lastActive': new Date()
		};

		if (displayName !== undefined) {
			updateData['profile.displayName'] = displayName;
		}

		if (avatar !== undefined) {
			updateData['profile.avatar'] = avatar;
		}

		const user = await User.findByIdAndUpdate(
			req.user.id,
			{ $set: updateData },
			{ new: true, upsert: false }
		);

		if (!user) {
			return res.status(404).json({ error: 'User not found' });
		}

		console.log('✅ Profile updated for user:', user.username);
		res.json({ message: 'Profile updated successfully' });
	} catch (error) {
		console.error('❌ Error updating profile:', error);
		res.status(500).json({ error: 'Failed to update profile' });
	}
});

// Update user preferences
router.put('/preferences', verifyToken, async (req, res) => {
	try {
		const preferences = req.body;

		const updateData = {
			'profile.lastActive': new Date()
		};

		// Update each preference field
		for (const [key, value] of Object.entries(preferences)) {
			updateData[`profile.preferences.${key}`] = value;
		}

		const user = await User.findByIdAndUpdate(
			req.user.id,
			{ $set: updateData },
			{ new: true, upsert: false }
		);

		if (!user) {
			return res.status(404).json({ error: 'User not found' });
		}

		console.log('✅ Preferences updated for user:', user.username);
		res.json({ message: 'Preferences updated successfully' });
	} catch (error) {
		console.error('❌ Error updating preferences:', error);
		res.status(500).json({ error: 'Failed to update preferences' });
	}
});

// Record game result (for statistics)
router.post('/game-result', verifyToken, async (req, res) => {
	try {
		const { result, winMethod, gameTimeSeconds, totalMoves, isWin, isLoss, isDraw } = req.body;

		const user = await User.findById(req.user.id);
		if (!user) {
			return res.status(404).json({ error: 'User not found' });
		}

		// Initialize profile if it doesn't exist
		if (!user.profile) {
			user.profile = {};
		}
		if (!user.profile.stats) {
			user.profile.stats = {
				gamesPlayed: 0,
				wins: 0,
				losses: 0,
				draws: 0,
				winRate: 0,
				winsByCheckmate: 0,
				winsByTimeout: 0,
				winsByResignation: 0,
				drawsByAgreement: 0,
				drawsByStalemate: 0,
				drawsByRepetition: 0,
				totalPlayTime: 0,
				averageGameTime: 0,
				fastestWin: null,
				longestGame: null,
				currentWinStreak: 0,
				bestWinStreak: 0,
				currentLossStreak: 0,
				totalMoves: 0,
				averageMovesPerGame: 0,
				monthlyStats: {}
			};
		}
		if (!user.profile.achievements) {
			user.profile.achievements = {
				firstWin: false,
				tenWins: false,
				hundredWins: false,
				winStreak5: false,
				winStreak10: false,
				fastWinner: false,
				timemaster: false,
				survivor: false,
				drawMaster: false,
				veteran: false,
				monthly: false,
				comeback: false
			};
		}
		if (!user.profile.ranking) {
			user.profile.ranking = {
				elo: 1200,
				rank: 'Novice',
				peakElo: 1200,
				seasonRank: 'Unranked'
			};
		}

		const stats = user.profile.stats;
		const achievements = user.profile.achievements;
		const ranking = user.profile.ranking;

		// Get current month key
		const now = new Date();
		const currentMonth = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}`;

		// Initialize monthly stats if needed
		if (!stats.monthlyStats) stats.monthlyStats = {};
		if (!stats.monthlyStats[currentMonth]) {
			stats.monthlyStats[currentMonth] = { games: 0, wins: 0, losses: 0, draws: 0 };
		}

		// Update basic stats
		stats.gamesPlayed++;
		stats.monthlyStats[currentMonth].games++;

		if (isWin) {
			stats.wins++;
			stats.monthlyStats[currentMonth].wins++;
			stats.currentWinStreak++;
			stats.currentLossStreak = 0;

			// Update best win streak
			if (stats.currentWinStreak > stats.bestWinStreak) {
				stats.bestWinStreak = stats.currentWinStreak;
			}

			// Track win methods
			switch (winMethod) {
				case 'checkmate':
					stats.winsByCheckmate++;
					break;
				case 'timeout':
					stats.winsByTimeout++;
					break;
				case 'resignation':
					stats.winsByResignation++;
					break;
			}

		} else if (isLoss) {
			stats.losses++;
			stats.monthlyStats[currentMonth].losses++;
			stats.currentWinStreak = 0;
			stats.currentLossStreak++;

		} else if (isDraw) {
			stats.draws++;
			stats.monthlyStats[currentMonth].draws++;
			stats.currentWinStreak = 0;
			stats.currentLossStreak = 0;

			// Track draw methods
			switch (winMethod) {
				case 'agreement':
					stats.drawsByAgreement++;
					break;
				case 'stalemate':
					stats.drawsByStalemate++;
					break;
				case 'repetition':
					stats.drawsByRepetition++;
					break;
			}
		}

		// Update time statistics
		if (gameTimeSeconds) {
			stats.totalPlayTime += gameTimeSeconds;
			stats.averageGameTime = Math.round(stats.totalPlayTime / stats.gamesPlayed);

			// Track fastest win
			if (isWin && (!stats.fastestWin || gameTimeSeconds < stats.fastestWin)) {
				stats.fastestWin = gameTimeSeconds;
			}

			// Track longest game
			if (!stats.longestGame || gameTimeSeconds > stats.longestGame) {
				stats.longestGame = gameTimeSeconds;
			}
		}

		// Update move statistics
		if (totalMoves) {
			stats.totalMoves += totalMoves;
			stats.averageMovesPerGame = Math.round(stats.totalMoves / stats.gamesPlayed);
		}

		// Calculate win rate
		stats.winRate = stats.gamesPlayed > 0 ?
			Math.round((stats.wins / stats.gamesPlayed) * 100) : 0;

		// Update ELO (simple calculation)
		let eloChange = 0;
		if (isWin) {
			eloChange = 30; // Win
		} else if (isLoss) {
			eloChange = -25; // Loss
		} else if (isDraw) {
			eloChange = 5; // Draw (slight positive)
		}

		const newElo = Math.max(800, ranking.elo + eloChange); // Minimum ELO of 800
		ranking.elo = newElo;
		ranking.peakElo = Math.max(ranking.peakElo, newElo);
		ranking.rank = getEloRank(newElo);
		ranking.seasonRank = getSeasonRank(newElo);

		// Check for achievements
		checkAndAwardAchievements(stats, achievements);

		// Update last active
		user.profile.lastActive = new Date();

		// Save the updated user
		await user.save();

		console.log(`📊 Game result recorded for ${user.username}:`, {
			result: isWin ? 'win' : isLoss ? 'loss' : 'draw',
			newElo: ranking.elo,
			gamesPlayed: stats.gamesPlayed
		});

		res.json({
			message: 'Game result recorded successfully',
			newElo: ranking.elo,
			newRank: ranking.rank
		});

	} catch (error) {
		console.error('❌ Error recording game result:', error);
		res.status(500).json({ error: 'Failed to record game result' });
	}
});

// Get leaderboard
router.get('/leaderboard', async (req, res) => {
	try {
		const { limit = 10, sortBy = 'elo' } = req.query;

		let sortCriteria = {};
		switch (sortBy) {
			case 'elo':
				sortCriteria = { 'profile.ranking.elo': -1 };
				break;
			case 'wins':
				sortCriteria = { 'profile.stats.wins': -1 };
				break;
			case 'games':
				sortCriteria = { 'profile.stats.gamesPlayed': -1 };
				break;
			case 'winRate':
				sortCriteria = { 'profile.stats.winRate': -1 };
				break;
			default:
				sortCriteria = { 'profile.ranking.elo': -1 };
		}

		const leaderboard = await User.find({ 'profile.ranking.elo': { $exists: true } })
			.select('username profile.displayName profile.avatar profile.ranking profile.stats')
			.sort(sortCriteria)
			.limit(parseInt(limit));

		const formattedLeaderboard = leaderboard.map((user, index) => ({
			rank: index + 1,
			username: user.username,
			displayName: user.profile?.displayName || user.username,
			avatar: user.profile?.avatar || '♔',
			elo: user.profile?.ranking?.elo || 1200,
			rank_title: user.profile?.ranking?.rank || 'Novice',
			seasonRank: user.profile?.ranking?.seasonRank || 'Unranked',
			wins: user.profile?.stats?.wins || 0,
			losses: user.profile?.stats?.losses || 0,
			draws: user.profile?.stats?.draws || 0,
			gamesPlayed: user.profile?.stats?.gamesPlayed || 0,
			winRate: user.profile?.stats?.winRate || 0
		}));

		res.json(formattedLeaderboard);
	} catch (error) {
		console.error('❌ Error fetching leaderboard:', error);
		res.status(500).json({ error: 'Failed to fetch leaderboard' });
	}
});

// Get user's rank position
router.get('/rank', verifyToken, async (req, res) => {
	try {
		const user = await User.findById(req.user.id);
		if (!user || !user.profile?.ranking) {
			return res.status(404).json({ error: 'Profile not found' });
		}

		const userElo = user.profile.ranking.elo;

		// Count how many users have higher ELO
		const higherRanked = await User.countDocuments({
			'profile.ranking.elo': { $gt: userElo }
		});

		const totalUsers = await User.countDocuments({
			'profile.ranking.elo': { $exists: true }
		});

		res.json({
			position: higherRanked + 1,
			totalPlayers: totalUsers,
			elo: userElo,
			rank: user.profile.ranking.rank,
			seasonRank: user.profile.ranking.seasonRank,
			percentile: totalUsers > 0 ? Math.round(((totalUsers - higherRanked) / totalUsers) * 100) : 0
		});
	} catch (error) {
		console.error('❌ Error fetching rank:', error);
		res.status(500).json({ error: 'Failed to fetch rank' });
	}
});

// Get achievement progress
router.get('/achievements', verifyToken, async (req, res) => {
	try {
		const user = await User.findById(req.user.id);

		if (!user || !user.profile) {
			return res.status(404).json({ error: 'Profile not found' });
		}

		const achievements = user.profile.achievements || {};
		const stats = user.profile.stats || {};

		const achievementList = [
			{
				id: 'firstWin',
				name: 'First Victory',
				description: 'Win your first game',
				icon: '🏆',
				unlocked: achievements.firstWin || false,
				progress: Math.min(stats.wins || 0, 1),
				target: 1
			},
			{
				id: 'tenWins',
				name: 'Ten Victories',
				description: 'Win 10 games',
				icon: '🥉',
				unlocked: achievements.tenWins || false,
				progress: Math.min(stats.wins || 0, 10),
				target: 10
			},
			{
				id: 'hundredWins',
				name: 'Century Champion',
				description: 'Win 100 games',
				icon: '🥇',
				unlocked: achievements.hundredWins || false,
				progress: Math.min(stats.wins || 0, 100),
				target: 100
			},
			{
				id: 'winStreak5',
				name: '5 Win Streak',
				description: 'Win 5 games in a row',
				icon: '🔥',
				unlocked: achievements.winStreak5 || false,
				progress: Math.min(stats.bestWinStreak || 0, 5),
				target: 5
			},
			{
				id: 'winStreak10',
				name: '10 Win Streak',
				description: 'Win 10 games in a row',
				icon: '⚡',
				unlocked: achievements.winStreak10 || false,
				progress: Math.min(stats.bestWinStreak || 0, 10),
				target: 10
			},
			{
				id: 'veteran',
				name: 'Veteran Player',
				description: 'Play 100 games',
				icon: '🎖️',
				unlocked: achievements.veteran || false,
				progress: Math.min(stats.gamesPlayed || 0, 100),
				target: 100
			},
			{
				id: 'drawMaster',
				name: 'Draw Master',
				description: 'Achieve 10 draws',
				icon: '🤝',
				unlocked: achievements.drawMaster || false,
				progress: Math.min(stats.draws || 0, 10),
				target: 10
			}
		];

		res.json(achievementList);
	} catch (error) {
		console.error('❌ Error fetching achievements:', error);
		res.status(500).json({ error: 'Failed to fetch achievements' });
	}
});

// Reset profile (for development/testing)
router.delete('/', verifyToken, async (req, res) => {
	try {
		const user = await User.findById(req.user.id);
		if (!user) {
			return res.status(404).json({ error: 'User not found' });
		}

		// Reset profile to defaults
		user.profile = {
			displayName: user.username,
			avatar: '♔',
			joinDate: new Date(),
			lastActive: new Date(),
			stats: {
				gamesPlayed: 0,
				wins: 0,
				losses: 0,
				draws: 0,
				winRate: 0,
				winsByCheckmate: 0,
				winsByTimeout: 0,
				winsByResignation: 0,
				drawsByAgreement: 0,
				drawsByStalemate: 0,
				drawsByRepetition: 0,
				totalPlayTime: 0,
				averageGameTime: 0,
				fastestWin: null,
				longestGame: null,
				currentWinStreak: 0,
				bestWinStreak: 0,
				currentLossStreak: 0,
				totalMoves: 0,
				averageMovesPerGame: 0,
				monthlyStats: {}
			},
			achievements: {
				firstWin: false,
				tenWins: false,
				hundredWins: false,
				winStreak5: false,
				winStreak10: false,
				fastWinner: false,
				timemaster: false,
				survivor: false,
				drawMaster: false,
				veteran: false,
				monthly: false,
				comeback: false
			},
			preferences: {
				theme: 'dark',
				boardStyle: 'classic',
				pieceStyle: 'traditional',
				soundEffects: true,
				showCoordinates: true,
				highlightMoves: true,
				autoQueen: false,
				confirmMoves: false,
				animationSpeed: 'normal'
			},
			ranking: {
				elo: 1200,
				rank: 'Novice',
				peakElo: 1200,
				seasonRank: 'Unranked'
			}
		};

		await user.save();

		console.log('🔄 Profile reset for user:', user.username);
		res.json({ message: 'Profile reset successfully' });
	} catch (error) {
		console.error('❌ Error resetting profile:', error);
		res.status(500).json({ error: 'Failed to reset profile' });
	}
});

// Helper functions
function getEloRank(elo) {
	if (elo >= 2200) return 'Grandmaster';
	if (elo >= 2000) return 'Master';
	if (elo >= 1800) return 'Expert';
	if (elo >= 1600) return 'Advanced';
	if (elo >= 1400) return 'Intermediate';
	if (elo >= 1200) return 'Novice';
	return 'Beginner';
}

function getSeasonRank(elo) {
	if (elo >= 2100) return 'Diamond';
	if (elo >= 1900) return 'Platinum';
	if (elo >= 1700) return 'Gold';
	if (elo >= 1500) return 'Silver';
	if (elo >= 1300) return 'Bronze';
	return 'Iron';
}

function checkAndAwardAchievements(stats, achievements) {
	// First Win
	if (stats.wins >= 1 && !achievements.firstWin) {
		achievements.firstWin = true;
		console.log('🏅 Achievement Unlocked: First Victory!');
	}

	// Ten Wins
	if (stats.wins >= 10 && !achievements.tenWins) {
		achievements.tenWins = true;
		console.log('🏅 Achievement Unlocked: Ten Victories!');
	}

	// Hundred Wins
	if (stats.wins >= 100 && !achievements.hundredWins) {
		achievements.hundredWins = true;
		console.log('🏅 Achievement Unlocked: Century Champion!');
	}

	// Win Streaks
	if (stats.currentWinStreak >= 5 && !achievements.winStreak5) {
		achievements.winStreak5 = true;
		console.log('🏅 Achievement Unlocked: 5 Win Streak!');
	}

	if (stats.currentWinStreak >= 10 && !achievements.winStreak10) {
		achievements.winStreak10 = true;
		console.log('🏅 Achievement Unlocked: 10 Win Streak!');
	}

	// Veteran (100 games)
	if (stats.gamesPlayed >= 100 && !achievements.veteran) {
		achievements.veteran = true;
		console.log('🏅 Achievement Unlocked: Veteran Player!');
	}

	// Draw Master
	if (stats.draws >= 10 && !achievements.drawMaster) {
		achievements.drawMaster = true;
		console.log('🏅 Achievement Unlocked: Draw Master!');
	}
}

// Get user profile by username (public view)
router.get('/user/:username', async (req, res) => {
	try {
		const { username } = req.params;

		const user = await User.findOne({ username }).select('-password');
		if (!user) {
			return res.status(404).json({ error: 'User not found' });
		}

		// Return public profile information
		res.json({
			user: {
				username: user.username,
				joinDate: user.createdAt
			},
			profile: user.profile || getDefaultProfile()
		});

	} catch (error) {
		console.error('❌ Error fetching user profile by username:', error);
		res.status(500).json({ error: 'Failed to fetch user profile' });
	}
});

// ===== PROFILE UPDATE FUNCTIONS =====
// These functions are called when games are completed to update player statistics

// Calculate ELO rating change
function calculateEloChange(playerElo, opponentElo, result, kFactor = 32) {
	const expectedScore = 1 / (1 + Math.pow(10, (opponentElo - playerElo) / 400));
	const actualScore = result; // 1 for win, 0.5 for draw, 0 for loss
	const eloChange = Math.round(kFactor * (actualScore - expectedScore));
	return eloChange;
}

// Calculate win rate percentage
function calculateWinRate(wins, losses, draws) {
	const totalGames = wins + losses + draws;
	if (totalGames === 0) return 0;
	return Math.round((wins / totalGames) * 100);
}

// Update profile stats when a game is completed
async function updateGameResult(playerId, opponentId, result, winMethod, gameDuration, moveCount) {
	try {
		console.log('📊 Updating game result for player:', playerId, 'Result:', result, 'Method:', winMethod);

		const player = await User.findById(playerId);
		const opponent = await User.findById(opponentId);

		if (!player || !opponent) {
			console.error('❌ Player or opponent not found');
			return;
		}

		// Initialize profile if doesn't exist
		if (!player.profile) {
			player.profile = getDefaultProfile();
		}
		if (!opponent.profile) {
			opponent.profile = getDefaultProfile();
		}

		// Get current ELO ratings
		const playerElo = player.profile.ranking?.elo || 1200;
		const opponentElo = opponent.profile.ranking?.elo || 1200;

		// Calculate ELO changes
		let playerResult, opponentResult;
		if (result === 'win') {
			playerResult = 1;
			opponentResult = 0;
		} else if (result === 'draw') {
			playerResult = 0.5;
			opponentResult = 0.5;
		} else { // result === 'loss'
			playerResult = 0;
			opponentResult = 1;
		}

		const playerEloChange = calculateEloChange(playerElo, opponentElo, playerResult);
		const opponentEloChange = calculateEloChange(opponentElo, playerElo, opponentResult);

		const newPlayerElo = Math.max(100, playerElo + playerEloChange); // Minimum ELO of 100
		const newOpponentElo = Math.max(100, opponentElo + opponentEloChange);

		// Update player stats
		const playerStats = player.profile.stats || {};
		playerStats.gamesPlayed = (playerStats.gamesPlayed || 0) + 1;

		if (result === 'win') {
			playerStats.wins = (playerStats.wins || 0) + 1;

			// Update win method stats
			if (winMethod === 'checkmate') {
				playerStats.winsByCheckmate = (playerStats.winsByCheckmate || 0) + 1;
			} else if (winMethod === 'resignation') {
				playerStats.winsByResignation = (playerStats.winsByResignation || 0) + 1;
			} else if (winMethod === 'timeout') {
				playerStats.winsByTimeout = (playerStats.winsByTimeout || 0) + 1;
			}

			// Update win streak
			playerStats.currentWinStreak = (playerStats.currentWinStreak || 0) + 1;
			playerStats.bestWinStreak = Math.max(
				playerStats.bestWinStreak || 0,
				playerStats.currentWinStreak
			);
			playerStats.currentLossStreak = 0;

		} else if (result === 'draw') {
			playerStats.draws = (playerStats.draws || 0) + 1;

			// Update draw method stats
			if (winMethod === 'stalemate') {
				playerStats.drawsByStalemate = (playerStats.drawsByStalemate || 0) + 1;
			} else if (winMethod === 'threefold') {
				playerStats.drawsByRepetition = (playerStats.drawsByRepetition || 0) + 1;
			} else {
				playerStats.drawsByAgreement = (playerStats.drawsByAgreement || 0) + 1;
			}

			// Reset streaks on draw
			playerStats.currentWinStreak = 0;
			playerStats.currentLossStreak = 0;

		} else { // loss
			playerStats.losses = (playerStats.losses || 0) + 1;
			playerStats.currentLossStreak = (playerStats.currentLossStreak || 0) + 1;
			playerStats.currentWinStreak = 0;
		}

		// Update time and move statistics
		playerStats.totalPlayTime = (playerStats.totalPlayTime || 0) + gameDuration;
		playerStats.totalMoves = (playerStats.totalMoves || 0) + moveCount;

		const totalGames = playerStats.gamesPlayed;
		playerStats.averageGameTime = Math.round(playerStats.totalPlayTime / totalGames);
		playerStats.averageMovesPerGame = Math.round(playerStats.totalMoves / totalGames);

		// Update fastest win if applicable
		if (result === 'win') {
			if (!playerStats.fastestWin || gameDuration < playerStats.fastestWin) {
				playerStats.fastestWin = gameDuration;
			}
		}

		// Update longest game
		if (!playerStats.longestGame || gameDuration > playerStats.longestGame) {
			playerStats.longestGame = gameDuration;
		}

		// Calculate new win rate
		playerStats.winRate = calculateWinRate(
			playerStats.wins || 0,
			playerStats.losses || 0,
			playerStats.draws || 0
		);

		// Update ELO and ranking
		player.profile.ranking = player.profile.ranking || {};
		player.profile.ranking.elo = newPlayerElo;
		player.profile.ranking.peakElo = Math.max(
			player.profile.ranking.peakElo || 1200,
			newPlayerElo
		);

		// Update rank based on ELO
		if (newPlayerElo >= 2400) player.profile.ranking.rank = 'Grandmaster';
		else if (newPlayerElo >= 2200) player.profile.ranking.rank = 'Master';
		else if (newPlayerElo >= 2000) player.profile.ranking.rank = 'Expert';
		else if (newPlayerElo >= 1800) player.profile.ranking.rank = 'Advanced';
		else if (newPlayerElo >= 1600) player.profile.ranking.rank = 'Intermediate';
		else if (newPlayerElo >= 1400) player.profile.ranking.rank = 'Beginner';
		else player.profile.ranking.rank = 'Novice';

		// Update monthly stats
		const currentMonth = new Date().toISOString().substring(0, 7); // YYYY-MM
		if (!playerStats.monthlyStats) playerStats.monthlyStats = {};
		if (!playerStats.monthlyStats[currentMonth]) {
			playerStats.monthlyStats[currentMonth] = { games: 0, wins: 0, losses: 0, draws: 0 };
		}

		playerStats.monthlyStats[currentMonth].games++;
		if (result === 'win') playerStats.monthlyStats[currentMonth].wins++;
		else if (result === 'loss') playerStats.monthlyStats[currentMonth].losses++;
		else playerStats.monthlyStats[currentMonth].draws++;

		// Update last active time
		player.profile.lastActive = new Date();

		// Save player updates
		await player.save();

		// Do the same for opponent (with opposite result)
		const opponentResult2 = result === 'win' ? 'loss' : result === 'loss' ? 'win' : 'draw';
		await updateOpponentStats(opponent, opponentResult2, winMethod, gameDuration, moveCount, newOpponentElo);

		// Check and unlock achievements for both players
		await checkAndUnlockAchievements(playerId);
		await checkAndUnlockAchievements(opponentId);

		console.log('✅ Profile stats updated successfully');
		console.log(`📊 ${player.username}: ${playerElo} -> ${newPlayerElo} (${playerEloChange > 0 ? '+' : ''}${playerEloChange})`);
		console.log(`📊 ${opponent.username}: ${opponentElo} -> ${newOpponentElo} (${opponentEloChange > 0 ? '+' : ''}${opponentEloChange})`);

	} catch (error) {
		console.error('❌ Error updating game result:', error);
	}
}

// Helper function to update opponent stats
async function updateOpponentStats(opponent, result, winMethod, gameDuration, moveCount, newElo) {
	const opponentStats = opponent.profile.stats || {};
	opponentStats.gamesPlayed = (opponentStats.gamesPlayed || 0) + 1;

	if (result === 'win') {
		opponentStats.wins = (opponentStats.wins || 0) + 1;
		if (winMethod === 'checkmate') opponentStats.winsByCheckmate = (opponentStats.winsByCheckmate || 0) + 1;
		else if (winMethod === 'resignation') opponentStats.winsByResignation = (opponentStats.winsByResignation || 0) + 1;
		else if (winMethod === 'timeout') opponentStats.winsByTimeout = (opponentStats.winsByTimeout || 0) + 1;

		opponentStats.currentWinStreak = (opponentStats.currentWinStreak || 0) + 1;
		opponentStats.bestWinStreak = Math.max(opponentStats.bestWinStreak || 0, opponentStats.currentWinStreak);
		opponentStats.currentLossStreak = 0;

		if (!opponentStats.fastestWin || gameDuration < opponentStats.fastestWin) {
			opponentStats.fastestWin = gameDuration;
		}
	} else if (result === 'draw') {
		opponentStats.draws = (opponentStats.draws || 0) + 1;
		if (winMethod === 'stalemate') opponentStats.drawsByStalemate = (opponentStats.drawsByStalemate || 0) + 1;
		else if (winMethod === 'threefold') opponentStats.drawsByRepetition = (opponentStats.drawsByRepetition || 0) + 1;
		else opponentStats.drawsByAgreement = (opponentStats.drawsByAgreement || 0) + 1;

		opponentStats.currentWinStreak = 0;
		opponentStats.currentLossStreak = 0;
	} else { // loss
		opponentStats.losses = (opponentStats.losses || 0) + 1;
		opponentStats.currentLossStreak = (opponentStats.currentLossStreak || 0) + 1;
		opponentStats.currentWinStreak = 0;
	}

	// Update time and move stats
	opponentStats.totalPlayTime = (opponentStats.totalPlayTime || 0) + gameDuration;
	opponentStats.totalMoves = (opponentStats.totalMoves || 0) + moveCount;
	opponentStats.averageGameTime = Math.round(opponentStats.totalPlayTime / opponentStats.gamesPlayed);
	opponentStats.averageMovesPerGame = Math.round(opponentStats.totalMoves / opponentStats.gamesPlayed);

	if (!opponentStats.longestGame || gameDuration > opponentStats.longestGame) {
		opponentStats.longestGame = gameDuration;
	}

	// Update win rate
	opponentStats.winRate = calculateWinRate(
		opponentStats.wins || 0,
		opponentStats.losses || 0,
		opponentStats.draws || 0
	);

	// Update ELO and ranking
	opponent.profile.ranking = opponent.profile.ranking || {};
	opponent.profile.ranking.elo = newElo;
	opponent.profile.ranking.peakElo = Math.max(opponent.profile.ranking.peakElo || 1200, newElo);

	// Update rank
	if (newElo >= 2400) opponent.profile.ranking.rank = 'Grandmaster';
	else if (newElo >= 2200) opponent.profile.ranking.rank = 'Master';
	else if (newElo >= 2000) opponent.profile.ranking.rank = 'Expert';
	else if (newElo >= 1800) opponent.profile.ranking.rank = 'Advanced';
	else if (newElo >= 1600) opponent.profile.ranking.rank = 'Intermediate';
	else if (newElo >= 1400) opponent.profile.ranking.rank = 'Beginner';
	else opponent.profile.ranking.rank = 'Novice';

	// Update monthly stats
	const currentMonth = new Date().toISOString().substring(0, 7);
	if (!opponentStats.monthlyStats) opponentStats.monthlyStats = {};
	if (!opponentStats.monthlyStats[currentMonth]) {
		opponentStats.monthlyStats[currentMonth] = { games: 0, wins: 0, losses: 0, draws: 0 };
	}

	opponentStats.monthlyStats[currentMonth].games++;
	if (result === 'win') opponentStats.monthlyStats[currentMonth].wins++;
	else if (result === 'loss') opponentStats.monthlyStats[currentMonth].losses++;
	else opponentStats.monthlyStats[currentMonth].draws++;

	opponent.profile.lastActive = new Date();
	await opponent.save();
}

// Check and unlock achievements based on current stats
async function checkAndUnlockAchievements(playerId) {
	try {
		const user = await User.findById(playerId);
		if (!user || !user.profile) return;

		const stats = user.profile.stats || {};
		const achievements = user.profile.achievements || {};
		let newAchievements = false;

		// First Win
		if ((stats.wins || 0) >= 1 && !achievements.firstWin) {
			achievements.firstWin = true;
			newAchievements = true;
			console.log('🏆 Achievement unlocked: First Victory');
		}

		// Ten Wins
		if ((stats.wins || 0) >= 10 && !achievements.tenWins) {
			achievements.tenWins = true;
			newAchievements = true;
			console.log('🏆 Achievement unlocked: Ten Victories');
		}

		// Hundred Wins
		if ((stats.wins || 0) >= 100 && !achievements.hundredWins) {
			achievements.hundredWins = true;
			newAchievements = true;
			console.log('🏆 Achievement unlocked: Century Champion');
		}

		// Win Streak 5
		if ((stats.currentWinStreak || 0) >= 5 && !achievements.winStreak5) {
			achievements.winStreak5 = true;
			newAchievements = true;
			console.log('🏆 Achievement unlocked: 5 Win Streak');
		}

		// Win Streak 10
		if ((stats.currentWinStreak || 0) >= 10 && !achievements.winStreak10) {
			achievements.winStreak10 = true;
			newAchievements = true;
			console.log('🏆 Achievement unlocked: 10 Win Streak');
		}

		// Draw Master
		if ((stats.draws || 0) >= 10 && !achievements.drawMaster) {
			achievements.drawMaster = true;
			newAchievements = true;
			console.log('🏆 Achievement unlocked: Draw Master');
		}

		// Veteran (100 games played)
		if ((stats.gamesPlayed || 0) >= 100 && !achievements.veteran) {
			achievements.veteran = true;
			newAchievements = true;
			console.log('🏆 Achievement unlocked: Veteran Player');
		}

		// Fast Winner (win in under 300 seconds = 5 minutes)
		if ((stats.fastestWin || Infinity) <= 300 && !achievements.fastWinner) {
			achievements.fastWinner = true;
			newAchievements = true;
			console.log('🏆 Achievement unlocked: Fast Winner');
		}

		// Time Master (game longer than 1 hour = 3600 seconds)
		if ((stats.longestGame || 0) >= 3600 && !achievements.timemaster) {
			achievements.timemaster = true;
			newAchievements = true;
			console.log('🏆 Achievement unlocked: Time Master');
		}

		// Comeback Kid (win after having a loss streak of 5+)
		// This would need to be tracked separately during gameplay

		if (newAchievements) {
			user.profile.achievements = achievements;
			await user.save();
			console.log('✅ Achievements updated for user:', user.username);
		}

	} catch (error) {
		console.error('❌ Error checking achievements:', error);
	}
}

// Function to record when a game starts (for tracking game participation)
async function recordGameStart(hostId, opponentId) {
	try {
		console.log('📊 Recording game start for players:', hostId, opponentId);

		// This could be used to track active games, update "currently playing" status, etc.
		// For now, we'll just update last active time

		const updates = { 'profile.lastActive': new Date() };
		await User.updateMany(
			{ _id: { $in: [hostId, opponentId] } },
			{ $set: updates }
		);

		console.log('✅ Game start recorded');

	} catch (error) {
		console.error('❌ Error recording game start:', error);
	}
}

// Export functions for use in game routes
module.exports = router;
module.exports.updateGameResult = updateGameResult;
module.exports.recordGameStart = recordGameStart;
