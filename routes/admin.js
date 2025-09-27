const express = require('express');
const router = express.Router();
const Tournament = require('../models/Tournament');
const User = require('../models/User');
const Game = require('../models/Game');
const { verifyAdmin } = require('../middleware/adminAuth');
const TournamentNotificationService = require('../utils/tournamentNotifications');

// Get notification service instance
const getNotificationService = (req) => {
	const ably = req.app.get('ably');
	return new TournamentNotificationService(ably);
};

// Helper function to create tournament games
const createTournamentGames = async (tournament, round, pairings) => {
	const games = [];

	// Calculate start times for games (stagger them by 5 minutes)
	const now = new Date();
	const startTime = new Date(now.getTime() + (10 * 60 * 1000)); // Start in 10 minutes

	for (let i = 0; i < pairings.length; i++) {
		const pairing = pairings[i];

		// Skip byes
		if (!pairing.black) continue;

		// Stagger game start times by 5 minutes
		const gameStartTime = new Date(startTime.getTime() + (i * 5 * 60 * 1000));

		const game = new Game({
			host: pairing.white,
			opponent: pairing.black,
			gameType: 'tournament',
			tournament: {
				id: tournament._id,
				round: round,
				matchIndex: i
			},
			timeControl: {
				initial: tournament.timeControl.initial * 1000, // Convert to milliseconds
				increment: tournament.timeControl.increment * 1000
			},
			status: 'waiting',
			scheduledStartTime: gameStartTime,
			createdAt: new Date()
		});

		await game.save();

		// Update the tournament pairing to reference the created game
		pairing.game = game._id;
		pairing.result = 'pending';
		pairing.scheduledStartTime = gameStartTime;

		games.push(game);
	}

	return games;
};

// Apply admin verification to all routes in this file
router.use(verifyAdmin);

// Get all tournaments (admin view with more details)
router.get('/tournaments', async (req, res) => {
	try {
		const { page = 1, limit = 10, status, type } = req.query;

		let filter = {};
		if (status) filter.status = status;
		if (type) filter.type = type;

		const tournaments = await Tournament.find(filter)
			.populate('participants.player', 'username profile')
			.populate('organizer', 'username profile')
			.sort({ createdAt: -1 })
			.limit(limit * 1)
			.skip((page - 1) * limit);

		const total = await Tournament.countDocuments(filter);

		res.json({
			tournaments: tournaments.map(tournament => {
				// Calculate total prize pool from the prizePool object
				let totalPrizePool = 0;
				if (tournament.prizePool) {
					const first = parseInt(tournament.prizePool.first?.replace('$', '') || '0');
					const second = parseInt(tournament.prizePool.second?.replace('$', '') || '0');
					const third = parseInt(tournament.prizePool.third?.replace('$', '') || '0');
					totalPrizePool = first + second + third;
				}

				return {
					id: tournament._id,
					name: tournament.name,
					description: tournament.description,
					type: tournament.type,
					format: tournament.format,
					status: tournament.status,
					maxParticipants: tournament.maxParticipants,
					currentParticipants: tournament.participants.length,
					participants: tournament.participants,
					prizePool: tournament.prizePool,
					totalPrizePool, // Calculated total prize pool
					registrationDeadline: tournament.registrationEnd, // Use correct field name
					startDate: tournament.startDate,
					endDate: tournament.endDate,
					currentRound: tournament.currentRound,
					totalRounds: tournament.rounds?.length || 0,
					organizer: tournament.organizer, // Use 'organizer' not 'createdBy'
					createdAt: tournament.createdAt,
					settings: tournament.settings
				};
			}),
			pagination: {
				current: parseInt(page),
				total: Math.ceil(total / limit),
				hasNext: page * limit < total,
				hasPrev: page > 1,
				totalTournaments: total
			}
		});
	} catch (error) {
		console.error('Get tournaments error:', error);
		res.status(500).json({ message: 'Server error' });
	}
});

