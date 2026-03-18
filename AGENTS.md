# Multiplayer Server Agent Instructions

This document provides detailed instructions for LLMs to scaffold a Node.js multiplayer the Tongue Tw server forister game. The server enables up to 4 participants to play together in real-time with synchronized game state.

## Architecture Overview

### Technology Stack

- **Runtime**: Node.js with TypeScript
- **Real-time Communication**: Socket.io v4
- **AI/ML**: OpenAI SDK (for twister generation) - same as frontend
- **Deployment Target**: Separate Node.js server (not embedded in Vite)

### Server Directory Structure

```
server/
├── src/
│   ├── index.ts              # Entry point, Socket.io setup
│   ├── config/
│   │   └── env.ts            # Environment variables
│   ├── types/
│   │   └── index.ts          # Shared TypeScript interfaces
│   ├── services/
│   │   ├── room-manager.ts   # Room creation, joining, state
│   │   ├── game-engine.ts    # Game logic, timer, scoring
│   │   ├── twister-generator.ts # AI twister generation (moved from client)
│   │   └── scoring.ts        # Levenshtein similarity (moved from client)
│   ├── handlers/
│   │   ├── connection.ts     # Socket connection handling
│   │   ├── room.ts           # Room-related events
│   │   └── game.ts           # Game events (start, pause, submit, etc.)
│   └── utils/
│       └── room-code.ts      # Room code generation
├── package.json
└── tsconfig.json
```

## Core Data Types

Create `/server/src/types/index.ts`:

```typescript
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
  id: string; // Socket ID
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
  currentRound: number; // 0-indexed
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

// Socket Events (Client -> Server)
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
  timestamp: number; // For latency validation
}

export interface PauseGamePayload {
  // Empty - all pause state handled server-side
}

export interface ResumeGamePayload {
  // Empty
}

// Socket Events (Server -> Client)
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
```

## Server Implementation

### 1. Entry Point (`src/index.ts`)

```typescript
import { Server } from 'socket.io';
import { createServer } from 'http';
import { handleConnection } from './handlers/connection';

const httpServer = createServer();
const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
  },
  pingTimeout: 20000,
  pingInterval: 25000,
});

io.on('connection', (socket) => handleConnection(socket, io));

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`Multiplayer server running on port ${PORT}`);
});
```

### 2. Room Code Generation (`src/utils/room-code.ts`)

```typescript
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclude confusing chars

export function generateRoomCode(): string {
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  }
  return code;
}

export function isValidRoomCode(code: string): boolean {
  return /^[A-Z0-9]{4}$/.test(code);
}
```

### 3. Room Manager (`src/services/room-manager.ts`)

```typescript
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
      twisters: [], // Generated after settings confirmed
      currentRound: -1, // -1 means not started
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

    // Reassign host if needed
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
```

### 4. Game Engine (`src/services/game-engine.ts`)

