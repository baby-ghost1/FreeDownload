# Backend — `@freedownload/backend`

Fastify 5 REST API (`/api/v1`) + independent worker processes. Node 24 LTS,
TypeScript (strict), PostgreSQL 18 (Drizzle), Redis 8, BullMQ.

## Commands

From the repository root:

```bash
npm run dev           # tsx watch → http://localhost:4000
npm run build         # tsc → dist/
npm run lint
npm run typecheck
npm test
```

Workspace-scoped: `npm run <script> --workspace @freedownload/backend`.

## Layout

```
src/
├── server/        app.ts (Fastify factory, error envelope, CORS, helmet)
│                  config.ts (Zod env schema — boot fails on invalid config)
│                  server.ts (entrypoint, graceful shutdown)
├── modules/       route/service modules (health now; auth, downloads, admin…)
├── queue/         BullMQ queues, producers, consumers        (Phase 3)
├── workers/       download / media / cleanup workers         (Phase 3)
├── downloader/    SourceAdapter, detectors, policies, executors (Phase 4)
├── media/         FFmpeg runner, metadata, formats              (Phase 4)
├── storage/       R2 client, signed URLs, lifecycle             (Phase 4)
├── database/      Drizzle schema, migrations, seeds             (Phase 2)
├── security/      rate limit, SSRF, validation, sanitization    (Phase 2+)
├── errors/        AppError + the §46 error code table
├── logging/       pino JSON logger with redaction list
├── observability/ metrics, tracing, Sentry                      (Phase 9)
└── types/         AppInstance (Fastify + Zod type provider)
```

## API server vs workers

Both run from the same `dist/` build:

| Target   | Command                       | Role                                     |
| -------- | ----------------------------- | ---------------------------------------- |
| `api`    | `node dist/server/server.js`  | HTTP only — validate, authorize, enqueue |
| `worker` | `node dist/workers/worker.js` | downloads, FFmpeg, uploads, cleanup      |

The API performs **no** long-running media work (contract §9).

## Docker

Build context is the repository root:

```bash
docker build -f backend/Dockerfile --target api    -t fd-api .
docker build -f backend/Dockerfile --target worker -t fd-worker .
```

Multi-stage, non-root user `app`, `HEALTHCHECK` on `/health` (api) and process
presence (worker).

## Configuration

All environment variables are documented in the root `.env.example` and
validated at import time by `src/server/config.ts`. Invalid config throws
before the server binds a port.

## Health

- `GET /health` — liveness, returns `{ status, service, uptimeSec }`.
- `GET /ready` — readiness; infrastructure checks register themselves into
  `src/modules/health/readiness.ts` as Postgres (Phase 2), Redis/queue
  (Phase 3) and R2 (Phase 4) land. Neither endpoint exposes secrets or
  infrastructure details.
