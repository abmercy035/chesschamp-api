const express = require('express');
const Game = require('../models/Game');
const User = require('../models/User');
const jwt = require('jsonwebtoken');
const { Chess } = require('chess.js'); // Import chess.js for move validation
const { log } = require('../utils/logger');
const { updateGameResult, recordGameStart, recordDrawOffer, recordResignation } = require('./profile');
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

			// For tournament games, if user is host and game is waiting, allow them to "ready up"
			if (game.gameType === 'tournament' && game.status === 'waiting') {
				// Continue to join logic to activate the game if both players are ready
			} else if (game.status === 'active') {
				return res.json({
					message: 'Already in game as host',
					game: {
						...game.toObject(),
						white: { id: game.host._id, username: game.host.username },
						black: game.opponent ? { id: game.opponent._id, username: game.opponent.username } : null
					}
				});
			} else {
				return res.json({ message: 'Already in game as host' });
			}
		}

		if (game.opponent && game.opponent._id.toString() === userId) {
			log('🎮 User is already the opponent');

			// For tournament games, if user is opponent and game is waiting, allow them to "ready up"  
			if (game.gameType === 'tournament' && game.status === 'waiting') {
				// Continue to join logic to activate the game if both players are ready
			} else if (game.status === 'active') {
				return res.json({
					message: 'Already in game as opponent',
					game: {
						...game.toObject(),
						white: { id: game.host._id, username: game.host.username },
						black: { id: game.opponent._id, username: game.opponent.username }
					}
				});
			} else {
				return res.json({ message: 'Already in game as opponent' });
			}
		}

		// Special handling for tournament games
		if (game.gameType === 'tournament') {
			// Check if user is one of the assigned players
			if (game.host._id.toString() !== userId && (!game.opponent || game.opponent._id.toString() !== userId)) {
				return res.status(403).json({
					error: 'You are not assigned to this tournament match.'
				});
			}

			// Check if scheduled start time has been reached
			if (game.scheduledStartTime && new Date() < new Date(game.scheduledStartTime)) {
				const timeUntilStart = Math.ceil((new Date(game.scheduledStartTime) - new Date()) / (1000 * 60));
				return res.status(400).json({
					error: `Tournament game starts in ${timeUntilStart} minute(s). Please wait.`,
					scheduledStartTime: game.scheduledStartTime
				});
			}

			// Check if the game should be forfeited (5 minutes after scheduled start)
			if (game.scheduledStartTime) {
				const fiveMinutesLater = new Date(new Date(game.scheduledStartTime).getTime() + (5 * 60 * 1000));
				if (new Date() > fiveMinutesLater && game.status === 'waiting') {
					// Award win to the player who joined (if any) or the first to join now
					const presentPlayer = game.host._id.toString() === userId ? game.host : game.opponent;
					const absentPlayer = game.host._id.toString() === userId ? game.opponent : game.host;

					if (presentPlayer && absentPlayer) {
						// Award automatic win due to no-show
						game.status = 'finished';
						game.winner = presentPlayer._id;
						game.winReason = 'no-show';
						game.updatedAt = new Date();

						await game.save();
						await game.populate('winner');

						console.log(`⏰ ${absentPlayer.username} failed to show up, ${presentPlayer.username} wins by forfeit`);

						// Handle tournament completion
						await handleTournamentGameCompletion(game);

						return res.json({
							message: `You win by forfeit! ${absentPlayer.username} failed to show up within 5 minutes.`,
							game: {
								...game.toObject(),
								white: { id: game.host._id, username: game.host.username },
								black: { id: game.opponent._id, username: game.opponent.username }
							},
							autoWin: true
						});
					}
				}
			}
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
			let updatedGame;

			if (game.gameType === 'tournament') {
				// For tournament games, both players are pre-assigned
				// Just activate the game when a player "joins" (confirms their participation)
				updatedGame = await Game.findOneAndUpdate(
					{ _id: gameId, status: 'waiting' },
					{
						status: 'active',
						startTime: new Date(), // Record actual start time
						updatedAt: new Date()
					},
					{ new: true }
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

				if (!updatedGame) {
					return res.status(400).json({ error: 'Game is no longer available' });
				}

				console.log('✅ Tournament game activated, both players ready');
			} else {
				// For regular games, assign opponent and activate
				updatedGame = await Game.findOneAndUpdate(
					{ _id: gameId, opponent: null }, // Only update if opponent is not set
					{
						opponent: userId,
						status: 'active',
						startTime: new Date() // Record actual start time
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

				// If no game was updated, it means the game is already full
				if (!updatedGame) {
					return res.status(400).json({ error: 'Game is full' });
				}

				console.log('✅ User joined as opponent, game is now active');
			}

			// Record game start for profile tracking
			await recordGameStart(updatedGame.host._id, updatedGame.opponent._id);

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
		console.log({ id: req.user.id, _id: req.user._id })

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
			userId,
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
		const { move, timeLeft } = req.body; // Expected format: { from: "e2", to: "e4" } or { san: "e4" }

		console.log('🎮 Move attempt:', { gameId, userId, move, timeLeft });

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
				const moveOptions = {
					from: move.from,
					to: move.to
				};

				// Only add promotion if it's specified (for pawn promotion moves)
				if (move.promotion) {
					moveOptions.promotion = move.promotion;
				}

				moveResult = chess.move(moveOptions);
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
		} else if (
			gameState.inStalemate ||
			gameState.inDraw ||
			gameState.insufficientMaterial ||
			gameState.inThreefoldRepetition
		) {
			game.status = 'finished';
			if (gameState.inStalemate) {
				game.winReason = 'stalemate';
				console.log('🤝 Game ended in stalemate');
			} else if (gameState.inThreefoldRepetition) {
				game.winReason = 'threefold';
				console.log('🤝 Game ended by threefold repetition');
			} else if (gameState.insufficientMaterial) {
				game.winReason = 'insufficientMaterial';
				console.log('🤝 Game ended by insufficient material');
			} else if (chess.getHalfMoves() >= 100) {
				game.winReason = 'fiftyMove';
				console.log('🤝 Game ended by fifty-move rule');
			} else if (gameState.inDraw) {
				game.winReason = 'draw';
				console.log('🤝 Game ended in draw');
			}
		}

		// Update timer state if provided
		if (timeLeft && typeof timeLeft === 'object' && timeLeft.w !== undefined && timeLeft.b !== undefined) {
			game.timeLeft = timeLeft;
			console.log('⏰ Updated timer state:', timeLeft);
		}

		game.updatedAt = new Date();
		await game.save();
		await game.populate('host opponent winner');

		// Update player profiles if game is finished
		if (game.status === 'finished') {
			console.log('🎯 Game finished, updating player profiles...');

			// Handle tournament game completion
			if (game.gameType === 'tournament') {
				await handleTournamentGameCompletion(game);
			}

			// Calculate game duration (if startTime exists)
			let gameDuration = 600; // Default 10 minutes
			if (game.startTime) {
				gameDuration = Math.floor((new Date() - game.startTime) / 1000);
			}

			// Count total moves made
			const moveCount = game.moves ? game.moves.length : 0;

			if (game.winner) {
				// Someone won the game
				const winnerId = game.winner._id || game.winner;
				const loserId = winnerId.toString() === game.host._id.toString() ? game.opponent._id : game.host._id;

				await updateGameResult(winnerId, loserId, 'win', game.winReason, gameDuration, moveCount);
			} else {
				// Game was a draw
				await updateGameResult(game.host._id, game.opponent._id, 'draw', game.winReason, gameDuration, moveCount);
			}
		}

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

		// Handle tournament game completion
		if (game.gameType === 'tournament') {
			await handleTournamentGameCompletion(game);
		}

		// Update player profiles after resignation
		console.log('🎯 Game ended by resignation, updating player profiles...');

		// Calculate game duration
		let gameDuration = 300; // Default 5 minutes for resignation
		if (game.startTime) {
			gameDuration = Math.floor((new Date() - game.startTime) / 1000);
		}

		// Count total moves made
		const moveCount = game.moves ? game.moves.length : 0;

		const winnerId = winner._id;
		const loserId = resigningPlayer === 'white' ? game.host._id : game.opponent._id;

		// Record resignation in player stats
		await recordResignation(loserId);

		await updateGameResult(winnerId, loserId, 'win', 'resignation', gameDuration, moveCount);

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

// Offer a draw
router.post('/offer-draw/:id', verifyToken, async (req, res) => {
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

		// Check if user is a player in this game
		const isHost = game.host && game.host._id.toString() === userId;
		const isOpponent = game.opponent && game.opponent._id.toString() === userId;

		if (!isHost && !isOpponent) {
			return res.status(400).json({ error: 'You are not a player in this game' });
		}

		// Check if there's already a pending draw offer
		if (game.currentDrawOffer && game.currentDrawOffer.offeredBy) {
			return res.status(400).json({ error: 'There is already a pending draw offer' });
		}

		// Create draw offer
		game.currentDrawOffer = {
			offeredBy: userId,
			timestamp: new Date()
		};

		// Add to draw offers history
		game.drawOffers.push({
			offeredBy: userId,
			timestamp: new Date(),
			status: 'pending'
		});

		// Record draw offer in player stats
		await recordDrawOffer(userId);

		game.updatedAt = new Date();
		await game.save();
		await game.populate('currentDrawOffer.offeredBy');

		console.log(`🤝 Draw offer created by ${isHost ? 'host' : 'opponent'}`);

		// Get Ably instance and publish draw offer
		const ably = req.app.get('ably');
		const channel = ably.channels.get(`game-${gameId}`);

		await channel.publish('drawOffer', {
			game: {
				...game.toObject(),
				white: { name: game.host.username },
				black: { name: game.opponent.username }
			},
			offeredBy: {
				id: userId,
				username: isHost ? game.host.username : game.opponent.username,
				color: isHost ? 'white' : 'black'
			}
		});

		res.json({
			message: 'Draw offer sent',
			drawOffer: game.currentDrawOffer
		});

	} catch (error) {
		console.error('❌ Error creating draw offer:', error);
		res.status(500).json({ error: 'Failed to offer draw' });
	}
});

// Respond to a draw offer (accept or decline)
router.post('/respond-draw/:id', verifyToken, async (req, res) => {
	try {
		const gameId = req.params.id;
		const userId = req.user.id;
		const { response } = req.body; // 'accept' or 'decline'

		if (!['accept', 'decline'].includes(response)) {
			return res.status(400).json({ error: 'Response must be "accept" or "decline"' });
		}

		const game = await Game.findById(gameId).populate('host opponent currentDrawOffer.offeredBy');
		if (!game) {
			return res.status(404).json({ error: 'Game not found' });
		}

		if (game.status !== 'active') {
			return res.status(400).json({ error: 'Game is not active' });
		}

		// Check if there's a pending draw offer
		if (!game.currentDrawOffer || !game.currentDrawOffer.offeredBy) {
			return res.status(400).json({ error: 'No pending draw offer' });
		}

		// Check if user is the recipient of the draw offer (not the one who offered)
		if (game.currentDrawOffer.offeredBy._id.toString() === userId) {
			return res.status(400).json({ error: 'You cannot respond to your own draw offer' });
		}

		// Check if user is a player in this game
		const isHost = game.host && game.host._id.toString() === userId;
		const isOpponent = game.opponent && game.opponent._id.toString() === userId;

		if (!isHost && !isOpponent) {
			return res.status(400).json({ error: 'You are not a player in this game' });
		}

		// Update draw offer status in history
		const pendingOffer = game.drawOffers[game.drawOffers.length - 1];
		if (pendingOffer && pendingOffer.status === 'pending') {
			pendingOffer.status = response === 'accept' ? 'accepted' : 'declined';
		}

		if (response === 'accept') {
			// Accept draw - end game
			game.status = 'finished';
			game.winReason = 'draw';
			game.currentDrawOffer = {}; // Clear current offer

			console.log('🤝 Draw accepted - game ended');
		} else {
			// Decline draw - continue game
			game.currentDrawOffer = {}; // Clear current offer

			console.log('❌ Draw declined - game continues');
		}

		game.updatedAt = new Date();
		await game.save();

		// Handle tournament game completion for draws
		if (response === 'accept' && game.gameType === 'tournament') {
			await handleTournamentGameCompletion(game);
		}

		// Get Ably instance and publish draw response
		const ably = req.app.get('ably');
		const channel = ably.channels.get(`game-${gameId}`);

		if (response === 'accept') {
			await channel.publish('gameEnd', {
				game: {
					...game.toObject(),
					white: { name: game.host.username },
					black: { name: game.opponent.username }
				},
				reason: 'draw',
				message: 'Draw accepted by mutual agreement'
			});
		} else {
			await channel.publish('drawDeclined', {
				game: {
					...game.toObject(),
					white: { name: game.host.username },
					black: { name: game.opponent.username }
				},
				declinedBy: {
					id: userId,
					username: isHost ? game.host.username : game.opponent.username,
					color: isHost ? 'white' : 'black'
				}
			});
		}

		res.json({
			message: response === 'accept' ? 'Draw accepted - game ended' : 'Draw declined',
			response: response,
			gameStatus: game.status
		});

	} catch (error) {
		console.error('❌ Error responding to draw offer:', error);
		res.status(500).json({ error: 'Failed to respond to draw offer' });
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

// End game due to timeout
router.post('/timeout/:id', verifyToken, async (req, res) => {
	try {
		const gameId = req.params.id;
		const userId = req.user.id;
		const { loserColor } = req.body; // 'w' or 'b'

		const game = await Game.findById(gameId).populate('host opponent');
		if (!game) {
			return res.status(404).json({ error: 'Game not found' });
		}

		if (game.status !== 'active') {
			return res.status(400).json({ error: 'Game is not active' });
		}

		// Verify that the user is part of this game
		const isHost = game.host && game.host._id.toString() === userId;
		const isOpponent = game.opponent && game.opponent._id.toString() === userId;

		if (!isHost && !isOpponent) {
			return res.status(400).json({ error: 'You are not a player in this game' });
		}

		// Determine winner and loser
		let winner, loser;
		if (loserColor === 'w') {
			winner = game.opponent;
			loser = game.host;
		} else {
			winner = game.host;
			loser = game.opponent;
		}

		// End the game
		game.status = 'finished';
		game.winner = winner._id;
		game.winReason = 'timeout';
		game.updatedAt = new Date();

		await game.save();
		await game.populate('winner');

		console.log(`⏰ ${loserColor === 'w' ? 'White' : 'Black'} timed out, ${winner.username} wins`);

		// Handle tournament game completion
		if (game.gameType === 'tournament') {
			await handleTournamentGameCompletion(game);
		}

		// Update player profiles after timeout
		console.log('🎯 Game ended by timeout, updating player profiles...');

		// Calculate game duration
		let gameDuration = 600; // Default 10 minutes
		if (game.startTime) {
			gameDuration = Math.floor((new Date() - game.startTime) / 1000);
		}

		// Count total moves made
		const moveCount = game.moves ? game.moves.length : 0;

		await updateGameResult(winner._id, loser._id, 'win', 'timeout', gameDuration, moveCount);

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
			loser: loserColor,
			reason: 'timeout'
		});

		res.json({
			message: `${loserColor === 'w' ? 'White' : 'Black'} timed out. ${winner.username} wins!`,
			game: {
				...game.toObject(),
				white: { name: game.host.username },
				black: { name: game.opponent.username }
			}
		});

	} catch (error) {
		console.error('❌ Error processing timeout:', error);
		res.status(500).json({ error: 'Failed to process timeout' });
	}
});

// Manual cleanup endpoint for stale games
router.post('/cleanup', verifyToken, async (req, res) => {
	try {
		const { cleanupStaleGames } = require('../utils/gameCleanup');
		const result = await cleanupStaleGames();

		res.json({
			success: true,
			...result
		});
	} catch (error) {
		console.error('❌ Error during manual cleanup:', error);
		res.status(500).json({ error: 'Failed to cleanup games' });
	}
});

// Debug endpoint to test tournament completion
router.get('/debug-tournament/:gameId', verifyToken, async (req, res) => {
	try {
		const game = await Game.findById(req.params.gameId).populate('host opponent winner');
		if (!game) {
			return res.status(404).json({ error: 'Game not found' });
		}

		console.log('🐛 DEBUG: Game info', {
			id: game._id,
			status: game.status,
			winner: game.winner ? game.winner.username : 'No winner',
			winReason: game.winReason,
			tournament: game.tournament,
			gameType: game.gameType
		});

		if (game.tournament && game.tournament.id) {
			const tournament = await Tournament.findById(game.tournament.id).populate('participants.player', 'username');
			console.log('🐛 DEBUG: Tournament info', {
				id: tournament._id,
				name: tournament.name,
				round: game.tournament.round,
				matchIndex: game.tournament.matchIndex,
				participants: tournament.participants.map(p => ({
					username: p.player.username,
					score: p.score,
					wins: p.wins,
					draws: p.draws,
					losses: p.losses
				}))
			});
		}

		res.json({
			message: 'Debug info logged to console',
			gameInfo: {
				status: game.status,
				winner: game.winner ? game.winner.username : null,
				tournament: game.tournament
			}
		});

	} catch (error) {
		console.error('❌ Debug error:', error);
		res.status(500).json({ error: 'Debug failed' });
	}
});

// Check for overdue tournament games and award forfeits
router.post('/check-forfeits', async (req, res) => {
	try {
		console.log('🕐 Checking for overdue tournament games...');

		const fiveMinutesAgo = new Date(Date.now() - (5 * 60 * 1000));

		// Find tournament games that are waiting and past their forfeit time
		const overdueGames = await Game.find({
			gameType: 'tournament',
			status: 'waiting',
			scheduledStartTime: { $lte: fiveMinutesAgo }
		}).populate('host opponent');

		console.log(`⏰ Found ${overdueGames.length} overdue tournament games`);

		let forfeitsAwarded = 0;

		for (const game of overdueGames) {
			// Award forfeit win - this is a simplified version, in practice you'd want to check
			// which player(s) actually attempted to join
			game.status = 'finished';
			game.winner = game.host._id; // Default to host win
			game.winReason = 'forfeit-time';
			game.updatedAt = new Date();

			await game.save();
			await game.populate('winner');

			console.log(`⚡ Awarded forfeit win to ${game.host.username} in game ${game._id}`);

			// Handle tournament completion
			if (game.gameType === 'tournament') {
				await handleTournamentGameCompletion(game);
			}

			forfeitsAwarded++;
		}

		res.json({
			message: `Checked ${overdueGames.length} overdue games, awarded ${forfeitsAwarded} forfeits`,
			forfeitsAwarded
		});

	} catch (error) {
		console.error('❌ Error checking forfeits:', error);
		res.status(500).json({ error: 'Failed to check forfeits' });
	}
});

module.exports = router;
