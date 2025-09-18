const express = require('express');
const Game = require('../models/Game');
const User = require('../models/User');
const jwt = require('jsonwebtoken');
const { Chess } = require('chess.js'); // Import chess.js for move validation
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
		// log('🎮 User', userId, 'attempting to join game:', gameId);

		const game = await Game.findById(gameId)
			.populate({
				path: 'host',
				select: '-password -email'
			})
			.populate({
				path: 'opponent',
				select: '-password -email'
			});

		if (!game) {
			return res.status(404).json({ error: 'Game not found' });
		}

		// log({
		// 	status: game.status,
		// 	host: game.host?._id,
		// 	opponent: game.opponent?._id || null
		// }, '🎮 Current game state:');

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
console.log({id: req.user.id, _id:req.user._id})

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
			console.log("host is w")
		} else if (game.opponent && game.opponent._id.toString() === userId) {
			userRole = 'player';
			playerColor = 'b'; // black for opponent 
			console.log("host is b")
		}

		console.log({ userRole, playerColor }, '🎮 User role determined:');

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

// Make a move with proper chess validation
router.post('/move/:id', verifyToken, async (req, res) => {
	try {
		const gameId = req.params.id;
		const userId = req.user.id;
		const { move } = req.body; // Expected format: { from: "e2", to: "e4" } or { san: "e4" }

		console.log('🎮 Move attempt:', { gameId, userId, move });

		const game = await Game.findById(gameId).populate('host opponent');
		if (!game) {
			return res.status(404).json({ error: 'Game not found' });
		}

		// Check if game is active
		if (game.status !== 'active') {
			return res.status(400).json({ error: 'Game is not active' });
		}

		// Initialize chess.js with current game state
		const chess = new Chess();
		if (game.fen && game.fen !== 'start') {
			chess.load(game.fen);
		}

		// Verify it's the player's turn
		const currentTurn = chess.turn();
		let canMove = false;
		let playerColor = null;

		if (currentTurn === 'w' && game.host && game.host._id.toString() === userId) {
			canMove = true;
			playerColor = 'w';
		} else if (currentTurn === 'b' && game.opponent && game.opponent._id.toString() === userId) {
			canMove = true;
			playerColor = 'b';
		}

		if (!canMove) {
			return res.status(400).json({
				error: 'Not your turn',
				currentTurn: currentTurn,
				expectedPlayer: currentTurn === 'w' ? 'white (host)' : 'black (opponent)'
			});
		}

		// Attempt to make the move
		let moveResult;
		try {
			// Support both coordinate moves (from/to) and SAN notation
			if (move.from && move.to) {
				moveResult = chess.move({
					from: move.from,
					to: move.to,
					promotion: move.promotion || 'q' // Default to queen promotion
				});
			} else if (move.san) {
				moveResult = chess.move(move.san);
			} else {
				return res.status(400).json({
					error: 'Invalid move format. Use {from: "e2", to: "e4"} or {san: "e4"}'
				});
			}
		} catch (chessError) {
			return res.status(400).json({
				error: 'Illegal move',
				details: chessError.message,
				currentBoard: chess.ascii()
			});
		}

		if (!moveResult) {
			return res.status(400).json({
				error: 'Invalid move',
				currentBoard: chess.ascii()
			});
		}

		console.log('✅ Valid move:', moveResult);

		// Create detailed move record
		const moveRecord = {
			san: moveResult.san,
			from: moveResult.from,
			to: moveResult.to,
			piece: moveResult.piece,
			captured: moveResult.captured || null,
			promotion: moveResult.promotion || null,
			flags: moveResult.flags,
			fen: chess.fen(),
			timestamp: new Date()
		};

		// Update game state
		game.moves.push(moveRecord);
		game.fen = chess.fen();
		game.turn = chess.turn();

		// Check for game ending conditions
		const gameState = {
			inCheck: chess.inCheck(),
			inCheckmate: chess.isCheckmate(),
			inStalemate: chess.isStalemate(),
			inDraw: chess.isDraw(),
			insufficientMaterial: chess.isInsufficientMaterial(),
			inThreefoldRepetition: chess.isThreefoldRepetition()
		};

		game.gameState = gameState;

		// Handle game ending
		if (gameState.inCheckmate) {
			game.status = 'finished';
			game.winner = playerColor === 'w' ? game.host._id : game.opponent._id;
			game.winReason = 'checkmate';
			console.log('🏆 Game ended by checkmate, winner:', playerColor);
		} else if (gameState.inStalemate || gameState.inDraw || gameState.insufficientMaterial || gameState.inThreefoldRepetition) {
			game.status = 'finished';
			game.winReason = gameState.inStalemate ? 'stalemate' : 'draw';
			console.log('🤝 Game ended in draw/stalemate');
		}

		game.updatedAt = new Date();
		await game.save();
		await game.populate('host opponent winner');

		console.log('✅ Move processed successfully');

		// Prepare response
		const gameResponse = {
			...game.toObject(),
			white: { name: game.host.username },
			black: { name: game.opponent.username },
			currentBoard: chess.ascii(), // For debugging
			legalMoves: chess.moves(), // Available moves for next player
		};

		// Get Ably instance and publish move
		const ably = req.app.get('ably');
		const channel = ably.channels.get(`game-${gameId}`);

		console.log('📢 Publishing move to channel:', `game-${gameId}`);

		const moveMessage = {
			game: gameResponse,
			move: moveRecord,
			by: userId,
			gameState: gameState
		};

		// If game ended, publish game end event
		if (game.status === 'finished') {
			await channel.publish('gameEnd', {
				game: gameResponse,
				winner: game.winner ? {
					id: game.winner._id,
					username: game.winner.username
				} : null,
				reason: game.winReason,
				finalMove: moveRecord
			});
		} else {
			await channel.publish('move', moveMessage);
		}

		res.json({
			message: game.status === 'finished' ?
				`Game ended: ${game.winReason}` :
				'Move made successfully',
			game: gameResponse,
			moveResult: moveRecord,
			gameState: gameState
		});

	} catch (error) {
		console.error('❌ Error making move:', error);
		res.status(500).json({ error: 'Failed to make move', details: error.message });
	}
});

