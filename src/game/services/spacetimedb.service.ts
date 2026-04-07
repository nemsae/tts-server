import { Injectable, Logger, OnModuleInit, OnModuleDestroy, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DbConnection } from '../../spacetimedb-bindings/index.js';
import type { STDBPlayer, STDBRoom, STDBGameSettings } from '../../common/types/spacetimedb.js';

import { DbConnection as RawDbConnection } from 'spacetimedb/dist/sdk';

type STDbConnection = InstanceType<typeof RawDbConnection>;

@Injectable()
export class SpacetimeDBService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SpacetimeDBService.name);
  private connection: DbConnection | null = null;
  private isConnecting = false;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 5;
  private readonly baseReconnectDelay = 1000;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    await this.initialize();
  }

  async onModuleDestroy() {
    await this.disconnect();
  }

  async initialize(): Promise<void> {
    if (this.connection || this.isConnecting) {
      return;
    }

    const host = this.configService.get<string>('SPACETIMEDB_HOST', 'localhost:3000');
    const moduleName = this.configService.get<string>('SPACETIMEDB_MODULE', 'tts');
    const token = this.configService.get<string>('SPACETIMEDB_TOKEN');

    this.isConnecting = true;

    try {
      this.connection = DbConnection.builder()
        .withUri(`ws://${host}`)
        .withDatabaseName(moduleName)
        .withToken(token)
        .onConnect((conn, identity, _token) => {
          this.logger.log(`Connected to SpacetimeDB with identity: ${identity.toHexString()}`);
          this.reconnectAttempts = 0;
        })
        .onDisconnect((ctx, error) => {
          this.logger.warn(`Disconnected from SpacetimeDB: ${error?.message ?? 'unknown reason'}`);
          this.handleDisconnect();
        })
        .onConnectError((ctx, error) => {
          this.logger.error(`Connection error: ${error.message}`);
          this.handleDisconnect();
        })
        .build();

      await this.waitForConnection();
      this.logger.log('SpacetimeDB connection initialized');
    } catch (error) {
      this.logger.error(`Failed to initialize SpacetimeDB: ${error}`);
      throw error;
    } finally {
      this.isConnecting = false;
    }
  }

  private async waitForConnection(timeout = 10000): Promise<void> {
    const start = Date.now();
    while (!this.connection?.isActive && Date.now() - start < timeout) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!this.connection?.isActive) {
      throw new Error('Connection timeout');
    }
  }

  private handleDisconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.logger.error('Max reconnection attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    this.logger.log(`Attempting reconnection in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      this.initialize().catch((err) => {
        this.logger.error(`Reconnection failed: ${err}`);
      });
    }, delay);
  }

  async disconnect(): Promise<void> {
    if (this.connection) {
      this.connection.disconnect();
      this.connection = null;
      this.logger.log('Disconnected from SpacetimeDB');
    }
  }

  getConnection(): DbConnection {
    if (!this.connection) {
      throw new BadRequestException('SpacetimeDB not connected');
    }
    return this.connection;
  }

  async createRoom(playerName: string, settings: STDBGameSettings): Promise<string> {
    const conn = this.getConnection();
    try {
      await conn.reducers.createRoom({
        name: playerName,
        topic: settings.topic,
        rounds: settings.rounds,
        roundTimeLimit: settings.roundTimeLimit,
      });
      return 'room created';
    } catch (error) {
      this.logger.error(`createRoom failed: ${error}`);
      throw new BadRequestException(`Failed to create room: ${error}`);
    }
  }

  async joinRoom(roomCode: string, playerName: string): Promise<STDBPlayer> {
    const conn = this.getConnection();
    try {
      await conn.reducers.joinRoom({ roomCode, name: playerName });
      const player = conn.db.player.iter().find((p) => p.name === playerName);
      if (!player) {
        throw new BadRequestException('Player not found after join');
      }
      return {
        identity: player.identity.toHexString(),
        roomCode: player.roomCode,
        name: player.name,
        isHost: player.isHost,
        isOnline: player.isOnline,
        currentScore: player.currentScore,
        joinedAt: player.joinedAt,
      };
    } catch (error) {
      this.logger.error(`joinRoom failed: ${error}`);
      throw new BadRequestException(`Failed to join room: ${error}`);
    }
  }

  async leaveRoom(): Promise<void> {
    const conn = this.getConnection();
    try {
      await conn.reducers.leaveRoom();
    } catch (error) {
      this.logger.error(`leaveRoom failed: ${error}`);
      throw new BadRequestException(`Failed to leave room: ${error}`);
    }
  }

  async updateRoomStatus(roomCode: string, status: string): Promise<void> {
    const conn = this.getConnection();
    try {
      await conn.reducers.updateRoomStatus({ roomCode, status });
    } catch (error) {
      this.logger.error(`updateRoomStatus failed: ${error}`);
      throw new BadRequestException(`Failed to update room status: ${error}`);
    }
  }

  async sendSignal(toIdentity: string, signalType: string, signalData: string): Promise<void> {
    const conn = this.getConnection();
    try {
      await conn.reducers.sendSignal({
        toIdentity: toIdentity as never,
        signalType,
        signalData,
      });
    } catch (error) {
      this.logger.error(`sendSignal failed: ${error}`);
      throw new BadRequestException(`Failed to send signal: ${error}`);
    }
  }

  async cleanupSignals(roomCode: string): Promise<void> {
    const conn = this.getConnection();
    try {
      await conn.reducers.cleanupSignals({ roomCode });
    } catch (error) {
      this.logger.error(`cleanupSignals failed: ${error}`);
      throw new BadRequestException(`Failed to cleanup signals: ${error}`);
    }
  }

  async setMute(mutedIdentity: string, isMuted: boolean): Promise<void> {
    const conn = this.getConnection();
    try {
      await conn.reducers.setMute({
        mutedIdentity: mutedIdentity as never,
        isMuted,
      });
    } catch (error) {
      this.logger.error(`setMute failed: ${error}`);
      throw new BadRequestException(`Failed to set mute: ${error}`);
    }
  }

  async bulkSetMute(isMuted: boolean): Promise<void> {
    const conn = this.getConnection();
    try {
      await conn.reducers.bulkSetMute({ isMuted });
    } catch (error) {
      this.logger.error(`bulkSetMute failed: ${error}`);
      throw new BadRequestException(`Failed to bulk set mute: ${error}`);
    }
  }

  getRoom(roomCode: string): STDBRoom | null {
    const conn = this.connection;
    if (!conn) return null;

    const room = conn.db.room.iter().find((r) => r.roomCode === roomCode);
    if (!room) return null;

    return {
      roomCode: room.roomCode,
      hostIdentity: room.hostIdentity.toHexString(),
      topic: room.topic,
      rounds: room.rounds,
      roundTimeLimit: room.roundTimeLimit,
      status: room.status,
      createdAt: room.createdAt,
    };
  }

  getPlayersInRoom(roomCode: string): STDBPlayer[] {
    const conn = this.connection;
    if (!conn) return [];

    return Array.from(conn.db.player.iter())
      .filter((p) => p.roomCode === roomCode)
      .map((p) => ({
        identity: p.identity.toHexString(),
        roomCode: p.roomCode,
        name: p.name,
        isHost: p.isHost,
        isOnline: p.isOnline,
        currentScore: p.currentScore,
        joinedAt: p.joinedAt,
      }));
  }

  getPlayerCount(roomCode: string): number {
    const conn = this.connection;
    if (!conn) return 0;

    return Array.from(conn.db.player.iter()).filter((p) => p.roomCode === roomCode).length;
  }
}
