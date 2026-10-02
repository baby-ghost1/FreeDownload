# Architecture

FreeDownload is a media download and processing platform: users submit a media
URL, the system analyzes it, the user picks a format, and a worker produces a
temporary signed download link.

**Scope constraint.** Sources are policy-gated and intended for media the user
owns or is permitted to download. The system must not bypass DRM,
authentication, paywalls, access controls or platform security mechanisms.

## System diagram

```
                    USERS
                      │
                      ▼
             ┌──────────────────┐
             │ Cloudflare       │ DNS · TLS · CDN · WAF · DDoS
             │                  │ rate limiting · Turnstile (high-risk)
             └────────┬─────────┘
                      │
        ┌─────────────┴─────────────┐
        ▼                           ▼
┌──────────────────┐      ┌─────────────────────────┐
│ FRONTEND         │      │ BACKEND API (stateless) │
│ Next.js 16       │HTTPS │ Fastify 5 · /api/v1     │
│ on Vercel        │─────▶│ auth · validate · authz  │
│                  │      │ rate-limit · idempotency │
└────────┬─────────┘      └──────┬──────────┬───────┘
         │                       │          │
         │                ┌──────┘          └──────┐
         │                ▼                        ▼
         │         ┌──────────────┐         ┌──────────────┐
         │         │ PostgreSQL 18│         │   Redis 8    │
         │         │ source of    │         │ cache · RL   │
         │         │ truth        │         │ locks · dedup│
         │         └──────┬───────┘         │ BullMQ       │
         │                │                 └──────┬───────┘
         │                │                        │
         │                │                 ┌──────▼───────────────┐
         │                │                 │ WORKER FLEET         │
         │                │                 │ download / media /   │
         │                │                 │ cleanup (stateless)  │
         │                │                 └──┬─────────┬─────────┘
         │                │                    │         │
         │                │            ┌───────┘         └────────┐
         │                │            ▼                          ▼
         │                │     ┌─────────────┐            ┌────────────┐
         │                │     │ Source       │            │ FFmpeg     │
         │                │     │ adapters     │            │ remux-first│
         │                │     │ (policy      │            │ transcode  │
         │                │     │  gated)      │            │ only if    │
         │                │     └──────┬──────┘            │ needed     │
         │                │            │                   └─────┬──────┘
         │                │            └────────┬────────────────┘
         │                │                     ▼
         │                │              yt-dlp / HTTP
         │                │              (arg-array exec,
         │                │               SSRF-validated)
         │                │                      │
         │                └─────── metadata ◀────┤
         │                                        ▼
         │                               Cloudflare R2
         │                               + signed URL (TTL)
         ▼                                       │
    SIGNED URL ◀─────────────────────────────────┘
```

## Non-negotiable invariants

1. The API never runs downloads or transcodes synchronously — it validates,
   authorizes and enqueues only.
2. Workers are stateless, lease-based and horizontally scalable.
3. PostgreSQL is the only source of truth; Redis is disposable and rebuildable.
4. Every user URL passes SSRF validation on entry **and** after every redirect.
5. Media bytes never pass through Vercel or the API — the browser fetches
   directly from R2 with a short-lived signed URL.
6. All source-specific logic lives behind the `SourceAdapter` interface.

## Job lifecycle

```
CREATED → VALIDATING → QUEUED → ANALYZING → READY → PROCESSING → UPLOADING
        → COMPLETED → EXPIRED → (purged)

VALIDATING ──▶ POLICY_RESTRICTED | FAILED
ANALYZING/PROCESSING/UPLOADING ──▶ FAILED ──▶ RETRYING ──▶ (back to work)
retries exhausted ──▶ DEAD_LETTER
any pre-COMPLETED ──▶ CANCELLED
```

- Transitions use optimistic concurrency: `UPDATE … WHERE status = expected`;
  a zero-row update aborts the writer.
- Workers hold a lease (`lease_token` + `lease_expires_at`) refreshed by
  heartbeat. A crashed worker's lease expires and the job re-queues.
- Retries: exponential backoff with jitter (1s, 4s, 16s, 64s, 256s), capped by
  `QUEUE_RETRY_LIMIT`.
- Terminal states are immutable; every transition is logged and recorded in
  `download_attempts`.

## Download engine

```
Downloader
├── SourceDetector      which adapter can handle this URL
├── SourcePolicy        enabled/disabled/maintenance/restricted, limits
├── MetadataExtractor   title, duration, thumbnail, uploader
├── FormatResolver      container/quality/audio options
├── DownloaderAdapter   per-source implementation (SourceAdapter interface)
└── DownloadExecutor    runs the job, enforces timeouts and cleanup
```

