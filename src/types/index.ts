export type TwisterLength = 'short' | 'medium' | 'long' | 'custom';
export type TwisterTopic = string;
export type GameScreen = 'lobby' | 'playing' | 'paused' | 'game-over';

export interface GameSettings {
  topic: string;
  length: TwisterLength;
  customLength?: number;
  rounds: number;
}

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
}

export interface Room {
  code: string;
  game: GameState;
  hostId: string;
  createdAt: number;
}

export interface CreateRoomPayload {
  playerName: string;
  settings: GameSettings;
}

export interface JoinRoomPayload {
  roomCode: string;
  playerName: string;
}

export interface SubmitAnswerPayload {
  transcript: string;
  timestamp: number;
}

export interface PauseGamePayload {}

export interface ResumeGamePayload {}

export interface RoomCreatedEvent {
  roomCode: string;
  player: Player;
  game: GameState;
}

export interface PlayerJoinedEvent {
  player: Player;
  players: Player[];
  game: GameState;
}

export interface GameStartedEvent {
  game: GameState;
  currentTwister: Twister;
  roundStartTime: number;
}

export interface RoundAdvancedEvent {
  currentRound: number;
  currentTwister: Twister;
  roundStartTime: number;
}

export interface PlayerSubmittedEvent {
  playerId: string;
  similarity: number;
}

export interface GamePausedEvent {
  pausedAt: number;
  pausedBy: string;
}

export interface GameResumedEvent {
  resumedAt: number;
  totalPausedTime: number;
}

export interface GameEndedEvent {
  leaderboard: Array<{ player: Player; accuracy: number; time: number }>;
}

export interface PlayerLeftEvent {
  playerId: string;
  players: Player[];
}
