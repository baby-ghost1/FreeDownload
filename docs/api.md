# API - `/api/v1`

REST, JSON in/out. Every route declares a Zod schema (request + response);
OpenAPI export of those schemas lands with the downloads API.

## Conventions

| Topic              | Rule                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------- |
| Base path          | `/api/v1`                                                                                                     |
| Auth (first party) | session cookie - `HttpOnly`, `Secure`, `SameSite=None` cross-site, `SameSite=Lax` same-site                   |
| Auth (API clients) | `Authorization: Bearer <api_key>`                                                                             |
| CSRF               | double-submit token on all cookie-authenticated mutations                                                     |
| Request ID         | `X-Request-Id` echoed on every response; accepted from the client only if it matches `^[A-Za-z0-9._-]{8,64}$` |
| Idempotency        | `Idempotency-Key` header on `POST /downloads`; 24h window, Redis + `idempotency_keys`                         |
| Pagination         | cursor-based: `?cursor=<opaque>&limit=50` → `{ data: [...], nextCursor: string \| null }`                     |
| Rate limits        | `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`, `Retry-After` on 429                             |
| Validation         | Zod on every body/query/param; failures → `VALIDATION_ERROR`                                                  |
| Truncation         | never. `description` fields are truncated server-side before storage.                                         |

## Error format

```json
{
  "error": {
    "code": "UNSUPPORTED_SOURCE",
    "message": "This source is currently not supported.",
    "requestId": "ed76f62d-e4a3-4c38-bb33-96ee47d5fc6c"
  }
}
```

Codes: `VALIDATION_ERROR` 400 · `UNAUTHORIZED` 401 · `FORBIDDEN` 403 ·
`NOT_FOUND` 404 · `CONFLICT` 409 · `PAYLOAD_TOO_LARGE` 413 ·
`UNSUPPORTED_SOURCE` 422 · `RATE_LIMITED` 429 · `INTERNAL_ERROR` 500 ·
`SERVICE_UNAVAILABLE` 503.

Stack traces, worker output and internal hostnames are never returned.

## Endpoints

### Health

| Method | Path      | Auth | Notes                                               |
| ------ | --------- | ---- | --------------------------------------------------- |
| GET    | `/health` | none | liveness - process is up                            |
| GET    | `/ready`  | none | readiness - dependency checks, `503` when not ready |

### Auth ✅ (Phase 2)

| Method | Path                           | Auth         | Notes                                                     |
| ------ | ------------------------------ | ------------ | --------------------------------------------------------- |
| POST   | `/api/v1/auth/register`        | none         | 201 + session cookies + `csrfToken`; Turnstile when keyed |
| POST   | `/api/v1/auth/login`           | none         | 200 + rotated session; per-IP rate limit                  |
| POST   | `/api/v1/auth/logout`          | session+CSRF | revokes the session, clears cookies                       |
| POST   | `/api/v1/auth/verify-email`    | none         | single-use token → `status = active`                      |
| POST   | `/api/v1/auth/forgot-password` | none         | always 200; Turnstile when keyed                          |
| POST   | `/api/v1/auth/reset-password`  | none         | single-use token; revokes **every** session               |

Session payload (`register`/`login`):

```json
{
  "user": {
    "id": "01a0fc19-903c-72fb-8d1c-96415edf73b3",
    "email": "ada@example.com",
    "displayName": "Ada",
    "status": "pending",
    "emailVerifiedAt": null,
    "createdAt": "2026-10-02T10:12:08.933Z"
  },
  "csrfToken": "RkB8M5wRjSu70URoAZ0uTR6R1NLvk_mE"
}
```

Cookies: `fd_session` (HttpOnly, `Secure`+`SameSite=None` in production,
`Lax` in development, signed when `COOKIE_SECRET` is set) and `fd_csrf`
(readable by the frontend, echoed back as `X-CSRF-Token` on mutations).

Planned: `POST /auth/resend-verification` · `GET /auth/session`.

### Downloads ✅ (Phases 3–4)

Identity: a session cookie **or** an `X-Anon-Key` header (client-generated,
`[A-Za-z0-9_-]{8,64}`) that owns anonymous jobs **or** an API key as
`Authorization: Bearer fd_live_…` (Phase 7 - metered, see below). Anonymous
creation/analyze also carries `X-Turnstile-Token` once Turnstile is keyed;
Bearer requests skip the challenge.

