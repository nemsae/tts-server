import type { GameSettings as GameSettingsFromSchema, TwisterLength as TwisterLengthFromSchema } from '../schemas/index.js';

export type TwisterLength = TwisterLengthFromSchema;
export type GameSettings = GameSettingsFromSchema;

export type TwisterTopic = string;
export type GameScreen = 'lobby' | 'playing' | 'paused' | 'game-over';

export interface Twister {
  id: string;
  text: string;
  difficulty: 1 | 2 | 3;
  topic: TwisterTopic;
  length?: TwisterLength;
}

export interface Player {
  id: string;
  name: string;
  isHost: boolean;
  isReady: boolean;
  currentScore: number;
  isConnected: boolean;
}

export interface RoundResult {
  playerId: string;
  twisterId: string;
  similarity: number;
  completedAt: number;
}

export interface GameState {
  roomCode: string;
  settings: GameSettings;
  players: Player[];
  twisters: Twister[];
  currentRound: number;
  roundResults: RoundResult[];
  status: GameScreen;
  startedAt: number | null;
  pausedAt: number | null;
  totalPausedTime: number;
  currentTwisterStartTime: number | null;
  roundTimeLimit: number | null;
}

export interface Room {
  code: string;
  game: GameState;
  hostId: string;
  createdAt: number;
}
