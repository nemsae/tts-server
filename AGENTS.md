# AGENTS.md — NestJS Standards

## Project Structure
```
src/
├── main.ts                    # Entry point
├── app.module.ts              # Root module
├── common/
│   ├── types/index.ts       # Shared types
│   └── utils/               # Logger, validation, rate-limiter, room-code
└── game/
    ├── game.module.ts        # Feature module
    ├── game.gateway.ts       # WebSocket gateway
    ├── game.controller.ts    # REST controller
    ├── dto/                 # DTOs (use class-validator)
    └── services/            # GameEngine, RoomManager, TwisterGenerator, Scoring
```

## Conventions
- **ESM**: Use `.js` extensions in all imports
- **Decorators**: `@WebSocketGateway`, `@SubscribeMessage`, `@MessageBody`, `@Controller`, `@Get`, `@Post`
- **Validation**: class-validator decorators on DTOs; custom `validateDto()` for WebSocket payloads
- **DI**: Constructor injection with `@Injectable()` for all services
- **Naming**: PascalCase (classes), camelCase (variables/functions)
- **Error handling**: Throw `HttpException`/`BadRequestException` for HTTP errors

## Commands
| Action    | Command           |
|-----------|-------------------|
| Dev       | `npm run dev`     |
| Build     | `npm run build`   |
| Start     | `npm run start`   |
| Lint      | `npm run lint`    |

## Environment
| Variable        | Required | Default     |
|-----------------|----------|-------------|
| OPENAI_API_KEY  | Yes      | -           |
| CLIENT_URL      | Yes      | -           |
| PORT            | No       | 3001        |
| LOG_LEVEL       | No       | info        |
