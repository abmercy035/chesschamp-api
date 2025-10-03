const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
	// Basic Info
	name: { type: String },
	email: { type: String, required: true, unique: true },
	username: { type: String, required: true, unique: true },
	password: { type: String, required: true },
	age: { type: Number, required: true, min: 13, max: 120 },
	country: { type: String, required: true },

	// User Role
	role: { type: String, enum: ['user', 'admin'], default: 'user' },
	isAdmin: { type: Boolean, default: false },

	// Profile Data
	profile: {
		displayName: { type: String, default: '' },
		avatar: { type: String, default: '♔' },
		joinDate: { type: Date, default: Date.now },
		lastActive: { type: Date, default: Date.now },

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

			// Advanced Stats
			totalMoves: { type: Number, default: 0 },
			averageMovesPerGame: { type: Number, default: 0 },

			// Battle Actions
			drawsOffered: { type: Number, default: 0 },
			resignations: { type: Number, default: 0 },

			// Monthly Stats (stored as key-value pairs)
			monthlyStats: { type: mongoose.Schema.Types.Mixed, default: {} }
		},

		// Achievements & Badges
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

		// Preferences & Settings
		preferences: {
			theme: { type: String, default: 'dark' },
			boardStyle: { type: String, default: 'classic' },
			pieceStyle: { type: String, default: 'traditional' },
			soundEffects: { type: Boolean, default: true },
			showCoordinates: { type: Boolean, default: true },
			highlightMoves: { type: Boolean, default: true },
			autoQueen: { type: Boolean, default: false },
			confirmMoves: { type: Boolean, default: false }
		},

		// Ranking System
		ranking: {
			elo: { type: Number, default: 1200 },
			rank: { type: String, default: 'Novice' },
			peakElo: { type: Number, default: 1200 },
			seasonRank: { type: String, default: 'Unranked' }
		}
	}
}, {
	timestamps: true // Adds createdAt and updatedAt fields
});

module.exports = mongoose.model('User', UserSchema);
