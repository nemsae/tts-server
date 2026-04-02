# AGENTS.md — TypeScript/Express Standards

## Project Structure

```
src/
├── api/                  # Feature-based modules (e.g. api/user/)
│   ├── <feature>Controller.ts  # Request handling, delegates to service
│   ├── <feature>Service.ts     # Business logic, returns ServiceResponse
│   ├── <feature>Router.ts      # Route definitions + validation middleware
│   └── <feature>Model.ts        # Zod schemas + inferred types
├── common/
│   ├── middleware/        # Global middleware (error handler, auth, rate limit)
│   └── utils/             # Shared helpers (env config, validation, responses)
├── server.ts             # Express app setup, middleware registration
└── index.ts              # Entry point — imports app, starts listening
```

## Conventions

- **Modules**: ESM (`"type": "module"` in package.json). Use `import`/`export`, never `require`.
- **Types**: Strict mode on. No `any` — use `unknown` + narrowing or Zod inference.
- **Validation**: Validate all incoming requests with Zod schemas via `validateRequest` middleware on routes.
- **Error handling**: Async route handlers must forward errors with `next(error)`. Use a global 4-arg error middleware as the last registered middleware.
- **Responses**: Use a standardized `ServiceResponse` class (`{ success, responseObject, message, statusCode }`).
- **Naming**: PascalCase for classes/types/interfaces. camelCase for functions/variables/files. Files: `userController.ts`, `UserService.ts`.

## Code Style

- Linter: ESLint + Prettier (run `npm run lint` before commits).
- Imports: Node builtins → external packages → internal aliases (`@/...`) → relative.
- Check `package.json` before adding new libraries. Prefer existing utilities (Zod, helmet, cors, rate-limit).

## Testing

- Run `npm test` after completing any task. Fix failures before returning control.
- Unit test services with mocked repositories. Integration test routes with supertest.

## Commands

| Action          | Command              |
|-----------------|----------------------|
| Dev server      | `npm run dev`        |
| Build           | `npm run build`      |
| Lint            | `npm run lint`       |
| Typecheck       | `npm run typecheck`  |
| Test            | `npm test`           |
