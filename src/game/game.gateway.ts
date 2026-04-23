import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { BadRequestException } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { ZodSchema } from 'zod';
import { GameEngineService, AUTO_ADVANCE_DELAY } from './services/game-engine.service.js';
import { RoomManagerService } from './services/room-manager.service.js';
import {
  CreateRoomSchema,
  JoinRoomSchema,
  SubmitAnswerSchema,
  type CreateRoomDto,
  type JoinRoomDto,
  type SubmitAnswerDto,
} from './dto/game.dto.js';
import { openaiRateLimiter, roomCreationRateLimiter, roomJoinRateLimiter, answerSubmissionRateLimiter } from '../common/utils/rate-limiter.js';
import type { GameSettings } from '../common/types/index.js';

function parseDto<T>(schema: ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const messages = result.error.issues.map((e) => e.message);
    throw new BadRequestException(messages.join(', '));
  }
  return result.data;
}

@WebSocketGateway({
  cors: {
    origin: process.env.CLIENT_URL,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  pingTimeout: 20000,
  pingInterval: 25000,
})
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(GameGateway.name);
  private socketRoomMap = new Map<string, { roomCode: string | null; playerId: string | null }>();

  constructor(
    private readonly gameEngine: GameEngineService,
    private readonly roomManager: RoomManagerService,
  ) {}

  handleConnection(client: Socket): void {
    this.logger.log(`Client connected: ${client.id}`);
    this.socketRoomMap.set(client.id, { roomCode: null, playerId: null });
  }

  handleDisconnect(client: Socket): void {
    const socketData = this.socketRoomMap.get(client.id);
    this.logger.log(`Client disconnected: ${client.id}`);

    if (socketData?.roomCode && socketData?.playerId) {
      const roomBefore = this.roomManager.getRoom(socketData.roomCode);
      const playersBefore = roomBefore?.game.players.length ?? 0;

      this.roomManager.removePlayer(socketData.roomCode, socketData.playerId);

      const room = this.roomManager.getRoom(socketData.roomCode);
      if (room) {
        this.logger.log(`Player removed from room`, {
          roomCode: socketData.roomCode,
          playerId: socketData.playerId,
          remainingPlayers: room.game.players.length,
        });
        this.server.to(socketData.roomCode).emit('player-left', {
          playerId: socketData.playerId,
          players: room.game.players,
        });
      } else {
        this.logger.log(`Room deleted (last player left)`, { roomCode: socketData.roomCode, playersBefore });
      }
    }

    this.socketRoomMap.delete(client.id);
  }

  @SubscribeMessage('create-room')
  handleCreateRoom(
    @MessageBody() rawData: unknown,
    @ConnectedSocket() client: Socket,
  ): { success: boolean; error?: string; roomCode?: string; player?: unknown; game?: unknown } {
    if (!roomCreationRateLimiter.check(client.id)) {
      this.logger.warn(`create-room rate limited: ${client.id}`);
      return { success: false, error: 'Too many room creation attempts. Please try again later.' };
    }

    let data: CreateRoomDto;
    try {
      data = parseDto(CreateRoomSchema, rawData);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Validation failed';
      this.logger.error(`create-room validation failed`, { error: errMsg, payload: rawData });
      return { success: false, error: errMsg };
    }

    this.logger.log(`create-room event`, { roomCode: data.roomCode, hostName: data.hostName, settings: data.settings });

    try {
      const settings: GameSettings = {
        topic: data.settings.topic,
        length: data.settings.length,
        customLength: data.settings.customLength,
        rounds: data.settings.rounds,
        roundTimeLimit: data.settings.roundTimeLimit,
      };

      const room = this.roomManager.createRoom(data.roomCode, data.hostName, settings);
      this.socketRoomMap.set(client.id, { roomCode: room.code, playerId: room.game.players[0].id });
      void client.join(room.code);

      this.logger.log(`Room created`, { roomCode: room.code, playerId: room.game.players[0].id });

      return {
        success: true,
        roomCode: room.code,
        player: room.game.players[0],
        game: room.game,
      };
    } catch (error) {
      this.logger.error(`create-room failed`, { error: error instanceof Error ? error.message : String(error) });
      return { success: false, error: error instanceof Error ? error.message : 'Failed to create room' };
    }
  }

  @SubscribeMessage('join-room')
  handleJoinRoom(
    @MessageBody() rawData: unknown,
    @ConnectedSocket() client: Socket,
  ): { success: boolean; error?: string; roomCode?: string; player?: unknown; game?: unknown } {
    if (!roomJoinRateLimiter.check(client.id)) {
      this.logger.warn(`join-room rate limited: ${client.id}`);
      return { success: false, error: 'Too many join attempts. Please try again later.' };
    }

    let data: JoinRoomDto;
    try {
      data = parseDto(JoinRoomSchema, rawData);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Validation failed' };
    }

    this.logger.log(`join-room event`, { roomCode: data.roomCode, playerName: data.playerName });

    try {
      const result = this.roomManager.joinRoom(data.roomCode, data.playerName);

      if (!result) {
        this.logger.warn(`join-room failed - room not found or full`, { roomCode: data.roomCode });
        return { success: false, error: 'Room not found or full' };
      }

      this.socketRoomMap.set(client.id, { roomCode: result.room.code, playerId: result.player.id });
      void client.join(result.room.code);

      this.logger.log(`Player joined room`, {
        roomCode: result.room.code,
        playerId: result.player.id,
        playerName: data.playerName,
      });

      this.server.to(result.room.code).emit('player-joined', {
        player: result.player,
        players: result.room.game.players,
        game: result.room.game,
      });

      return {
        success: true,
        roomCode: result.room.code,
        player: result.player,
        game: result.room.game,
      };
    } catch (error) {
      this.logger.error(`join-room failed`, { error: error instanceof Error ? error.message : String(error) });
      return { success: false, error: error instanceof Error ? error.message : 'Failed to join room' };
    }
  }

  @SubscribeMessage('leave-room')
  handleLeaveRoom(@ConnectedSocket() client: Socket): { success: boolean; error?: string } {
    const socketData = this.socketRoomMap.get(client.id);

    this.logger.log(`leave-room event`, { roomCode: socketData?.roomCode, playerId: socketData?.playerId });

    if (!socketData?.roomCode || !socketData?.playerId) {
      return { success: false, error: 'Not in a room' };
    }

    const roomCode = socketData.roomCode;
    const playerId = socketData.playerId;

    const room = this.roomManager.getRoom(roomCode);
    if (!room) {
      socketData.roomCode = null;
      socketData.playerId = null;
      void client.leave(roomCode);
      return { success: true };
    }

    this.roomManager.removePlayer(roomCode, playerId);

    socketData.roomCode = null;
    socketData.playerId = null;
    void client.leave(roomCode);

    const updatedRoom = this.roomManager.getRoom(roomCode);
    if (updatedRoom) {
      this.server.to(roomCode).emit('player-left', {
        playerId,
        players: updatedRoom.game.players,
      });
    }

    this.logger.log(`Player left room`, { roomCode, playerId });
    return { success: true };
  }

  @SubscribeMessage('room-info')
  handleRoomInfo(
    @MessageBody() rawData: unknown,
  ): { exists: boolean; status?: string; playerCount?: number; playerNames?: string[] } {
    const roomCode = (rawData as { roomCode?: string })?.roomCode?.toUpperCase();
    if (!roomCode) {
      return { exists: false };
    }

    const room = this.roomManager.getRoom(roomCode);
    if (!room) {
      return { exists: false };
    }

    return {
      exists: true,
      status: room.game.status,
      playerCount: room.game.players.length,
      playerNames: room.game.players.map((p) => p.name),
    };
  }

  @SubscribeMessage('start-game')
  async handleStartGame(@ConnectedSocket() client: Socket): Promise<{ success: boolean; error?: string }> {
    const socketData = this.socketRoomMap.get(client.id);

    if (!openaiRateLimiter.check(client.id)) {
      this.logger.warn(`start-game rate limited: ${client.id}`);
      return { success: false, error: 'Too many game starts. Please wait before trying again.' };
    }

    this.logger.log(`start-game event`, { roomCode: socketData?.roomCode, playerId: socketData?.playerId });

    if (!socketData?.roomCode) {
      return { success: false, error: 'Not in a room' };
    }

    const room = this.roomManager.getRoom(socketData.roomCode);
    if (!room || room.hostId !== socketData.playerId) {
      this.logger.warn(`start-game failed - not host or room not found`, {
        roomCode: socketData.roomCode,
        playerId: socketData.playerId,
      });
      return { success: false, error: 'Only host can start game' };
    }

    const roomCode = socketData.roomCode;

    try {
      const success = await this.gameEngine.startGame(roomCode, this.server);

      if (success) {
        this.logger.log(`Game started`, { roomCode, rounds: room.game.twisters.length });
        this.server.to(roomCode).emit('game-started', {
          game: room.game,
          currentTwister: room.game.twisters[0],
          roundStartTime: room.game.currentTwisterStartTime,
          roundTimeLimit: room.game.roundTimeLimit,
        });
        return { success: true };
      } else {
        return { success: false, error: 'Failed to start game' };
      }
    } catch (error) {
      this.logger.error(`start-game error`, { error: error instanceof Error ? error.message : String(error) });
      return { success: false, error: error instanceof Error ? error.message : 'Failed to start game' };
    }
  }

  @SubscribeMessage('submit-answer')
  handleSubmitAnswer(
    @MessageBody() rawData: unknown,
    @ConnectedSocket() client: Socket,
  ): { success: boolean; error?: string; similarity?: number } {
    const socketData = this.socketRoomMap.get(client.id);

    if (!answerSubmissionRateLimiter.check(client.id)) {
      this.logger.warn(`submit-answer rate limited: ${client.id}`);
      return { success: false, error: 'Too many submissions. Please slow down.' };
    }

    let data: SubmitAnswerDto;
    try {
      data = parseDto(SubmitAnswerSchema, rawData);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Validation failed' };
    }

    this.logger.debug(`submit-answer event`, {
      roomCode: socketData?.roomCode,
      playerId: socketData?.playerId,
      transcript: data.transcript.substring(0, 50),
    });

    if (!socketData?.roomCode || !socketData?.playerId) {
      return { success: false, error: 'Not in a room' };
    }

    const result = this.gameEngine.submitAnswer(
      socketData.roomCode,
      socketData.playerId,
      data.transcript,
      data.timestamp,
    );

    if (!result) {
      this.logger.warn(`submit-answer failed - cannot submit`, {
        roomCode: socketData.roomCode,
        playerId: socketData.playerId,
      });
      return { success: false, error: 'Cannot submit answer' };
    }

    this.logger.log(`Answer submitted`, {
      roomCode: socketData.roomCode,
      playerId: socketData.playerId,
      similarity: result.similarity,
      isComplete: result.isComplete,
    });

    this.server.to(socketData.roomCode).emit('player-submitted', {
      playerId: socketData.playerId,
      similarity: result.similarity,
    });

    if (result.isComplete) {
      const roomCode = socketData.roomCode;
      this.logger.log(`All players submitted, advancing round`, { roomCode });
      setTimeout(() => {
        this.gameEngine.advanceRound(roomCode, this.server);
      }, AUTO_ADVANCE_DELAY);
    }

    return { success: true, similarity: result.similarity };
  }

  @SubscribeMessage('pause-game')
  handlePauseGame(@ConnectedSocket() client: Socket): { success: boolean; error?: string } {
    const socketData = this.socketRoomMap.get(client.id);

    this.logger.log(`pause-game event`, { roomCode: socketData?.roomCode, playerId: socketData?.playerId });

    if (!socketData?.roomCode || !socketData?.playerId) {
      return { success: false, error: 'Not in a room' };
    }

    try {
      const success = this.gameEngine.pauseGame(socketData.roomCode, socketData.playerId, this.server);
      this.logger.log(`pause-game result`, { roomCode: socketData.roomCode, success });
      return { success };
    } catch (error) {
      this.logger.error(`pause-game error`, { error: error instanceof Error ? error.message : String(error) });
      return { success: false, error: 'Failed to pause game' };
    }
  }

  @SubscribeMessage('resume-game')
  handleResumeGame(@ConnectedSocket() client: Socket): { success: boolean; error?: string } {
    const socketData = this.socketRoomMap.get(client.id);

    this.logger.log(`resume-game event`, { roomCode: socketData?.roomCode });

    if (!socketData?.roomCode) {
      return { success: false, error: 'Not in a room' };
    }

    try {
      const success = this.gameEngine.resumeGame(socketData.roomCode, this.server);
      this.logger.log(`resume-game result`, { roomCode: socketData.roomCode, success });
      return { success };
    } catch (error) {
      this.logger.error(`resume-game error`, { error: error instanceof Error ? error.message : String(error) });
      return { success: false, error: 'Failed to resume game' };
    }
  }

  @SubscribeMessage('get-room-state')
  handleGetRoomState(@ConnectedSocket() client: Socket): { success: boolean; error?: string; game?: unknown; playerId?: string | null } {
    const socketData = this.socketRoomMap.get(client.id);

    this.logger.debug(`get-room-state event`, { roomCode: socketData?.roomCode });

    if (!socketData?.roomCode) {
      return { success: false, error: 'Not in a room' };
    }

    const room = this.roomManager.getRoom(socketData.roomCode);
    if (!room) {
      this.logger.warn(`get-room-state failed - room not found`, { roomCode: socketData.roomCode });
      return { success: false, error: 'Room not found' };
    }

    return { success: true, game: room.game, playerId: socketData.playerId };
  }
}
