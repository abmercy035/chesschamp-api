const express = require('express');
const Game = require('../models/Game');
const User = require('../models/User');
const jwt = require('jsonwebtoken');
const { log } = require('../utils/logger');
const router = express.Router();

// Middleware to verify JWT
async function verifyToken(req, res, next) {
	const token = req.cookies.token;
	// var appCookies = (req?.headers?.cookie?.split(";"));
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

// Get all waiting games (for dashboard) - NEWEST FIRST
router.get('/', verifyToken, async (req, res) => {
	try {

		console.log('🎮 Getting waiting games');

		const games = await Game.find()
			.populate('host', 'username')
			.populate('opponent', 'username')
			.sort({ createdAt: -1 }); // Sort by newest first

		console.log('🎮 Found', games.length, 'waiting games');

		res.json(games);

	} catch (error) {
		console.error('❌ Error getting games:', error);
		res.status(500).json({ error: 'Failed to get games' });
	}
});

// Create a new game
router.post('/create', verifyToken, async (req, res) => {
	try {
		console.log('🎮 Creating new game for user:', req.user._id);
		const host = await User.findById(req.user._id).lean()

		const game = new Game({
			host: host._id,
			stakedPrice: 50.00,
			timeLeft: { w: 300, b: 300 } // 5 minutes each side
		});

		await game.save();
		console.log('✅ Game created:', game._id);

		res.json({ id: game._id });
	} catch (error) {
		console.error('❌ Error creating game:', error);
		res.status(500).json({ error: 'Failed to create game' });
	}
});

// Join a game
router.post('/join/:id', verifyToken, async (req, res) => {
	try {
		const gameId = req.params.id;
		const userId = req.user.id;

		log('🎮 User', userId, 'attempting to join game:', gameId);

		const game = await Game.findById(gameId)
			.populate({
				path: 'host',
				select: '-password -email'
			})
			.populate({
				path: 'opponent',
				select: '-password -email'
			});

		log({ game })
		if (!game) {
			return res.status(404).json({ error: 'Game not found' });
		}

		log({
			status: game.status,
			host: game.host?._id,
			opponent: game.opponent?._id || null
		}, '🎮 Current game state:');

		// Check if user is already in the game
		if (game.host._id.toString() === userId) {
			log('🎮 User is the host');
			return res.json({ message: 'Already in game as host' });
		}
log(game.opponent)
		if (game.opponent && game.opponent._id.toString() === userId) {
			log('🎮 User is already the opponent');
			return res.json({ message: 'Already in game as opponent' });
		}

		// Check if game is already full
		if (game.opponent && game.status === 'active') {
			const updatedGame = await Game.findOneAndUpdate(
				{ _id: game._id },
				{ $inc: { watches: 1 } },
				{ new: true } // Return the updated document
			);

			res.json({
				error: 'Game has started, you will be joining as a spectator',
				watches: updatedGame.watches
			});
		}

		// Join as opponent
		try {
			// First, atomically update the game to prevent race conditions
			const updatedGame = await Game.findOneAndUpdate(
				{ _id: gameId, opponent: null }, // Only update if opponent is not set
				{
					opponent: userId,
					status: 'active'
				},
				{ new: true } // Return the updated document
			).populate([
				{
					path: 'host',
					select: '-password -email'
				},
				{
					path: 'opponent',
					select: '-password -email'
				}
			]);
log(updatedGame)

			// If no game was updated, it means the game is already full
			if (!updatedGame) {
				return res.status(400).json({ error: 'Game is full' });
			}

			console.log('✅ User joined as opponent, game is now active');

			// Get Ably instance and publish game start notification
			const ably = req.app.get('ably');
			const channel = ably.channels.get(`game-${gameId}`);
			console.log('📢 Publishing game start notification to channel:', `game-${gameId}`);

			const gameData = {
				id: updatedGame._id,
				status: updatedGame.status,
				white: {
					id: updatedGame.host._id,
					username: updatedGame.host.username
				},
				black: {
					id: updatedGame.opponent._id,
					username: updatedGame.opponent.username
				}
			};

			// Notify all players that the game has started
			await channel.publish('gameStart', {
				game: gameData,
				message: 'Game started! Both players have joined.'
			});

			// Prepare sanitized response
			const responseGame = {
				...updatedGame.toObject(),
				white: {
					id: updatedGame.host._id,
					username: updatedGame.host.username
				},
				black: {
					id: updatedGame.opponent._id,
					username: updatedGame.opponent.username
				}
			};

			res.json({
				message: 'Joined game successfully',
				game: responseGame
			});

		} catch (error) {
			console.error('Error joining game as opponent:', error);
			res.status(500).json({ error: 'Failed to join game' });
		}

	} catch (error) {
		console.error('❌ Error joining game:', error);
		res.status(500).json({ error: 'Failed to join game' });
	}
});

// Get game details
router.get('/:id', verifyToken, async (req, res) => {
	try {
		const gameId = req.params.id;
		const userId = req.user.id;

		log('🎮 Getting game details for:', gameId, 'user:', userId);

		const game = await Game.findById(gameId).populate([
			{
				path: 'host',
				select: '-password -email'
			},
			{
				path: 'opponent',
				select: '-password -email'
			}
		]);

		if (!game) {
			return res.status(404).json({ error: 'Game not found' });
		}

		// Determine user's role and color
		let userRole = 'spectator';
		let playerColor = null;

		if (game.host && game.host._id.toString() === userId) {
			userRole = 'player';
			playerColor = 'w'; // white Host
		} else if (game.opponent && game.opponent._id.toString() === userId) {
			userRole = 'player';
			playerColor = 'b'; // black for opponent 
		}

		log({ userRole, playerColor }, '🎮 User role determined:');

		// Get Ably instance and publish game start notification
		const ably = req.app.get('ably');
		const channel = ably.channels.get(`game-${gameId}`);
		console.log('📢 Publishing game start notification to channel:', `game-${gameId}`);


		const response = {
			...game.toObject(),
			userRole,
			playerColor,
			white: game.host ? { name: game.host.username } : null,
			black: game.opponent ? { name: game.opponent.username } : null
		};

		log(response, '🎮 Sending game response:');
		res.json(response);

		// Notify all players that the game has started
		// await channel.publish('gameStart', {
		// 	game: response,
		//  
		// 	message: 'Game started! Both players have joined.'
		// });

	} catch (error) {
		console.error('❌ Error getting game:', error);
		res.status(500).json({ error: 'Failed to get game' });
	}
});

// Make a move
router.post('/move/:id', verifyToken, async (req, res) => {
	try {
		const gameId = req.params.id;
		const userId = req.user.id;
		const { move } = req.body;

		console.log('🎮 Move attempt:', { gameId, userId, move });

		const game = await Game.findById(gameId).populate('host opponent');
		if (!game) {
			return res.status(404).json({ error: 'Game not found' });
		}

		// Check if game is active
		if (game.status !== 'active') {
			return res.status(400).json({ error: 'Game is not active' });
		}

		// Determine if user can move
		let canMove = false;
		if (game.turn === 'w' && game.host && game.host._id.toString() === userId) {
			canMove = true;
		} else if (game.turn === 'b' && game.opponent && game.opponent._id.toString() === userId) {
			canMove = true;
		}

		if (!canMove) {
			return res.status(400).json({ error: 'Not your turn' });
		}

		// Add move to game
		game.moves.push(move);
		game.turn = game.turn === 'w' ? 'b' : 'w'; // Switch turns

		await game.save();
		await game.populate('host opponent');

		console.log('✅ Move made successfully');

		// Get Ably instance and publish move
		const ably = req.app.get('ably');
		const channel = ably.channels.get(`game-${gameId}`);

		console.log('📢 Publishing move to channel:', `game-${gameId}`);

		await channel.publish('move', {
			game: {
				...game.toObject(),
				white: { name: game.host.username },
				black: { name: game.opponent.username }
			},
			move,
			by: userId
		});

		res.json({
			message: 'Move made successfully',
			game: {
				...game.toObject(),
				white: { name: game.host.username },
				black: { name: game.opponent.username }
			}
		});

	} catch (error) {
		console.error('❌ Error making move:', error);
		res.status(500).json({ error: 'Failed to make move' });
	}
});

module.exports = router;
