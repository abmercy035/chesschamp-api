const mongoose = require('mongoose');
const GameSchema = new mongoose.Schema({
	host: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
	opponent: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
	moves: [{
		san: { type: String, required: true }, // Standard Algebraic Notation (e.g., "Nf3", "e4")
		from: { type: String, required: true }, // Source square (e.g., "e2")
		to: { type: String, required: true }, // Target square (e.g., "e4")
		piece: { type: String, required: true }, // Moving piece (e.g., "p", "N", "K")
		captured: { type: String }, // Captured piece if any
		promotion: { type: String }, // Promotion piece if pawn promotion
		flags: { type: String }, // Move flags (castling, en passant, etc.)
		fen: { type: String, required: true }, // Board state after this move
		timestamp: { type: Date, default: Date.now }
	}],
	watches: { type: Number, default: 0 },
	stakedPrice: { type: Number, default: 50.00 },
	status: { type: String, enum: ['waiting', 'active', 'finished'], default: 'waiting' },
	winner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
	winReason: { type: String },
	fen: { type: String, default: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' }, // Starting position
	turn: { type: String, enum: ['w', 'b'], default: 'w' },
	timeLeft: {
		w: { type: Number, default: 300 }, // 5 minutes in seconds
		b: { type: Number, default: 300 }
	},
	gameState: {
		inCheck: { type: Boolean, default: false },
		inCheckmate: { type: Boolean, default: false },
		inStalemate: { type: Boolean, default: false },
		inDraw: { type: Boolean, default: false },
		insufficientMaterial: { type: Boolean, default: false },
		inThreefoldRepetition: { type: Boolean, default: false }
	},
	drawOffers: [{
		offeredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
		timestamp: { type: Date, default: Date.now },
		status: { type: String, enum: ['pending', 'accepted', 'declined'], default: 'pending' }
	}],
	currentDrawOffer: {
		offeredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
		timestamp: { type: Date }
	},

	// Ranked game support
	gameType: { type: String, enum: ['casual', 'ranked'], default: 'casual' },
	isRanked: { type: Boolean, default: false },

	eloInfo: {
		whiteElo: { type: Number },
		blackElo: { type: Number },
		eloDifference: { type: Number },
		eloChange: {
			white: { type: Number },
			black: { type: Number }
		}
	},

	// Time control
	timeControl: {
		initial: { type: Number, default: 300000 }, // 5 minutes in milliseconds
		increment: { type: Number, default: 0 }     // increment per move in milliseconds
	},

	createdAt: { type: Date, default: Date.now },
	updatedAt: { type: Date, default: Date.now }
});
module.exports = mongoose.model('Game', GameSchema);