```typescript
import type { Room, GameState, Twister, RoundResult, Player } from '../types';
import { roomManager } from './room-manager';
import { generateTwisters } from './twister-generator';
import { scoreTwister } from './scoring';

const ROUND_TIME_LIMIT = 30000; // 30 seconds per twister
const AUTO_ADVANCE_DELAY = 2000; // 2 seconds after all complete

class GameEngine {
  private roundTimers = new Map<string, NodeJS.Timeout>();

  async startGame(roomCode: string): Promise<boolean> {
    const room = roomManager.getRoom(roomCode);
    if (!room || room.game.status !== 'lobby') return false;

    // Generate twisters on server (moved from client)
    const twisters = await generateTwisters(
      room.game.settings.topic,
      room.game.settings.length,
      room.game.settings.customLength,
      room.game.settings.rounds
    );

    room.game.twisters = twisters;
    room.game.currentRound = 0;
    room.game.status = 'playing';
    room.game.startedAt = Date.now();
    room.game.currentTwisterStartTime = Date.now();

    return true;
  }

  submitAnswer(
    roomCode: string,
    playerId: string,
    transcript: string,
    clientTimestamp: number
  ): { similarity: number; isComplete: boolean } | null {
    const room = roomManager.getRoom(roomCode);
    if (!room || room.game.status !== 'playing') return null;
    if (room.game.pausedAt !== null) return null;

    const currentTwister = room.game.twisters[room.game.currentRound];
    if (!currentTwister) return null;

    // Anti-cheat: validate timestamp is within round window
    const roundElapsed = Date.now() - (room.game.currentTwisterStartTime || 0);
    if (roundElapsed > ROUND_TIME_LIMIT) return null;

    const { similarity } = scoreTwister(transcript, currentTwister.text);

    // Record result
    const result: RoundResult = {
      playerId,
      twisterId: currentTwister.id,
      similarity,
      completedAt: Date.now(),
    };
    room.game.roundResults.push(result);

    // Update player score
    const player = room.game.players.find((p) => p.id === playerId);
    if (player) {
      player.currentScore = similarity;
    }

    // Check if all players have submitted
    const submittedPlayerIds = new Set(
      room.game.roundResults.filter((r) => r.twisterId === currentTwister.id).map((r) => r.playerId)
    );

    const allPlayersSubmitted = room.game.players.every((p) => submittedPlayerIds.has(p.id));

    return { similarity, isComplete: allPlayersSubmitted };
  }

  async advanceRound(roomCode: string, io: any): Promise<boolean> {
    const room = roomManager.getRoom(roomCode);
    if (!room) return false;

    room.game.currentRound++;

    if (room.game.currentRound >= room.game.twisters.length) {
      // Game over
      room.game.status = 'game-over';
      this.clearRoundTimer(roomCode);
      return false;
    }

    room.game.currentTwisterStartTime = Date.now();

    io.to(roomCode).emit('round-advanced', {
      currentRound: room.game.currentRound,
      currentTwister: room.game.twisters[room.game.currentRound],
      roundStartTime: room.game.currentTwisterStartTime,
    });

    // Start round timer
    this.startRoundTimer(roomCode, io);

    return true;
  }

  pauseGame(roomCode: string, playerId: string, io: any): boolean {
    const room = roomManager.getRoom(roomCode);
    if (!room || room.game.status !== 'playing') return false;
    if (room.game.pausedAt !== null) return false; // Already paused

    room.game.pausedAt = Date.now();
    room.game.status = 'paused';

    io.to(roomCode).emit('game-paused', {
      pausedAt: room.game.pausedAt,
      pausedBy: playerId,
    });

    return true;
  }

  resumeGame(roomCode: string, io: any): boolean {
    const room = roomManager.getRoom(roomCode);
    if (!room || room.game.status !== 'paused') return false;
    if (room.game.pausedAt === null) return false;

    const pauseDuration = Date.now() - room.game.pausedAt;
    room.game.totalPausedTime += pauseDuration;
    room.game.status = 'playing';
    room.game.pausedAt = null;

    io.to(roomCode).emit('game-resumed', {
      resumedAt: Date.now(),
      totalPausedTime: room.game.totalPausedTime,
    });

    return true;
  }

  endGame(roomCode: string, io: any): void {
    const room = roomManager.getRoom(roomCode);
    if (!room) return;

    room.game.status = 'game-over';
    this.clearRoundTimer(roomCode);

    // Calculate final results
    const leaderboard = this.calculateLeaderboard(room);

    io.to(roomCode).emit('game-ended', { leaderboard });
  }

  private calculateLeaderboard(room: Room) {
    return room.game.players
      .map((player) => {
        const playerResults = room.game.roundResults.filter((r) => r.playerId === player.id);
        const totalSimilarity = playerResults.reduce((sum, r) => sum + r.similarity, 0);
        const accuracy =
          playerResults.length > 0 ? Math.round(totalSimilarity / playerResults.length) : 0;

        const totalTime = room.game.startedAt
          ? Date.now() - room.game.startedAt - room.game.totalPausedTime
          : 0;

        return { player, accuracy, time: totalTime };
      })
      .sort((a, b) => b.accuracy - a.accuracy || a.time - b.time);
  }

  private startRoundTimer(roomCode: string, io: any): void {
    this.clearRoundTimer(roomCode);

    const timer = setTimeout(async () => {
      await this.advanceRound(roomCode, io);
    }, ROUND_TIME_LIMIT);

    this.roundTimers.set(roomCode, timer);
  }

  private clearRoundTimer(roomCode: string): void {
    const timer = this.roundTimers.get(roomCode);
    if (timer) {
      clearTimeout(timer);
      this.roundTimers.delete(roomCode);
    }
  }
}

export const gameEngine = new GameEngine();
```