// Create new tournament
router.post('/tournaments', async (req, res) => {
	try {
		const {
			name,
			description,
			type, // single-elimination, round-robin, swiss, seasonal
			format, // blitz, rapid, classical
			maxParticipants,
			prizePool,
			registrationDeadline,
			startDate,
			settings
		} = req.body;

		// Validation
		if (!name || !type || !maxParticipants) {
			return res.status(400).json({
				message: 'Name, type, and max participants are required'
			});
		}

		// Validate tournament type
		const validTypes = ['single-elimination', 'round-robin', 'swiss', 'seasonal'];
		if (!validTypes.includes(type)) {
			return res.status(400).json({
				message: `Invalid tournament type. Must be one of: ${validTypes.join(', ')}`
			});
		}

		// Validate max participants for single elimination (must be power of 2)
		if (type === 'single-elimination' && maxParticipants && !isPowerOfTwo(maxParticipants)) {
			return res.status(400).json({
				message: 'Single elimination tournaments require a power of 2 participants (2, 4, 8, 16, 32, etc.)'
			});
		}

		// Create tournament
		const tournament = new Tournament({
			name,
			description,
			type,
			format: format || 'rapid',
			maxParticipants,
			// Convert simple number prizePool to proper structure
			prizePool: prizePool ? {
				first: `$${Math.floor(prizePool * 0.5)}`,
				second: `$${Math.floor(prizePool * 0.3)}`,
				third: `$${Math.floor(prizePool * 0.2)}`,
				participation: '$10'
			} : undefined,
			registrationEnd: registrationDeadline ? new Date(registrationDeadline) : null,
			startDate: startDate ? new Date(startDate) : null,
			organizer: req.user._id,
			status: 'registration',
			// Add settings if the model supports it
			...(settings && { settings })
		});

		await tournament.save();

		// Populate created tournament for response
		await tournament.populate('organizer', 'username profile');

		res.status(201).json({
			message: 'Tournament created successfully',
			tournament: {
				id: tournament._id,
				name: tournament.name,
				description: tournament.description,
				type: tournament.type,
				format: tournament.format,
				status: tournament.status,
				maxParticipants: tournament.maxParticipants,
				currentParticipants: 0,
				prizePool: tournament.prizePool,
				totalPrizePool: prizePool || 0, // Add total for frontend
				registrationDeadline: tournament.registrationEnd, // Use correct field name
				startDate: tournament.startDate,
				settings: tournament.settings,
				organizer: tournament.organizer, // Use 'organizer' not 'createdBy'
				createdAt: tournament.createdAt
			}
		});

	} catch (error) {
		console.error('Create tournament error:', error);
		res.status(500).json({ message: 'Server error' });
	}
});

// Update tournament
router.put('/tournaments/:id', async (req, res) => {
	try {
		const tournament = await Tournament.findById(req.params.id);

		if (!tournament) {
			return res.status(404).json({ message: 'Tournament not found' });
		}

		// Only allow updates if tournament is in registration phase
		if (tournament.status !== 'registration') {
			return res.status(400).json({
				message: `Cannot update tournament in ${tournament.status} status`
			});
		}

		const {
			name,
			description,
			maxParticipants,
			prizePool,
			registrationDeadline,
			startDate,
			settings
		} = req.body;

		// Update fields
		if (name) tournament.name = name;
		if (description) tournament.description = description;
		if (maxParticipants) tournament.maxParticipants = maxParticipants;
		if (prizePool !== undefined) {
			tournament.prizePool = prizePool ? {
				first: `$${Math.floor(prizePool * 0.5)}`,
				second: `$${Math.floor(prizePool * 0.3)}`,
				third: `$${Math.floor(prizePool * 0.2)}`,
				participation: '$10'
			} : undefined;
		}
		if (registrationDeadline) tournament.registrationEnd = new Date(registrationDeadline);
		if (startDate) tournament.startDate = new Date(startDate);
		if (settings) tournament.settings = { ...tournament.settings, ...settings };

		await tournament.save();
		await tournament.populate('organizer', 'username profile');
		await tournament.populate('participants.player', 'username profile');

		res.json({
			message: 'Tournament updated successfully',
			tournament
		});

	} catch (error) {
		console.error('Update tournament error:', error);
		res.status(500).json({ message: 'Server error' });
	}
});

