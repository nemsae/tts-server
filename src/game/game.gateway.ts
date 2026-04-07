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
import { SpacetimeDBService } from './services/spacetimedb.service.js';
import {
  CreateRoomSchema,
  JoinRoomSchema,
  SubmitAnswerSchema,
  type CreateRoomDto,
  type JoinRoomDto,
  type SubmitAnswerDto,
} from './dto/game.dto.js';
import {
  openaiRateLimiter,
  roomCreationRateLimiter,
  roomJoinRateLimiter,
  answerSubmissionRateLimiter,
} from '../common/utils/rate-limiter.js';
import type { GameSettings, Player } from '../common/types/index.js';

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
  private socketIdentityMap = new Map<
    string,
    { roomCode: string | null; identity: string | null; name: string | null }
  >();

  constructor(
    private readonly gameEngine: GameEngineService,
    private readonly spacetimeDb: SpacetimeDBService,
  ) {}

  handleConnection(client: Socket): void {
    this.logger.log(`Client connected: ${client.id}`);
    this.socketIdentityMap.set(client.id, { roomCode: null, identity: null, name: null });
  }

  async handleDisconnect(client: Socket): Promise<void> {
    const socketData = this.socketIdentityMap.get(client.id);
    this.logger.log(`Client disconnected: ${client.id}`);

    if (socketData?.roomCode && socketData?.identity) {
      try {
        await this.spacetimeDb.leaveRoom();
      } catch (error) {
        this.logger.warn(`leaveRoom failed on disconnect: ${error}`);
      }

      const room = this.spacetimeDb.getRoom(socketData.roomCode);
      if (room) {
        const players = this.spacetimeDb.getPlayersInRoom(socketData.roomCode);
        this.logger.log(`Player disconnected from room`, {
          roomCode: socketData.roomCode,
          identity: socketData.identity,
          remainingPlayers: players.length,
        });
        this.server.to(socketData.roomCode).emit('player-left', {
          playerId: socketData.identity,
          players: players.map((p) => ({
            id: p.identity,
            name: p.name,
            isHost: p.isHost,
            isReady: false,
            currentScore: p.currentScore,
            isConnected: p.isOnline,
          })),
        });
      } else {
        this.logger.log(`Room deleted (last player left)`, { roomCode: socketData.roomCode });
      }
    }

    this.socketIdentityMap.delete(client.id);
  }

  @SubscribeMessage('create-room')
  async handleCreateRoom(
    @MessageBody() rawData: unknown,
    @ConnectedSocket() client: Socket,
  ): Promise<{ success: boolean; error?: string; roomCode?: string; player?: unknown; game?: unknown }> {
    if (!roomCreationRateLimiter.check(client.id)) {
      this.logger.warn(`create-room rate limited: ${client.id}`);
      return { success: false, error: 'Too many room creation attempts. Please try again later.' };
    }

    let data: CreateRoomDto;
    try {
      data = parseDto(CreateRoomSchema, rawData);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Validation failed' };
    }

    this.logger.log(`create-room event`, { playerName: data.playerName, settings: data.settings });

    try {
      const settings: GameSettings = {
        topic: data.settings.topic,
        length: data.settings.length,
        customLength: data.settings.customLength,
        rounds: data.settings.rounds,
        roundTimeLimit: data.settings.roundTimeLimit,
      };

      const stddbSettings = {
        topic: data.settings.topic,
        rounds: data.settings.rounds,
        roundTimeLimit: data.settings.roundTimeLimit,
      };

      const { roomCode, identity } = await this.spacetimeDb.createRoom(data.playerName, stddbSettings);
      this.socketIdentityMap.set(client.id, { roomCode, identity, name: data.playerName });
      void client.join(roomCode);

      const players = this.spacetimeDb.getPlayersInRoom(roomCode);
      const player: Player = {
        id: identity,
        name: data.playerName,
        isHost: true,
        isReady: true,
        currentScore: 0,
        isConnected: true,
      };

      this.logger.log(`Room created`, { roomCode, identity });

      return {
        success: true,
        roomCode,
        player,
        game: {
          roomCode,
          settings,
          players,
          twisters: [],
          currentRound: -1,
          roundResults: [],
          status: 'lobby',
          startedAt: null,
          pausedAt: null,
          totalPausedTime: 0,
          currentTwisterStartTime: null,
          roundTimeLimit: data.settings.roundTimeLimit,
        },
      };
    } catch (error) {
      this.logger.error(`create-room failed`, { error: error instanceof Error ? error.message : String(error) });
      return { success: false, error: error instanceof Error ? error.message : 'Failed to create room' };
    }
  }

  @SubscribeMessage('join-room')
  async handleJoinRoom(
    @MessageBody() rawData: unknown,
    @ConnectedSocket() client: Socket,
  ): Promise<{ success: boolean; error?: string; roomCode?: string; player?: unknown; game?: unknown }> {
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
      const player = await this.spacetimeDb.joinRoom(data.roomCode, data.playerName);

      if (!player) {
        this.logger.warn(`join-room failed - room not found or full`, { roomCode: data.roomCode });
        return { success: false, error: 'Room not found or full' };
      }

      this.socketIdentityMap.set(client.id, {
        roomCode: data.roomCode.toUpperCase(),
        identity: player.identity,
        name: data.playerName,
      });
      void client.join(data.roomCode.toUpperCase());

      this.logger.log(`Player joined room`, {
        roomCode: data.roomCode,
        identity: player.identity,
        playerName: data.playerName,
      });

      const players = this.spacetimeDb.getPlayersInRoom(data.roomCode.toUpperCase());
      const room = this.spacetimeDb.getRoom(data.roomCode.toUpperCase());

      this.server.to(data.roomCode.toUpperCase()).emit('player-joined', {
        player: {
          id: player.identity,
          name: player.name,
          isHost: player.isHost,
          isReady: false,
          currentScore: player.currentScore,
          isConnected: player.isOnline,
        },
        players: players.map((p) => ({
          id: p.identity,
          name: p.name,
          isHost: p.isHost,
          isReady: false,
          currentScore: p.currentScore,
          isConnected: p.isOnline,
        })),
        game: {
          roomCode: data.roomCode.toUpperCase(),
          settings: room
            ? {
                topic: room.topic,
                rounds: room.rounds,
                roundTimeLimit: room.roundTimeLimit,
                length: 'medium',
                customLength: null,
              }
            : null,
          players: players.map((p) => ({
            id: p.identity,
            name: p.name,
            isHost: p.isHost,
            isReady: false,
            currentScore: p.currentScore,
            isConnected: p.isOnline,
          })),
          twisters: [],
          currentRound: -1,
          roundResults: [],
          status: 'lobby',
          startedAt: null,
          pausedAt: null,
          totalPausedTime: 0,
          currentTwisterStartTime: null,
          roundTimeLimit: room?.roundTimeLimit ?? null,
        },
      });

      return {
        success: true,
        roomCode: data.roomCode.toUpperCase(),
        player: {
          id: player.identity,
          name: player.name,
          isHost: player.isHost,
          isReady: false,
          currentScore: player.currentScore,
          isConnected: player.isOnline,
        },
        game: {
          roomCode: data.roomCode.toUpperCase(),
          settings: room
            ? {
                topic: room.topic,
                rounds: room.rounds,
                roundTimeLimit: room.roundTimeLimit,
                length: 'medium',
                customLength: null,
              }
            : null,
          players: players.map((p) => ({
            id: p.identity,
            name: p.name,
            isHost: p.isHost,
            isReady: false,
            currentScore: p.currentScore,
            isConnected: p.isOnline,
          })),
          twisters: [],
          currentRound: -1,
          roundResults: [],
          status: 'lobby',
          startedAt: null,
          pausedAt: null,
          totalPausedTime: 0,
          currentTwisterStartTime: null,
          roundTimeLimit: room?.roundTimeLimit ?? null,
        },
      };
    } catch (error) {
      this.logger.error(`join-room failed`, { error: error instanceof Error ? error.message : String(error) });
      return { success: false, error: error instanceof Error ? error.message : 'Failed to join room' };
    }
  }

  @SubscribeMessage('start-game')
  async handleStartGame(@ConnectedSocket() client: Socket): Promise<{ success: boolean; error?: string }> {
    const socketData = this.socketIdentityMap.get(client.id);

    if (!openaiRateLimiter.check(client.id)) {
      this.logger.warn(`start-game rate limited: ${client.id}`);
      return { success: false, error: 'Too many game starts. Please wait before trying again.' };
    }

    this.logger.log(`start-game event`, { roomCode: socketData?.roomCode, identity: socketData?.identity });

    if (!socketData?.roomCode || !socketData?.identity) {
      return { success: false, error: 'Not in a room' };
    }

    const room = this.spacetimeDb.getRoom(socketData.roomCode);
    if (!room || room.hostIdentity !== socketData.identity) {
      this.logger.warn(`start-game failed - not host or room not found`, {
        roomCode: socketData.roomCode,
        identity: socketData.identity,
      });
      return { success: false, error: 'Only host can start game' };
    }

    const roomCode = socketData.roomCode;

    try {
      await this.gameEngine.startGame(roomCode, this.server);
      this.logger.log(`Game started`, { roomCode });
      this.server.to(roomCode).emit('game-started', {});
      return { success: true };
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
    const socketData = this.socketIdentityMap.get(client.id);

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
      identity: socketData?.identity,
      transcript: data.transcript.substring(0, 50),
    });

    if (!socketData?.roomCode || !socketData?.identity) {
      return { success: false, error: 'Not in a room' };
    }

    const result = this.gameEngine.submitAnswer(
      socketData.roomCode,
      socketData.identity,
      data.transcript,
      data.timestamp,
    );

    if (!result) {
      this.logger.warn(`submit-answer failed - cannot submit`, {
        roomCode: socketData.roomCode,
        identity: socketData.identity,
      });
      return { success: false, error: 'Cannot submit answer' };
    }

    this.logger.log(`Answer submitted`, {
      roomCode: socketData.roomCode,
      identity: socketData.identity,
      similarity: result.similarity,
      isComplete: result.isComplete,
    });

    this.server.to(socketData.roomCode).emit('player-submitted', {
      playerId: socketData.identity,
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
    const socketData = this.socketIdentityMap.get(client.id);

    this.logger.log(`pause-game event`, { roomCode: socketData?.roomCode, identity: socketData?.identity });

    if (!socketData?.roomCode || !socketData?.identity) {
      return { success: false, error: 'Not in a room' };
    }

    try {
      const success = this.gameEngine.pauseGame(socketData.roomCode, socketData.identity, this.server);
      this.logger.log(`pause-game result`, { roomCode: socketData.roomCode, success });
      return { success };
    } catch (error) {
      this.logger.error(`pause-game error`, { error: error instanceof Error ? error.message : String(error) });
      return { success: false, error: 'Failed to pause game' };
    }
  }

  @SubscribeMessage('resume-game')
  handleResumeGame(@ConnectedSocket() client: Socket): { success: boolean; error?: string } {
    const socketData = this.socketIdentityMap.get(client.id);

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
  handleGetRoomState(@ConnectedSocket() client: Socket): {
    success: boolean;
    error?: string;
    game?: unknown;
    playerId?: string | null;
  } {
    const socketData = this.socketIdentityMap.get(client.id);

    this.logger.debug(`get-room-state event`, { roomCode: socketData?.roomCode });

    if (!socketData?.roomCode) {
      return { success: false, error: 'Not in a room' };
    }

    const room = this.spacetimeDb.getRoom(socketData.roomCode);
    if (!room) {
      this.logger.warn(`get-room-state failed - room not found`, { roomCode: socketData.roomCode });
      return { success: false, error: 'Room not found' };
    }

    const players = this.spacetimeDb.getPlayersInRoom(socketData.roomCode);
    return {
      success: true,
      playerId: socketData.identity,
      game: {
        roomCode: room.roomCode,
        settings: {
          topic: room.topic,
          rounds: room.rounds,
          roundTimeLimit: room.roundTimeLimit,
          length: 'medium',
          customLength: null,
        },
        players: players.map((p) => ({
          id: p.identity,
          name: p.name,
          isHost: p.isHost,
          isReady: false,
          currentScore: p.currentScore,
          isConnected: p.isOnline,
        })),
        twisters: [],
        currentRound: -1,
        roundResults: [],
        status: room.status,
        startedAt: null,
        pausedAt: null,
        totalPausedTime: 0,
        currentTwisterStartTime: null,
        roundTimeLimit: room.roundTimeLimit,
      },
    };
  }
}
