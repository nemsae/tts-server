# Tongue Twister Game API Integration Guide

This guide explains how to integrate a Next.js/React frontend with the NestJS backend for the multiplayer tongue twister game.

## Base URL Configuration

```env
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_WS_URL=ws://localhost:3001
```

---

## WebSocket Connection (Primary)

The game uses Socket.IO for real-time communication. All game actions happen over WebSocket.

### Connection Setup

```tsx
import { io, Socket } from 'socket.io-client';

const socket: Socket = io(process.env.NEXT_PUBLIC_WS_URL, {
  transports: ['websocket', 'polling'],
  autoConnect: true,
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
});
```

---

## Room Management

### Create Room

Creates a new game room and makes the creator the host.

**Event:** `create-room`  
**Direction:** Client → Server

```ts
interface CreateRoomRequest {
  playerName: string; // 1-20 chars, sanitized
  settings: GameSettings;
}

interface GameSettings {
  topic: string; // 1-80 chars, required
  length: 'short' | 'medium' | 'long' | 'custom';
  customLength?: number; // 1-20, required if length='custom'
  rounds: number; // 1-10
  roundTimeLimit: number; // 5-120 seconds
  autoSubmitEnabled?: boolean;
  autoSubmitDelay?: number;
}
```

**Request Example:**

```ts
socket.emit('create-room', {
  playerName: 'Alice',
  settings: {
    topic: 'Animals',
    length: 'medium',
    rounds: 3,
    roundTimeLimit: 30,
  },
});
```

**Response:**

```ts
interface CreateRoomResponse {
  success: boolean;
  roomCode?: string; // 6-char code (e.g., "ABC123")
  player?: Player;
  game?: GameState;
  error?: string;
}
```

### Join Room

Join an existing room by room code.

**Event:** `join-room`  
**Direction:** Client → Server

```ts
interface JoinRoomRequest {
  roomCode: string; // 6-character room code
  playerName: string;
}
```

**Request Example:**

```ts
socket.emit('join-room', {
  roomCode: 'ABC123',
  playerName: 'Bob',
});
```

**Response:**

```ts
interface JoinRoomResponse {
  success: boolean;
  roomCode?: string;
  player?: Player;
  game?: GameState;
  error?: string;
}
```

---

## Game Actions

### Start Game

Starts the game. Only the room host can start.

**Event:** `start-game`  
**Direction:** Client → Server  
**Requires:** Host permissions

**Request:**

```ts
socket.emit('start-game');
```

**Response:**

```ts
interface StartGameResponse {
  success: boolean;
  error?: string;
}
```

### Submit Answer

Submit a player's transcribed speech answer.

**Event:** `submit-answer`  
**Direction:** Client → Server

```ts
interface SubmitAnswerRequest {
  transcript: string; // Player's speech transcription (1-500 chars)
  timestamp: number; // Unix timestamp when submitted
}
```

**Request Example:**

```ts
socket.emit('submit-answer', {
  transcript: 'Peter Piper picked a peck of pickled peppers',
  timestamp: Date.now(),
});
```

**Response:**

```ts
interface SubmitAnswerResponse {
  success: boolean;
  similarity?: number; // 0-1 score indicating accuracy
  error?: string;
}
```

### Pause Game

Pause the current game (any player can pause).

**Event:** `pause-game`  
**Direction:** Client → Server

**Request:**

```ts
socket.emit('pause-game');
```

**Response:**

```ts
interface PauseGameResponse {
  success: boolean;
  error?: string;
}
```

### Resume Game

Resume a paused game.

**Event:** `resume-game`  
**Direction:** Client → Server

**Request:**

```ts
socket.emit('resume-game');
```

**Response:**

```ts
interface ResumeGameResponse {
  success: boolean;
  error?: string;
}
```

### Get Room State

Retrieve current room and game state.

**Event:** `get-room-state`  
**Direction:** Client → Server

**Request:**

```ts
socket.emit('get-room-state');
```

**Response:**

```ts
interface GetRoomStateResponse {
  success: boolean;
  game?: GameState;
  playerId?: string;
  error?: string;
}
```

---

## REST API Endpoints

### Generate Twisters

Generate tongue twisters without creating a room (for preview/testing).

**Endpoint:** `POST /api/generate`  
**Base URL:** `http://localhost:3001`

```ts
interface GenerateTwistersRequest {
  topic: string;
  length: 'short' | 'medium' | 'long' | 'custom';
  customLength?: number;
  rounds?: number; // Default: 1
}
```

**Response:**

```ts
interface GenerateTwistersResponse {
  twisters: Twister[];
}

interface Twister {
  id: string;
  text: string;
  difficulty: 1 | 2 | 3;
  topic: string;
  length?: string;
}
```