// Start tournament
router.post('/tournaments/:id/start', async (req, res) => {
	try {
		const tournament = await Tournament.findById(req.params.id)
			.populate('participants.player', 'username profile');

		if (!tournament) {
			return res.status(404).json({ message: 'Tournament not found' });
		}

		if (tournament.status !== 'registration') {
			return res.status(400).json({
				message: `Cannot start tournament in ${tournament.status} status`
			});
		}

		if (tournament.participants.length < 2) {
			return res.status(400).json({
				message: 'Need at least 2 participants to start tournament'
			});
		}

		// Generate initial bracket/pairings
		const brackets = await tournament.generateBracket();

		// Create actual games for the first round
		const firstRoundPairings = tournament.rounds[0].games;
		const createdGames = await createTournamentGames(tournament, 1, firstRoundPairings);

		tournament.status = 'active';
		tournament.actualStartDate = new Date();
		tournament.currentRound = 1;

		await tournament.save();

		// Send tournament started notifications
		const notificationService = getNotificationService(req);
		await notificationService.notifyTournamentStarted(tournament);

		res.json({
			message: 'Tournament started successfully',
			tournament: {
				id: tournament._id,
				name: tournament.name,
				status: tournament.status,
				currentRound: tournament.currentRound,
				participants: tournament.participants.length,
				bracket: brackets,
				gamesCreated: createdGames.length
			}
		});

	} catch (error) {
		console.error('Start tournament error:', error);
		res.status(500).json({ message: 'Server error' });
	}
});

// End tournament
router.post('/tournaments/:id/end', async (req, res) => {
	try {
		const tournament = await Tournament.findById(req.params.id);

		if (!tournament) {
			return res.status(404).json({ message: 'Tournament not found' });
		}

		if (tournament.status === 'completed') {
			return res.status(400).json({ message: 'Tournament already completed' });
		}

		tournament.status = 'completed';
		tournament.endDate = new Date();

		// Calculate final standings
		const finalStandings = tournament.getLeaderboard();

		await tournament.save();

		res.json({
			message: 'Tournament ended successfully',
			tournament: {
				id: tournament._id,
				name: tournament.name,
				status: tournament.status,
				endDate: tournament.endDate,
				finalStandings: finalStandings.slice(0, 10) // Top 10
			}
		});

	} catch (error) {
		console.error('End tournament error:', error);
		res.status(500).json({ message: 'Server error' });
	}
});

// Delete tournament
router.delete('/tournaments/:id', async (req, res) => {
	try {
		const tournament = await Tournament.findById(req.params.id);

		if (!tournament) {
			return res.status(404).json({ message: 'Tournament not found' });
		}

		// Only allow deletion if tournament hasn't started
		if (tournament.status === 'active') {
			return res.status(400).json({
				message: 'Cannot delete active tournament'
			});
		}

		await Tournament.findByIdAndDelete(req.params.id);

		res.json({ message: 'Tournament deleted successfully' });

	} catch (error) {
		console.error('Delete tournament error:', error);
		res.status(500).json({ message: 'Server error' });
	}
});

// Get tournament participants (detailed view)
router.get('/tournaments/:id/participants', async (req, res) => {
	try {
		const tournament = await Tournament.findById(req.params.id)
			.populate('participants.player', 'username profile');

		if (!tournament) {
			return res.status(404).json({ message: 'Tournament not found' });
		}

		res.json({
			tournamentId: tournament._id,
			tournamentName: tournament.name,
			participants: tournament.participants.map(p => ({
				user: {
					id: p.player._id,
					username: p.player.username,
					displayName: p.player.profile?.displayName || p.player.username,
					elo: p.player.profile?.ranking?.elo || 1200,
					gamesPlayed: p.player.profile?.stats?.gamesPlayed || 0,
					winRate: p.player.profile?.stats?.winRate || 0
				},
				registeredAt: p.registeredAt,
				score: p.score,
				wins: p.wins,
				losses: p.losses,
				draws: p.draws,
				isActive: !p.eliminated
			}))
		});

	} catch (error) {
		console.error('Get participants error:', error);
		res.status(500).json({ message: 'Server error' });
	}
});

