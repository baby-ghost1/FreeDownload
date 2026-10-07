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
| `npm run test:coverage`             | same suites with coverage thresholds |
| `npm run test:e2e`                  | Playwright e2e (desktop + mobile)    |
| `npm run load`                      | k6 load smoke against `:4000`        |
| `npm run load:site`                 | k6 load test against the Vercel site |
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
npm run docker:up        # Postgres 18 + Redis 8 (needed by db + integration)
npm run db:migrate       # apply committed migrations
npm test                 # unit + integration
npm run test:coverage    # same suites, enforced coverage thresholds
npm run typecheck        # types
npm run test:e2e         # Playwright: happy path, axe a11y (WCAG 2.1 A/AA),
                         # error/stack-trace surfaces (API route-mocked,
                         # starts `next dev` itself — no backend needed)
npm run load             # k6 smoke: catalog, auth, jobs, API-key quota
                         # against a running stack on :4000 (needs k6)
npm run load:site        # k6 frontend ramp against the deployed Vercel site
TOTAL=500 CONCURRENCY=25 npm run load:site:node
                         # Node frontend ramp (OpenSSL fingerprint — the
                         # deployed Vercel site challenges k6's Go handshake)
```

### Load testing (k6)

`npm run load` runs the four scenarios in [`load/`](load/) at smoke scale
(1 VU, paced under the default rate limits) against `BASE_URL`
(default `http://localhost:4000`). Every script fails its thresholds on 5xx,
check regressions or unexpected 429s.

Full runs target **staging only** and need the per-IP limits raised first,
otherwise the scripts measure the limiter instead of the app:

| Setting                         | Default | Staging load run |
| ------------------------------- | ------- | ---------------- |
| `RATE_LIMIT_MAX`                | 300/min | `100000`         |
| `AUTH_RATE_LIMIT_MAX`           | 10/min  | `10000`          |
| `DOWNLOAD_RATE_LIMIT_MAX`       | 60/min  | `10000`          |
| free plan `apiPerHour` (DB row) | 60/h    | raise for soaks  |

```bash
k6 run --vus 25 --duration 2m -e BASE_URL=https://api.staging.example load/catalog.js
```

`POST /downloads/analyze` is deliberately not scripted (each call performs a
real yt-dlp extraction against the target site).

### Production load test — `freedownloadapp.vercel.app`

Two generators are checked in against the **deployed frontend** (the seven public
routes, weighted like real traffic) rather than the API:

- [`load/site.js`](load/site.js) — k6, driven by `-e VUS=` / `-e ITERATIONS=` /
  `-e RPS=` / `-e TLS_VERSION=`, one JSON summary per stage via `SUMMARY_FILE`.
- [`load/site-node.mjs`](load/site-node.mjs) — dependency-free Node, driven by
  `TOTAL` / `CONCURRENCY` / `RPS` / `SUMMARY_FILE`.

```bash
k6 run -e VUS=25 -e ITERATIONS=2000 -e STAGE=3-medium-25vu \
       -e SUMMARY_FILE=/tmp/stage3.json load/site.js

TOTAL=2500 CONCURRENCY=75 STAGE=3-medium SUMMARY_FILE=/tmp/s3.json \
  npm run load:site:node
```

#### Why the production run uses Node

k6 and Node hit the same URL from the same box and get different answers. Once
this IP had accumulated load-test traffic, **Go's TLS handshake was challenged
while OpenSSL's was not** — measured back to back within the same minute:

| Client                    | Result                 |
| ------------------------- | ---------------------- |
| k6 (Go), TLS 1.3          | 0 × `200`, 20 × `403`  |
| k6 (Go) forced to TLS 1.2 | 20 × `200` (transient) |
| Node (`undici` / OpenSSL) | 20 × `200`             |
| curl (OpenSSL/schannel)   | 20 × `200`             |

The block follows the **TLS fingerprint (JA3/JA4)**, not the request count: the
same `load/site.js` at 1 VU / 20 requests returned `403` from k6 while curl
returned `200` for the same URLs seconds later. `-e TLS_VERSION=tls1.2` buys
headroom but does not hold. `load/site.js` still works well against the
self-hosted API (`npm run load`), where nothing fingerprints you.

#### Run of 2026-10-07 — 10,000 requests, 100% `200`

Five stages, one Windows box, one public IP, no think time (stages 1–3 in one
pass, 4–5 after a mitigation cooldown):

