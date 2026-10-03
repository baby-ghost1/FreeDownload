# FreeDownload

Production-grade **media download and processing platform**. Paste a link →
analyze → choose a format → download via a temporary signed URL.

> **Compliance note.** The platform is for media users own or have permission to
> download. It must never be used to bypass DRM, authentication, paywalls,
> access controls, or platform security mechanisms. Every source is
> policy-gated and can be disabled by an admin without a redeploy.

## Architecture

```
Cloudflare (DNS/TLS/CDN/WAF/Turnstile)
   ├── Frontend  — Next.js 16 on Vercel
   └── Backend   — Fastify REST API (/api/v1) on VPS
                     ├── PostgreSQL 18  (source of truth)
                     ├── Redis 8        (cache, rate limits, BullMQ)
                     └── Worker fleet   (download · media · cleanup)
                            ├── yt-dlp / FFmpeg (arg-array exec, SSRF-validated)
                            └── Cloudflare R2 → short-lived signed URLs
```

Invariants:

- The API **never** runs downloads or transcodes synchronously — it only
  validates, authorizes and enqueues.
- Workers are stateless, lease-based and horizontally scalable.
- PostgreSQL is the only source of truth; Redis is disposable.
- Every user URL passes SSRF validation on entry **and** after each redirect.

Full detail: [`docs/architecture.md`](docs/architecture.md).

## Repository layout

```
├── frontend/         Next.js 16 (deployed to Vercel)
├── backend/          Fastify API + workers (Docker, VPS)
├── infrastructure/   IaC and deployment manifests (later phases)
├── docs/             architecture, api, database, security, deployment
├── .github/          CI pipeline + Dependabot
├── docker-compose.yml  local PostgreSQL 18 + Redis 8
└── package.json      npm workspaces + Turborepo
```

Frontend and backend are **logically separate workspaces** communicating only
through the documented API contract. No runtime code is shared.

## Prerequisites

| Tool             | Version              |
| ---------------- | -------------------- |
| Node.js          | 24 LTS (`>=24 <25`)  |
| npm              | 11.x                 |
| Docker + Compose | for PostgreSQL/Redis |
| Git              | 2.x                  |

## Quick start

```bash
npm install              # install all workspaces
cp .env.example .env     # local configuration
npm run docker:up        # start postgres:18 + redis:8
npm run dev              # turbo: frontend :3000, backend :4000
```

- Frontend: <http://localhost:3000>
- API health: <http://localhost:4000/health> · readiness: `/ready`

## Commands

| Command                             | Description                          |
| ----------------------------------- | ------------------------------------ |
| `npm run dev`                       | run frontend + backend in watch mode |
| `npm run build`                     | build both workspaces                |
| `npm run lint`                      | ESLint (zero warnings allowed)       |
| `npm run typecheck`                 | strict TypeScript across workspaces  |
| `npm test`                          | Vitest unit suites                   |
| `npm run test:e2e`                  | Playwright e2e (desktop + mobile)    |
| `npm run format` / `format:check`   | Prettier                             |
| `npm run docker:up` / `docker:down` | local data services                  |
| `npm run db:generate`               | emit SQL migration from schema       |
| `npm run db:migrate`                | apply pending migrations             |
| `npm run db:seed`                   | idempotent reference data            |

## Environment

All variables are documented in [`.env.example`](.env.example) and validated
at boot by `backend/src/server/config.ts`. `.env` is gitignored — production
secrets are injected by the platform, never committed.

## Testing

```bash
npm run docker:up      # Postgres 18 + Redis 8 (needed by db + integration)
npm run db:migrate     # apply committed migrations
npm test               # unit + integration
npm run typecheck      # types
npm run test:e2e       # Playwright happy path + mobile/dark (API route-mocked,
                       # starts `next dev` itself — no backend needed)
# load (Phase 8):         k6 against staging only, mocked adapters
```

## Docker

```bash
docker compose config --quiet                                  # validate
docker build -f backend/Dockerfile --target api     -t fd-api .     # API
docker build -f backend/Dockerfile --target worker   -t fd-worker .  # worker
docker build -f frontend/Dockerfile --target runner  -t fd-web .     # frontend
```

