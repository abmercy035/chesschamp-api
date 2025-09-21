const mongoose = require('mongoose');

const TournamentSchema = new mongoose.Schema({
	name: { type: String, required: true },
	description: { type: String },

	// Tournament Settings
	type: {
		type: String,
		enum: ['single-elimination', 'round-robin', 'swiss', 'seasonal'],
		default: 'single-elimination'
	},
	format: {
		type: String,
		enum: ['blitz', 'rapid', 'classical'],
		default: 'rapid'
	},
	timeControl: {
		initial: { type: Number, default: 600 }, // 10 minutes
		increment: { type: Number, default: 5 }  // 5 seconds
	},

	// Tournament Status
	status: {
		type: String,
		enum: ['upcoming', 'registration', 'active', 'completed', 'cancelled'],
		default: 'upcoming'
	},

	// Dates
	registrationStart: { type: Date },
	registrationEnd: { type: Date },
	startDate: { type: Date },
	endDate: { type: Date },

	// Participants
	participants: [{
		player: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
		registeredAt: { type: Date, default: Date.now },
		seed: { type: Number }, // Tournament seeding
		score: { type: Number, default: 0 },
		wins: { type: Number, default: 0 },
		losses: { type: Number, default: 0 },
		draws: { type: Number, default: 0 },
		tiebreakers: {
			buchholz: { type: Number, default: 0 },
			sonneborn: { type: Number, default: 0 }
		},
		eliminated: { type: Boolean, default: false },
		finalRank: { type: Number }
	}],

	// Tournament Games
	games: [{
		round: { type: Number },
		white: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
		black: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
		game: { type: mongoose.Schema.Types.ObjectId, ref: 'Game' },
		result: { type: String, enum: ['white', 'black', 'draw', 'pending'] },
		scheduledTime: { type: Date }
	}],

	// Tournament Structure
	maxParticipants: { type: Number, default: 32 },
	minParticipants: { type: Number, default: 4 },
	currentRound: { type: Number, default: 0 },
	totalRounds: { type: Number },

	// Prizes & Rewards
	prizePool: {
		first: { type: String },
		second: { type: String },
		third: { type: String },
		participation: { type: String }
	},

	// Tournament Director
	organizer: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

	// Statistics
	stats: {
		totalGames: { type: Number, default: 0 },
		completedGames: { type: Number, default: 0 },
		averageRating: { type: Number, default: 0 },
		topRating: { type: Number, default: 0 }
	},

	// Season Info (for seasonal tournaments)
	season: {
		year: { type: Number },
		month: { type: Number },
		quarter: { type: Number }
	}
}, {
	timestamps: true
});

// Indexes for better query performance
TournamentSchema.index({ status: 1, startDate: 1 });
TournamentSchema.index({ 'season.year': 1, 'season.month': 1 });
TournamentSchema.index({ type: 1, status: 1 });

// Tournament Methods
TournamentSchema.methods.getLeaderboard = function () {
	return this.participants
		.sort((a, b) => {
			// Sort by score first, then by tiebreakers
			if (b.score !== a.score) return b.score - a.score;
			if (b.tiebreakers.buchholz !== a.tiebreakers.buchholz) return b.tiebreakers.buchholz - a.tiebreakers.buchholz;
			return b.tiebreakers.sonneborn - a.tiebreakers.sonneborn;
		})
		.map((participant, index) => ({
			rank: index + 1,
			player: participant.player,
			score: participant.score,
			wins: participant.wins,
			losses: participant.losses,
			draws: participant.draws,
			tiebreakers: participant.tiebreakers
		}));
};

TournamentSchema.methods.canRegister = function () {
	const now = new Date();
	return this.status === 'registration' &&
		now >= this.registrationStart &&
		now <= this.registrationEnd &&
		this.participants.length < this.maxParticipants;
};

module.exports = mongoose.model('Tournament', TournamentSchema);
