import { generateRoomCode } from '../utils/room-code.js';
import { logger } from '../utils/logger.js';
import type { Room, Player, GameSettings, GameState } from '../types/index.js';

class RoomManager {
  private rooms = new Map<string, Room>();

  createRoom(hostName: string, settings: GameSettings): Room {
    const roomCode = this.generateUniqueCode();
    const hostId = `host-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    logger.debug('RoomManager', 'Creating room', { roomCode, hostName, settings });

    const host: Player = {
      id: hostId,
      name: hostName,
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
    logger.info('RoomManager', 'Room created', { roomCode, hostId, totalRooms: this.rooms.size });
    return room;
  }

  joinRoom(roomCode: string, playerName: string): { room: Room; player: Player } | null {
    logger.debug('RoomManager', 'Attempting to join room', { roomCode, playerName });

    const room = this.rooms.get(roomCode.toUpperCase());
    if (!room) {
      logger.warn('RoomManager', 'Join failed - room not found', { roomCode });
      return null;
    }
    if (room.game.players.length >= 4) {
      logger.warn('RoomManager', 'Join failed - room full', { roomCode, currentPlayers: room.game.players.length });
      return null;
    }
    if (room.game.status !== 'lobby') {
      logger.warn('RoomManager', 'Join failed - game already started', { roomCode, status: room.game.status });
      return null;
    }

    const player: Player = {
      id: `player-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: playerName,
      isHost: false,
      isReady: false,
      currentScore: 0,
      isConnected: true,
    };

    room.game.players.push(player);
    logger.info('RoomManager', 'Player joined room', { roomCode, playerId: player.id, playerName, totalPlayers: room.game.players.length });
    return { room, player };
  }

  getRoom(roomCode: string): Room | undefined {
    return this.rooms.get(roomCode.toUpperCase());
  }

  removePlayer(roomCode: string, playerId: string): boolean {
    const room = this.rooms.get(roomCode);
    if (!room) return false;

    const player = room.game.players.find(p => p.id === playerId);
    logger.debug('RoomManager', 'Removing player', { roomCode, playerId, playerName: player?.name });

    room.game.players = room.game.players.filter((p) => p.id !== playerId);

    if (room.game.players.length === 0) {
      this.rooms.delete(roomCode);
      logger.info('RoomManager', 'Room deleted - no players remaining', { roomCode, totalRooms: this.rooms.size });
      return true;
    }

    if (room.hostId === playerId && room.game.players.length > 0) {
      room.game.players[0].isHost = true;
      room.hostId = room.game.players[0].id;
      logger.info('RoomManager', 'Host reassigned', { roomCode, newHostId: room.hostId, newHostName: room.game.players[0].name });
    }

    return true;
  }

  private generateUniqueCode(): string {
    let code: string;
    do {
      code = generateRoomCode();
    } while (this.rooms.has(code));
    return code;
  }
}

export const roomManager = new RoomManager();
