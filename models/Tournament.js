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

// Generate tournament bracket based on type
TournamentSchema.methods.generateBracket = async function () {
	const participants = this.participants.filter(p => !p.eliminated);

	if (participants.length < 2) {
		throw new Error('Need at least 2 participants to generate bracket');
	}

	switch (this.type) {
		case 'single-elimination':
			return this.generateSingleEliminationBracket(participants);
		case 'round-robin':
			return this.generateRoundRobinBracket(participants);
		case 'swiss':
			return this.generateSwissBracket(participants);
		default:
			throw new Error(`Bracket generation not implemented for type: ${this.type}`);
	}
};

// Single Elimination Bracket
TournamentSchema.methods.generateSingleEliminationBracket = function (participants) {
	// Sort participants by ELO for seeding
	const seededParticipants = participants.sort((a, b) =>
		(b.player.profile?.ranking?.elo || 1200) - (a.player.profile?.ranking?.elo || 1200)
	);

	// Calculate total rounds needed
	this.totalRounds = Math.ceil(Math.log2(participants.length));

	// Generate first round pairings
	const firstRoundPairings = [];
	for (let i = 0; i < seededParticipants.length; i += 2) {
		if (i + 1 < seededParticipants.length) {
			firstRoundPairings.push({
				round: 1,
				white: seededParticipants[i].player,
				black: seededParticipants[i + 1].player,
				result: 'pending',
				bracketPosition: Math.floor(i / 2)
			});
		}
	}

	// Initialize rounds structure
	this.rounds = [{ games: firstRoundPairings }];
	for (let round = 2; round <= this.totalRounds; round++) {
		this.rounds.push({ games: [] });
	}

	return {
		type: 'single-elimination',
		totalRounds: this.totalRounds,
		currentRound: 1,
		bracket: this.rounds[0].games
	};
};

// Round Robin Bracket
TournamentSchema.methods.generateRoundRobinBracket = function (participants) {
	const numParticipants = participants.length;
	this.totalRounds = numParticipants - 1;

	// Generate all possible pairings
	const allPairings = [];

	for (let round = 0; round < this.totalRounds; round++) {
		const roundPairings = [];

		for (let i = 0; i < numParticipants / 2; i++) {
			const player1Index = (round + i) % numParticipants;
			const player2Index = (numParticipants - 1 - i + round) % numParticipants;

			if (player1Index !== player2Index) {
				roundPairings.push({
					round: round + 1,
					white: participants[player1Index].player,
					black: participants[player2Index].player,
					result: 'pending'
				});
			}
		}

		allPairings.push({ games: roundPairings });
	}

	this.rounds = allPairings;

	return {
		type: 'round-robin',
		totalRounds: this.totalRounds,
		currentRound: 1,
		allRounds: this.rounds
	};
};

// Swiss System Bracket (generate round by round)
TournamentSchema.methods.generateSwissBracket = function (participants) {
	// Swiss system generates pairings round by round based on current standings
	this.totalRounds = Math.ceil(Math.log2(participants.length)) + 1;

	// Generate first round pairings (random or by ELO)
	const shuffledParticipants = [...participants].sort(() => Math.random() - 0.5);
	const firstRoundPairings = [];

	for (let i = 0; i < shuffledParticipants.length; i += 2) {
		if (i + 1 < shuffledParticipants.length) {
			firstRoundPairings.push({
				round: 1,
				white: shuffledParticipants[i].player,
				black: shuffledParticipants[i + 1].player,
				result: 'pending'
			});
		}
	}

	this.rounds = [{ games: firstRoundPairings }];

	return {
		type: 'swiss',
		totalRounds: this.totalRounds,
		currentRound: 1,
		firstRound: firstRoundPairings
	};
};

// Advance to next round (single elimination)
TournamentSchema.methods.advanceRound = async function () {
	const currentRound = this.rounds[this.currentRound - 1];

	if (!currentRound || currentRound.games.some(game => game.result === 'pending')) {
		throw new Error('Current round is not complete');
	}

	if (this.type === 'single-elimination') {
		return this.advanceSingleElimination();
	} else if (this.type === 'round-robin') {
		return this.advanceRoundRobin();
	} else if (this.type === 'swiss') {
		return this.advanceSwiss();
	}
};

// Single Elimination advancement
TournamentSchema.methods.advanceSingleElimination = function () {
	const currentRound = this.rounds[this.currentRound - 1];
	const winners = [];

	// Determine winners from current round
	currentRound.games.forEach(game => {
		if (game.result === 'white') {
			winners.push(game.white);
		} else if (game.result === 'black') {
			winners.push(game.black);
		} else if (game.result === 'draw') {
			// Handle draws (could be random, higher seed, etc.)
			winners.push(Math.random() < 0.5 ? game.white : game.black);
		}
	});

	// Check if tournament is complete
	if (winners.length === 1) {
		this.status = 'completed';
		this.endDate = new Date();
		return { completed: true, winner: winners[0] };
	}

	// Generate next round pairings
	const nextRoundPairings = [];
	for (let i = 0; i < winners.length; i += 2) {
		if (i + 1 < winners.length) {
			nextRoundPairings.push({
				round: this.currentRound + 1,
				white: winners[i],
				black: winners[i + 1],
				result: 'pending'
			});
		}
	}

	// Add next round to tournament
	this.rounds[this.currentRound].games = nextRoundPairings;
	this.currentRound += 1;

	return {
		completed: false,
		nextRoundPairings,
		currentRound: this.currentRound
	};
};

// Round Robin advancement (just advance round number)
TournamentSchema.methods.advanceRoundRobin = function () {
	this.currentRound += 1;

	if (this.currentRound > this.totalRounds) {
		this.status = 'completed';
		this.endDate = new Date();
		return { completed: true };
	}

	return {
		completed: false,
		currentRound: this.currentRound,
		nextRoundPairings: this.rounds[this.currentRound - 1].games
	};
};

// Swiss advancement (generate next round based on standings)
TournamentSchema.methods.advanceSwiss = function () {
	this.currentRound += 1;

	if (this.currentRound > this.totalRounds) {
		this.status = 'completed';
		this.endDate = new Date();
		return { completed: true };
	}

	// Generate next round pairings based on current standings
	const standings = this.getLeaderboard();
	const nextRoundPairings = [];

	// Pair players with similar scores
	for (let i = 0; i < standings.length; i += 2) {
		if (i + 1 < standings.length) {
			nextRoundPairings.push({
				round: this.currentRound,
				white: standings[i].player,
				black: standings[i + 1].player,
				result: 'pending'
			});
		}
	}

	// Add next round
	this.rounds[this.currentRound - 1] = { games: nextRoundPairings };

	return {
		completed: false,
		currentRound: this.currentRound,
		nextRoundPairings
	};
};

module.exports = mongoose.model('Tournament', TournamentSchema);
