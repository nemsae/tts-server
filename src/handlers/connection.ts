import type { Server, Socket } from 'socket.io';
import { roomManager } from '../services/room-manager';
import { gameEngine } from '../services/game-engine';
import { AUTO_ADVANCE_DELAY } from '../services/game-engine';
import type { CreateRoomPayload, JoinRoomPayload, SubmitAnswerPayload } from '../types';

export function handleConnection(socket: Socket, io: Server): void {
  let currentRoomCode: string | null = null;
  let currentPlayerId: string | null = null;

  socket.on('create-room', async (payload: CreateRoomPayload, callback) => {
    const room = roomManager.createRoom(payload.playerName, payload.settings);
    currentRoomCode = room.code;
    currentPlayerId = room.game.players[0].id;

    socket.join(room.code);

    callback({
      success: true,
      roomCode: room.code,
      player: room.game.players[0],
      game: room.game,
    });
  });

  socket.on('join-room', (payload: JoinRoomPayload, callback) => {
    const result = roomManager.joinRoom(payload.roomCode, payload.playerName);

    if (!result) {
      callback({ success: false, error: 'Room not found or full' });
      return;
    }

    currentRoomCode = result.room.code;
    currentPlayerId = result.player.id;

    socket.join(result.room.code);

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

  socket.on('start-game', async (callback) => {
    if (!currentRoomCode) {
      callback({ success: false, error: 'Not in a room' });
      return;
    }

    const room = roomManager.getRoom(currentRoomCode);
    if (!room || room.hostId !== currentPlayerId) {
      callback({ success: false, error: 'Only host can start game' });
      return;
    }

    const success = await gameEngine.startGame(currentRoomCode);

    if (success) {
      io.to(currentRoomCode).emit('game-started', {
        game: room.game,
        currentTwister: room.game.twisters[0],
        roundStartTime: room.game.currentTwisterStartTime,
      });
      callback({ success: true });
    } else {
      callback({ success: false, error: 'Failed to start game' });
    }
  });

  socket.on('submit-answer', (payload: SubmitAnswerPayload, callback) => {
    if (!currentRoomCode || !currentPlayerId) {
      callback({ success: false, error: 'Not in a room' });
      return;
    }

    const result = gameEngine.submitAnswer(
      currentRoomCode,
      currentPlayerId,
      payload.transcript,
      payload.timestamp
    );

    if (!result) {
      callback({ success: false, error: 'Cannot submit answer' });
      return;
    }

    io.to(currentRoomCode).emit('player-submitted', {
      playerId: currentPlayerId,
      similarity: result.similarity,
    });

    callback({ success: true, similarity: result.similarity });

    if (result.isComplete) {
      setTimeout(() => {
        gameEngine.advanceRound(currentRoomCode!, io);
      }, AUTO_ADVANCE_DELAY);
    }
  });

  socket.on('pause-game', (callback) => {
    if (!currentRoomCode || !currentPlayerId) {
      callback({ success: false, error: 'Not in a room' });
      return;
    }

    const success = gameEngine.pauseGame(currentRoomCode, currentPlayerId, io);
    callback({ success });
  });

  socket.on('resume-game', (callback) => {
    if (!currentRoomCode) {
      callback({ success: false, error: 'Not in a room' });
      return;
    }

    const success = gameEngine.resumeGame(currentRoomCode, io);
    callback({ success });
  });

  socket.on('get-room-state', (callback) => {
    if (!currentRoomCode) {
      callback({ success: false, error: 'Not in a room' });
      return;
    }

    const room = roomManager.getRoom(currentRoomCode);
    if (!room) {
      callback({ success: false, error: 'Room not found' });
      return;
    }

    callback({ success: true, game: room.game, playerId: currentPlayerId });
  });

  socket.on('disconnect', () => {
    if (currentRoomCode && currentPlayerId) {
      roomManager.removePlayer(currentRoomCode, currentPlayerId);

      const room = roomManager.getRoom(currentRoomCode);
      if (room) {
        io.to(currentRoomCode).emit('player-left', {
          playerId: currentPlayerId,
          players: room.game.players,
        });
      }
    }
  });
}
