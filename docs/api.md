# API — `/api/v1`

REST, JSON in/out. OpenAPI generation from the Zod route schemas lands in
Phase 2 (`docs/openapi.json`), with a public reference site later.

## Conventions

| Topic              | Rule                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------- |
| Base path          | `/api/v1`                                                                                                     |
| Auth (first party) | session cookie — `HttpOnly`, `Secure`, `SameSite=None` cross-site, `SameSite=Lax` same-site                   |
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
| GET    | `/health` | none | liveness — process is up                            |
| GET    | `/ready`  | none | readiness — dependency checks, `503` when not ready |

### Auth

| Method | Path                               | Notes                                                |
| ------ | ---------------------------------- | ---------------------------------------------------- |
| POST   | `/api/v1/auth/register`            | Turnstile required                                   |
| POST   | `/api/v1/auth/login`               | Turnstile after N failures, throttled per IP + email |
| POST   | `/api/v1/auth/logout`              | revokes the session                                  |
| POST   | `/api/v1/auth/verify-email`        | single-use, short-lived token                        |
| POST   | `/api/v1/auth/resend-verification` | rate limited                                         |
| POST   | `/api/v1/auth/forgot-password`     | Turnstile; never reveals account existence           |
| POST   | `/api/v1/auth/reset-password`      | single-use token, invalidates sessions               |
| GET    | `/api/v1/auth/session`             | current session payload                              |

### Downloads

| Method | Path                           | Notes                                           |
| ------ | ------------------------------ | ----------------------------------------------- |
| POST   | `/api/v1/downloads/analyze`    | `{ url }` → media info + formats, cached ≤5 min |
| POST   | `/api/v1/downloads`            | creates a job; honors `Idempotency-Key`         |
| GET    | `/api/v1/downloads/:id`        | job status + progress                           |
| GET    | `/api/v1/downloads/:id/result` | fresh short-lived signed URL once `COMPLETED`   |
| POST   | `/api/v1/downloads/:id/cancel` | only before `COMPLETED`                         |

### Catalog

`GET /api/v1/sources` · `GET /api/v1/formats` · `GET /api/v1/config/public`
(limits, flags, plans, Turnstile site key) — all cacheable with explicit TTLs.

### Account

`GET /me` · `PATCH /me` · `DELETE /me` · `GET /me/history` · `GET /me/usage` ·
`GET /me/sessions` · `DELETE /me/sessions/:id`

### Billing

`GET /plans` · `POST /subscriptions` · `GET /subscriptions/current` ·
`POST /subscriptions/cancel` · `POST /payments/checkout` ·
`POST /payments/webhook` (signature verified, idempotent)

### API keys

`POST /api-keys` (raw value returned exactly once) · `GET /api-keys` ·
`DELETE /api-keys/:id` · `GET /api-keys/:id/usage`

### Admin

Separate auth guard + MFA + audit entry on every mutation:

`POST /admin/auth/login` · `GET /admin/overview` · `GET /admin/jobs` ·
`POST /admin/jobs/:id/retry|cancel` · `GET /admin/workers` ·
`GET|PATCH /admin/sources/:id` · `GET /admin/users` ·
`PATCH /admin/users/:id` · `GET|PATCH /admin/settings` ·
`GET|PATCH /admin/flags` · `GET /admin/revenue` ·
`GET|PATCH /admin/copyright/:id` · `GET /admin/audit-logs`

### Misc

`POST /api/v1/reports` (Turnstile) · `GET /api/v1/legal/:doc`

## Status

| Group               | State              |
| ------------------- | ------------------ |
| `/health`, `/ready` | ✅ Phase 1         |
| everything else     | planned Phases 2–7 |
