const express = require('express');
const router = express.Router();
const Tournament = require('../models/Tournament');
const User = require('../models/User');
const jwt = require('jsonwebtoken');
const TournamentNotificationService = require('../utils/tournamentNotifications');

// Middleware to verify JWT
async function verifyToken(req, res, next) {
	const token = req.cookies.token;
	var appCookies = (req?.headers?.cookie);

	console.log(appCookies)
	console.log(token)
	if (!token) return res.status(401).json({ error: 'Access denied' });

	try {
		const verified = jwt.verify(token, process.env.JWT_SECRET);
		if (verified) {
			const userFound = await User.findOne({ _id: verified.id }).lean()
			if (userFound) {
				req.user = { ...verified, ...userFound };
				next();
			}
		}
	} catch (err) {
		console.log(err)
		res.status(400).json({ error: 'Invalid token' });
	}
}

// Get notification service instance
const getNotificationService = (req) => {
	const ably = req.app.get('ably');
	return new TournamentNotificationService(ably);
};

// Get all public tournaments (open for registration)
router.get('/', async (req, res) => {
	try {
		const { page = 1, limit = 10, status = 'registration', type } = req.query;

		let filter = { status };
		if (type) filter.type = type;

		const tournaments = await Tournament.find(filter)
			.populate('participants.player', 'username profile')
			.populate('organizer', 'username profile')
			.sort({ registrationEnd: 1 }) // Show tournaments ending registration soon first
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
				prizePool: tournament.prizePool,
				registrationEnd: tournament.registrationEnd,
				startDate: tournament.startDate,
				endDate: tournament.endDate,
				organizer: tournament.organizer,
				timeControl: tournament.timeControl,
				settings: tournament.settings,
				spotsRemaining: tournament.maxParticipants - tournament.participants.length,
				isRegistrationOpen: tournament.status === 'registration' &&
					new Date() < new Date(tournament.registrationEnd)
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

// Get single tournament details
router.get('/:id', async (req, res) => {
	try {
		const tournament = await Tournament.findById(req.params.id)
			.populate('participants.player', 'username profile')
			.populate('organizer', 'username profile');

		if (!tournament) {
			return res.status(404).json({ message: 'Tournament not found' });
		}

		// Calculate additional info
		const totalPrizePool = tournament.prizePool ?
			Object.values(tournament.prizePool)
				.map(prize => parseInt(prize?.toString().replace('$', '')) || 0)
				.reduce((sum, amount) => sum + amount, 0) : 0;

		res.json({
			tournament: {
				id: tournament._id,
				name: tournament.name,
				description: tournament.description,
				type: tournament.type,
				format: tournament.format,
				status: tournament.status,
				maxParticipants: tournament.maxParticipants,
				currentParticipants: tournament.participants.length,
				participants: tournament.participants.map(p => ({
					id: p.player._id,
					username: p.player.username,
					displayName: p.player.profile?.displayName || p.player.username,
					avatar: p.player.profile?.avatar || '♔',
					elo: p.player.profile?.ranking?.elo || 1200,
					registeredAt: p.registeredAt,
					score: p.score,
					eliminated: p.eliminated
				})),
				prizePool: tournament.prizePool,
				totalPrizePool,
				registrationEnd: tournament.registrationEnd,
				startDate: tournament.startDate,
				endDate: tournament.endDate,
				currentRound: tournament.currentRound,
				totalRounds: tournament.totalRounds,
				organizer: tournament.organizer,
				timeControl: tournament.timeControl,
				settings: tournament.settings,
				rounds: tournament.rounds,
				spotsRemaining: tournament.maxParticipants - tournament.participants.length,
				isRegistrationOpen: tournament.status === 'registration' &&
					new Date() < new Date(tournament.registrationEnd),
				createdAt: tournament.createdAt
			}
		});
	} catch (error) {
		console.error('Get tournament error:', error);
		res.status(500).json({ message: 'Server error' });
	}
});

// Register for tournament
router.post('/:id/register', verifyToken, async (req, res) => {
	try {
		const tournament = await Tournament.findById(req.params.id);

		if (!tournament) {
			return res.status(404).json({ message: 'Tournament not found' });
		}

		// Check if registration is open
		if (tournament.status !== 'registration') {
			return res.status(400).json({
				message: `Registration is not open for this tournament. Current status: ${tournament.status}`
			});
		}

		// Check if registration deadline has passed
		if (tournament.registrationEnd && new Date() > new Date(tournament.registrationEnd)) {
			return res.status(400).json({
				message: 'Registration deadline has passed'
			});
		}

		// Check if tournament is full
		if (tournament.participants.length >= tournament.maxParticipants) {
			return res.status(400).json({
				message: 'Tournament is full'
			});
		}

		// Check if user is already registered
		const isAlreadyRegistered = tournament.participants.some(
			p => p.player.toString() === req.user.id
		);

		if (isAlreadyRegistered) {
			return res.status(400).json({
				message: 'You are already registered for this tournament'
			});
		}

		// Check minimum ELO requirement if set
		if (tournament.settings?.requireMinElo) {
			const user = await User.findById(req.user.id);
			const userElo = user.profile?.ranking?.elo || 1200;

			if (userElo < tournament.settings.minElo) {
				return res.status(400).json({
					message: `Minimum ELO requirement: ${tournament.settings.minElo}. Your ELO: ${userElo}`
				});
			}
		}

		// Register user
		tournament.participants.push({
			player: req.user.id,
			registeredAt: new Date(),
			score: 0,
			wins: 0,
			losses: 0,
			draws: 0,
			eliminated: false
		});

		await tournament.save();

		// Send registration confirmation notification
		const notificationService = getNotificationService(req);
		await notificationService.notifyRegistrationConfirmed(req.user.id, tournament);

		res.json({
			message: 'Successfully registered for tournament',
			tournament: {
				id: tournament._id,
				name: tournament.name,
				currentParticipants: tournament.participants.length,
				maxParticipants: tournament.maxParticipants
			}
		});

	} catch (error) {
		console.error('Tournament registration error:', error);
		res.status(500).json({ message: 'Server error' });
	}
});

// Unregister from tournament  
router.delete('/:id/register', verifyToken, async (req, res) => {
	try {
		const tournament = await Tournament.findById(req.params.id);

		if (!tournament) {
			return res.status(404).json({ message: 'Tournament not found' });
		}

		// Check if registration is still open
		if (tournament.status !== 'registration') {
			return res.status(400).json({
				message: 'Cannot unregister after registration has closed'
			});
		}

		// Find and remove user from participants
		const participantIndex = tournament.participants.findIndex(
			p => p.player.toString() === req.user.id
		);

		if (participantIndex === -1) {
			return res.status(400).json({
				message: 'You are not registered for this tournament'
			});
		}

		tournament.participants.splice(participantIndex, 1);
		await tournament.save();

		// Send unregistration notification
		const notificationService = getNotificationService(req);
		await notificationService.notifyRegistrationCancelled(req.user.id, tournament);

		res.json({
			message: 'Successfully unregistered from tournament',
			tournament: {
				id: tournament._id,
				name: tournament.name,
				currentParticipants: tournament.participants.length,
				maxParticipants: tournament.maxParticipants
			}
		});

	} catch (error) {
		console.error('Tournament unregistration error:', error);
		res.status(500).json({ message: 'Server error' });
	}
});

// Get user's tournament registrations
router.get('/user/registrations', verifyToken, async (req, res) => {
	try {
		const tournaments = await Tournament.find({
			'participants.player': req.user.id
		})
			.populate('organizer', 'username profile')
			.sort({ createdAt: -1 });

		res.json({
			tournaments: tournaments.map(tournament => ({
				id: tournament._id,
				name: tournament.name,
				type: tournament.type,
				format: tournament.format,
				status: tournament.status,
				currentParticipants: tournament.participants.length,
				maxParticipants: tournament.maxParticipants,
				startDate: tournament.startDate,
				endDate: tournament.endDate,
				organizer: tournament.organizer,
				userRegistration: tournament.participants.find(
					p => p.player.toString() === req.user.id
				)
			}))
		});

	} catch (error) {
		console.error('Get user registrations error:', error);
		res.status(500).json({ message: 'Server error' });
	}
});

// Get user's tournament matches/games
router.get('/user/matches', verifyToken, async (req, res) => {
	try {
		// Find all tournament games where the user is a participant
		const Game = require('../models/Game');

		const tournamentGames = await Game.find({
			gameType: 'tournament',
			$or: [
				{ host: req.user.id },
				{ opponent: req.user.id }
			]
		})
			.populate('host', 'username profile')
			.populate('opponent', 'username profile')
			.populate('tournament.id', 'name type status currentRound')
			.sort({ createdAt: -1 });

		const matches = tournamentGames.map(game => ({
			id: game._id,
			tournament: {
				id: game.tournament.id._id,
				name: game.tournament.id.name,
				type: game.tournament.id.type,
				status: game.tournament.id.status,
				round: game.tournament.round
			},
			white: game.host,
			black: game.opponent,
			status: game.status,
			result: game.winner ? (game.winner.toString() === game.host._id.toString() ? 'white' : 'black') : (game.status === 'finished' ? 'draw' : null),
			winReason: game.winReason,
			scheduledStartTime: game.scheduledStartTime,
			startTime: game.startTime,
			createdAt: game.createdAt,
			canJoin: game.status === 'waiting' && (
				game.host._id.toString() === req.user.id ||
				game.opponent._id.toString() === req.user.id
			)
		}));

		res.json({ matches });

	} catch (error) {
		console.error('Get user tournament matches error:', error);
		res.status(500).json({ message: 'Server error' });
	}
});

// Force refresh tournament data (for debugging)
router.post('/:id/refresh', async (req, res) => {
	try {
		const tournament = await Tournament.findById(req.params.id)
			.populate('participants.player', 'username profile')
			.populate('organizer', 'username profile');

		if (!tournament) {
			return res.status(404).json({ message: 'Tournament not found' });
		}

		// Log current tournament state for debugging
		console.log('🔄 Tournament refresh requested for:', tournament.name);
		console.log('📊 Current participants:', tournament.participants.map(p => ({
			username: p.player.username,
			score: p.score,
			wins: p.wins,
			draws: p.draws,
			losses: p.losses
		})));

		console.log('🏆 Tournament rounds:', tournament.rounds.map((round, index) => ({
			round: index + 1,
			games: round.games.map(game => ({
				white: game.white,
				black: game.black,
				result: game.result
			}))
		})));

		// Calculate additional info
		const totalPrizePool = tournament.prizePool ?
			Object.values(tournament.prizePool)
				.map(prize => parseInt(prize.toString().replace('$', '')) || 0)
				.reduce((sum, amount) => sum + amount, 0) : 0;

		res.json({
			message: 'Tournament data refreshed',
			tournament: {
				id: tournament._id,
				name: tournament.name,
				description: tournament.description,
				type: tournament.type,
				format: tournament.format,
				status: tournament.status,
				maxParticipants: tournament.maxParticipants,
				currentParticipants: tournament.participants.length,
				participants: tournament.participants.map(p => ({
					id: p.player._id,
					username: p.player.username,
					displayName: p.player.profile?.displayName || p.player.username,
					avatar: p.player.profile?.avatar || '♔',
					elo: p.player.profile?.ranking?.elo || 1200,
					registeredAt: p.registeredAt,
					score: p.score,
					wins: p.wins,
					draws: p.draws,
					losses: p.losses,
					eliminated: p.eliminated
				})),
				prizePool: tournament.prizePool,
				totalPrizePool,
				registrationEnd: tournament.registrationEnd,
				startDate: tournament.startDate,
				endDate: tournament.endDate,
				currentRound: tournament.currentRound,
				totalRounds: tournament.totalRounds,
				organizer: tournament.organizer,
				timeControl: tournament.timeControl,
				settings: tournament.settings,
				rounds: tournament.rounds,
				spotsRemaining: tournament.maxParticipants - tournament.participants.length,
				isRegistrationOpen: tournament.status === 'registration' &&
					new Date() < new Date(tournament.registrationEnd),
				createdAt: tournament.createdAt
			}
		});
	} catch (error) {
		console.error('Tournament refresh error:', error);
		res.status(500).json({ message: 'Server error' });
	}
});

// Get tournament games for display 
router.get('/:id/games', async (req, res) => {
	try {
		const Game = require('../models/Game');

		const games = await Game.find({
			'tournament.id': req.params.id
		})
			.populate('host', 'username profile')
			.populate('opponent', 'username profile')
			.sort({ 'tournament.round': 1, 'tournament.matchIndex': 1 });

		const formattedGames = games.map(game => ({
			id: game._id,
			round: game.tournament.round,
			matchIndex: game.tournament.matchIndex,
			white: game.host,
			black: game.opponent,
			status: game.status,
			result: game.winner ? (game.winner.toString() === game.host._id.toString() ? 'white' : 'black') :
				(game.status === 'finished' ? 'draw' : 'pending'),
			winReason: game.winReason,
			scheduledStartTime: game.scheduledStartTime,
			startTime: game.startTime,
			createdAt: game.createdAt
		}));

		res.json({ games: formattedGames });

	} catch (error) {
		console.error('Get tournament games error:', error);
		res.status(500).json({ message: 'Server error' });
	}
});

module.exports = router;
