const Game = require('../models/Game');

// Function to clean up stale games
async function cleanupStaleGames() {
	try {
		console.log('🧹 Starting enhanced game cleanup process...');
		const now = new Date();
		const twentyFourHoursAgo = new Date(now.getTime() - (24 * 60 * 60 * 1000));

		// 1. Find unstarted games (active status but no moves made, created 24+ hours ago)
		const unstartedGames = await Game.find({
			status: 'active',
			createdAt: { $lt: twentyFourHoursAgo },
			moves: { $size: 0 }
		}).populate('host opponent');

		// 2. Find abandoned mid-game (active status, has moves, but last move 24+ hours ago)
		const abandonedGames = await Game.find({
			status: 'active',
			moves: { $ne: [], $exists: true }, // Has moves array and it's not empty
			$expr: {
				$lt: [
					{ $arrayElemAt: ["$moves.timestamp", -1] }, // Last move timestamp
					twentyFourHoursAgo
				]
			}
		}).populate('host opponent');

		// 3. Find waiting games with no opponent for 24+ hours
		const waitingGames = await Game.find({
			status: 'waiting',
			createdAt: { $lt: twentyFourHoursAgo },
			$or: [
				{ opponent: null },
				{ opponent: { $exists: false } }
			]
		}).populate('host opponent');

		// Combine all games to delete
		const allGamesToDelete = [...unstartedGames, ...abandonedGames, ...waitingGames];

		if (allGamesToDelete.length === 0) {
			console.log('✅ No stale games found to clean up');
			return {
				unstartedGames: 0,
				abandonedGames: 0,
				waitingGames: 0,
				totalDeleted: 0,
				message: 'No games to clean up'
			};
		}

		console.log(`🗑️ Found stale games to delete:`);
		console.log(`   - Unstarted games (active, 0 moves): ${unstartedGames.length}`);
		console.log(`   - Abandoned games (active, inactive 24h+): ${abandonedGames.length}`);
		console.log(`   - Waiting games (no opponent): ${waitingGames.length}`);
		console.log(`   - Total games to delete: ${allGamesToDelete.length}`);

		// Log details of each game being deleted
		allGamesToDelete.forEach(game => {
			const lastMoveTime = game.moves.length > 0 ?
				new Date(game.moves[game.moves.length - 1].timestamp).toISOString() :
				'No moves';
			const gameType = game.moves.length === 0 ? 'Unstarted' :
				game.status === 'waiting' ? 'Waiting' : 'Abandoned';

			console.log(`     • ${gameType}: ${game._id} | ${game.status} | Created: ${game.createdAt.toISOString()} | Last move: ${lastMoveTime} | Host: ${game.host?.username} | Opponent: ${game.opponent?.username || 'none'} | Moves: ${game.moves.length}`);
		});

		// Delete all stale games
		const deleteResult = await Game.deleteMany({
			_id: { $in: allGamesToDelete.map(g => g._id) }
		});

		console.log(`✅ Successfully cleaned up ${deleteResult.deletedCount} stale games`);

		return {
			unstartedGames: unstartedGames.length,
			abandonedGames: abandonedGames.length,
			waitingGames: waitingGames.length,
			totalDeleted: deleteResult.deletedCount,
			message: `Successfully cleaned up ${deleteResult.deletedCount} stale games`,
			deletedGames: allGamesToDelete.map(g => ({
				id: g._id,
				type: g.moves.length === 0 ? 'unstarted' : g.status === 'waiting' ? 'waiting' : 'abandoned',
				status: g.status,
				createdAt: g.createdAt,
				lastMoveAt: g.moves.length > 0 ? g.moves[g.moves.length - 1].timestamp : null,
				host: g.host?.username,
				opponent: g.opponent?.username || null,
				moves: g.moves.length
			}))
		};

	} catch (error) {
		console.error('❌ Error during game cleanup:', error);
		throw error;
	}
}

// Function to start automatic cleanup (runs every hour)
function startAutomaticCleanup() {
	console.log('🕒 Starting automatic enhanced game cleanup service (runs every hour)');
	console.log('📋 Cleanup Rules:');
	console.log('   • Unstarted games: Active status, 0 moves, 24+ hours old');
	console.log('   • Abandoned games: Active status, has moves, last move 24+ hours ago');
	console.log('   • Waiting games: Waiting status, no opponent, 24+ hours old');

	// Run cleanup immediately on start
	cleanupStaleGames().catch(error => {
		console.error('❌ Initial cleanup failed:', error);
	});

	// Then run every hour (3600000 ms)
	setInterval(() => {
		cleanupStaleGames().catch(error => {
			console.error('❌ Scheduled cleanup failed:', error);
		});
	}, 3600000); // 1 hour = 3600000 ms
}

module.exports = {
	cleanupStaleGames,
	startAutomaticCleanup
};
