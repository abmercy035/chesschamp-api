const express = require('express');
const router = express.Router();
const Tournament = require('../models/Tournament');
const User = require('../models/User');
const { verifyAdmin } = require('../middleware/adminAuth');

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
			.populate('participants.user', 'username profile.displayName profile.ranking.elo')
			.populate('createdBy', 'username profile.displayName')
			.sort({ createdAt: -1 })
			.limit(limit * 1)
			.skip((page - 1) * limit);

		const total = await Tournament.countDocuments(filter);

		res.json({
			tournaments: tournaments.map(tournament => ({
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
				registrationDeadline: tournament.registrationDeadline,
				startDate: tournament.startDate,
				endDate: tournament.endDate,
				currentRound: tournament.currentRound,
				totalRounds: tournament.rounds.length,
				createdBy: tournament.createdBy,
				createdAt: tournament.createdAt,
				settings: tournament.settings
			})),
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
			prizePool: prizePool || 0,
			registrationDeadline: registrationDeadline ? new Date(registrationDeadline) : null,
			startDate: startDate ? new Date(startDate) : null,
			settings: {
				timeControl: settings?.timeControl || '10+5',
				rated: settings?.rated !== false,
				requireMinElo: settings?.requireMinElo || false,
				minElo: settings?.minElo || 0,
				maxElo: settings?.maxElo || null,
				allowSpectators: settings?.allowSpectators !== false,
				...settings
			},
			createdBy: req.user._id,
			status: 'registration'
		});

		await tournament.save();

		// Populate created tournament for response
		await tournament.populate('createdBy', 'username profile.displayName');

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
				registrationDeadline: tournament.registrationDeadline,
				startDate: tournament.startDate,
				settings: tournament.settings,
				createdBy: tournament.createdBy,
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
		if (prizePool !== undefined) tournament.prizePool = prizePool;
		if (registrationDeadline) tournament.registrationDeadline = new Date(registrationDeadline);
		if (startDate) tournament.startDate = new Date(startDate);
		if (settings) tournament.settings = { ...tournament.settings, ...settings };

		await tournament.save();
		await tournament.populate('createdBy', 'username profile.displayName');
		await tournament.populate('participants.user', 'username profile.displayName profile.ranking.elo');

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
			.populate('participants.user', 'username profile.displayName profile.ranking.elo');

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

		tournament.status = 'active';
		tournament.actualStartDate = new Date();
		tournament.currentRound = 1;

		await tournament.save();

		res.json({
			message: 'Tournament started successfully',
			tournament: {
				id: tournament._id,
				name: tournament.name,
				status: tournament.status,
				currentRound: tournament.currentRound,
				participants: tournament.participants.length,
				bracket: brackets
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
			.populate('participants.user', 'username profile.displayName profile.ranking.elo profile.stats');

		if (!tournament) {
			return res.status(404).json({ message: 'Tournament not found' });
		}

		res.json({
			tournamentId: tournament._id,
			tournamentName: tournament.name,
			participants: tournament.participants.map(p => ({
				user: {
					id: p.user._id,
					username: p.user.username,
					displayName: p.user.profile.displayName,
					elo: p.user.profile.ranking.elo,
					gamesPlayed: p.user.profile.stats.gamesPlayed,
					winRate: p.user.profile.stats.winRate
				},
				registeredAt: p.registeredAt,
				score: p.score,
				wins: p.wins,
				losses: p.losses,
				draws: p.draws,
				isActive: p.isActive
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

// Helper function to check if number is power of 2
function isPowerOfTwo(n) {
	return n && (n & (n - 1)) === 0;
}

module.exports = router;
