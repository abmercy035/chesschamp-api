const mongoose = require('mongoose');

const UserProfileSchema = new mongoose.Schema({
	userId: {
		type: mongoose.Schema.Types.ObjectId,
		ref: 'User',
		required: true,
		unique: true
	},

	// Basic Profile Info
	displayName: { type: String, default: '' },
	avatar: { type: String, default: '♔' },

	// Statistics
	stats: {
		gamesPlayed: { type: Number, default: 0 },
		wins: { type: Number, default: 0 },
		losses: { type: Number, default: 0 },
		draws: { type: Number, default: 0 },
		winRate: { type: Number, default: 0 },

		// Game Outcomes
		winsByCheckmate: { type: Number, default: 0 },
		winsByTimeout: { type: Number, default: 0 },
		winsByResignation: { type: Number, default: 0 },
		drawsByAgreement: { type: Number, default: 0 },
		drawsByStalemate: { type: Number, default: 0 },
		drawsByRepetition: { type: Number, default: 0 },

		// Time Statistics
		totalPlayTime: { type: Number, default: 0 }, // in seconds
		averageGameTime: { type: Number, default: 0 },
		fastestWin: { type: Number, default: null },
		longestGame: { type: Number, default: null },

		// Streak Statistics
		currentWinStreak: { type: Number, default: 0 },
		bestWinStreak: { type: Number, default: 0 },
		currentLossStreak: { type: Number, default: 0 },

		// Move Statistics
		totalMoves: { type: Number, default: 0 },
		averageMovesPerGame: { type: Number, default: 0 }
	},

	// Achievements
	achievements: {
		firstWin: { type: Boolean, default: false },
		tenWins: { type: Boolean, default: false },
		hundredWins: { type: Boolean, default: false },
		winStreak5: { type: Boolean, default: false },
		winStreak10: { type: Boolean, default: false },
		fastWinner: { type: Boolean, default: false },
		timemaster: { type: Boolean, default: false },
		survivor: { type: Boolean, default: false },
		drawMaster: { type: Boolean, default: false },
		veteran: { type: Boolean, default: false },
		monthly: { type: Boolean, default: false },
		comeback: { type: Boolean, default: false }
	},

	// Preferences
	preferences: {
		theme: { type: String, default: 'dark' },
		boardStyle: { type: String, default: 'classic' },
		pieceStyle: { type: String, default: 'traditional' },
		soundEffects: { type: Boolean, default: true },
		showCoordinates: { type: Boolean, default: true },
		highlightMoves: { type: Boolean, default: true },
		autoQueen: { type: Boolean, default: false },
		confirmMoves: { type: Boolean, default: false },
		animationSpeed: { type: String, default: 'normal' }
	},

	// Ranking System
	ranking: {
		elo: { type: Number, default: 1200 },
		rank: { type: String, default: 'Novice' },
		peakElo: { type: Number, default: 1200 },
		seasonRank: { type: String, default: 'Unranked' }
	},

	// Game History (reference to games)
	gameHistory: [{
		gameId: { type: mongoose.Schema.Types.ObjectId, ref: 'Game' },
		result: { type: String, enum: ['win', 'loss', 'draw'] },
		method: { type: String }, // checkmate, timeout, resignation, etc.
		duration: { type: Number }, // game duration in seconds
		moves: { type: Number }, // total moves in game
		eloChange: { type: Number }, // ELO change from this game
		timestamp: { type: Date, default: Date.now }
	}],

	createdAt: { type: Date, default: Date.now },
	updatedAt: { type: Date, default: Date.now }
});

// Update the updatedAt field before saving
UserProfileSchema.pre('save', function (next) {
	this.updatedAt = new Date();
	next();
});

// Calculate win rate before saving
UserProfileSchema.pre('save', function (next) {
	if (this.stats.gamesPlayed > 0) {
		this.stats.winRate = Math.round((this.stats.wins / this.stats.gamesPlayed) * 100);
	}
	next();
});

// Calculate average game time before saving
UserProfileSchema.pre('save', function (next) {
	if (this.stats.gamesPlayed > 0) {
		this.stats.averageGameTime = Math.round(this.stats.totalPlayTime / this.stats.gamesPlayed);
	}
	next();
});

// Calculate average moves per game before saving
UserProfileSchema.pre('save', function (next) {
	if (this.stats.gamesPlayed > 0) {
		this.stats.averageMovesPerGame = Math.round(this.stats.totalMoves / this.stats.gamesPlayed);
	}
	next();
});