Images are multi-stage, run as non-root and declare healthchecks.

## Deployment

- **Frontend** → Vercel (project root `frontend/`), env vars from `.env.example`.
- **Backend API / workers** → VPS containers, one image with `api` / `worker`
  targets, behind Cloudflare.
- **Data** → managed PostgreSQL, managed Redis, Cloudflare R2 with lifecycle rules.

Migration path to AWS ECS/Fargate stays open: containers are 12-factor
(stateless, env-configured, healthchecked). See `docs/deployment.md` (Phase 9).

## Documentation

| Doc                                          | Contents                                 |
| -------------------------------------------- | ---------------------------------------- |
| [docs/architecture.md](docs/architecture.md) | system design, decisions, job lifecycle  |
| [docs/api.md](docs/api.md)                   | REST contract, conventions, error format |
| [docs/database.md](docs/database.md)         | schema, indexes, retention               |
| [docs/security.md](docs/security.md)         | SSRF, auth, secrets, abuse controls      |
| [docs/contributing.md](docs/contributing.md) | workflow, quality gates                  |

## Status

Phases 1–7 complete:

- **1 — foundation:** workspaces, strict TypeScript, lint/format, health
  endpoints, docker-compose, CI.
- **2 — core:** Drizzle schema + migrations + seed, auth (register/login/
  sessions/CSRF/Turnstile), `/me`, Redis rate limits, docs.
- **3 — queue:** BullMQ queues with pinned backoff (`1,4,16,64,256s`), job
  state machine + idempotent create, lease-based stateless download/cleanup
  workers, crash recovery + dead-letter, `POST/GET /downloads`,
  `POST /downloads/:id/cancel`.
- **4 — media engine:** yt-dlp SourceAdapter (argument-array exec, progress,
  format selection), SSRF guards (DNS + private/metadata range checks, re-sweep
  of extractor-reported URLs), FFmpeg remux/transcode + ffprobe verification,
  local/R2 storage with signed URLs, real pipeline runner
  (analyze → ready → processing → uploading → completed),
  `POST /downloads/analyze`, `POST /downloads/:id/start`,
  `GET /downloads/:id/result`, catalog endpoints (`sources`/`formats`/
  `config/public`), and cleanup now purges storage objects, nulls raw URLs and
  trims `media_metadata.raw`.
- **5 — frontend:** design tokens (light/dark), UI kit, site shell (header,
  footer, pre-paint theme toggle), landing page with pricing, the
  analyze → format → progress → signed-link download flow, history list, auth
  UI (login/register/forgot/reset/verify), static legal pages, and Playwright
  e2e — happy path + dark/mobile across desktop and Pixel 7 projects, API
  fully route-mocked (`npm run test:e2e`, no backend required).
- **6 — dashboard + admin:** `/account` (profile, 30-day usage, session list
  with revoke), `/admin` console (TOTP MFA gate, overview, jobs cancel/retry,
  source enable/disable, user suspend/activate, audit log, feature flags),
  admin auth with separate `fd_admin` cookie + role gate (owner/admin mutate),
  cursor-paginated admin reads, and append-only `audit_logs` (migration
  trigger). Source toggles invalidate the policy cache — disabling a source
  takes effect immediately, no redeploy.
- **7 — monetization:** DB-driven plans (`free`/`pro`/`business`) and a limits
  engine (daily jobs, concurrent jobs, plan file-size cap, priority tiers,
  API-key hourly quota — env values only as fallbacks), Stripe behind a
  `PaymentProvider` interface (null provider returns 503; raw-body HMAC
  webhook signature verification, idempotent event application), metered API
  keys (`fd_live_…` shown once, SHA-256 stored, Bearer auth, `api_usage`
  hourly buckets), hashed-rollout feature flags evaluated per subject, a
  flag-gated ad slot, and the `/account` Plan & billing + API keys UI.

Subsequent phases follow the roadmap in `docs/architecture.md`.
