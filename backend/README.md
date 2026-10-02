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
npm test              # unit + integration (integration needs docker:up)
```

Database (needs `npm run docker:up`):

```bash
npm run db:generate   # emit SQL migration from schema changes
npm run db:migrate    # apply pending migrations
npm run db:seed       # idempotent reference data (plans, generic source)
```

Workspace-scoped: `npm run <script> --workspace @freedownload/backend`.

## Layout

```
src/
├── server/        app.ts (Fastify factory, error envelope, CORS, helmet,
│                  session hook, Redis rate limit, /api/v1 registration)
│                  config.ts (Zod env schema — boot fails on invalid config)
│                  server.ts (entrypoint, graceful shutdown)
├── modules/       route/service modules
│   ├── health/    liveness, readiness + registered dependency probes
│   ├── auth/      register / login / logout / tokens + session management
│   ├── me/        profile read/update
│   └── mailer/    Mailer interface (console transport in dev)
├── security/      passwords (Argon2id), tokens, CSRF, Turnstile
├── database/      Drizzle schema, migrations, seed, pg pool        ✅ Phase 2
├── redis/         ioredis client + ping                            ✅ Phase 2
├── http/          shared response schemas (error envelope)
├── errors/        AppError + the §46 error code table
├── logging/       pino JSON logger with redaction list
├── queue/         BullMQ queues, producers, consumers        (Phase 3)
├── workers/       download / media / cleanup workers         (Phase 3)
├── downloader/    SourceAdapter, detectors, policies, executors (Phase 4)
├── media/         FFmpeg runner, metadata, formats              (Phase 4)
├── storage/       R2 client, signed URLs, lifecycle             (Phase 4)
├── observability/ metrics, tracing, Sentry                      (Phase 9)
└── types/         AppInstance (Fastify + Zod type provider)

tests/
├── unit/          hermetic tests (no infrastructure)
└── integration/   PostgreSQL + Redis; skipped when docker:up hasn't run
                   (always executed in CI, which provisions the services)
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
- `GET /ready` — readiness; probes register into
  `src/modules/health/readiness.ts`. Postgres and Redis are registered
  (Phase 2); queue (Phase 3) and storage (Phase 4) follow. Under Vitest the
  probes report `skipped` unless `READINESS_LIVE=1`. Neither endpoint
  exposes secrets or infrastructure details.