### 5. Scoring Service (`src/services/scoring.ts`)

```typescript
// Moved from client: src/shared/lib/string-utils.ts
export function levenshteinDistance(source: string, target: string): number {
  if (source === target) return 0;
  if (source.length === 0) return target.length;
  if (target.length === 0) return source.length;

  const matrix = Array.from({ length: source.length + 1 }, () =>
    new Array<number>(target.length + 1).fill(0)
  );

  for (let i = 0; i <= source.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= target.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= source.length; i++) {
    for (let j = 1; j <= target.length; j++) {
      const cost = source[i - 1] === target[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[source.length][target.length];
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function scoreTwister(spoken: string, target: string): { similarity: number } {
  const normalizedTarget = normalizeText(target);
  const normalizedInput = normalizeText(spoken);

  if (normalizedTarget.length === 0 && normalizedInput.length === 0) {
    return { similarity: 100 };
  }

  if (normalizedTarget.length === 0 || normalizedInput.length === 0) {
    return { similarity: 0 };
  }

  const distance = levenshteinDistance(normalizedTarget, normalizedInput);
  const longestLength = Math.max(normalizedTarget.length, normalizedInput.length);
  const rawScore = ((longestLength - distance) / longestLength) * 100;

  return { similarity: Math.max(0, Math.round(rawScore)) };
}
```

### 6. Twister Generator (`src/services/twister-generator.ts`)

```typescript
import OpenAI from 'openai';
import type { Twister, TwisterLength, TwisterTopic } from '../types';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function getLengthInstruction(length: TwisterLength, customLength?: number): string {
  if (length === 'custom' && customLength) {
    return `Each tongue twister must be exactly ${customLength} words long.`;
  }
  const lengthMap: Record<'short' | 'medium' | 'long', string> = {
    short: 'Keep each tongue twister very brief, around 5 words.',
    medium: 'Make each tongue twister moderately long, around 10 words.',
    long: 'Make each tongue twister quite lengthy, around 20 words.',
  };
  return lengthMap[length as 'short' | 'medium' | 'long'];
}

export async function generateTwisters(
  topic: TwisterTopic,
  length: TwisterLength,
  customLength: number | undefined,
  rounds: number
): Promise<Twister[]> {
  const lengthInstruction = getLengthInstruction(length, customLength);

  const systemPrompt = `You are a tongue twister generator. Generate ${rounds} unique, fun, and challenging tongue twisters that are difficult to say quickly.
