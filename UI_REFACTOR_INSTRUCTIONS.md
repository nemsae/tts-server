# UI Refactor Instructions - Multiplayer Tongue Twister Server

This document provides detailed instructions for integrating the UI with the multiplayer server.

## Server URL

```
VITE_SOCKET_URL=http://localhost:3001
```

## Socket.io Connection

```typescript
import { io, Socket } from 'socket.io-client';

const socket = io(import.meta.env.VITE_SOCKET_URL, {
  transports: ['websocket', 'polling'],
});
```

## Socket Events Overview

### Client -> Server Events

| Event | Payload | Description |
|-------|---------|-------------|
| `create-room` | `{ playerName: string, settings: GameSettings }` | Create a new room as host |
| `join-room` | `{ roomCode: string, playerName: string }` | Join existing room |
| `start-game` | none | Host starts the game (only host) |
| `submit-answer` | `{ transcript: string, timestamp: number }` | Submit player's answer |
| `pause-game` | none | Pause the game (any player) |
| `resume-game` | none | Resume the game (any player) |
| `get-room-state` | none | Request current room state |

### Server -> Client Events

| Event | Payload | Description |
|-------|---------|-------------|
| `player-joined` | `{ player: Player, players: Player[], game: GameState }` | New player joined |
| `player-left` | `{ playerId: string, players: Player[] }` | Player disconnected |
| `game-started` | `{ game: GameState, currentTwister: Twister, roundStartTime: number }` | Game begins |
| `round-advanced` | `{ currentRound: number, currentTwister: Twister, roundStartTime: number }` | New round |
| `player-submitted` | `{ playerId: string, similarity: number }` | Player submitted answer |
| `game-paused` | `{ pausedAt: number, pausedBy: string }` | Game paused |
| `game-resumed` | `{ resumedAt: number, totalPausedTime: number }` | Game resumed |
| `game-ended` | `{ leaderboard: Array<{ player: Player; accuracy: number; time: number }> }` | Game over |

## Data Types

```typescript
type TwisterLength = 'short' | 'medium' | 'long' | 'custom';
type GameScreen = 'lobby' | 'playing' | 'paused' | 'game-over';

interface GameSettings {
  topic: string;
  length: TwisterLength;
  customLength?: number;
  rounds: number;
}

interface Twister {
  id: string;
  text: string;
  difficulty: 1 | 2 | 3;
  topic: string;
  length?: TwisterLength;
}

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
  currentRound: number;       // 0-indexed, -1 = not started
  roundResults: RoundResult[];
  status: GameScreen;        // 'lobby' | 'playing' | 'paused' | 'game-over'
  startedAt: number | null;
  pausedAt: number | null;
  totalPausedTime: number;
  currentTwisterStartTime: number | null;
}
```

## API Response Formats

### Create Room / Join Room Response

```typescript
// Success
{
  success: true,
  roomCode: string,
  player: Player,
  game: GameState
}

// Error
{
  success: false,
  error: string
}
```

### Start Game Response

```typescript
// Success
{ success: true }

// Error
{ success: false, error: string }
```

### Submit Answer Response

```typescript
// Success
{ success: true, similarity: number }

// Error
{ success: false, error: string }
```

### Get Room State Response

```typescript
// Success
{ success: true, game: GameState, playerId: string }

// Error
{ success: false, error: string }
```

## Game Flow

### 1. Lobby Screen

1. **Host creates room**:
   ```typescript
   socket.emit('create-room', {
     playerName: 'HostName',
     settings: {
       topic: 'food',
       length: 'medium',
       rounds: 5
     }
   }, (response) => {
     if (response.success) {
       // Navigate to lobby, show room code: response.roomCode
     }
   });
   ```

2. **Players join**:
   ```typescript
   socket.emit('join-room', {
     roomCode: 'ABCD',
     playerName: 'Player2'
   }, (response) => {
     if (response.success) {
       // Navigate to lobby
     }
   });
   ```

