const User = require('../models/User');

class TournamentNotificationService {
	constructor(ably) {
		this.ably = ably;
	}

	// Send real-time notification via Ably
	async sendRealtimeNotification(userId, notification) {
		if (this.ably) {
			try {
				const channel = this.ably.channels.get(`user-${userId}`);
				await channel.publish('tournament-notification', notification);
			} catch (error) {
				console.error('Failed to send real-time notification:', error);
			}
		}
	}

	// Registration confirmation
	async notifyRegistrationConfirmed(userId, tournament) {
		const notification = {
			type: 'registration_confirmed',
			title: '✅ Registration Confirmed',
			message: `You've successfully registered for "${tournament.name}"`,
			tournamentId: tournament._id,
			tournamentName: tournament.name,
			timestamp: new Date(),
			data: {
				registrationEnd: tournament.registrationEnd,
				startDate: tournament.startDate,
				currentParticipants: tournament.participants.length,
				maxParticipants: tournament.maxParticipants
			}
		};

		await this.sendRealtimeNotification(userId, notification);
		return notification;
	}

	// Registration cancellation
	async notifyRegistrationCancelled(userId, tournament) {
		const notification = {
			type: 'registration_cancelled',
			title: '❌ Registration Cancelled',
			message: `You've been unregistered from "${tournament.name}"`,
			tournamentId: tournament._id,
			tournamentName: tournament.name,
			timestamp: new Date(),
			data: {
				spotsAvailable: tournament.maxParticipants - tournament.participants.length
			}
		};

		await this.sendRealtimeNotification(userId, notification);
		return notification;
	}

	// Tournament starting soon
	async notifyTournamentStarting(tournament) {
		const notifications = [];

		for (const participant of tournament.participants) {
			const notification = {
				type: 'tournament_starting',
				title: '🚀 Tournament Starting Soon',
				message: `"${tournament.name}" starts in 30 minutes! Get ready to compete.`,
				tournamentId: tournament._id,
				tournamentName: tournament.name,
				timestamp: new Date(),
				data: {
					startDate: tournament.startDate,
					type: tournament.type,
					format: tournament.format,
					currentRound: tournament.currentRound || 1
				}
			};

			await this.sendRealtimeNotification(participant.player.toString(), notification);
			notifications.push(notification);
		}

		return notifications;
	}

	// Tournament started
	async notifyTournamentStarted(tournament) {
		const notifications = [];

		for (const participant of tournament.participants) {
			const notification = {
				type: 'tournament_started',
				title: '🏆 Tournament Started!',
				message: `"${tournament.name}" has begun! Check your bracket for first round matches.`,
				tournamentId: tournament._id,
				tournamentName: tournament.name,
				timestamp: new Date(),
				data: {
					currentRound: tournament.currentRound,
					totalRounds: tournament.totalRounds,
					nextMatch: this.getNextMatchForPlayer(tournament, participant.player.toString())
				}
			};

			await this.sendRealtimeNotification(participant.player.toString(), notification);
			notifications.push(notification);
		}

		return notifications;
	}

	// Round advanced
	async notifyRoundAdvanced(tournament) {
		const notifications = [];

		for (const participant of tournament.participants) {
			if (participant.eliminated) continue; // Don't notify eliminated players

			const notification = {
				type: 'round_advanced',
				title: `⚡ Round ${tournament.currentRound} Started`,
				message: `New round in "${tournament.name}"! Check your next match.`,
				tournamentId: tournament._id,
				tournamentName: tournament.name,
				timestamp: new Date(),
				data: {
					currentRound: tournament.currentRound,
					totalRounds: tournament.totalRounds,
					playerScore: participant.score,
					playerRanking: this.getPlayerRanking(tournament, participant.player.toString()),
					nextMatch: this.getNextMatchForPlayer(tournament, participant.player.toString())
				}
			};

			await this.sendRealtimeNotification(participant.player.toString(), notification);
			notifications.push(notification);
		}

		return notifications;
	}

