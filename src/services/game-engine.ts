import type { Server } from 'socket.io';
import type { Room, GameState, Twister, RoundResult, Player } from '../types';
import { roomManager } from './room-manager';
import { generateTwisters } from './twister-generator';
import { scoreTwister } from './scoring';

const ROUND_TIME_LIMIT = 30000;
export const AUTO_ADVANCE_DELAY = 2000;

class GameEngine {
  private roundTimers = new Map<string, NodeJS.Timeout>();

  async startGame(roomCode: string): Promise<boolean> {
    const room = roomManager.getRoom(roomCode);
    if (!room || room.game.status !== 'lobby') return false;

    const twisters = await generateTwisters(
      room.game.settings.topic,
      room.game.settings.length,
      room.game.settings.customLength,
      room.game.settings.rounds
    );

    room.game.twisters = twisters;
    room.game.currentRound = 0;
    room.game.status = 'playing';
    room.game.startedAt = Date.now();
    room.game.currentTwisterStartTime = Date.now();

    return true;
  }

  submitAnswer(
    roomCode: string,
    playerId: string,
    transcript: string,
    clientTimestamp: number
  ): { similarity: number; isComplete: boolean } | null {
    const room = roomManager.getRoom(roomCode);
    if (!room || room.game.status !== 'playing') return null;
    if (room.game.pausedAt !== null) return null;

    const currentTwister = room.game.twisters[room.game.currentRound];
    if (!currentTwister) return null;

    const roundElapsed = Date.now() - (room.game.currentTwisterStartTime || 0);
    if (roundElapsed > ROUND_TIME_LIMIT) return null;

    const { similarity } = scoreTwister(transcript, currentTwister.text);

    const result: RoundResult = {
      playerId,
      twisterId: currentTwister.id,
      similarity,
      completedAt: Date.now(),
    };
    room.game.roundResults.push(result);

    const player = room.game.players.find((p) => p.id === playerId);
    if (player) {
      player.currentScore = similarity;
    }

    const submittedPlayerIds = new Set(
      room.game.roundResults.filter((r) => r.twisterId === currentTwister.id).map((r) => r.playerId)
    );

    const allPlayersSubmitted = room.game.players.every((p) => submittedPlayerIds.has(p.id));

    return { similarity, isComplete: allPlayersSubmitted };
  }

  async advanceRound(roomCode: string, io: Server): Promise<boolean> {
    const room = roomManager.getRoom(roomCode);
    if (!room) return false;

    room.game.currentRound++;

    if (room.game.currentRound >= room.game.twisters.length) {
      room.game.status = 'game-over';
      this.clearRoundTimer(roomCode);
      return false;
    }

    room.game.currentTwisterStartTime = Date.now();

    io.to(roomCode).emit('round-advanced', {
      currentRound: room.game.currentRound,
      currentTwister: room.game.twisters[room.game.currentRound],
      roundStartTime: room.game.currentTwisterStartTime,
    });

    this.startRoundTimer(roomCode, io);

    return true;
  }

  pauseGame(roomCode: string, playerId: string, io: Server): boolean {
    const room = roomManager.getRoom(roomCode);
    if (!room || room.game.status !== 'playing') return false;
    if (room.game.pausedAt !== null) return false;

    room.game.pausedAt = Date.now();
    room.game.status = 'paused';

    io.to(roomCode).emit('game-paused', {
      pausedAt: room.game.pausedAt,
      pausedBy: playerId,
    });

    return true;
  }

  resumeGame(roomCode: string, io: Server): boolean {
    const room = roomManager.getRoom(roomCode);
    if (!room || room.game.status !== 'paused') return false;
    if (room.game.pausedAt === null) return false;

    const pauseDuration = Date.now() - room.game.pausedAt;
    room.game.totalPausedTime += pauseDuration;
    room.game.status = 'playing';
    room.game.pausedAt = null;

    io.to(roomCode).emit('game-resumed', {
      resumedAt: Date.now(),
      totalPausedTime: room.game.totalPausedTime,
    });

    return true;
  }

  endGame(roomCode: string, io: Server): void {
    const room = roomManager.getRoom(roomCode);
    if (!room) return;

    room.game.status = 'game-over';
    this.clearRoundTimer(roomCode);

    const leaderboard = this.calculateLeaderboard(room);

    io.to(roomCode).emit('game-ended', { leaderboard });
  }

  private calculateLeaderboard(room: Room) {
    return room.game.players
      .map((player) => {
        const playerResults = room.game.roundResults.filter((r) => r.playerId === player.id);
        const totalSimilarity = playerResults.reduce((sum, r) => sum + r.similarity, 0);
        const accuracy =
          playerResults.length > 0 ? Math.round(totalSimilarity / playerResults.length) : 0;

        const totalTime = room.game.startedAt
          ? Date.now() - room.game.startedAt - room.game.totalPausedTime
          : 0;

        return { player, accuracy, time: totalTime };
      })
      .sort((a, b) => b.accuracy - a.accuracy || a.time - b.time);
  }

  private startRoundTimer(roomCode: string, io: Server): void {
    this.clearRoundTimer(roomCode);

    const timer = setTimeout(async () => {
      await this.advanceRound(roomCode, io);
    }, ROUND_TIME_LIMIT);

    this.roundTimers.set(roomCode, timer);
  }

  private clearRoundTimer(roomCode: string): void {
    const timer = this.roundTimers.get(roomCode);
    if (timer) {
      clearTimeout(timer);
      this.roundTimers.delete(roomCode);
    }
  }
}

export const gameEngine = new GameEngine();