3. **Listen for players**:
   ```typescript
   socket.on('player-joined', ({ player, players, game }) => {
     // Update players list
   });

   socket.on('player-left', ({ playerId, players }) => {
     // Remove player from list
   });
   ```

4. **Host starts game** (all players ready):
   ```typescript
   socket.emit('start-game', (response) => {
     if (response.success) {
       // Navigate to game screen
     }
   });
   ```

### 2. Playing Screen

1. **Listen for game start**:
   ```typescript
   socket.on('game-started', ({ game, currentTwister, roundStartTime }) => {
     // game.status = 'playing'
     // currentTwister.text = 'She sells seashells...'
     // Start 30-second countdown from roundStartTime
   });
   ```

2. **Submit answer**:
   ```typescript
   socket.emit('submit-answer', {
     transcript: 'she sells seashells',
     timestamp: Date.now()
   }, (response) => {
     if (response.success) {
       // Show similarity score
     }
   });
   ```

3. **Listen for submissions**:
   ```typescript
   socket.on('player-submitted', ({ playerId, similarity }) => {
     // Update player's score display
   });
   ```

4. **Round advances**:
   ```typescript
   socket.on('round-advanced', ({ currentRound, currentTwister, roundStartTime }) => {
     // new round starting
   });
   ```

### 3. Pause/Resume

1. **Pause game**:
   ```typescript
   socket.emit('pause-game', (response) => {
     // response.success indicates if pause worked
   });
   ```

2. **Listen for pause**:
   ```typescript
   socket.on('game-paused', ({ pausedAt, pausedBy }) => {
     // Show paused overlay, who paused
   });
   ```

3. **Resume game**:
   ```typescript
   socket.emit('resume-game', (response) => {
     // response.success indicates if resume worked
   });
   ```

4. **Listen for resume**:
   ```typescript
   socket.on('game-resumed', ({ resumedAt, totalPausedTime }) => {
     // Hide paused overlay, adjust timers
   });
   ```

### 4. Game Over

```typescript
socket.on('game-ended', ({ leaderboard }) => {
  // leaderboard: [{ player, accuracy, time }, ...]
  // Sort by accuracy descending, then time ascending
  // Show final scores
});
```

## Timer Synchronization

- Server sends `roundStartTime` (Unix timestamp)
- Client calculates remaining time: `30 - (Date.now() - roundStartTime) / 1000`
- Always use server time for validation, client timer is for display only

## State Management Recommendations

```typescript
interface MultiplayerState {
  socket: Socket | null;
  isConnected: boolean;
  currentRoomCode: string | null;
  currentPlayerId: string | null;
  isHost: boolean;
  players: Player[];
  game: GameState | null;
  currentTwister: Twister | null;
  roundStartTime: number | null;
  submittedPlayers: Set<string>;
}
```

## Required UI Screens

1. **Home/Multiplayer Screen**: Host game / Join game buttons
2. **Lobby Screen**: Room code, players list, settings display, start button (host only)
3. **Game Screen**: Current twister, timer, all players' progress/scores
4. **Game Over Screen**: Leaderboard with accuracy and time

## Environment Variables

```
VITE_SOCKET_URL=http://localhost:3001
VITE_OPENAI_API_KEY=your-key  # Only needed if generating twisters on client
```

## Testing Checklist

- [ ] Create room and receive room code
- [ ] Join room with valid code
- [ ] Join room with invalid code (show error)
- [ ] Join full room (4 players, show error)
- [ ] Player join/leave updates all clients
- [ ] Host can start game
- [ ] Non-host cannot start game
- [ ] All players see same twister
- [ ] Submit answer updates score
- [ ] Round auto-advances after all submit or timeout
- [ ] Pause/resume syncs across all clients
- [ ] Game over shows correct leaderboard
- [ ] Disconnect removes player from room