Each tongue twister should feature words related to the topic: ${topic}.
${lengthInstruction}
Return only the tongue twisters, one per line, with no numbering, no explanations, and no additional text.`;

  const response = await openai.chat.completions.create({
    model: 'o3-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Generate ${rounds} unique tongue twisters about ${topic}.` },
    ],
    reasoning_effort: 'low',
  });

  const content = response.choices[0]?.message?.content?.trim() ?? '';

  const texts = content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const difficulty = length === 'short' ? 1 : length === 'medium' ? 2 : length === 'long' ? 3 : 2;
  const usedTexts = new Set<string>();

  return texts
    .filter((text) => {
      const normalized = text.toLowerCase();
      if (usedTexts.has(normalized)) return false;
      usedTexts.add(normalized);
      return true;
    })
    .map((text, index) => ({
      id: `ai-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
      text,
      difficulty: difficulty as 1 | 2 | 3,
      topic,
      length,
    }));
}
```

### 7. Socket Handlers (`src/handlers/connection.ts`)

```typescript
import type { Server, Socket } from 'socket.io';
import { roomManager } from '../services/room-manager';
import { gameEngine } from '../services/game-engine';
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

    // Notify others
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

    // Broadcast to all players
    io.to(currentRoomCode).emit('player-submitted', {
      playerId: currentPlayerId,
      similarity: result.similarity,
    });

    callback({ success: true, similarity: result.similarity });

    // Auto-advance if all submitted
    if (result.isComplete) {
      setTimeout(() => {
        gameEngine.advanceRound(currentRoomCode!, io);
      }, 2000);
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
```

## Anti-Cheat & Latency Considerations

### Server-Driven Timer

- **ALWAYS** run the round timer on the server
- Server sends `roundStartTime` to clients
- Clients display countdown but it's for display only
- Server validates all submissions against server time

### Latency Compensation

- Accept `clientTimestamp` with submissions
- If `clientTimestamp` is too far from server time (> 5 seconds), reject
- Use server-side round tracking, not client-reported round

### State Synchronization

- Server is the single source of truth
- All game state changes happen on server first
- Server broadcasts state updates to all clients
- Clients render server state, not local predictions

### Player Disconnection

- If a player disconnects mid-game, their turn is skipped with 0 score
- Host can kick players from lobby
- Reconnection: players can rejoin with same name within 5 minutes

## WebRTC for Voice/Video (MVP Considerations)

For MVP, keep it simple:

### Option 1: Mute/Live Status Only (Simplest MVP)

- Show which players are currently speaking
- No actual voice transmission
- Uses Socket.io state (player.isSpeaking flag)

### Option 2: WebRTC Mesh (4 participants max)

- Each participant connects directly to others (P2P)
- For 4 players: each has 3 connections (max 6 total)
- Use simple-peer or raw WebRTC

### Implementation (Option 1 - Simplified):

```typescript
// Add to Player interface
interface Player {
  // ... existing fields
  isSpeaking: boolean;
  lastSpeechActivity: number;
}

// Socket events
socket.on('player-speaking', (isSpeaking: boolean) => {
  // Broadcast to room
  io.to(roomCode).emit('player-speaking-update', {
    playerId,
    isSpeaking,
  });
});
```

For voice transmission, consider adding later with a service like:

- LiveKit (has free tier, easy SDK)
- Agora
- Or simple WebRTC mesh

## Frontend Integration

### New Dependencies

```bash
npm install socket.io-client
```

### Environment Variables

```
VITE_SOCKET_URL=http://localhost:3001
VITE_OPENAI_API_KEY=your-key  # Server also needs this
```

### Client-Side Changes Required

1. **Create Socket Service** (`src/shared/api/socket.ts`):

```typescript
import { io, Socket } from 'socket.io-client';

class SocketService {
  private socket: Socket | null = null;

  connect() {
    this.socket = io(import.meta.env.VITE_SOCKET_URL);
  }

  // Expose all socket methods
  on(event: string, handler: any) {
    this.socket?.on(event, handler);
  }
  emit(event: string, ...args: any) {
    this.socket?.emit(event, ...args);
  }
  off(event: string) {
    this.socket?.off(event);
  }
}

export const socketService = new SocketService();
```

2. **New Multiplayer Home Page** (`src/pages/multiplayer/index.ts`):
   - Host game button -> creates room -> shows room code
   - Join game input -> enter room code -> join room

3. **New Lobby Page** (`src/pages/lobby/index.ts`):
   - Show room code
   - Show connected players
   - Settings (only host can modify)
   - Ready/Start button (only host can start)

4. **Modified GameSession Widget**:
   - Receive game state from server via Socket.io
   - Display other players' progress
   - Show "speaking" indicator for others
   - Pause/Resume affects all players

## Configuration

### Server package.json

```json
{
  "name": "tone-tts-server",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "openai": "^6.22.0",
    "socket.io": "^4.7.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.0.0"
  }
}
```

### Server tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src"
  }
}
```

## Development Workflow

1. **Run server**: `npm run dev` (in server directory)
2. **Run client**: `npm run dev` (in project root)
3. **Test multiplayer flow**:
   - Open 2 browser tabs to localhost
   - Tab 1: Host game -> creates room ABCD
   - Tab 2: Join with code ABCD
   - Host starts game
   - Both players see same twister
   - Both submit answers
   - Round advances automatically

## Production Considerations

1. **Environment Variables**:
   - `OPENAI_API_KEY` - Required for twister generation
   - `PORT` - Server port (default 3001)
   - `CLIENT_URL` - Allowed CORS origin

2. **Scaling** (future):
   - Use Redis adapter for Socket.io if running multiple instances
   - Consider adding a database (PostgreSQL/MongoDB) for persistence
   - Add authentication for production

3. **Security**:
   - Add rate limiting on socket events
   - Validate all incoming payloads
   - Sanitize player names
