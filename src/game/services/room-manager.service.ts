import { Injectable, Logger } from '@nestjs/common';
import { generateRoomCode } from '../../common/utils/room-code.js';
import { GameSettingsSchema, PlayerNameSchema } from '@jaysonder/tts-validation';
import type { ZodIssue } from 'zod';
import type { Room, Player, GameSettings, GameState } from '../../common/types/index.js';

@Injectable()
export class RoomManagerService {
  private readonly logger = new Logger(RoomManagerService.name);
  private rooms = new Map<string, Room>();

  createRoom(hostName: string, settings: GameSettings): Room {
    const nameResult = PlayerNameSchema.safeParse(hostName);
    if (!nameResult.success) {
      const error = nameResult.error.issues.map((e: ZodIssue) => e.message).join(', ');
      this.logger.error(`Invalid host name provided, hostName: ${hostName.substring(0, 20)}, error: ${error}`);
      throw new Error(`Invalid host name: ${error}`);
    }
    const sanitizedHostName = nameResult.data;

    const settingsResult = GameSettingsSchema.safeParse(settings);
    if (!settingsResult.success) {
      const errors = settingsResult.error.issues.map((e: ZodIssue) => e.message).join(', ');
      this.logger.error(`Invalid game settings provided, errors: ${errors}, settings: ${JSON.stringify(settings)}`);
      throw new Error(`Invalid game settings: ${errors}`);
    }

    const roomCode = this.generateUniqueCode();
    const hostId = `host-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    this.logger.debug(
      `Creating room, roomCode: ${roomCode}, hostName: ${sanitizedHostName}, settings: ${JSON.stringify(settings)}`,
    );

    const host: Player = {
      id: hostId,
      name: sanitizedHostName,
      isHost: true,
      isReady: true,
      currentScore: 0,
      isConnected: true,
    };

    const game: GameState = {
      roomCode,
      settings,
      players: [host],
      twisters: [],
      currentRound: -1,
      roundResults: [],
      transcripts: [],
      status: 'lobby',
      startedAt: null,
      pausedAt: null,
      totalPausedTime: 0,
      currentTwisterStartTime: null,
      roundTimeLimit: null,
    };

    const room: Room = {
      code: roomCode,
      game,
      hostId,
      createdAt: Date.now(),
    };

    this.rooms.set(roomCode, room);
    this.logger.log(`Room created, roomCode: ${roomCode}, hostId: ${hostId}, totalRooms: ${this.rooms.size}`);
    return room;
  }

  joinRoom(roomCode: string, playerName: string): { room: Room; player: Player } | null {
    const nameResult = PlayerNameSchema.safeParse(playerName);
    if (!nameResult.success) {
      this.logger.warn(
        `Join failed - invalid player name, playerName: ${playerName.substring(0, 20)}, error: ${nameResult.error.issues.map((e: ZodIssue) => e.message).join(', ')}`,
      );
      return null;
    }
    const sanitizedPlayerName = nameResult.data;

    this.logger.debug(`Attempting to join room, roomCode: ${roomCode}, playerName: ${sanitizedPlayerName}`);

    const room = this.rooms.get(roomCode.toUpperCase());
    if (!room) {
      this.logger.warn(`Join failed - room not found, roomCode: ${roomCode}`);
      return null;
    }
    if (room.game.players.length >= 4) {
      this.logger.warn(`Join failed - room full, roomCode: ${roomCode}, currentPlayers: ${room.game.players.length}`);
      return null;
    }
    if (room.game.status !== 'lobby') {
      this.logger.warn(`Join failed - game already started, roomCode: ${roomCode}, status: ${room.game.status}`);
      return null;
    }

    const player: Player = {
      id: `player-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: sanitizedPlayerName,
      isHost: false,
      isReady: false,
      currentScore: 0,
      isConnected: true,
    };

    room.game.players.push(player);
    this.logger.log(
      `Player joined room, roomCode: ${roomCode}, playerId: ${player.id}, playerName: ${playerName}, totalPlayers: ${room.game.players.length}`,
    );
    return { room, player };
  }

  getRoom(roomCode: string): Room | undefined {
    return this.rooms.get(roomCode.toUpperCase());
  }

  removePlayer(roomCode: string, playerId: string): boolean {
    const room = this.rooms.get(roomCode);
    if (!room) return false;

    const player = room.game.players.find((p: Player) => p.id === playerId);
    this.logger.debug(`Removing player, roomCode: ${roomCode}, playerId: ${playerId}, playerName: ${player?.name}`);

    room.game.players = room.game.players.filter((p: Player) => p.id !== playerId);

    if (room.game.players.length === 0) {
      this.rooms.delete(roomCode);
      this.logger.log(`Room deleted - no players remaining, roomCode: ${roomCode}, totalRooms: ${this.rooms.size}`);
      return true;
    }

    if (room.hostId === playerId && room.game.players.length > 0) {
      room.game.players[0].isHost = true;
      room.hostId = room.game.players[0].id;
      this.logger.log(
        `Host reassigned, roomCode: ${roomCode}, newHostId: ${room.hostId}, newHostName: ${room.game.players[0].name}`,
      );
    }

    return true;
  }

  getActiveLobbyPlayerCount(): number {
    let count = 0;
    for (const room of this.rooms.values()) {
      if (room.game.status === 'lobby') {
        count += room.game.players.length;
      }
    }
    return count;
  }

  private generateUniqueCode(): string {
    let code: string;
    do {
      code = generateRoomCode();
    } while (this.rooms.has(code));
    return code;
  }
}