// Method to determine rank based on ELO
UserProfileSchema.methods.updateRank = function () {
	const elo = this.ranking.elo;

	if (elo >= 2200) this.ranking.rank = 'Grandmaster';
	else if (elo >= 2000) this.ranking.rank = 'Master';
	else if (elo >= 1800) this.ranking.rank = 'Expert';
	else if (elo >= 1600) this.ranking.rank = 'Advanced';
	else if (elo >= 1400) this.ranking.rank = 'Intermediate';
	else if (elo >= 1200) this.ranking.rank = 'Novice';
	else this.ranking.rank = 'Beginner';

	// Update season rank
	if (elo >= 2100) this.ranking.seasonRank = 'Diamond';
	else if (elo >= 1900) this.ranking.seasonRank = 'Platinum';
	else if (elo >= 1700) this.ranking.seasonRank = 'Gold';
	else if (elo >= 1500) this.ranking.seasonRank = 'Silver';
	else if (elo >= 1300) this.ranking.seasonRank = 'Bronze';
	else this.ranking.seasonRank = 'Iron';
};

// Method to add game result
UserProfileSchema.methods.addGameResult = function (gameData) {
	const { result, method, duration, moves, isWin, isLoss, isDraw } = gameData;

	// Update basic stats
	this.stats.gamesPlayed++;

	if (isWin) {
		this.stats.wins++;
		this.stats.currentWinStreak++;
		this.stats.currentLossStreak = 0;

		if (this.stats.currentWinStreak > this.stats.bestWinStreak) {
			this.stats.bestWinStreak = this.stats.currentWinStreak;
		}

		// Track win methods
		switch (method) {
			case 'checkmate':
				this.stats.winsByCheckmate++;
				break;
			case 'timeout':
				this.stats.winsByTimeout++;
				break;
			case 'resignation':
				this.stats.winsByResignation++;
				break;
		}
	} else if (isLoss) {
		this.stats.losses++;
		this.stats.currentWinStreak = 0;
		this.stats.currentLossStreak++;
	} else if (isDraw) {
		this.stats.draws++;
		this.stats.currentWinStreak = 0;
		this.stats.currentLossStreak = 0;

		// Track draw methods
		switch (method) {
			case 'agreement':
				this.stats.drawsByAgreement++;
				break;
			case 'stalemate':
				this.stats.drawsByStalemate++;
				break;
			case 'repetition':
				this.stats.drawsByRepetition++;
				break;
		}
	}

	// Update time statistics
	if (duration) {
		this.stats.totalPlayTime += duration;

		if (isWin && (!this.stats.fastestWin || duration < this.stats.fastestWin)) {
			this.stats.fastestWin = duration;
		}

		if (!this.stats.longestGame || duration > this.stats.longestGame) {
			this.stats.longestGame = duration;
		}
	}

	// Update move statistics
	if (moves) {
		this.stats.totalMoves += moves;
	}

	// Update ELO
	let eloChange = 0;
	if (isWin) {
		eloChange = 30;
	} else if (isLoss) {
		eloChange = -25;
	} else if (isDraw) {
		eloChange = 5;
	}

	this.ranking.elo = Math.max(800, this.ranking.elo + eloChange);
	this.ranking.peakElo = Math.max(this.ranking.peakElo, this.ranking.elo);

	// Update rank
	this.updateRank();

	// Check achievements
	this.checkAchievements();

	// Add to game history
	this.gameHistory.push({
		result,
		method,
		duration,
		moves,
		eloChange,
		timestamp: new Date()
	});

	// Keep only last 100 games in history
	if (this.gameHistory.length > 100) {
		this.gameHistory = this.gameHistory.slice(-100);
	}
};

// Method to check and unlock achievements
UserProfileSchema.methods.checkAchievements = function () {
	// First Win
	if (this.stats.wins >= 1 && !this.achievements.firstWin) {
		this.achievements.firstWin = true;
	}

	// Ten Wins
	if (this.stats.wins >= 10 && !this.achievements.tenWins) {
		this.achievements.tenWins = true;
	}

	// Hundred Wins
	if (this.stats.wins >= 100 && !this.achievements.hundredWins) {
		this.achievements.hundredWins = true;
	}

	// Win Streaks
	if (this.stats.currentWinStreak >= 5 && !this.achievements.winStreak5) {
		this.achievements.winStreak5 = true;
	}

	if (this.stats.currentWinStreak >= 10 && !this.achievements.winStreak10) {
		this.achievements.winStreak10 = true;
	}

	// Veteran (100 games)
	if (this.stats.gamesPlayed >= 100 && !this.achievements.veteran) {
		this.achievements.veteran = true;
	}

	// Draw Master
	if (this.stats.draws >= 10 && !this.achievements.drawMaster) {
		this.achievements.drawMaster = true;
	}
};

module.exports = mongoose.model('UserProfile', UserProfileSchema);