	// Match scheduled
	async notifyMatchScheduled(tournament, match, whitePlayer, blackPlayer) {
		const notifications = [];

		// Notify white player
		const whiteNotification = {
			type: 'match_scheduled',
			title: '⚔️ Match Scheduled',
			message: `Your match in "${tournament.name}" vs ${blackPlayer.username} is scheduled.`,
			tournamentId: tournament._id,
			tournamentName: tournament.name,
			timestamp: new Date(),
			data: {
				matchId: match._id,
				opponent: {
					username: blackPlayer.username,
					displayName: blackPlayer.profile?.displayName || blackPlayer.username,
					elo: blackPlayer.profile?.ranking?.elo || 1200
				},
				color: 'white',
				round: match.round,
				scheduledTime: match.scheduledTime
			}
		};

		// Notify black player
		const blackNotification = {
			type: 'match_scheduled',
			title: '⚔️ Match Scheduled',
			message: `Your match in "${tournament.name}" vs ${whitePlayer.username} is scheduled.`,
			tournamentId: tournament._id,
			tournamentName: tournament.name,
			timestamp: new Date(),
			data: {
				matchId: match._id,
				opponent: {
					username: whitePlayer.username,
					displayName: whitePlayer.profile?.displayName || whitePlayer.username,
					elo: whitePlayer.profile?.ranking?.elo || 1200
				},
				color: 'black',
				round: match.round,
				scheduledTime: match.scheduledTime
			}
		};

		await this.sendRealtimeNotification(whitePlayer._id.toString(), whiteNotification);
		await this.sendRealtimeNotification(blackPlayer._id.toString(), blackNotification);

		notifications.push(whiteNotification, blackNotification);
		return notifications;
	}

	// Tournament completed
	async notifyTournamentCompleted(tournament) {
		const notifications = [];

		for (const participant of tournament.participants) {
			const finalRank = participant.finalRank || 'N/A';
			let message = `"${tournament.name}" has ended! `;

			if (finalRank === 1) {
				message += '🥇 Congratulations, you won!';
			} else if (finalRank === 2) {
				message += '🥈 Great job finishing 2nd place!';
			} else if (finalRank === 3) {
				message += '🥉 Excellent performance, 3rd place!';
			} else if (finalRank <= 10) {
				message += `🏆 Top 10 finish - #${finalRank}!`;
			} else {
				message += `Final ranking: #${finalRank}`;
			}

			const notification = {
				type: 'tournament_completed',
				title: '🏁 Tournament Finished',
				message: message,
				tournamentId: tournament._id,
				tournamentName: tournament.name,
				timestamp: new Date(),
				data: {
					finalRank: finalRank,
					finalScore: participant.score,
					wins: participant.wins,
					losses: participant.losses,
					draws: participant.draws,
					totalParticipants: tournament.participants.length
				}
			};

			await this.sendRealtimeNotification(participant.player.toString(), notification);
			notifications.push(notification);
		}

		return notifications;
	}

	// Match reminder (30 minutes before)
	async notifyMatchReminder(tournament, match, player, opponent) {
		const notification = {
			type: 'match_reminder',
			title: '⏰ Match Starting Soon',
			message: `Your tournament match vs ${opponent.username} starts in 30 minutes!`,
			tournamentId: tournament._id,
			tournamentName: tournament.name,
			timestamp: new Date(),
			data: {
				matchId: match._id,
				opponent: {
					username: opponent.username,
					displayName: opponent.profile?.displayName || opponent.username
				},
				scheduledTime: match.scheduledTime,
				round: match.round
			}
		};

		await this.sendRealtimeNotification(player._id.toString(), notification);
		return notification;
	}

	// Helper methods
	getNextMatchForPlayer(tournament, playerId) {
		if (!tournament.rounds || tournament.rounds.length === 0) return null;

		const currentRound = tournament.rounds[tournament.currentRound - 1];
		if (!currentRound || !currentRound.games) return null;

		return currentRound.games.find(game =>
			(game.white && game.white.toString() === playerId) ||
			(game.black && game.black.toString() === playerId)
		);
	}

	getPlayerRanking(tournament, playerId) {
		const sortedParticipants = tournament.participants
			.filter(p => !p.eliminated)
			.sort((a, b) => {
				// Sort by score, then by wins, then by ELO
				if (b.score !== a.score) return b.score - a.score;
				if (b.wins !== a.wins) return b.wins - a.wins;
				const aElo = a.player?.profile?.ranking?.elo || 1200;
				const bElo = b.player?.profile?.ranking?.elo || 1200;
				return bElo - aElo;
			});

		return sortedParticipants.findIndex(p => p.player.toString() === playerId) + 1;
	}

	// Notification preferences (placeholder for future implementation)
	async shouldNotifyUser(userId, notificationType) {
		// In the future, this could check user notification preferences
		// For now, send all notifications
		return true;
	}
}

module.exports = TournamentNotificationService;