Adapters are isolated: a failing source degrades only its own jobs, never the
API process. Sources can be disabled by an admin at runtime (cached policy,
≈30s propagation) with no redeploy.

## Worker model

| Worker          | Bound by | Responsibility                                       |
| --------------- | -------- | ---------------------------------------------------- |
| download-worker | network  | analyze + download, `WORKER_CONCURRENCY` (default 4) |
| media-worker    | CPU      | FFmpeg remux/transcode + R2 upload (default 2)       |
| cleanup-worker  | schedule | expiry, R2 purge, URL redaction, source health       |

Fairness: priority is derived server-side from the plan tier
(enterprise > pro > authenticated free > anonymous); clients cannot set
priority. Per-user, per-IP and per-source semaphores prevent hoarding.

## Key decisions

| Area              | Decision                                                                                   | Rationale                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Package manager   | **npm 11 + workspaces**                                                                    | user requirement; turbo detects npm from the lockfile                                                                |
| TypeScript        | **6.0.3** (not 7.0.2)                                                                      | `typescript-eslint@8.71` peer caps at `<6.1.0` — documented compatibility exception                                  |
| API framework     | Fastify 5 + `fastify-type-provider-zod`                                                    | schema-first routes, Zod validation, fast                                                                            |
| ORM               | Drizzle ORM + drizzle-kit                                                                  | TS-first schema, reviewable SQL migrations committed to the repo                                                     |
| Frontend          | Next.js 16, React 19, Tailwind v4                                                          | current stable; Tailwind v4 is CSS-first, so there is **no `tailwind.config.ts`** — tokens live in `app/globals.css` |
| Lint              | ESLint 10 + `typescript-eslint` + `@next/eslint-plugin-next` + `eslint-plugin-react-hooks` | `eslint-config-next` transitively requires plugins that only support ESLint ≤9; a11y is enforced with axe in E2E     |
| Hosting           | Frontend on Vercel, API/workers on VPS containers                                          | cost-conscious, matches the Docker contract                                                                          |
| Cross-origin auth | direct API calls, strict CORS allowlist, `SameSite=None; Secure` cookies + CSRF            | avoids per-request Vercel proxy cost on status polling                                                               |
| Analytics         | PostHog                                                                                    | funnels, retention, feature flags; server-side flags still live in PostgreSQL                                        |
| Payments          | Stripe behind a `PaymentProvider` interface                                                | swappable provider; `NullProvider` when disabled                                                                     |

## Roadmap

| Phase               | Scope                                                                                  | Exit criteria                                 |
| ------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------- |
| 1 Foundation        | workspaces, strict TS, lint/format, health, compose, CI                                | lint/typecheck/test/build green, images build |
| 2 Backend core      | Drizzle schema + migrations, auth (Argon2id), sessions, rate limiting, Zod validation  | integration tests pass                        |
| 3 Job system        | BullMQ, state machine, idempotency, download worker, DLQ, cleanup                      | crash-recovery test passes                    |
| 4 Media engine      | adapter interface, policy engine, generic yt-dlp adapter, FFmpeg, R2 signed URLs, SSRF | authorized E2E download in staging            |
| 5 Frontend          | design system, marketing routes, download flow, result page, auth UI                   | Playwright happy path + mobile/dark pass      |
| 6 Dashboard + admin | history/usage/settings, admin auth + MFA, source toggles, audit log                    | source disabled at runtime, no redeploy       |
| 7 Monetization      | plans, limits engine, Stripe, API keys, ad slots, flags                                | free/pro limits enforced                      |
| 8 Quality           | full unit/integration/security suites, E2E, k6, a11y audit                             | no open P1/P2 findings                        |
| 9 Production        | Cloudflare, R2 lifecycle, monitoring, backups, runbooks                                | DoD checklist fully checked                   |

## Failure behaviour

| Failure           | Behaviour                                                                                             |
| ----------------- | ----------------------------------------------------------------------------------------------------- |
| worker crash      | lease expires → requeue, `attempt++`, orphan temp files GC'd                                          |
| Redis down        | API 503 + `Retry-After` on job creation; workers pause; PG intact                                     |
| PostgreSQL down   | `/ready` fails, API 503; workers hold; no data loss                                                   |
| R2 down           | upload retried with backoff, intermediate artifact reused — no re-encode                              |
| source broken     | per-source `SourceError` → source health degraded → jobs fail gracefully; admin can disable instantly |
| job timeout       | process group killed → `FAILED` → `RETRYING`                                                          |
| retries exhausted | `DEAD_LETTER` + admin alert                                                                           |
