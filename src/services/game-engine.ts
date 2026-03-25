import type { Server } from 'socket.io';
import { logger } from '../utils/logger.js';
import { validateTranscript } from '../utils/validation.js';
import type { Room, GameState, Twister, RoundResult, Player } from '../types/index.js';
import { roomManager } from './room-manager.js';
import { generateTwisters } from './twister-generator.js';
import { scoreTwister } from './scoring.js';

export const AUTO_ADVANCE_DELAY = 2000;

class GameEngine {
  private roundTimers = new Map<string, NodeJS.Timeout>();

  async startGame(roomCode: string): Promise<boolean> {
    const room = roomManager.getRoom(roomCode);
    if (!room || room.game.status !== 'lobby') {
      logger.warn('GameEngine', 'startGame failed - invalid state', { roomCode, status: room?.game.status });
      return false;
    }

    logger.info('GameEngine', 'Starting game', { roomCode, topic: room.game.settings.topic, rounds: room.game.settings.rounds });

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
    room.game.roundTimeLimit = room.game.settings.roundTimeLimit ?? null;

    logger.info('GameEngine', 'Game started successfully', { roomCode, twistersGenerated: twisters.length });

    return true;
  }

  submitAnswer(
    roomCode: string,
    playerId: string,
    transcript: string,
    clientTimestamp: number
  ): { similarity: number; isComplete: boolean } | null {
    // Validate transcript input
    const transcriptValidation = validateTranscript(transcript);
    if (!transcriptValidation.isValid) {
      logger.warn('GameEngine', 'submitAnswer failed - invalid transcript', { 
        roomCode, 
        playerId, 
        error: transcriptValidation.error 
      });
      return null;
    }
    const sanitizedTranscript = transcriptValidation.sanitized;
    
    const room = roomManager.getRoom(roomCode);
    if (!room || room.game.status !== 'playing') {
      logger.warn('GameEngine', 'submitAnswer failed - game not in playing state', { roomCode, status: room?.game.status });
      return null;
    }
    if (room.game.pausedAt !== null) {
      logger.warn('GameEngine', 'submitAnswer failed - game paused', { roomCode });
      return null;
    }

    const currentTwister = room.game.twisters[room.game.currentRound];
    if (!currentTwister) {
      logger.warn('GameEngine', 'submitAnswer failed - no current twister', { roomCode, round: room.game.currentRound });
      return null;
    }

    const roundElapsed = Date.now() - (room.game.currentTwisterStartTime || 0);
    if (room.game.roundTimeLimit !== null && roundElapsed > room.game.roundTimeLimit) {
      logger.warn('GameEngine', 'submitAnswer failed - round time exceeded', { roomCode, roundElapsed, limit: room.game.roundTimeLimit });
      return null;
    }

    const { similarity } = scoreTwister(sanitizedTranscript, currentTwister.text);

    logger.debug('GameEngine', 'Answer scored', { roomCode, playerId, similarity, transcript: sanitizedTranscript.substring(0, 50), target: currentTwister.text });

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

    logger.info('GameEngine', 'Answer submitted', { roomCode, playerId, playerName: player?.name, similarity, allSubmitted: allPlayersSubmitted });

    return { similarity, isComplete: allPlayersSubmitted };
  }

  async advanceRound(roomCode: string, io: Server): Promise<boolean> {
    const room = roomManager.getRoom(roomCode);
    if (!room) {
      logger.warn('GameEngine', 'advanceRound failed - room not found', { roomCode });
      return false;
    }

    room.game.currentRound++;

    if (room.game.currentRound >= room.game.twisters.length) {
      logger.info('GameEngine', 'Game over - all rounds completed', { roomCode, totalRounds: room.game.twisters.length });
      room.game.status = 'game-over';
      this.clearRoundTimer(roomCode);
      this.endGame(roomCode, io);
      return false;
    }

    room.game.currentTwisterStartTime = Date.now();
    const currentTwister = room.game.twisters[room.game.currentRound];

    logger.info('GameEngine', 'Round advanced', { roomCode, round: room.game.currentRound, twisterId: currentTwister?.id });

    io.to(roomCode).emit('round-advanced', {
      currentRound: room.game.currentRound,
      currentTwister,
      roundStartTime: room.game.currentTwisterStartTime,
      roundTimeLimit: room.game.roundTimeLimit,
    });

    if (room.game.roundTimeLimit !== null) {
      this.startRoundTimer(roomCode, io);
    }

    return true;
  }

  pauseGame(roomCode: string, playerId: string, io: Server): boolean {
    const room = roomManager.getRoom(roomCode);
    if (!room || room.game.status !== 'playing') {
      logger.warn('GameEngine', 'pauseGame failed - invalid state', { roomCode, status: room?.game.status });
      return false;
    }
    if (room.game.pausedAt !== null) {
      logger.warn('GameEngine', 'pauseGame failed - already paused', { roomCode });
      return false;
    }

    room.game.pausedAt = Date.now();
    room.game.status = 'paused';

    logger.info('GameEngine', 'Game paused', { roomCode, playerId, pausedAt: room.game.pausedAt });

    io.to(roomCode).emit('game-paused', {
      pausedAt: room.game.pausedAt,
      pausedBy: playerId,
    });

    return true;
  }

  resumeGame(roomCode: string, io: Server): boolean {
    const room = roomManager.getRoom(roomCode);
    if (!room || room.game.status !== 'paused') {
      logger.warn('GameEngine', 'resumeGame failed - invalid state', { roomCode, status: room?.game.status });
      return false;
    }
    if (room.game.pausedAt === null) {
      logger.warn('GameEngine', 'resumeGame failed - not paused', { roomCode });
      return false;
    }

    const pauseDuration = Date.now() - room.game.pausedAt;
    room.game.totalPausedTime += pauseDuration;
    room.game.status = 'playing';
    room.game.pausedAt = null;

    logger.info('GameEngine', 'Game resumed', { roomCode, pauseDuration, totalPausedTime: room.game.totalPausedTime });

    io.to(roomCode).emit('game-resumed', {
      resumedAt: Date.now(),
      totalPausedTime: room.game.totalPausedTime,
    });

    return true;
  }

  endGame(roomCode: string, io: Server): void {
    const room = roomManager.getRoom(roomCode);
    if (!room) {
      logger.warn('GameEngine', 'endGame failed - room not found', { roomCode });
      return;
    }

    room.game.status = 'game-over';
    this.clearRoundTimer(roomCode);

    const leaderboard = this.calculateLeaderboard(room);

    logger.info('GameEngine', 'Game ended', { roomCode, leaderboard: leaderboard.map(e => ({ name: e.player.name, accuracy: e.accuracy })) });

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

    const room = roomManager.getRoom(roomCode);
    if (!room || room.game.roundTimeLimit === null) return;

    logger.debug('GameEngine', 'Starting round timer', { roomCode, duration: room.game.roundTimeLimit });

    const timer = setTimeout(async () => {
      logger.info('GameEngine', 'Round timer expired - auto-advancing', { roomCode });
      await this.advanceRound(roomCode, io);
    }, room.game.roundTimeLimit);

    this.roundTimers.set(roomCode, timer);
  }

  private clearRoundTimer(roomCode: string): void {
    const timer = this.roundTimers.get(roomCode);
    if (timer) {
      clearTimeout(timer);
      this.roundTimers.delete(roomCode);
      logger.debug('GameEngine', 'Round timer cleared', { roomCode });
    }
  }
}

export const gameEngine = new GameEngine();