### Get Active Players

Get count of players in active lobbies.

**Endpoint:** `GET /api/lobby/active-players`

**Response:**

```ts
{
  count: number;
}
```

---

## Server Events (Push)

The server pushes these events to clients:

### `player-joined`

```ts
{
  player: Player;
  players: Player[];
  game: GameState;
}
```

### `player-left`

```ts
{
  playerId: string;
  players: Player[];
}
```

### `game-started`

```ts
{
  game: GameState;
  currentTwister: Twister;
  roundStartTime: number;
  roundTimeLimit: number;
}
```

### `player-submitted`

```ts
{
  playerId: string;
  similarity: number;
}
```

### `round-advanced` (from game-engine)

```ts
{
  game: GameState;
  currentTwister: Twister;
  roundStartTime: number;
  roundTimeLimit: number;
}
```

### `game-paused`

```ts
{
  pausedAt: number;
  pausedBy: string;
}
```

### `game-resumed`

```ts
{
  resumedAt: number;
  totalPausedTime: number;
}
```

### `game-ended`

```ts
{
  game: GameState;
  finalResults: {
    playerId: string;
    totalScore: number;
    rank: number;
  }
  [];
}
```

---

## TypeScript Types

```ts
interface Player {
  id: string;
  name: string;
  isHost: boolean;
  isReady: boolean;
  currentScore: number;
  isConnected: boolean;
}

interface GameState {
  roomCode: string;
  settings: GameSettings;
  players: Player[];
  twisters: Twister[];
  currentRound: number;
  roundResults: RoundResult[];
  status: 'lobby' | 'playing' | 'paused' | 'game-over';
  startedAt: number | null;
  pausedAt: number | null;
  totalPausedTime: number;
  currentTwisterStartTime: number | null;
  roundTimeLimit: number | null;
}
```

---

## React Hook Example

```ts
import { useEffect, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

export function useGameSocket() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const [roomCode, setRoomCode] = useState<string | null>(null);

  useEffect(() => {
    const newSocket = io(process.env.NEXT_PUBLIC_WS_URL, {
      transports: ['websocket', 'polling'],
    });

    newSocket.on('connect', () => console.log('Connected'));
    newSocket.on('player-joined', (data) => setGameState(data.game));
    newSocket.on('player-left', (data) =>
      setGameState((prev) => ({
        ...prev,
        players: data.players,
      })),
    );
    newSocket.on('game-started', (data) => setGameState(data.game));
    newSocket.on('player-submitted', (data) => {
      // Handle submission feedback
    });

    setSocket(newSocket);
    return () => {
      newSocket.disconnect();
    };
  }, []);

  const createRoom = useCallback(
    (playerName: string, settings: GameSettings) => {
      if (!socket) return;
      const response = socket.emit('create-room', { playerName, settings });
      if (response.success) {
        setRoomCode(response.roomCode);
        setPlayer(response.player);
        setGameState(response.game);
      }
      return response;
    },
    [socket],
  );

  const joinRoom = useCallback(
    (code: string, playerName: string) => {
      if (!socket) return;
      const response = socket.emit('join-room', { roomCode: code, playerName });
      if (response.success) {
        setRoomCode(code);
        setPlayer(response.player);
        setGameState(response.game);
      }
      return response;
    },
    [socket],
  );

  const startGame = useCallback(() => socket?.emit('start-game'), [socket]);

  const submitAnswer = useCallback(
    (transcript: string) => {
      if (!socket) return;
      return socket.emit('submit-answer', {
        transcript,
        timestamp: Date.now(),
      });
    },
    [socket],
  );

  return {
    socket,
    gameState,
    player,
    roomCode,
    createRoom,
    joinRoom,
    startGame,
    submitAnswer,
  };
}
```

---

## Environment Variables (Server)

| Variable         | Required | Default | Description                    |
| ---------------- | -------- | ------- | ------------------------------ |
| `OPENAI_API_KEY` | Yes      | -       | OpenAI API key for AI twisters |
| `CLIENT_URL`     | Yes      | -       | Frontend URL for CORS          |
| `PORT`           | No       | 3001    | Server port                    |
| `LOG_LEVEL`      | No       | info    | Logging verbosity              |

---

## Error Handling

All responses include `success: boolean` and optionally `error: string`. Handle errors gracefully:

```ts
socket.on('create-room', (response) => {
  if (!response.success) {
    toast.error(response.error || 'Failed to create room');
  }
});
```

---

## Rate Limiting

The server implements rate limiting:

- Room creation: 5 requests/minute
- Room joining: 10 requests/minute
- Answer submission: 30 requests/minute
- Game start (AI generation): 3 requests/minute

Exceeding limits returns `{ success: false, error: 'Too many requests...' }`.
