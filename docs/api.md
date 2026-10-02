# API — `/api/v1`

REST, JSON in/out. Every route declares a Zod schema (request + response);
OpenAPI export of those schemas lands with the downloads API.

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

Implemented ✅: `GET /me` · `PATCH /me` · `POST /me/password` (CSRF + session;
changing the password revokes every _other_ session).

Planned: `DELETE /me` · `GET /me/history` · `GET /me/usage` ·
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

| Group                     | State        |
| ------------------------- | ------------ |
| `/health`, `/ready`       | ✅ Phase 1   |
| auth + `/me`              | ✅ Phase 2   |
| schema, Redis rate limits | ✅ Phase 2   |
| downloads, catalog, queue | ⏳ Phase 3–4 |
| billing, API keys, admin  | ⏳ Phase 6–7 |
