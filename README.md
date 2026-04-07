# Tone TTS Server

Multiplayer tongue twister game server. Players create/join rooms, compete to say tongue twisters, and get scored on speech accuracy.

## Client Connections

| Type          | Protocol  | Purpose                                                                |
| ------------- | --------- | ---------------------------------------------------------------------- |
| **REST API**  | HTTP      | Generate tongue twisters, query lobby stats (`/api/*`)                 |
| **WebSocket** | Socket.IO | Real-time multiplayer — room management, game state, answer submission |

### Socket.IO Events

**Client → Server:** `create-room`, `join-room`, `start-game`, `submit-answer`, `pause-game`, `resume-game`, `get-room-state`

**Server → Client:** `player-joined`, `player-left`, `game-started`, `round-advanced`, `player-submitted`, `game-paused`, `game-resumed`, `round-time-expired`, `game-ended`

## Commands

```bash
npm run dev          # Start dev server with hot reload
npm run build        # Compile TypeScript
npm start            # Run compiled build
npm run lint         # Lint source files
npm run lint:fix     # Auto-fix lint issues
npm run format       # Format with Prettier
npm run format:check # Check formatting
npm run typecheck    # Type-check without emitting
npm test             # Run tests
```

## Environment

Copy `.env.example` to `.env` and set:

- `OPENAI_API_KEY` — OpenAI API key for generating tongue twisters
- `CLIENT_URL` — Allowed CORS origin (e.g. `http://localhost:5173`)
- `PORT` — Server port (default `8080`)

### SpacetimeDB Configuration

- `SPACETIMEDB_HOST` — SpacetimeDB server host (default: `localhost:3000`)
- `SPACETIMEDB_MODULE` — SpacetimeDB module name (default: `tts`)
- `SPACETIMEDB_TOKEN` — Optional authentication token for SpacetimeDB connection

## Deploy

```bash
./deploy-to-gcp.sh
```

## SpacetimeDB Module

The game state and room management are handled by a SpacetimeDB WASM module in `spacetime-module/`.

### Prerequisites

Install the Spacetime CLI:

```bash
cargo install spacetimedb
```

### Build

```bash
cd spacetime-module
cargo build --target wasm32-unknown-unknown --release
```

### Publish

```bash
# Start SpacetimeDB locally (first time only)
spacetime start

# Publish to local database
spacetime publish <database_name>
```

The database name is configured in `spacetime.local.json`.

### Reducers

| Reducer                                              | Description                               |
| ---------------------------------------------------- | ----------------------------------------- |
| `init`                                               | Module initialization (called on publish) |
| `client_connected`                                   | Marks player online                       |
| `client_disconnected`                                | Marks player offline                      |
| `create_room(name, topic, rounds, round_time_limit)` | Creates room + host player                |
| `join_room(room_code, name)`                         | Joins existing room                       |
| `leave_room()`                                       | Leaves room, handles host reassignment    |
| `update_room_status(room_code, status)`              | Updates room status (host only)           |

### NestJS Integration

The `SpacetimeDBService` in `src/game/services/spacetimedb.service.ts` provides a NestJS-native wrapper around the SpacetimeDB TypeScript SDK:

```typescript
// Inject the service
constructor(private readonly stdb: SpacetimeDBService) {}

// Use in your game logic
const roomCode = await this.stdb.createRoom(playerName, settings);
const players = this.stdb.getPlayersInRoom(roomCode);
```

The service automatically:

- Connects to SpacetimeDB on module initialization
- Handles reconnection with exponential backoff
- Manages connection lifecycle (disconnect on module destroy)
- Provides typed reducer methods and query methods for room/player data

#### Room Management Migration

As of Ticket 7, room management has been migrated from in-memory to SpacetimeDB:

| Phase | Description                                       |
| ----- | ------------------------------------------------- |
| 1     | Write to SpacetimeDB, maintain in-memory fallback |
| 2     | Switch reads to SpacetimeDB                       |
| 3     | Remove in-memory RoomManagerService               |

**Key changes:**

- Player identification uses SpacetimeDB identity hex strings instead of `host-${timestamp}-${random}`
- Socket mappings track `{ roomCode, identity, name }` instead of `{ roomCode, playerId }`
- All WebSocket events (`player-joined`, `player-left`, etc.) unchanged

### Connect Client

```bash
spacetime connect <database_name>
```

## Publish Validation Package

The shared validation package for the UI is published to npm as `@jaysonder/tts-validation`.

Before publishing:

1. Update the version in `packages/validation/package.json`.
2. Refresh `packages/validation/package-lock.json` with `npm --prefix packages/validation install --package-lock-only`.
3. Merge the version bump to `main`.
4. Create and push a matching tag like `validation-v0.1.0`.

The `Publish Validation Package` GitHub Actions workflow will publish `packages/validation` to npm using the repo `NPM_TOKEN` secret. After that, other repos can install it with:

```bash
npm install @jaysonder/tts-validation zod
```
