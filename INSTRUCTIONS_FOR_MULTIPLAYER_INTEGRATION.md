# Tongue Twister Multiplayer Game API Documentation

This document provides exhaustive specifications for integrating a Svelte UI with the Tongue Twister Multiplayer Game server.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Connection Setup](#connection-setup)
3. [Type Definitions](#type-definitions)
4. [Socket Events Reference](#socket-events-reference)
5. [Game Flow](#game-flow)
6. [Client Implementation Guidelines](#client-implementation-guidelines)
7. [Server Configuration](#server-configuration)
8. [Error Handling](#error-handling)
9. [Scoring Algorithm](#scoring-algorithm)
10. [Timing & Synchronization](#timing--synchronization)

---

## Architecture Overview

### Technology Stack
- **Runtime**: Node.js with TypeScript
- **Real-time Communication**: Socket.io v4
- **AI/ML**: OpenAI SDK (GPT-o3-mini) for twister generation
- **Server Port**: 3001 (default), configurable via `PORT` environment variable
- **Client URL**: http://localhost:5173 (default), configurable via `CLIENT_URL` environment variable

### Connection Configuration

```typescript
const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
  },
  pingTimeout: 20000,
  pingInterval: 25000,
});
```

### Game Constraints
- **Max Players**: 4 per room
- **Round Time Limit**: 30,000ms (30 seconds)
- **Auto-Advance Delay**: 2,000ms (2 seconds after all players submit)

---

## Connection Setup

### Server URL
```
VITE_SOCKET_URL=http://localhost:3001
```

### Client Initialization

```typescript
import { io, Socket } from 'socket.io-client';

class SocketService {
  private socket: Socket | null = null;

  connect(): Socket {
    if (!this.socket) {
      this.socket = io(import.meta.env.VITE_SOCKET_URL, {
        transports: ['websocket'],
        autoConnect: true,
      });
    }
    return this.socket;
  }

  getSocket(): Socket | null {
    return this.socket;
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
  }
}

export const socketService = new SocketService();
```

### Connection Lifecycle

```typescript
// On connection established
socket.on('connect', () => {
  console.log('Connected to server:', socket.id);
});

// On disconnection
socket.on('disconnect', (reason) => {
  console.log('Disconnected:', reason);
  // reason: 'io server disconnect', 'io client disconnect', 'ping timeout', etc.
});

// On connection error
socket.on('connect_error', (error) => {
  console.error('Connection error:', error);
});
```

---

## Type Definitions

### Primitive Types

```typescript
type TwisterLength = 'short' | 'medium' | 'long' | 'custom';
type TwisterTopic = string;
type GameScreen = 'lobby' | 'playing' | 'paused' | 'game-over';
```

### GameSettings

Configuration passed when creating a room.

```typescript
interface GameSettings {
  topic: string;           // Topic for tongue twisters (e.g., "animals", "food", "colors")
  length: TwisterLength;    // 'short' (~5 words), 'medium' (~10 words), 'long' (~20 words), 'custom'
  customLength?: number;    // Required when length='custom', specifies exact word count
  rounds: number;           // Number of rounds to play (maps to number of twisters generated)
}
```

**Validation Rules:**
- `topic`: Must be non-empty string
- `rounds`: Must be positive integer
- If `length === 'custom'`, `customLength` is required and must be positive integer

### Twister

Generated tongue twister data.

```typescript
interface Twister {
  id: string;              // Unique identifier: format "ai-{timestamp}-{index}-{random}"
  text: string;            // The tongue twister text (e.g., "Peter Piper picked a peck of pickled peppers")
  difficulty: 1 | 2 | 3;   // 1=short, 2=medium, 3=long
  topic: TwisterTopic;     // Topic this twister belongs to
  length?: TwisterLength;  // Original length setting used
}
```

### Player

Player state data.

```typescript
interface Player {
  id: string;              // Socket-derived ID, format "host-{timestamp}-{random}" or "player-{timestamp}-{random}"
  name: string;            // Player's display name
  isHost: boolean;         // True if this player created the room
  isReady: boolean;        // Player ready status (relevant in lobby)
  currentScore: number;    // Current round's similarity score (0-100)
  isConnected: boolean;    // Connection status
}
```

**Important:** The `id` field is server-assigned and used for all subsequent API calls. The client MUST store the returned `player` object from room creation/joining.

### RoundResult

Individual submission result for a round.

```typescript
interface RoundResult {
  playerId: string;        // ID of the submitting player
  twisterId: string;        // ID of the twister attempted
  similarity: number;       // Score from 0-100
  completedAt: number;     // Unix timestamp (ms) when submitted
}
```

### GameState

Complete game state maintained by server.

```typescript
interface GameState {
  roomCode: string;                    // 4-character room code (e.g., "ABCD")
  settings: GameSettings;              // Game configuration
  players: Player[];                    // All players in the room
  twisters: Twister[];                  // Generated twisters (populated when game starts)
  currentRound: number;                 // Current round index (0-indexed), -1 before start
  roundResults: RoundResult[];         // All submission results for current game
  status: GameScreen;                   // 'lobby' | 'playing' | 'paused' | 'game-over'
  startedAt: number | null;            // Unix timestamp when game started, null if not started
  pausedAt: number | null;             // Unix timestamp when paused, null if not paused
  totalPausedTime: number;             // Cumulative paused duration in ms
  currentTwisterStartTime: number | null; // Unix timestamp when current twister started
}
```

### GameScreen Values

| Value | Description |
|-------|-------------|
| `lobby` | Waiting for players, host can start game |
| `playing` | Game in progress, accepting submissions |
| `paused` | Game paused, no submissions accepted |
| `game-over` | All rounds completed, showing results |

---

## Socket Events Reference

### Client-to-Server Events (Emitted by Client)

All events return a response via callback (acknowledgement pattern).

#### 1. `create-room`

Creates a new game room and becomes the host.

**Payload:**
```typescript
interface CreateRoomPayload {
  playerName: string;   // Host's display name
  settings: GameSettings; // Game configuration
}
```

**Success Response:**
```typescript
{
  success: true;
  roomCode: string;     // 4-character room code
  player: Player;        // The host's player object (SAVE THIS)
  game: GameState;       // Initial game state
}
```

**Error Response:**
```typescript
{
  success: false;
  error: string;         // Error message
}
```

**Example:**
```typescript
socket.emit('create-room', {
  playerName: 'Alice',
  settings: {
    topic: 'animals',
    length: 'medium',
    rounds: 5
  }
}, (response) => {
  if (response.success) {
    const { roomCode, player, game } = response;
    console.log(`Room created: ${roomCode}`);
    // Store player.id for later use
  }
});
```

---

#### 2. `join-room`

Joins an existing room.

**Payload:**
```typescript
interface JoinRoomPayload {
  roomCode: string;    // 4-character room code (case-insensitive)
  playerName: string;   // Player's display name
}
```

**Success Response:**
```typescript
{
  success: true;
  roomCode: string;
  player: Player;       // The joining player's object (SAVE THIS)
  game: GameState;      // Current game state
}
```

**Error Response:**
```typescript
{
  success: false;
  error: 'Room not found or full' | 'Game already in progress';
}
```

**Example:**
```typescript
socket.emit('join-room', {
  roomCode: 'ABCD',
  playerName: 'Bob'
}, (response) => {
  if (response.success) {
    const { roomCode, player, game } = response;
  }
});
```

---

#### 3. `start-game`

Starts the game (host only).

**Payload:** None (empty object or omit)

**Success Response:**
```typescript
{
  success: true;
}
```

**Error Response:**
```typescript
{
  success: false;
  error: 'Not in a room' | 'Only host can start game' | 'Failed to start game';
}
```

**Side Effects on Success:**
- Server generates twisters via OpenAI
- Emits `game-started` event to all players
- Starts round timer (30 seconds)

**Example:**
```typescript
socket.emit('start-game', {}, (response) => {
  if (response.success) {
    console.log('Game started!');
  }
});
```

---

#### 4. `submit-answer`

Submits a player's spoken transcript for scoring.

**Payload:**
```typescript
interface SubmitAnswerPayload {
  transcript: string;    // The spoken text (from Speech-to-Text)
  timestamp: number;      // Client timestamp (ms) for latency validation
}
```

**Success Response:**
```typescript
{
  success: true;
  similarity: number;    // Score from 0-100
}
```

**Error Response:**
```typescript
{
  success: false;
  error: 'Not in a room' | 'Cannot submit answer';
}
```

**Validation Rules:**
- Game status must be `playing`
- Game must not be paused
- Round timer must not have expired (within 30 seconds)
- Player must not have already submitted for current round

**Auto-Advance Trigger:**
If all players submit, server waits 2 seconds then emits `round-advanced`.

**Example:**
```typescript
socket.emit('submit-answer', {
  transcript: 'Peter piper picked a peck of pickled peppers',
  timestamp: Date.now()
}, (response) => {
  if (response.success) {
    console.log(`Score: ${response.similarity}`);
  }
});
```

---

#### 5. `pause-game`

Pauses the game (any player can pause).

**Payload:** None

**Success Response:**
```typescript
{
  success: true;
}
```

**Error Response:**
```typescript
{
  success: false;
  error: 'Not in a room';
}
```

**Side Effects on Success:**
- Emits `game-paused` event to all players
- Pauses round timer
- Sets `game.pausedAt` timestamp

**Example:**
```typescript
socket.emit('pause-game', {}, (response) => {
  if (response.success) {
    console.log('Game paused');
  }
});
```

---

#### 6. `resume-game`

Resumes a paused game.

**Payload:** None

**Success Response:**
```typescript
{
  success: true;
}
```

**Error Response:**
```typescript
{
  success: false;
  error: 'Not in a room';
}
```

**Side Effects on Success:**
- Emits `game-resumed` event to all players
- Resumes round timer (adjusting for pause duration)
- Updates `game.totalPausedTime`

**Example:**
```typescript
socket.emit('resume-game', {}, (response) => {
  if (response.success) {
    console.log('Game resumed');
  }
});
```

---

#### 7. `get-room-state`

Retrieves current game state (for reconnection/sync).

**Payload:** None

**Success Response:**
```typescript
{
  success: true;
  game: GameState;
  playerId: string;     // The client's player ID
}
```

**Error Response:**
```typescript
{
  success: false;
  error: 'Not in a room' | 'Room not found';
}
```

**Example:**
```typescript
socket.emit('get-room-state', {}, (response) => {
  if (response.success) {
    const { game, playerId } = response;
    updateLocalState(game, playerId);
  }
});
```

---

### Server-to-Client Events (Received by Client)

#### 1. `player-joined`

Broadcast when a new player joins the room.

**Payload:**
```typescript
interface PlayerJoinedEvent {
  player: Player;        // The player who joined
  players: Player[];      // Updated player list
  game: GameState;        // Updated game state
}
```

**When Received:**
- Other players receive when someone joins
- Joiner does NOT receive this (they get callback from `join-room`)

**Example Handler:**
```typescript
socket.on('player-joined', ({ player, players, game }) => {
  console.log(`${player.name} joined the room`);
  updatePlayersList(players);
  updateGameState(game);
});
```

---

#### 2. `game-started`

Broadcast when game begins.

**Payload:**
```typescript
interface GameStartedEvent {
  game: GameState;              // Full updated game state
  currentTwister: Twister;     // First twister to display
  roundStartTime: number;       // Unix timestamp (ms) for countdown
}
```

**When Received:**
- All players receive when host starts game

**Example Handler:**
```typescript
socket.on('game-started', ({ game, currentTwister, roundStartTime }) => {
  updateGameState(game);
  displayTwister(currentTwister);
  startCountdown(30000, roundStartTime); // 30 second countdown
});
```

---

#### 3. `player-submitted`

Broadcast when any player submits an answer.

**Payload:**
```typescript
interface PlayerSubmittedEvent {
  playerId: string;     // ID of submitting player
  similarity: number;   // Their similarity score
}
```

**When Received:**
- All players receive when any player submits

**Example Handler:**
```typescript
socket.on('player-submitted', ({ playerId, similarity }) => {
  const player = gameState.players.find(p => p.id === playerId);
  showSubmissionIndicator(player.name, similarity);
});
```

---

#### 4. `round-advanced`

Broadcast when moving to next round.

**Payload:**
```typescript
interface RoundAdvancedEvent {
  currentRound: number;      // New round index (0-indexed)
  currentTwister: Twister;   // Next twister to display
  roundStartTime: number;    // Unix timestamp (ms) for countdown
}
```

**When Received:**
- All players receive when advancing (auto or timeout)

**Example Handler:**
```typescript
socket.on('round-advanced', ({ currentRound, currentTwister, roundStartTime }) => {
  gameState.currentRound = currentRound;
  displayTwister(currentTwister);
  resetCountdown(30000, roundStartTime);
});
```

---

#### 5. `game-paused`

Broadcast when game is paused.

**Payload:**
```typescript
interface GamePausedEvent {
  pausedAt: number;    // Unix timestamp when paused
  pausedBy: string;    // Player ID who paused
}
```

**Example Handler:**
```typescript
socket.on('game-paused', ({ pausedAt, pausedBy }) => {
  gameState.status = 'paused';
  gameState.pausedAt = pausedAt;
  showPauseScreen(pausedBy);
});
```

---

#### 6. `game-resumed`

Broadcast when game resumes from pause.

**Payload:**
```typescript
interface GameResumedEvent {
  resumedAt: number;           // Unix timestamp when resumed
  totalPausedTime: number;     // Cumulative paused time in ms
}
```

**Example Handler:**
```typescript
socket.on('game-resumed', ({ resumedAt, totalPausedTime }) => {
  gameState.status = 'playing';
  gameState.pausedAt = null;
  gameState.totalPausedTime = totalPausedTime;
  hidePauseScreen();
});
```

---

#### 7. `game-ended`

Broadcast when all rounds complete.

**Payload:**
```typescript
interface GameEndedEvent {
  leaderboard: Array<{
    player: Player;
    accuracy: number;    // Average similarity score (0-100)
    time: number;       // Total game time in ms (excluding pauses)
  }>;
}
```

**Sorting:** Descending by accuracy, then ascending by time.

**Example Handler:**
```typescript
socket.on('game-ended', ({ leaderboard }) => {
  gameState.status = 'game-over';
  displayLeaderboard(leaderboard);
});
```

---

#### 8. `player-left`

Broadcast when a player disconnects.

**Payload:**
```typescript
interface PlayerLeftEvent {
  playerId: string;    // ID of disconnected player
  players: Player[];   // Updated player list
}
```

**When Received:**
- All remaining players receive

**Host Reassignment:** If host disconnects, the first remaining player becomes the new host.

**Example Handler:**
```typescript
socket.on('player-left', ({ playerId, players }) => {
  const leftPlayer = gameState.players.find(p => p.id === playerId);
  showNotification(`${leftPlayer?.name || 'Player'} left the room`);
  updatePlayersList(players);
});
```

---

## Game Flow

### Complete Game Lifecycle

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              LOBBY PHASE                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Host                          Server                       Players           │
│    │                              │                            │             │
│    │── create-room ──────────────>│                            │             │
│    │<─── roomCode, player ────────│                            │             │
│    │                              │                            │             │
│    │                              │<───── join-room ────────────│             │
│    │                              │────── player-joined ───────>│ (broadcast) │
│    │                              │                            │             │
│    │                              │<───── join-room ────────────│             │
│    │                              │────── player-joined ───────>│ (broadcast) │
│    │                              │                            │             │
│    │ (check all ready)            │                            │             │
│    │── start-game ───────────────>│                            │             │
│    │                              │                            │             │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            GAME START                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│    │<───────────────── game-started ──────────────────────────────────│     │
│    │    (includes first twister)                                         │
│    │                                                                     │
│    │                        ┌─────────────────────────────┐               │
│    │                        │    ROUND LOOP (N rounds)     │               │
│    │                        │                               │               │
│    │                        │  ┌─────────────────────────┐ │               │
│    │                        │  │   PLAYING PHASE          │ │               │
│    │                        │  │                         │ │               │
│    │                        │  │ - Display twister       │ │               │
│    │                        │  │ - 30s countdown         │ │               │
│    │                        │  │ - Accept submissions    │ │               │
│    │                        │  │                         │ │               │
│    │                        │  └─────────────────────────┘ │               │
│    │                        │              │               │               │
│    │                        │              ▼               │               │
│    │                        │  ┌─────────────────────────┐ │               │
│    │                        │  │  SUBMISSION TRACKING     │ │               │
│    │                        │  │                         │ │               │
│    │                        │  │ player-submitted ──────>│ (broadcast)    │
│    │                        │  │ (for each player)       │ │               │
│    │                        │  │                         │ │               │
│    │                        │  └─────────────────────────┘ │               │
│    │                        │              │               │               │
│    │                        │              ▼               │               │
│    │                        │  ┌─────────────────────────┐ │               │
│    │                        │  │  AUTO-ADVANCE (2s)      │ │               │
│    │                        │  │  OR TIMEOUT (30s)       │ │               │
│    │                        │  │                         │ │               │
│    │                        │  │ round-advanced ────────>│               │
│    │                        │  │ (next twister)          │ │               │
│    │                        │  │                         │ │               │
│    │                        │  └─────────────────────────┘ │               │
│    │                        │              │               │               │
│    │                        └──────────────┼───────────────┘               │
│    │                                    (loop)                             │
│    │                                                                     │
│    │<─────────────────── game-ended ──────────────────────────────────│   │
│    │    (includes leaderboard)                                           │
│    │                                                                     │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Lobby Phase Detailed Flow

1. **Host Creates Room**
   ```
   Client: emit('create-room', { playerName, settings })
   Server: Creates room, generates 4-char code
   Server: Returns { success, roomCode, player, game }
   Client: Stores player.id, joins socket room
   ```

2. **Players Join Room**
   ```
   Client: emit('join-room', { roomCode, playerName })
   Server: Validates room exists, not full, lobby status
   Server: Adds player to room
   Server: Broadcasts 'player-joined' to existing players
   Server: Returns { success, player, game } to joiner
   ```

3. **Host Starts Game**
   ```
   Host: emit('start-game')
   Server: Validates host permission
   Server: Calls generateTwisters() via OpenAI
   Server: Updates game state (currentRound=0, status='playing')
   Server: Broadcasts 'game-started' to all players
   Server: Starts 30s round timer
   ```

### Playing Phase Detailed Flow

1. **Round Start**
   ```
   All Clients: Receive 'game-started' or 'round-advanced'
   All Clients: Display currentTwister.text
   All Clients: Start local countdown from roundStartTime
   ```

2. **Player Submits Answer**
   ```
   Client: emit('submit-answer', { transcript, timestamp })
   Server: Validates game status, timing
   Server: Calls scoreTwister(transcript, twister.text)
   Server: Records RoundResult
   Server: Broadcasts 'player-submitted' to all
   Server: Returns { success, similarity } to submitter
   Server: Checks if all players submitted
   ```

3. **Round End (Auto-Advance)**
   ```
   (When all players submit OR 30s timeout)
   Server: Waits 2 seconds (AUTO_ADVANCE_DELAY)
   Server: Increments currentRound
   Server: If more twisters:
     - Updates currentTwisterStartTime
     - Broadcasts 'round-advanced'
     - Restarts 30s timer
   Server: If no more twisters:
     - Sets status='game-over'
     - Calculates leaderboard
     - Broadcasts 'game-ended'
   ```

### Pause/Resume Flow

```
┌──────────────────────────────────────────────────────────────────────┐
│                         PAUSE/RESUME FLOW                             │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  Any Player                    Server                    All Players   │
│       │                          │                            │        │
│       │── pause-game ───────────>│                            │        │
│       │                          │── game-paused ───────────>│        │
│       │<── success ──────────────│                            │        │
│       │                          │                            │        │
│       │     (timer frozen)       │                            │        │
│       │                          │                            │        │
│       │── resume-game ──────────>│                            │        │
│       │                          │── game-resumed ──────────>│        │
│       │<── success ──────────────│                            │        │
│       │                          │                            │        │
│       │ (timer resumes with      │                            │        │
│       │  adjusted remaining time)│                            │        │
│       │                          │                            │        │
└──────────────────────────────────────────────────────────────────────┘
```

### Disconnection Handling

1. **Player Disconnects Mid-Lobby**
   ```
   Server: Removes player from players array
   Server: Broadcasts 'player-left' to remaining
   Server: If host disconnected, reassigns host to first remaining player
   Server: If no players left, deletes room
   ```

2. **Player Disconnects Mid-Game**
   ```
   Server: Marks player as disconnected (isConnected: false)
   Server: Removes from active players
   Server: Broadcasts 'player-left'
   Server: Game continues with remaining players
   Server: Disconnected player's turn gets 0 score
   ```

3. **Reconnection**
   ```
   Client: Reconnects socket
   Client: emit('join-room', { roomCode, playerName })
   Server: If room exists and game in progress:
     - Creates new player entry
     - Returns current game state
     - Player can continue from current state
   ```

---

## Client Implementation Guidelines

### Recommended Store Structure (Svelte)

```typescript
// src/lib/stores/game.ts
import { writable, derived } from 'svelte/store';

interface GameStore {
  socket: Socket | null;
  player: Player | null;
  roomCode: string | null;
  game: GameState | null;
  isConnected: boolean;
  error: string | null;
}

function createGameStore() {
  const { subscribe, set, update } = writable<GameStore>({
    socket: null,
    player: null,
    roomCode: null,
    game: null,
    isConnected: false,
    error: null,
  });

  return {
    subscribe,
    
    setSocket: (socket: Socket) => update(s => ({ ...s, socket })),
    
    setPlayer: (player: Player) => update(s => ({ ...s, player })),
    
    setRoomCode: (roomCode: string) => update(s => ({ ...s, roomCode })),
    
    setGame: (game: GameState) => update(s => ({ ...s, game })),
    
    updateGame: (updater: (game: GameState) => GameState) => 
      update(s => ({ ...s, game: s.game ? updater(s.game) : null })),
    
    setConnected: (isConnected: boolean) => update(s => ({ ...s, isConnected })),
    
    setError: (error: string | null) => update(s => ({ ...s, error })),
    
    reset: () => set({
      socket: null,
      player: null,
      roomCode: null,
      game: null,
      isConnected: false,
      error: null,
    }),
  };
}

export const gameStore = createGameStore();

// Derived stores for convenience
export const players = derived(gameStore, $game => $game.game?.players ?? []);
export const currentTwister = derived(gameStore, $game => {
  if (!$game.game || $game.game.currentRound < 0) return null;
  return $game.game.twisters[$game.game.currentRound] ?? null;
});
export const gameStatus = derived(gameStore, $game => $game.game?.status ?? 'lobby');
export const isHost = derived(gameStore, $game => $game.player?.isHost ?? false);
```

### Socket Event Handler Setup

```typescript
// src/lib/socket/handlers.ts
import type { Socket } from 'socket.io-client';
import { gameStore } from '../stores/game';

export function setupSocketHandlers(socket: Socket) {
  // Connection events
  socket.on('connect', () => {
    gameStore.setConnected(true);
    gameStore.setError(null);
  });

  socket.on('disconnect', () => {
    gameStore.setConnected(false);
  });

  socket.on('connect_error', (error) => {
    gameStore.setError(`Connection failed: ${error.message}`);
  });

  // Game events
  socket.on('player-joined', ({ player, players, game }) => {
    gameStore.setGame(game);
  });

  socket.on('game-started', ({ game, currentTwister, roundStartTime }) => {
    gameStore.setGame(game);
    // Trigger UI update for twister display
  });

  socket.on('player-submitted', ({ playerId, similarity }) => {
    gameStore.updateGame(g => ({
      ...g,
      players: g.players.map(p => 
        p.id === playerId ? { ...p, currentScore: similarity } : p
      )
    }));
  });

  socket.on('round-advanced', ({ currentRound, currentTwister, roundStartTime }) => {
    gameStore.updateGame(g => ({
      ...g,
      currentRound,
      // Reset scores for new round
      players: g.players.map(p => ({ ...p, currentScore: 0 }))
    }));
  });

  socket.on('game-paused', ({ pausedAt, pausedBy }) => {
    gameStore.updateGame(g => ({
      ...g,
      status: 'paused',
      pausedAt
    }));
  });

  socket.on('game-resumed', ({ resumedAt, totalPausedTime }) => {
    gameStore.updateGame(g => ({
      ...g,
      status: 'playing',
      pausedAt: null,
      totalPausedTime
    }));
  });

  socket.on('game-ended', ({ leaderboard }) => {
    gameStore.updateGame(g => ({
      ...g,
      status: 'game-over'
    }));
    // leaderboard contains final rankings
  });

  socket.on('player-left', ({ playerId, players }) => {
    gameStore.updateGame(g => ({
      ...g,
      players
    }));
  });
}
```

### Room Creation Flow

```typescript
// src/lib/actions/createRoom.ts
import { socketService } from '../socket';
import { gameStore } from '../stores/game';
import type { GameSettings } from '../types';

export async function createRoom(playerName: string, settings: GameSettings): Promise<boolean> {
  const socket = socketService.getSocket();
  if (!socket) return false;

  return new Promise((resolve) => {
    socket.emit('create-room', { playerName, settings }, (response: any) => {
      if (response.success) {
        gameStore.setPlayer(response.player);
        gameStore.setRoomCode(response.roomCode);
        gameStore.setGame(response.game);
        resolve(true);
      } else {
        gameStore.setError(response.error);
        resolve(false);
      }
    });
  });
}
```

### Join Room Flow

```typescript
// src/lib/actions/joinRoom.ts
import { socketService } from '../socket';
import { gameStore } from '../stores/game';

export async function joinRoom(roomCode: string, playerName: string): Promise<boolean> {
  const socket = socketService.getSocket();
  if (!socket) return false;

  return new Promise((resolve) => {
    socket.emit('join-room', { roomCode, playerName }, (response: any) => {
      if (response.success) {
        gameStore.setPlayer(response.player);
        gameStore.setRoomCode(response.roomCode);
        gameStore.setGame(response.game);
        resolve(true);
      } else {
        gameStore.setError(response.error);
        resolve(false);
      }
    });
  });
}
```

### Start Game Flow

```typescript
// src/lib/actions/startGame.ts
import { socketService } from '../socket';
import { gameStore } from '../stores/game';

export function startGame(): Promise<boolean> {
  const socket = socketService.getSocket();
  if (!socket) return Promise.resolve(false);

  return new Promise((resolve) => {
    socket.emit('start-game', {}, (response: any) => {
      if (response.success) {
        resolve(true);
      } else {
        gameStore.setError(response.error);
        resolve(false);
      }
    });
  });
}
```

### Submit Answer Flow

```typescript
// src/lib/actions/submitAnswer.ts
import { socketService } from '../socket';
import { gameStore } from '../stores/game';

export function submitAnswer(transcript: string): Promise<number | null> {
  const socket = socketService.getSocket();
  if (!socket) return Promise.resolve(null);

  return new Promise((resolve) => {
    socket.emit('submit-answer', {
      transcript,
      timestamp: Date.now()
    }, (response: any) => {
      if (response.success) {
        resolve(response.similarity);
      } else {
        gameStore.setError(response.error);
        resolve(null);
      }
    });
  });
}
```

### Pause/Resume Flow

```typescript
// src/lib/actions/pauseGame.ts
import { socketService } from '../socket';

export function pauseGame(): Promise<boolean> {
  const socket = socketService.getSocket();
  if (!socket) return Promise.resolve(false);

  return new Promise((resolve) => {
    socket.emit('pause-game', {}, (response: any) => {
      resolve(response.success);
    });
  });
}

export function resumeGame(): Promise<boolean> {
  const socket = socketService.getSocket();
  if (!socket) return Promise.resolve(false);

  return new Promise((resolve) => {
    socket.emit('resume-game', {}, (response: any) => {
      resolve(response.success);
    });
  });
}
```

### Countdown Timer Implementation

The server is the source of truth for timing. Clients should calculate remaining time from `roundStartTime`.

```typescript
// src/lib/utils/countdown.ts
const ROUND_DURATION = 30000; // 30 seconds

export function createCountdown(roundStartTime: number, onTick: (remaining: number) => void, onExpire: () => void) {
  let intervalId: number | null = null;
  
  const calculateRemaining = () => {
    const elapsed = Date.now() - roundStartTime;
    return Math.max(0, ROUND_DURATION - elapsed);
  };
  
  const tick = () => {
    const remaining = calculateRemaining();
    onTick(remaining);
    
    if (remaining <= 0) {
      if (intervalId) clearInterval(intervalId);
      onExpire();
    }
  };
  
  intervalId = window.setInterval(tick, 100); // Update every 100ms
  
  return {
    stop: () => {
      if (intervalId) clearInterval(intervalId);
    },
    getRemaining: calculateRemaining
  };
}
```

---

## Server Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Server port |
| `CLIENT_URL` | `http://localhost:5173` | Allowed CORS origin |
| `OPENAI_API_KEY` | (required) | OpenAI API key for twister generation |

### Running the Server

```bash
# Development
cd server
npm run dev

# Production
npm run build
npm start
```

### Dependencies (server/package.json)

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

---

## Error Handling

### Client-Side Error Handling Pattern

```typescript
// Always use callbacks for error handling
socket.emit('some-event', payload, (response: ApiResponse) => {
  if (response.success) {
    // Handle success
  } else {
    // Handle error
    console.error('API Error:', response.error);
    showErrorNotification(response.error);
  }
});
```

### Server-Side Error Messages

| Event | Error Message | Cause |
|-------|--------------|-------|
| `join-room` | `Room not found or full` | Room doesn't exist OR already has 4 players |
| `join-room` | `Game already in progress` | Room status is not 'lobby' |
| `start-game` | `Not in a room` | Client not joined to any room |
| `start-game` | `Only host can start game` | Player is not the host |
| `submit-answer` | `Not in a room` | Client not joined to any room |
| `submit-answer` | `Cannot submit answer` | Game not in 'playing' state, paused, or timer expired |
| `pause-game` | `Not in a room` | Client not joined to any room |
| `resume-game` | `Not in a room` | Client not joined to any room |
| `get-room-state` | `Not in a room` | Client not joined to any room |
| `get-room-state` | `Room not found` | Room was deleted |

### Connection Error Recovery

```typescript
socket.on('connect_error', (error) => {
  console.error('Connection error:', error);
  
  // Attempt reconnection with backoff
  setTimeout(() => {
    socket.connect();
  }, 2000);
});

socket.on('disconnect', (reason) => {
  console.log('Disconnected:', reason);
  
  // Handle intentional disconnects
  if (reason === 'io server disconnect') {
    // Server disconnected us, manually reconnect
    socket.connect();
  }
});
```

---

## Scoring Algorithm

The server uses Levenshtein distance for similarity scoring.

### Normalization Steps

1. Convert both strings to lowercase
2. Remove all non-alphanumeric characters (replace with spaces)
3. Collapse multiple spaces into single space
4. Trim leading/trailing whitespace

### Similarity Calculation

```
similarity = ((max(len(target), len(input)) - levenshteinDistance(target, input)) 
              / max(len(target), len(input))) * 100
```

**Example:**
- Target: "Peter Piper picked a peck of pickled peppers"
- Input: "Peter piper picked a peck of pickled peppers"
- Distance: 1 (case difference in "Piper")
- Similarity: 98%

### Score Interpretation

| Score Range | Interpretation |
|-------------|----------------|
| 90-100 | Near perfect |
| 70-89 | Good attempt |
| 50-69 | Partial match |
| 0-49 | Poor match |

---

## Timing & Synchronization

### Server-Driven Timer

The server is the **single source of truth** for all timing:

1. `roundStartTime` is set by the server when a round begins
2. Clients calculate remaining time locally: `max(0, ROUND_DURATION - (now - roundStartTime))`
3. Server validates all submissions against server time
4. If `Date.now() - roundStartTime > 30000`, submission is rejected

### Round Timer Constants

```typescript
const ROUND_TIME_LIMIT = 30000;      // 30 seconds per twister
const AUTO_ADVANCE_DELAY = 2000;     // 2 seconds after all submit
```

### Latency Compensation

The `clientTimestamp` in `submit-answer` is used for anti-cheat validation:

```typescript
// Server-side validation
const roundElapsed = Date.now() - room.game.currentTwisterStartTime;
if (roundElapsed > ROUND_TIME_LIMIT) {
  return null; // Reject late submissions
}
```

Clients should send their timestamp, but the server uses server time for validation.

### Pause Time Tracking

```typescript
// When paused
room.game.pausedAt = Date.now();

// When resumed
const pauseDuration = Date.now() - room.game.pausedAt;
room.game.totalPausedTime += pauseDuration;

// Total game time (excluding pauses)
const totalTime = Date.now() - room.game.startedAt - room.game.totalPausedTime;
```

---

## Complete API Contract Summary

### Socket Events Quick Reference

| Direction | Event | Payload | Response |
|-----------|-------|---------|----------|
| C → S | `create-room` | `{ playerName, settings }` | `{ success, roomCode, player, game }` |
| C → S | `join-room` | `{ roomCode, playerName }` | `{ success, roomCode, player, game }` |
| C → S | `start-game` | `{}` | `{ success }` |
| C → S | `submit-answer` | `{ transcript, timestamp }` | `{ success, similarity }` |
| C → S | `pause-game` | `{}` | `{ success }` |
| C → S | `resume-game` | `{}` | `{ success }` |
| C → S | `get-room-state` | `{}` | `{ success, game, playerId }` |
| S → C | `player-joined` | `{ player, players, game }` | - |
| S → C | `game-started` | `{ game, currentTwister, roundStartTime }` | - |
| S → C | `player-submitted` | `{ playerId, similarity }` | - |
| S → C | `round-advanced` | `{ currentRound, currentTwister, roundStartTime }` | - |
| S → C | `game-paused` | `{ pausedAt, pausedBy }` | - |
| S → C | `game-resumed` | `{ resumedAt, totalPausedTime }` | - |
| S → C | `game-ended` | `{ leaderboard }` | - |
| S → C | `player-left` | `{ playerId, players }` | - |

---

## Testing Checklist

When implementing the UI, verify:

- [ ] Can create a room and receive room code
- [ ] Can join a room with valid code
- [ ] Cannot join full room (4 players)
- [ ] Cannot join non-existent room
- [ ] Host can start game
- [ ] Non-host cannot start game
- [ ] All players see same twister when game starts
- [ ] Countdown matches server `roundStartTime`
- [ ] Submitting answer shows score
- [ ] All players see submissions from others
- [ ] Round advances when all submit (after 2s delay)
- [ ] Round advances on timeout (30s)
- [ ] Pause freezes game for all
- [ ] Resume continues game for all
- [ ] Player leaving triggers `player-left`
- [ ] Host reassigns when host leaves
- [ ] Game ends when all rounds complete
- [ ] Leaderboard displays correct rankings
