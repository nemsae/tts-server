import { Injectable, Logger } from '@nestjs/common';
import { Server } from 'socket.io';
import { TranscriptSchema } from '@jaysonder/tts-validation';
import type { ZodIssue } from 'zod';
import type { Room, RoundResult, Player, PlayerRoundTranscript } from '../../common/types/index.js';
import { RoomManagerService } from './room-manager.service.js';
import { TwisterGeneratorService } from './twister-generator.service.js';
import { scoreTwister } from './scoring.service.js';

export const AUTO_ADVANCE_DELAY = 2000;

@Injectable()
export class GameEngineService {
  private readonly logger = new Logger(GameEngineService.name);
  private roundTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly roomManager: RoomManagerService,
    private readonly twisterGenerator: TwisterGeneratorService,
  ) {}

  async startGame(roomCode: string, io: Server): Promise<boolean> {
    const room = this.roomManager.getRoom(roomCode);
    if (!room || room.game.status !== 'lobby') {
      this.logger.warn(`startGame failed - invalid state, roomCode: ${roomCode}, status: ${room?.game.status}`);
      return false;
    }

    this.logger.log(
      `Starting game, roomCode: ${roomCode}, topic: ${room.game.settings.topic}, rounds: ${room.game.settings.rounds}`,
    );

    const twisters = await this.twisterGenerator.generateTwisters(
      room.game.settings.topic,
      room.game.settings.length,
      room.game.settings.customLength,
      room.game.settings.rounds,
    );

    room.game.twisters = twisters;
    room.game.currentRound = 0;
    room.game.status = 'playing';
    room.game.startedAt = Date.now();
    room.game.currentTwisterStartTime = Date.now();
    room.game.roundTimeLimit = room.game.settings.roundTimeLimit ?? null;

    if (room.game.roundTimeLimit !== null) {
      this.startRoundTimer(roomCode, io);
    }

    this.logger.log(`Game started successfully, roomCode: ${roomCode}, twistersGenerated: ${twisters.length}`);

    return true;
  }

  submitAnswer(
    roomCode: string,
    playerId: string,
    transcript: string,
    _clientTimestamp: number,
  ): { similarity: number; isComplete: boolean } | null {
    const room = this.roomManager.getRoom(roomCode);
    if (!room || room.game.status !== 'playing') {
      this.logger.warn(
        `submitAnswer failed - game not in playing state, roomCode: ${roomCode}, status: ${room?.game.status}`,
      );
      return null;
    }
    if (room.game.pausedAt !== null) {
      this.logger.warn(`submitAnswer failed - game paused, roomCode: ${roomCode}`);
      return null;
    }

    const currentTwister = room.game.twisters[room.game.currentRound];
    if (!currentTwister) {
      this.logger.warn(
        `submitAnswer failed - no current twister, roomCode: ${roomCode}, round: ${room.game.currentRound}`,
      );
      return null;
    }

    const roundElapsedMs = Date.now() - (room.game.currentTwisterStartTime || 0);
    if (room.game.roundTimeLimit !== null) {
      const roundElapsedSeconds = roundElapsedMs / 1000;
      if (roundElapsedSeconds > room.game.roundTimeLimit) {
        this.logger.warn(
          `submitAnswer failed - round time exceeded, roomCode: ${roomCode}, roundElapsedSeconds: ${roundElapsedSeconds}, limitSeconds: ${room.game.roundTimeLimit}`,
        );
        return null;
      }
    }

    const updateResult = this.updateTranscript(roomCode, playerId, transcript);
    if (!updateResult) {
      return null;
    }

    const { similarity } = updateResult;

    const savedTranscript = room.game.transcripts.find(
      (t: PlayerRoundTranscript) => t.playerId === playerId && t.twisterId === currentTwister.id,
    );

    const result: RoundResult = {
      playerId,
      twisterId: currentTwister.id,
      transcript: savedTranscript?.transcript ?? '',
      similarity,
      completedAt: Date.now(),
    };
    room.game.roundResults.push(result);

    const player = room.game.players.find((p: Player) => p.id === playerId);

    const submittedPlayerIds = new Set(
      room.game.roundResults
        .filter((r: RoundResult) => r.twisterId === currentTwister.id)
        .map((r: RoundResult) => r.playerId),
    );

    const allPlayersSubmitted = room.game.players.every((p: Player) => submittedPlayerIds.has(p.id));

    this.logger.log(
      `Answer submitted, roomCode: ${roomCode}, playerId: ${playerId}, playerName: ${player?.name}, similarity: ${similarity}, allSubmitted: ${allPlayersSubmitted}`,
    );

    return { similarity, isComplete: allPlayersSubmitted };
  }

  updateTranscript(
    roomCode: string,
    playerId: string,
    transcript: string,
  ): { similarity: number; isComplete: boolean } | null {
    const transcriptResult = TranscriptSchema.safeParse(transcript);
    if (!transcriptResult.success) {
      this.logger.warn(
        `updateTranscript failed - invalid transcript, roomCode: ${roomCode}, playerId: ${playerId}, error: ${transcriptResult.error.issues.map((e: ZodIssue) => e.message).join(', ')}`,
      );
      return null;
    }
    const sanitizedTranscript = transcriptResult.data;

    const room = this.roomManager.getRoom(roomCode);
    if (!room || room.game.status !== 'playing') {
      this.logger.warn(
        `updateTranscript failed - game not in playing state, roomCode: ${roomCode}, status: ${room?.game.status}`,
      );
      return null;
    }
    if (room.game.pausedAt !== null) {
      this.logger.warn(`updateTranscript failed - game paused, roomCode: ${roomCode}`);
      return null;
    }

    const currentTwister = room.game.twisters[room.game.currentRound];
    if (!currentTwister) {
      this.logger.warn(
        `updateTranscript failed - no current twister, roomCode: ${roomCode}, round: ${room.game.currentRound}`,
      );
      return null;
    }

    const { similarity } = scoreTwister(sanitizedTranscript, currentTwister.text);

    this.logger.debug(`Transcript updated, roomCode: ${roomCode}, playerId: ${playerId}, similarity: ${similarity}`);

    const existingIndex = room.game.transcripts.findIndex(
      (t: PlayerRoundTranscript) => t.playerId === playerId && t.twisterId === currentTwister.id,
    );

    const now = Date.now();
    const transcriptEntry: PlayerRoundTranscript = {
      playerId,
      twisterId: currentTwister.id,
      transcript: sanitizedTranscript,
      similarity,
      submittedAt: now,
    };

    if (existingIndex >= 0) {
      room.game.transcripts[existingIndex] = transcriptEntry;
    } else {
      room.game.transcripts.push(transcriptEntry);
    }

    const player = room.game.players.find((p: Player) => p.id === playerId);
    if (player) {
      player.currentScore = similarity;
    }

    return { similarity, isComplete: false };
  }

  advanceRound(roomCode: string, io: Server): boolean {
    const room = this.roomManager.getRoom(roomCode);
    if (!room) {
      this.logger.warn(`advanceRound failed - room not found, roomCode: ${roomCode}`);
      return false;
    }

    room.game.currentRound++;
    room.game.transcripts = [];

    if (room.game.currentRound >= room.game.twisters.length) {
      this.logger.log(
        `Game over - all rounds completed, roomCode: ${roomCode}, totalRounds: ${room.game.twisters.length}`,
      );
      room.game.status = 'game-over';
      this.clearRoundTimer(roomCode);
      this.endGame(roomCode, io);
      return false;
    }

    room.game.currentTwisterStartTime = Date.now();
    const currentTwister = room.game.twisters[room.game.currentRound];

    this.logger.log(
      `Round advanced, roomCode: ${roomCode}, round: ${room.game.currentRound}, twisterId: ${currentTwister?.id}`,
    );

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
    const room = this.roomManager.getRoom(roomCode);
    if (!room || room.game.status !== 'playing') {
      this.logger.warn(`pauseGame failed - invalid state, roomCode: ${roomCode}, status: ${room?.game.status}`);
      return false;
    }
    if (room.game.pausedAt !== null) {
      this.logger.warn(`pauseGame failed - already paused, roomCode: ${roomCode}`);
      return false;
    }

    this.clearRoundTimer(roomCode);

    room.game.pausedAt = Date.now();
    room.game.status = 'paused';

    this.logger.log(`Game paused, roomCode: ${roomCode}, playerId: ${playerId}, pausedAt: ${room.game.pausedAt}`);

    io.to(roomCode).emit('game-paused', {
      pausedAt: room.game.pausedAt,
      pausedBy: playerId,
    });

    return true;
  }

  resumeGame(roomCode: string, io: Server): boolean {
    const room = this.roomManager.getRoom(roomCode);
    if (!room || room.game.status !== 'paused') {
      this.logger.warn(`resumeGame failed - invalid state, roomCode: ${roomCode}, status: ${room?.game.status}`);
      return false;
    }
    if (room.game.pausedAt === null) {
      this.logger.warn(`resumeGame failed - not paused, roomCode: ${roomCode}`);
      return false;
    }

    const pauseDuration = Date.now() - room.game.pausedAt;
    room.game.totalPausedTime += pauseDuration;
    room.game.status = 'playing';
    room.game.pausedAt = null;

    if (room.game.currentTwisterStartTime !== null) {
      room.game.currentTwisterStartTime += pauseDuration;
    }

    this.logger.log(
      `Game resumed, roomCode: ${roomCode}, pauseDuration: ${pauseDuration}, totalPausedTime: ${room.game.totalPausedTime}`,
    );

    io.to(roomCode).emit('game-resumed', {
      resumedAt: Date.now(),
      totalPausedTime: room.game.totalPausedTime,
      roundStartTime: room.game.currentTwisterStartTime,
      roundTimeLimit: room.game.roundTimeLimit,
    });

    if (room.game.roundTimeLimit !== null) {
      this.startRoundTimer(roomCode, io);
    }

    return true;
  }

  endGame(roomCode: string, io: Server): void {
    const room = this.roomManager.getRoom(roomCode);
    if (!room) {
      this.logger.warn(`endGame failed - room not found, roomCode: ${roomCode}`);
      return;
    }

    room.game.status = 'game-over';
    this.clearRoundTimer(roomCode);

    const leaderboard = this.calculateLeaderboard(room);

    this.logger.log(
      `Game ended, roomCode: ${roomCode}, leaderboard: ${JSON.stringify(leaderboard.map((e: { player: Player; accuracy: number; time: number }) => ({ name: e.player.name, accuracy: e.accuracy })))}`,
    );

    io.to(roomCode).emit('game-ended', { leaderboard });
  }

  private calculateLeaderboard(room: Room) {
    return room.game.players
      .map((player: Player) => {
        const playerResults = room.game.roundResults.filter((r: RoundResult) => r.playerId === player.id);
        const totalSimilarity = playerResults.reduce((sum: number, r: RoundResult) => sum + r.similarity, 0);
        const accuracy = playerResults.length > 0 ? Math.round(totalSimilarity / playerResults.length) : 0;

        const totalTime = room.game.startedAt ? Date.now() - room.game.startedAt - room.game.totalPausedTime : 0;

        return { player, accuracy, time: totalTime };
      })
      .sort(
        (a: { accuracy: number; time: number }, b: { accuracy: number; time: number }) =>
          b.accuracy - a.accuracy || a.time - b.time,
      );
  }

  private startRoundTimer(roomCode: string, io: Server): void {
    this.clearRoundTimer(roomCode);

    const room = this.roomManager.getRoom(roomCode);
    if (!room || room.game.roundTimeLimit === null) return;

    const elapsedMs = Date.now() - (room.game.currentTwisterStartTime || Date.now());
    const roundTimeLimitMs = room.game.roundTimeLimit * 1000;
    const remainingMs = Math.max(0, roundTimeLimitMs - elapsedMs);

    this.logger.debug(
      `Starting round timer, roomCode: ${roomCode}, remainingMs: ${remainingMs}, totalDurationMs: ${roundTimeLimitMs}, limitSeconds: ${room.game.roundTimeLimit}`,
    );

    const timer = setTimeout(() => {
      this.logger.log(`Round timer expired, roomCode: ${roomCode}`);

      io.to(roomCode).emit('round-time-expired', {
        round: room.game.currentRound,
      });

      setTimeout(() => {
        this.logger.log(`Auto-advancing after round time expired, roomCode: ${roomCode}`);
        this.advanceRound(roomCode, io);
      }, AUTO_ADVANCE_DELAY);
    }, remainingMs);

    this.roundTimers.set(roomCode, timer);
  }

  private clearRoundTimer(roomCode: string): void {
    const timer = this.roundTimers.get(roomCode);
    if (timer) {
      clearTimeout(timer);
      this.roundTimers.delete(roomCode);
      this.logger.debug(`Round timer cleared, roomCode: ${roomCode}`);
    }
  }
}