// Resign from game
router.post('/resign/:id', verifyToken, async (req, res) => {
	try {
		const gameId = req.params.id;
		const userId = req.user.id;

		const game = await Game.findById(gameId).populate('host opponent');
		if (!game) {
			return res.status(404).json({ error: 'Game not found' });
		}

		if (game.status !== 'active') {
			return res.status(400).json({ error: 'Game is not active' });
		}

		// Determine who resigned and who wins
		let resigningPlayer, winner;
		if (game.host && game.host._id.toString() === userId) {
			resigningPlayer = 'white';
			winner = game.opponent;
		} else if (game.opponent && game.opponent._id.toString() === userId) {
			resigningPlayer = 'black';
			winner = game.host;
		} else {
			return res.status(400).json({ error: 'You are not a player in this game' });
		}

		// End the game
		game.status = 'finished';
		game.winner = winner._id;
		game.winReason = 'resignation';
		game.updatedAt = new Date();

		await game.save();
		await game.populate('winner');

		console.log(`🏳️ ${resigningPlayer} resigned, ${winner.username} wins`);

		// Publish game end event
		const ably = req.app.get('ably');
		const channel = ably.channels.get(`game-${gameId}`);

		await channel.publish('gameEnd', {
			game: {
				...game.toObject(),
				white: { name: game.host.username },
				black: { name: game.opponent.username }
			},
			winner: {
				id: winner._id,
				username: winner.username
			},
			reason: 'resignation',
			resigningPlayer: resigningPlayer
		});

		res.json({
			message: `${resigningPlayer} resigned. ${winner.username} wins!`,
			game: {
				...game.toObject(),
				white: { name: game.host.username },
				black: { name: game.opponent.username }
			}
		});

	} catch (error) {
		console.error('❌ Error processing resignation:', error);
		res.status(500).json({ error: 'Failed to resign' });
	}
});

// Get legal moves for current position
router.get('/moves/:id', verifyToken, async (req, res) => {
	try {
		const gameId = req.params.id;
		const game = await Game.findById(gameId);

		if (!game) {
			return res.status(404).json({ error: 'Game not found' });
		}

		if (game.status !== 'active') {
			return res.status(400).json({ error: 'Game is not active' });
		}

		// Initialize chess.js with current game state
		const chess = new Chess();
		if (game.fen && game.fen !== 'start') {
			chess.load(game.fen);
		}

		const legalMoves = chess.moves({ verbose: true }); // Get detailed move objects
		const simpleMoves = chess.moves(); // Get simple notation moves

		res.json({
			currentTurn: chess.turn(),
			legalMoves: simpleMoves,
			detailedMoves: legalMoves,
			gameState: {
				inCheck: chess.inCheck(),
				canCastle: {
					kingside: chess.moves().some(move => move.includes('O-O') && !move.includes('O-O-O')),
					queenside: chess.moves().some(move => move.includes('O-O-O'))
				}
			},
			currentBoard: chess.ascii()
		});

	} catch (error) {
		console.error('❌ Error getting legal moves:', error);
		res.status(500).json({ error: 'Failed to get legal moves' });
	}
});

// Get current board state as 8x8 array (for frontend compatibility)
router.get('/board/:id', verifyToken, async (req, res) => {
	try {
		const gameId = req.params.id;
		const game = await Game.findById(gameId);

		if (!game) {
			return res.status(404).json({ error: 'Game not found' });
		}

		// Initialize chess.js with current game state
		const chess = new Chess();
		if (game.fen && game.fen !== 'start') {
			chess.load(game.fen);
		}

		// Convert chess.js board to 8x8 array format
		const board = chess.board();
		const simpleBoard = board.map(row =>
			row.map(piece => piece ? `${piece.color === 'w' ? piece.type.toUpperCase() : piece.type}` : null)
		);

		res.json({
			board: simpleBoard,
			fen: chess.fen(),
			turn: chess.turn(),
			ascii: chess.ascii(),
			gameState: {
				inCheck: chess.inCheck(),
				inCheckmate: chess.isCheckmate(),
				inStalemate: chess.isStalemate(),
				inDraw: chess.isDraw()
			}
		});

	} catch (error) {
		console.error('❌ Error getting board state:', error);
		res.status(500).json({ error: 'Failed to get board state' });
	}
});

module.exports = router;
