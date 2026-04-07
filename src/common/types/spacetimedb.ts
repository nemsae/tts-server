import type { GameSettings } from '../schemas/index.js';

export interface STDBRoom {
  roomCode: string;
  hostIdentity: string;
  topic: string;
  rounds: number;
  roundTimeLimit: number;
  status: string;
  createdAt: Date;
}

export interface STDBPlayer {
  identity: string;
  roomCode: string;
  name: string;
  isHost: boolean;
  isOnline: boolean;
  currentScore: number;
  joinedAt: Date;
}

export interface STDBSignal {
  id: bigint;
  fromIdentity: string;
  toIdentity: string;
  roomCode: string;
  signalType: string;
  signalData: string;
  createdAt: Date;
}

export interface STDBMuteState {
  id: bigint;
  muterIdentity: string;
  mutedIdentity: string;
  isMuted: boolean;
}

export type STDBGameSettings = Pick<GameSettings, 'topic' | 'rounds' | 'roundTimeLimit'>;
