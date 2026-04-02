import type { Server, Socket } from 'socket.io';
import { roomManager } from '../services/room-manager.js';
import { gameEngine } from '../services/game-engine.js';
import { AUTO_ADVANCE_DELAY } from '../services/game-engine.js';
import { logger } from '../utils/logger.js';
import {
  openaiRateLimiter,
  roomCreationRateLimiter,
  roomJoinRateLimiter,
  answerSubmissionRateLimiter,
} from '../utils/rate-limit.js';
import type { CreateRoomPayload, JoinRoomPayload, SubmitAnswerPayload } from '../types/index.js';

export function handleConnection(socket: Socket, io: Server): void {
  let currentRoomCode: string | null = null;
  let currentPlayerId: string | null = null;

  const clientInfo = { socketId: socket.id };

  logger.info('Socket', 'Client connected', clientInfo);

  socket.on('create-room', async (payload: CreateRoomPayload, callback) => {
    // Rate limiting check
    if (!roomCreationRateLimiter.check(socket.id)) {
      logger.warn('Socket', 'create-room rate limited', { socketId: socket.id });
      callback({ success: false, error: 'Too many room creation attempts. Please try again later.' });
      return;
    }

    logger.info('Socket', 'create-room event', { playerName: payload.playerName, settings: payload.settings });

    try {
      const room = roomManager.createRoom(payload.playerName, payload.settings);
      currentRoomCode = room.code;
      currentPlayerId = room.game.players[0].id;

      void socket.join(room.code);

      logger.info('Socket', 'Room created', { roomCode: room.code, playerId: currentPlayerId });

      callback({
        success: true,
        roomCode: room.code,
        player: room.game.players[0],
        game: room.game,
      });
    } catch (error) {
      logger.error('Socket', 'create-room failed', { error: error instanceof Error ? error.message : String(error) });
      callback({ success: false, error: error instanceof Error ? error.message : 'Failed to create room' });
    }
  });

  socket.on('join-room', (payload: JoinRoomPayload, callback) => {
    // Rate limiting check
    if (!roomJoinRateLimiter.check(socket.id)) {
      logger.warn('Socket', 'join-room rate limited', { socketId: socket.id });
      callback({ success: false, error: 'Too many join attempts. Please try again later.' });
      return;
    }

    logger.info('Socket', 'join-room event', { roomCode: payload.roomCode, playerName: payload.playerName });

    try {
      const result = roomManager.joinRoom(payload.roomCode, payload.playerName);

      if (!result) {
        logger.warn('Socket', 'join-room failed - room not found or full', { roomCode: payload.roomCode });
        callback({ success: false, error: 'Room not found or full' });
        return;
      }

      currentRoomCode = result.room.code;
      currentPlayerId = result.player.id;

      void socket.join(result.room.code);

      logger.info('Socket', 'Player joined room', {
        roomCode: result.room.code,
        playerId: currentPlayerId,
        playerName: payload.playerName,
      });

      io.to(result.room.code).emit('player-joined', {
        player: result.player,
        players: result.room.game.players,
        game: result.room.game,
      });

      callback({
        success: true,
        roomCode: result.room.code,
        player: result.player,
        game: result.room.game,
      });
    } catch (error) {
      logger.error('Socket', 'join-room failed', { error: error instanceof Error ? error.message : String(error) });
      callback({ success: false, error: error instanceof Error ? error.message : 'Failed to join room' });
    }
  });

  socket.on('start-game', async (_payload, callback) => {
    // Rate limiting check for expensive OpenAI API calls
    if (!openaiRateLimiter.check(socket.id)) {
      logger.warn('Socket', 'start-game rate limited', { socketId: socket.id });
      callback?.({ success: false, error: 'Too many game starts. Please wait before trying again.' });
      return;
    }

    logger.info('Socket', 'start-game event', { roomCode: currentRoomCode, playerId: currentPlayerId });

    if (!currentRoomCode) {
      logger.warn('Socket', 'start-game failed - not in room', { playerId: currentPlayerId });
      callback?.({ success: false, error: 'Not in a room' });
      return;
    }

    const room = roomManager.getRoom(currentRoomCode);
    if (!room || room.hostId !== currentPlayerId) {
      logger.warn('Socket', 'start-game failed - not host or room not found', {
        roomCode: currentRoomCode,
        playerId: currentPlayerId,
      });
      callback({ success: false, error: 'Only host can start game' });
      return;
    }

    try {
      const success = await gameEngine.startGame(currentRoomCode, io);

      if (success) {
        logger.info('Socket', 'Game started', { roomCode: currentRoomCode, rounds: room.game.twisters.length });
        io.to(currentRoomCode).emit('game-started', {
          game: room.game,
          currentTwister: room.game.twisters[0],
          roundStartTime: room.game.currentTwisterStartTime,
          roundTimeLimit: room.game.roundTimeLimit,
        });
        callback({ success: true });
      } else {
        logger.warn('Socket', 'start-game failed', { roomCode: currentRoomCode });
        callback({ success: false, error: 'Failed to start game' });
      }
    } catch (error) {
      logger.error('Socket', 'start-game error', { error: error instanceof Error ? error.message : String(error) });
      callback({ success: false, error: error instanceof Error ? error.message : 'Failed to start game' });
    }
  });

  socket.on('submit-answer', (payload: SubmitAnswerPayload, callback) => {
    // Rate limiting check
    if (!answerSubmissionRateLimiter.check(socket.id)) {
      logger.warn('Socket', 'submit-answer rate limited', { socketId: socket.id });
      callback?.({ success: false, error: 'Too many submissions. Please slow down.' });
      return;
    }

    logger.debug('Socket', 'submit-answer event', {
      roomCode: currentRoomCode,
      playerId: currentPlayerId,
      transcript: payload.transcript.substring(0, 50),
    });

    if (!currentRoomCode || !currentPlayerId) {
      logger.warn('Socket', 'submit-answer failed - not in room', { playerId: currentPlayerId });
      callback?.({ success: false, error: 'Not in a room' });
      return;
    }

    const result = gameEngine.submitAnswer(currentRoomCode, currentPlayerId, payload.transcript, payload.timestamp);

    if (!result) {
      logger.warn('Socket', 'submit-answer failed - cannot submit', {
        roomCode: currentRoomCode,
        playerId: currentPlayerId,
      });
      callback?.({ success: false, error: 'Cannot submit answer' });
      return;
    }

    logger.info('Socket', 'Answer submitted', {
      roomCode: currentRoomCode,
      playerId: currentPlayerId,
      similarity: result.similarity,
      isComplete: result.isComplete,
    });

    io.to(currentRoomCode).emit('player-submitted', {
      playerId: currentPlayerId,
      similarity: result.similarity,
    });

    callback?.({ success: true, similarity: result.similarity });

    if (result.isComplete) {
      logger.info('Socket', 'All players submitted, advancing round', { roomCode: currentRoomCode });
      setTimeout(() => {
        void gameEngine.advanceRound(currentRoomCode!, io);
      }, AUTO_ADVANCE_DELAY);
    }
  });

  socket.on('pause-game', (_payload, callback) => {
    logger.info('Socket', 'pause-game event', { roomCode: currentRoomCode, playerId: currentPlayerId });

    if (!currentRoomCode || !currentPlayerId) {
      logger.warn('Socket', 'pause-game failed - not in room', { playerId: currentPlayerId });
      callback?.({ success: false, error: 'Not in a room' });
      return;
    }

    try {
      const success = gameEngine.pauseGame(currentRoomCode, currentPlayerId, io);
      logger.info('Socket', 'pause-game result', { roomCode: currentRoomCode, success });
      callback?.({ success });
    } catch (error) {
      logger.error('Socket', 'pause-game error', { error: error instanceof Error ? error.message : String(error) });
      callback?.({ success: false, error: 'Failed to pause game' });
    }
  });

  socket.on('resume-game', (_payload, callback) => {
    logger.info('Socket', 'resume-game event', { roomCode: currentRoomCode });

    if (!currentRoomCode) {
      logger.warn('Socket', 'resume-game failed - not in room');
      callback?.({ success: false, error: 'Not in a room' });
      return;
    }

    try {
      const success = gameEngine.resumeGame(currentRoomCode, io);
      logger.info('Socket', 'resume-game result', { roomCode: currentRoomCode, success });
      callback?.({ success });
    } catch (error) {
      logger.error('Socket', 'resume-game error', { error: error instanceof Error ? error.message : String(error) });
      callback?.({ success: false, error: 'Failed to resume game' });
    }
  });

  socket.on('get-room-state', (_payload, callback) => {
    logger.debug('Socket', 'get-room-state event', { roomCode: currentRoomCode });

    if (!currentRoomCode) {
      callback?.({ success: false, error: 'Not in a room' });
      return;
    }

    const room = roomManager.getRoom(currentRoomCode);
    if (!room) {
      logger.warn('Socket', 'get-room-state failed - room not found', { roomCode: currentRoomCode });
      callback?.({ success: false, error: 'Room not found' });
      return;
    }

    callback?.({ success: true, game: room.game, playerId: currentPlayerId });
  });

  socket.on('disconnect', () => {
    logger.info('Socket', 'Client disconnected', {
      socketId: socket.id,
      roomCode: currentRoomCode,
      playerId: currentPlayerId,
    });

    if (currentRoomCode && currentPlayerId) {
      const roomBefore = roomManager.getRoom(currentRoomCode);
      const playersBefore = roomBefore?.game.players.length ?? 0;

      roomManager.removePlayer(currentRoomCode, currentPlayerId);

      const room = roomManager.getRoom(currentRoomCode);
      if (room) {
        logger.info('Socket', 'Player removed from room', {
          roomCode: currentRoomCode,
          playerId: currentPlayerId,
          remainingPlayers: room.game.players.length,
        });
        io.to(currentRoomCode).emit('player-left', {
          playerId: currentPlayerId,
          players: room.game.players,
        });
      } else {
        logger.info('Socket', 'Room deleted (last player left)', { roomCode: currentRoomCode, playersBefore });
      }
    }
  });
}
