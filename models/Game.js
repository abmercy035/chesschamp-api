const mongoose = require('mongoose');
const GameSchema = new mongoose.Schema({
	host: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
	opponent: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
	moves: [{ type: String }],
	watches: { type: Number },
	stakedPrice: { type: Number },
	status: { type: String, enum: ['waiting', 'active', 'finished'], default: 'waiting' },
	winner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
	fen: { type: String, default: 'start' }, // Forsyth–Edwards Notation for board state
	turn: { type: String, enum: ['w', 'b'], default: 'w' },
	timeLeft: { w: Number, b: Number },
	createdAt : { type: Date, default: Date.now },
	updatedAt : { type: Date, default: Date.now }
});
module.exports = mongoose.model('Game', GameSchema);