// Manual pairing for round-robin or custom tournaments
router.post('/tournaments/:id/pair', async (req, res) => {
	try {
		const { pairings } = req.body; // Array of {player1Id, player2Id}
		const tournament = await Tournament.findById(req.params.id);

		if (!tournament) {
			return res.status(404).json({ message: 'Tournament not found' });
		}

		if (tournament.status !== 'active') {
			return res.status(400).json({
				message: 'Tournament must be active to create pairings'
			});
		}

		// Validate and create pairings
		const validPairings = [];
		for (const pairing of pairings) {
			const { player1Id, player2Id } = pairing;

			// Check if both players are in tournament
			const player1 = tournament.participants.find(p => p.user.toString() === player1Id);
			const player2 = tournament.participants.find(p => p.user.toString() === player2Id);

			if (player1 && player2) {
				validPairings.push({
					player1: player1Id,
					player2: player2Id,
					round: tournament.currentRound
				});
			}
		}

		// Add pairings to current round
		if (!tournament.rounds[tournament.currentRound - 1]) {
			tournament.rounds[tournament.currentRound - 1] = { games: [] };
		}

		tournament.rounds[tournament.currentRound - 1].games.push(...validPairings);
		await tournament.save();

		res.json({
			message: 'Manual pairings created successfully',
			round: tournament.currentRound,
			pairings: validPairings
		});

	} catch (error) {
		console.error('Manual pairing error:', error);
		res.status(500).json({ message: 'Server error' });
	}
});

// Advance to next round
router.post('/tournaments/:id/advance', async (req, res) => {
	try {
		const tournament = await Tournament.findById(req.params.id);

		if (!tournament) {
			return res.status(404).json({ message: 'Tournament not found' });
		}

		if (tournament.status !== 'active') {
			return res.status(400).json({
				message: 'Tournament must be active to advance rounds'
			});
		}

		// Check if current round is complete
		const currentRound = tournament.rounds[tournament.currentRound - 1];
		if (!currentRound || currentRound.games.some(game => !game.result)) {
			return res.status(400).json({
				message: 'Current round is not complete'
			});
		}

		// Advance round
		const result = await tournament.advanceRound();

		res.json({
			message: result.completed ? 'Tournament completed' : 'Advanced to next round',
			tournament: {
				id: tournament._id,
				currentRound: tournament.currentRound,
				status: tournament.status,
				isCompleted: result.completed,
				nextRoundPairings: result.nextRoundPairings
			}
		});

	} catch (error) {
		console.error('Advance round error:', error);
		res.status(500).json({ message: 'Server error' });
	}
});

// Manual pairing for tournament rounds
router.post('/tournaments/:id/manual-pair', async (req, res) => {
	try {
		const { pairings } = req.body; // Array of {player1Id, player2Id} objects
		const tournament = await Tournament.findById(req.params.id)
			.populate('participants.player', 'username profile');

		if (!tournament) {
			return res.status(404).json({ message: 'Tournament not found' });
		}

		if (tournament.status !== 'active') {
			return res.status(400).json({
				message: 'Tournament must be active for manual pairing'
			});
		}

		// Validate pairings
		const participantIds = tournament.participants.map(p => p.player._id.toString());
		for (const pairing of pairings) {
			if (!participantIds.includes(pairing.player1Id) ||
				!participantIds.includes(pairing.player2Id)) {
				return res.status(400).json({
					message: 'Invalid participant in pairing'
				});
			}
		}

		// Create manual round
		const currentRound = tournament.currentRound || 1;
		const manualGames = pairings.map(pairing => ({
			round: currentRound,
			white: pairing.player1Id,
			black: pairing.player2Id,
			result: 'pending',
			manualPairing: true
		}));

		// Update tournament with manual round
		if (!tournament.rounds) tournament.rounds = [];
		tournament.rounds[currentRound - 1] = { games: manualGames };
		tournament.currentRound = currentRound;

		await tournament.save();

		res.json({
			message: 'Manual pairings created successfully',
			round: currentRound,
			pairings: manualGames.length
		});

	} catch (error) {
		console.error('Manual pairing error:', error);
		res.status(500).json({ message: 'Server error' });
	}
});