| Method | Path                           | Auth                 | Notes                                                                          |
| ------ | ------------------------------ | -------------------- | ------------------------------------------------------------------------------ |
| POST   | `/api/v1/downloads`            | session+CSRF \| anon | 201 + job; honors `Idempotency-Key` (replay → 201 + `Idempotent-Replay: true`) |
| POST   | `/api/v1/downloads/analyze`    | session+CSRF \| anon | synchronous metadata + format list, Redis-cached (`ANALYZE_CACHE_TTL_SEC`)     |
| GET    | `/api/v1/downloads`            | session \| anon      | `?limit=1..100` (default 20) + `cursor`, newest first with `nextCursor` - only the caller's jobs |
| GET    | `/api/v1/downloads/:id`        | session \| anon      | status + progress; a foreign job answers `404`, never `403`                    |
| POST   | `/api/v1/downloads/:id/start`  | session+CSRF \| anon | `ready` → `processing` with the chosen `format`/`container`; else `409`        |
| GET    | `/api/v1/downloads/:id/result` | session \| anon      | signed URL once `completed` (409 before that, 404 if purged)                   |
| POST   | `/api/v1/downloads/:id/cancel` | session+CSRF \| anon | only before `COMPLETED`; repeating it → `409`                                  |

Request body: `{ "url": "https://.", "format"?: "mp4", "container"?: "mp4" }`.
`format` matches `^[A-Za-z0-9][A-Za-z0-9.#_-]{0,63}$`, `container`
`^[a-z0-9]{2,5}$` - anything else is `400` before a job row exists. Only
`http(s)` URLs are accepted; credentials in the URL are rejected and the
stored URL is redacted (path kept, query/fragment dropped).

Creation enforces the plan quota **before** a job row exists: the daily job
count (UTC day via `usage_records`) and the number of concurrent active jobs
(`queued`…`retrying`) each answer `429 RATE_LIMITED` with
`details.scope = daily|concurrent`. `POST /:id/start` additionally enforces
the plan's `maxFileSizeMb` against the picked format - over the cap is
`403 POLICY_RESTRICTED` with `details.maxFileSizeMb`. Anonymous, free and
paid jobs also differ in queue `priority` (60 → tier-based 50…10).

**Analyze → start flow:** creating _without_ a format runs analysis and parks
the job at `ready` (`errorCode: AWAITING_FORMAT` on the finished attempt).
`POST /:id/start` then hands the picked format to the worker, which resumes
without re-analyzing. Creating _with_ a format runs the whole pipeline in one
go. The worker takes over `ready`/`processing` rows that hold no lease, so the
start hand-off never depends on queue state.

`analyze` enforces SSRF + source policy _before_ spawning yt-dlp and re-sweeps
every URL the extractor reports (thumbnail, format URLs) before returning or
caching anything. Private/internal targets answer `403 POLICY_RESTRICTED`;
unreachable sources answer `503`.

`result` returns `{ url, expiresAt, sizeBytes, container, mimeType }` where
`url` is a short-lived signed link (R2 presigned GET in production, HMAC
`GET /api/v1/files/...` for the local dev driver) - media bytes never travel
through the API (contract invariant 5).

Job payload - no raw URL, hash, IP or lease ever crosses the wire:

```json
{
  "id": "01a0fc73-13a1-7d58-9974-48b3e537fd69",
  "status": "queued",
  "progress": 0,
  "url": "https://example.com/watch",
  "title": "Example video title",
  "requestedFormat": null,
  "targetContainer": null,
  "errorCode": null,
  "errorMessage": null,
  "retryCount": 0,
  "createdAt": "2026-10-02T11:41:03.512Z",
  "updatedAt": "2026-10-02T11:41:03.540Z",
  "expiresAt": "2026-10-03T11:41:03.512Z",
  "completedAt": null
}
```

`status` walks `created → validating → queued → analyzing → ready →
processing → uploading → completed` (→ `expired` after retention), with
`failed → retrying` loops and terminal `cancelled` / `dead_letter` /
`policy_restricted`. The API never does media work itself: creation only
enqueues (contract invariant 1).

### Catalog ✅ (Phase 4)

| Method | Path                    | Auth | Notes                                                                         |
| ------ | ----------------------- | ---- | ----------------------------------------------------------------------------- |
| GET    | `/api/v1/sources`       | none | enabled sources + health `mode` (`active`/`maintenance`/…)                    |
| GET    | `/api/v1/formats`       | none | supported output formats for `body.format`                                    |
| GET    | `/api/v1/config/public` | none | limits, flags, plans, navbar (`system_settings.navbar_config`, fail-open visible), Turnstile site key; `Cache-Control: public, max-age=60` |

