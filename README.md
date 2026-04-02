# Tone TTS Server

Multiplayer tongue twister game server. Players create/join rooms, compete to say tongue twisters, and get scored on speech accuracy.

## Client Connections

| Type | Protocol | Purpose |
|------|----------|---------|
| **REST API** | HTTP | Generate tongue twisters, query lobby stats (`/api/*`) |
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

## Deploy

```bash
./deploy-to-gcp.sh
```

## Publish Validation Package

The shared validation package for the UI is published to npm as `@nemsae/tts-validation`.

Before publishing:

1. Update the version in `packages/validation/package.json`.
2. Refresh `packages/validation/package-lock.json` with `npm --prefix packages/validation install --package-lock-only`.
3. Merge the version bump to `main`.
4. Create and push a matching tag like `validation-v0.1.0`.

The `Publish Validation Package` GitHub Actions workflow will publish `packages/validation` to npm using the repo `NPM_TOKEN` secret. After that, other repos can install it with:

```bash
npm install @nemsae/tts-validation zod
```
