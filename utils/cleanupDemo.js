// Enhanced Game Cleanup System - Test & Documentation
// 
// This script demonstrates the enhanced cleanup functionality

const { cleanupStaleGames } = require('./gameCleanup');

async function demonstrateCleanup() {
	console.log('🎯 Enhanced Game Cleanup System');
	console.log('═'.repeat(50));
	console.log();

	console.log('📋 CLEANUP RULES:');
	console.log('1. 🚀 Unstarted Games:');
	console.log('   • Status: active');
	console.log('   • Moves: 0 (never started playing)');
	console.log('   • Age: Created 24+ hours ago');
	console.log();

	console.log('2. 🏃 Abandoned Games (NEW):');
	console.log('   • Status: active');
	console.log('   • Moves: Has moves (players started)');
	console.log('   • Activity: Last move 24+ hours ago');
	console.log('   • Scenario: Both players made moves then abandoned');
	console.log();

	console.log('3. ⏳ Waiting Games:');
	console.log('   • Status: waiting');
	console.log('   • Opponent: No opponent joined');
	console.log('   • Age: Created 24+ hours ago');
	console.log();

	console.log('🔍 EXAMPLE SCENARIOS HANDLED:');
	console.log('❌ Game A: Players made 5 moves, both left 25 hours ago → DELETED');
	console.log('❌ Game B: Created 30 hours ago, 0 moves, still active → DELETED');
	console.log('❌ Game C: Waiting for opponent 48 hours, no one joined → DELETED');
	console.log('✅ Game D: Last move 12 hours ago → KEPT (still active)');
	console.log('✅ Game E: Game finished yesterday → KEPT (not active status)');
	console.log();

	console.log('🎛️ MANUAL CLEANUP TEST:');
	try {
		const result = await cleanupStaleGames();
		console.log('📊 Cleanup Results:');
		console.log(`   • Unstarted games cleaned: ${result.unstartedGames}`);
		console.log(`   • Abandoned games cleaned: ${result.abandonedGames}`);
		console.log(`   • Waiting games cleaned: ${result.waitingGames}`);
		console.log(`   • Total games deleted: ${result.totalDeleted}`);
		console.log();

		if (result.totalDeleted > 0) {
			console.log('🗑️ Deleted Games Details:');
			result.deletedGames.forEach((game, index) => {
				console.log(`   ${index + 1}. ${game.type.toUpperCase()}: ${game.id}`);
				console.log(`      Host: ${game.host} | Opponent: ${game.opponent || 'none'}`);
				console.log(`      Created: ${game.createdAt} | Moves: ${game.moves}`);
				if (game.lastMoveAt) {
					console.log(`      Last Move: ${game.lastMoveAt}`);
				}
				console.log();
			});
		}
	} catch (error) {
		console.error('❌ Cleanup test failed:', error.message);
	}
}

// Export for testing
module.exports = { demonstrateCleanup };

// Run if called directly
if (require.main === module) {
	demonstrateCleanup();
}