`GET /api/v1/files/*` serves bytes **only** when `STORAGE_DRIVER=local`
(development) and requires the HMAC token minted with the signed URL - it 404s
in production, where browsers stream straight from R2.

### Account

Implemented: `GET /me` · `PATCH /me` · `POST /me/password` (CSRF + session;
changing the password revokes every _other_ session) · `GET /me/usage?days=N`
(daily job counts, 1–90 days) · `GET /me/sessions` (active sessions, flags the
current one) · `DELETE /me/sessions/:id` (own sessions only; revoking the
current one also clears the cookies).

Planned: `DELETE /me` · `GET /me/history`

### Billing ✅ (Phase 7)

Implemented: `GET /plans` (active plans for pricing) ·
`GET /subscriptions/current` (session; missing/canceled subscriptions fall
back to the free plan) · `POST /subscriptions` (session + CSRF; switches to
`free` only - paid plans start a checkout) · `POST /subscriptions/cancel`
(free plans cancel immediately, provider subscriptions at period end; 409
`CONFLICT` when nothing is active) · `POST /payments/checkout` (503
`SERVICE_UNAVAILABLE` while `PAYMENT_PROVIDER=none`) ·
`POST /payments/webhook` (raw-body `stripe-signature` HMAC-SHA256
verification with a 5-minute tolerance; idempotent - subscriptions upsert on
`provider_ref`, payments `ON CONFLICT DO NOTHING`, replayed events change
nothing).

### API keys ✅ (Phase 7)

Implemented: `POST /api-keys` (session + CSRF; `fd_live_…` raw value
returned exactly once, stored as SHA-256) · `GET /api-keys` ·
`DELETE /api-keys/:id` (revoke - a foreign key answers 404) ·
`GET /api-keys/:id/usage` (hourly buckets + totals).

`Authorization: Bearer fd_live_…` authenticates the download routes; cookie
CSRF does not apply to it. Every request is metered into `api_usage`
(UTC-hour buckets) and gated by the plan's `apiPerHour` limit (429
`details.scope = api-hourly`); invalid, expired or revoked keys answer 401
before the route runs.

### Admin

Separate `fd_admin` cookie + TOTP MFA + audit entry on every mutation.
Everything except `login` / `mfa/setup` / `mfa/complete` / `logout` / `me`
requires an MFA-verified session (403 `details.mfaRequired` otherwise); any
mutation additionally requires role `owner` or `admin` (403 for
`support`/`viewer`) and the double-submit CSRF header. Reads are
cursor-paginated (`?cursor=&limit=`). Every mutation appends an immutable
`audit_logs` row (a migration trigger rejects UPDATE/DELETE).

Implemented: `POST /admin/auth/login` (rate-limited; optional `code`) ·
`POST /admin/auth/logout` · `GET /admin/auth/me` ·
`POST /admin/auth/mfa/setup` · `POST /admin/auth/mfa/complete` ·
`GET /admin/overview` · `GET /admin/jobs` · `GET /admin/jobs/:id` ·
`POST /admin/jobs/:id/retry|cancel` (retry requeues
`failed|dead_letter|policy_restricted|retrying`) ·
`GET /admin/sources` · `GET /admin/sources/:id` ·
`PATCH /admin/sources/:id` (enabled/mode/formats - invalidates the policy
cache, so the change is live without a redeploy) ·
`GET /admin/users` · `PATCH /admin/users/:id` (suspend kills the user's
sessions on their next request) · `GET /admin/audit-logs` ·
`GET /admin/flags` · `PATCH /admin/flags/:key` ·
`GET /admin/settings` · `PATCH /admin/settings/:key`

Planned: `GET /admin/workers` · `GET /admin/revenue` ·
`GET|PATCH /admin/copyright/:id`

### Misc

`POST /api/v1/reports` (Turnstile) · `GET /api/v1/legal/:doc`

## Status

| Group                     | State      |
| ------------------------- | ---------- |
| `/health`, `/ready`       | ✅ Phase 1 |
| auth + `/me`              | ✅ Phase 2 |
| schema, Redis rate limits | ✅ Phase 2 |
| downloads CRUD, queue     | ✅ Phase 3 |
| analyze, result, catalog  | ✅ Phase 4 |
| account + admin console   | ✅ Phase 6 |
| billing, API keys         | ✅ Phase 7 |
