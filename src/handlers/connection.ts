import type { Server, Socket } from 'socket.io';
import { roomManager } from '../services/room-manager.js';
import { gameEngine } from '../services/game-engine.js';
import { AUTO_ADVANCE_DELAY } from '../services/game-engine.js';
import { logger } from '../utils/logger.js';
import type { CreateRoomPayload, JoinRoomPayload, SubmitAnswerPayload } from '../types/index.js';

export function handleConnection(socket: Socket, io: Server): void {
  let currentRoomCode: string | null = null;
  let currentPlayerId: string | null = null;

  const clientInfo = { socketId: socket.id };

  logger.info('Socket', 'Client connected', clientInfo);

  socket.on('create-room', async (payload: CreateRoomPayload, callback) => {
    logger.info('Socket', 'create-room event', { playerName: payload.playerName, settings: payload.settings });

    const room = roomManager.createRoom(payload.playerName, payload.settings);
    currentRoomCode = room.code;
    currentPlayerId = room.game.players[0].id;

    socket.join(room.code);

    logger.info('Socket', 'Room created', { roomCode: room.code, playerId: currentPlayerId });

    callback({
      success: true,
      roomCode: room.code,
      player: room.game.players[0],
      game: room.game,
    });
  });

  socket.on('join-room', (payload: JoinRoomPayload, callback) => {
    logger.info('Socket', 'join-room event', { roomCode: payload.roomCode, playerName: payload.playerName });

    const result = roomManager.joinRoom(payload.roomCode, payload.playerName);

    if (!result) {
      logger.warn('Socket', 'join-room failed - room not found or full', { roomCode: payload.roomCode });
      callback({ success: false, error: 'Room not found or full' });
      return;
    }

    currentRoomCode = result.room.code;
    currentPlayerId = result.player.id;

    socket.join(result.room.code);

    logger.info('Socket', 'Player joined room', { roomCode: result.room.code, playerId: currentPlayerId, playerName: payload.playerName });

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
  });

  socket.on('start-game', async (_payload, callback) => {
    logger.info('Socket', 'start-game event', { roomCode: currentRoomCode, playerId: currentPlayerId });

    if (!currentRoomCode) {
      logger.warn('Socket', 'start-game failed - not in room', { playerId: currentPlayerId });
      callback?.({ success: false, error: 'Not in a room' });
      return;
    }

    const room = roomManager.getRoom(currentRoomCode);
    if (!room || room.hostId !== currentPlayerId) {
      logger.warn('Socket', 'start-game failed - not host or room not found', { roomCode: currentRoomCode, playerId: currentPlayerId });
      callback({ success: false, error: 'Only host can start game' });
      return;
    }

    const success = await gameEngine.startGame(currentRoomCode);

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
  });

  socket.on('submit-answer', (payload: SubmitAnswerPayload, callback) => {
    logger.debug('Socket', 'submit-answer event', { roomCode: currentRoomCode, playerId: currentPlayerId, transcript: payload.transcript });

    if (!currentRoomCode || !currentPlayerId) {
      logger.warn('Socket', 'submit-answer failed - not in room', { playerId: currentPlayerId });
      callback?.({ success: false, error: 'Not in a room' });
      return;
    }

    const result = gameEngine.submitAnswer(
      currentRoomCode,
      currentPlayerId,
      payload.transcript,
      payload.timestamp
    );

    if (!result) {
      logger.warn('Socket', 'submit-answer failed - cannot submit', { roomCode: currentRoomCode, playerId: currentPlayerId });
      callback?.({ success: false, error: 'Cannot submit answer' });
      return;
    }

    logger.info('Socket', 'Answer submitted', { roomCode: currentRoomCode, playerId: currentPlayerId, similarity: result.similarity, isComplete: result.isComplete });

    io.to(currentRoomCode).emit('player-submitted', {
      playerId: currentPlayerId,
      similarity: result.similarity,
    });

    callback?.({ success: true, similarity: result.similarity });

    if (result.isComplete) {
      logger.info('Socket', 'All players submitted, advancing round', { roomCode: currentRoomCode });
      setTimeout(() => {
        gameEngine.advanceRound(currentRoomCode!, io);
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

    const success = gameEngine.pauseGame(currentRoomCode, currentPlayerId, io);
    logger.info('Socket', 'pause-game result', { roomCode: currentRoomCode, success });
    callback?.({ success });
  });

  socket.on('resume-game', (_payload, callback) => {
    logger.info('Socket', 'resume-game event', { roomCode: currentRoomCode });

    if (!currentRoomCode) {
      logger.warn('Socket', 'resume-game failed - not in room');
      callback?.({ success: false, error: 'Not in a room' });
      return;
    }

    const success = gameEngine.resumeGame(currentRoomCode, io);
    logger.info('Socket', 'resume-game result', { roomCode: currentRoomCode, success });
    callback?.({ success });
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
    logger.info('Socket', 'Client disconnected', { socketId: socket.id, roomCode: currentRoomCode, playerId: currentPlayerId });

    if (currentRoomCode && currentPlayerId) {
      const roomBefore = roomManager.getRoom(currentRoomCode);
      const playersBefore = roomBefore?.game.players.length ?? 0;

      roomManager.removePlayer(currentRoomCode, currentPlayerId);

      const room = roomManager.getRoom(currentRoomCode);
      if (room) {
        logger.info('Socket', 'Player removed from room', { roomCode: currentRoomCode, playerId: currentPlayerId, remainingPlayers: room.game.players.length });
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