// Update participant seeds
router.put('/tournaments/:id/seeds', async (req, res) => {
	try {
		const { seeds } = req.body; // Array of {participantId, seed} objects
		const tournament = await Tournament.findById(req.params.id);

		if (!tournament) {
			return res.status(404).json({ message: 'Tournament not found' });
		}

		if (tournament.status !== 'registration') {
			return res.status(400).json({
				message: 'Can only update seeds during registration'
			});
		}

		// Update seeds for participants
		for (const seedUpdate of seeds) {
			const participant = tournament.participants.find(
				p => p.player.toString() === seedUpdate.participantId
			);
			if (participant) {
				participant.seed = seedUpdate.seed;
			}
		}

		await tournament.save();

		res.json({
			message: 'Participant seeds updated successfully',
			updatedSeeds: seeds.length
		});

	} catch (error) {
		console.error('Update seeds error:', error);
		res.status(500).json({ message: 'Server error' });
	}
});

// Handle byes (automatically advance players)
router.post('/tournaments/:id/byes', async (req, res) => {
	try {
		const { playerIds, round } = req.body;
		const tournament = await Tournament.findById(req.params.id);

		if (!tournament) {
			return res.status(404).json({ message: 'Tournament not found' });
		}

		// Add bye wins for specified players
		for (const playerId of playerIds) {
			const participant = tournament.participants.find(
				p => p.player.toString() === playerId
			);
			if (participant) {
				participant.wins += 1;
				participant.score += 1;
			}
		}

		await tournament.save();

		res.json({
			message: 'Byes assigned successfully',
			byesAssigned: playerIds.length,
			round: round
		});

	} catch (error) {
		console.error('Assign byes error:', error);
		res.status(500).json({ message: 'Server error' });
	}
});

// Reschedule match
router.put('/tournaments/:id/matches/:matchId/reschedule', async (req, res) => {
	try {
		const { tournamentId, matchId } = req.params;
		const { newDateTime, reason } = req.body;

		const tournament = await Tournament.findById(tournamentId);

		if (!tournament) {
			return res.status(404).json({ message: 'Tournament not found' });
		}

		// Find and update the match
		let matchFound = false;
		for (const round of tournament.rounds) {
			const match = round.games.find(game => game._id.toString() === matchId);
			if (match) {
				match.scheduledTime = new Date(newDateTime);
				match.rescheduleReason = reason;
				match.rescheduled = true;
				matchFound = true;
				break;
			}
		}

		if (!matchFound) {
			return res.status(404).json({ message: 'Match not found' });
		}

		await tournament.save();

		res.json({
			message: 'Match rescheduled successfully',
			newDateTime: newDateTime,
			reason: reason
		});

	} catch (error) {
		console.error('Reschedule match error:', error);
		res.status(500).json({ message: 'Server error' });
	}
});

// Get tournament bracket with advanced information
router.get('/tournaments/:id/bracket', async (req, res) => {
	try {
		const tournament = await Tournament.findById(req.params.id)
			.populate('participants.player', 'username profile')
			.populate('rounds.games.white', 'username profile')
			.populate('rounds.games.black', 'username profile');

		if (!tournament) {
			return res.status(404).json({ message: 'Tournament not found' });
		}

		// Enhanced bracket information
		const bracketData = {
			id: tournament._id,
			name: tournament.name,
			type: tournament.type,
			status: tournament.status,
			currentRound: tournament.currentRound,
			totalRounds: tournament.totalRounds,
			participants: tournament.participants.map(p => ({
				id: p.player._id,
				username: p.player.username,
				displayName: p.player.profile?.displayName || p.player.username,
				elo: p.player.profile?.ranking?.elo || 1200,
				seed: p.seed,
				score: p.score,
				wins: p.wins,
				losses: p.losses,
				draws: p.draws,
				eliminated: p.eliminated,
				finalRank: p.finalRank
			})),
			rounds: tournament.rounds?.map(round => ({
				games: round.games.map(game => ({
					id: game._id,
					round: game.round,
					white: game.white,
					black: game.black,
					result: game.result,
					winner: game.winner,
					scheduledTime: game.scheduledTime,
					rescheduled: game.rescheduled,
					rescheduleReason: game.rescheduleReason,
					manualPairing: game.manualPairing,
					bracketPosition: game.bracketPosition
				}))
			})) || [],
			settings: tournament.settings
		};

		res.json({ bracket: bracketData });

	} catch (error) {
		console.error('Get bracket error:', error);
		res.status(500).json({ message: 'Server error' });
	}
})

// Helper function to check if number is power of 2
function isPowerOfTwo(n) {
	return n && (n & (n - 1)) === 0;
}

module.exports = router;
