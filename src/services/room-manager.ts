import { generateRoomCode } from '../utils/room-code';
import type { Room, Player, GameSettings, GameState } from '../types';

class RoomManager {
  private rooms = new Map<string, Room>();

  createRoom(hostName: string, settings: GameSettings): Room {
    const roomCode = this.generateUniqueCode();
    const hostId = `host-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

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
    };

    const room: Room = {
      code: roomCode,
      game,
      hostId,
      createdAt: Date.now(),
    };

    this.rooms.set(roomCode, room);
    return room;
  }

  joinRoom(roomCode: string, playerName: string): { room: Room; player: Player } | null {
    const room = this.rooms.get(roomCode.toUpperCase());
    if (!room) return null;
    if (room.game.players.length >= 4) return null;
    if (room.game.status !== 'lobby') return null;

    const player: Player = {
      id: `player-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: playerName,
      isHost: false,
      isReady: false,
      currentScore: 0,
      isConnected: true,
    };

    room.game.players.push(player);
    return { room, player };
  }

  getRoom(roomCode: string): Room | undefined {
    return this.rooms.get(roomCode.toUpperCase());
  }

  removePlayer(roomCode: string, playerId: string): boolean {
    const room = this.rooms.get(roomCode);
    if (!room) return false;

    room.game.players = room.game.players.filter((p) => p.id !== playerId);

    if (room.game.players.length === 0) {
      this.rooms.delete(roomCode);
      return true;
    }

    if (room.hostId === playerId && room.game.players.length > 0) {
      room.game.players[0].isHost = true;
      room.hostId = room.game.players[0].id;
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