| Stage      | Concurrency | Requests | req/s | p50    | p90    | p95    | p99    | max     | avg    |
| ---------- | ----------- | -------- | ----- | ------ | ------ | ------ | ------ | ------- | ------ |
| 1 baseline | 1           | 1,000    | 11.5  | 71 ms  | 89 ms  | 100 ms | 168 ms | 9,715ms | 87 ms  |
| 2 low      | 20          | 1,500    | 220.8 | 80 ms  | 107 ms | 121 ms | 237 ms | 545 ms  | 87 ms  |
| 3 medium   | 75          | 2,500    | 419.4 | 150 ms | 231 ms | 336 ms | 479 ms | 540 ms  | 172 ms |
| 4 high     | 40          | 2,500    | 288.2 | 118 ms | 170 ms | 185 ms | 449 ms | 719 ms  | 130 ms |
| 5 peak     | 60          | 2,500    | 291.5 | 168 ms | 295 ms | 367 ms | 670 ms | 742 ms  | 194 ms |

Response mix across all 10,000 requests:

| Outcome                   | Count  | Share   |
| ------------------------- | ------ | ------- |
| `200 OK`                  | 10,000 | 100.00% |
| `403` — Vercel mitigation | 0      | 0.00%   |
| `429 Too Many Requests`   | 0      | 0.00%   |
| `5xx`                     | 0      | 0.00%   |
| Transport error / timeout | 0      | 0.00%   |

Totals: **117.3 s** of active test time, **85.3 req/s** overall, **351.6 MiB**
downloaded, **100%** `X-Vercel-Cache` `HIT`/`PRERENDER` on every stage.

#### What it shows

- **The frontend is genuinely fast.** At 1 concurrent visitor: p50 **71 ms**,
  p95 **100 ms**, avg 87 ms — and it stays flat at 20 visitors (p50 80 ms,
  p95 121 ms). Even at the 419 req/s peak, p50 is **150 ms** and p95 **336 ms**.
  The 9.7 s max in stage 1 is a single cold-connection/edge-fetch outlier; every
  other stage maxes under 750 ms.
- **Nothing broke under load.** 10,000 requests produced **zero 5xx, zero 429,
  zero transport errors, zero `403`**. No origin error, no rate-limit envelope
  breach, no CDN miss storm — and `X-Vercel-Cache` was `HIT`/`PRERENDER` for
  **100%** of responses, so the edge never had to revalidate.
- **The ceiling is the single IP, not the site.** Sustained **419 req/s**
  (concurrency 75) completed cleanly, then Vercel's system mitigation tripped
  within seconds of the stage ending — a curl health gate went **0/8 → 403**.
  Stages 4–5 were re-run at concurrency 40/60 (~290 req/s), comfortably under
  the trigger, and stayed at 100% `200`.
- **It latches, then clears on its own.** Recovery took **11 minutes** this
  time (0/6 at 11:29:27, 6/6 at 11:30:18) — shorter than the ~40 minutes seen
  in the first run, and it cleared while paced traffic was still probing.
- **It is scoped to the source, not the site.** While this box got `403`, the
  same URL fetched from a different egress path returned `200` with full page
  content. Real visitors were never affected.
- **Bot Protection is off and stays irrelevant.** The `403` responses carry an
  `X-Vercel-Mitigated: challenge` header — that comes from Vercel's
  _platform-wide_ DDoS mitigation, which runs on every plan with no
  configuration and evaluates **before** the WAF and Bot Management layers — the
  Bot Protection toggle cannot turn it off. On Hobby there is no System Bypass
  Rule and no way to pause system mitigations (both are Pro/Enterprise). Confirm
  which rule fired under **Firewall → Events**.

#### Honest caveat

This is a **single-machine, single-IP** test of the edge + static pages. It says
nothing about the Fastify API (`npm run load` targets that separately on
`:4000`). Stage 1 is the only single-visitor number; stages 2–5 are concurrency
sweeps, not a duration soak.

#### To get a real capacity curve

1. On Hobby the practical lever is **pacing**: stay under ~400 req/s from any
   one IP (concurrency ≤ 60 here) and you get clean numbers.
2. On Pro+, add a System Bypass for the tester IP
   (`vercel firewall system-bypass add`) and re-run the same five stages
   unchanged to find the real origin/edge ceiling.
3. Re-run from 2–3 geographies if you want an SLA number — one IP will always
   be the bottleneck before the site is.

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

Phases 1–8 complete:

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
- **8 — quality:** coverage-gated suites (`npm run test:coverage`, thresholds
  enforced in both workspaces), a security integration suite (headers, CORS
  allowlist, cookie flags, rate-limit envelopes, production-config hardening,
  log redaction), axe-core WCAG 2.1 A/AA e2e audits across public,
  signed-in and admin routes (with the contrast/semantics fixes they
  surfaced), a stack-trace-leak e2e, k6 load scenarios (`npm run load`), a
  production `npm audit` gate (root `overrides` pins the transitive
  `esbuild`), and GitHub Actions workflows (CI, Dependabot, CodeQL).

Subsequent phases follow the roadmap in `docs/architecture.md`.
