# Security

Threat model focus: a hostile internet user submitting arbitrary URLs to a
service that performs network requests on their behalf.

## Implemented (Phases 1–4)

- **Argon2id** password hashing (`memoryCost`/`timeCost` from config, produced
  hashes asserted to be `$argon2id$`); weak or common passwords rejected
  before hashing.
- **Sessions**: random 32-byte token, only the SHA-256 digest is stored;
  `fd_session` is `HttpOnly`, `Secure` + `SameSite=None` in production
  (`Lax` in development), signed when `COOKIE_SECRET` is set. Sliding
  `last_seen_at`, revocation on logout, password change and reset.
- **CSRF**: double-submit — `fd_csrf` (readable by the frontend) is mirrored
  into `X-CSRF-Token` on every cookie-authenticated mutation; bearer clients
  are exempt because they carry no ambient credentials.
- **Single-use tokens** (verify e-mail, reset password): stored hashed, short
  TTL, consumed atomically; a password reset revokes every session.
- **Enumeration**: login answers identically for unknown user and wrong
  password (a dummy hash burns the same CPU); forgot-password always 200.
- **Rate limits**: Redis-backed global limiter plus a tighter per-route limit
  on auth endpoints (`RATE_LIMIT_*`, `AUTH_RATE_LIMIT_MAX`), failing open if
  Redis is unreachable so an outage never locks everyone out.
- **Turnstile**: server-side verification on registration and password
  recovery — enforced in production, fail-closed when the key is configured
  but verification cannot be completed, skipped in development.
- **Configuration**: Zod-validated environment; production refuses to boot
  without `SESSION_SECRET`/`COOKIE_SECRET` or with dev-default URLs.
- **Errors**: uniform error envelope (§46); stack traces and internals are
  never returned.
- **Containers**: multi-stage build, non-root runtime user, healthchecks.
- **SSRF guards** (Phase 4): `src/security/ssrf.ts` validates every URL the
  API and the worker touch — WHATWG parse, `http(s)` only, no userinfo, port
  allowlist, DNS resolution with _all_ answers checked against private /
  metadata / mapped-IPv6 ranges, blocked hostname suffixes, and a re-sweep of
  every URL an extractor reports (redirects, thumbnails, format URLs).
  `SSRF_ALLOW_PRIVATE=true` is a vitest-only escape hatch — production config
  validation rejects it outright.
- **Exec isolation** (Phase 4): `src/downloader/executors/proc.ts` spawns
  yt-dlp/ffmpeg/ffprobe with argument arrays only; container and format ids
  pass `^[a-z0-9]{2,5}$` allowlists before becoming arguments
  (`assertContainer`/`buildSelector`).
- **Media intake** (Phase 4): magic-byte sniff (`sniffContainer`), size cap
  (`MAX_FILE_SIZE_MB`) and an ffprobe stream check run _before_ anything is
  stored; SSRF/policy violations terminate the job as `policy_restricted`
  (never retried); signed result URLs carry their own expiry and the local
  dev file route HMAC-verifies each request.

## Layer 1 — edge (Cloudflare)

- DNS + TLS everywhere, HSTS in production.
- WAF managed rules, bot score, DDoS absorption.
- IP/ASN rate-limiting rules in front of the API.
- **Turnstile** only on high-risk actions: registration, password recovery,
  login after repeated failures, anonymous job creation past a threshold,
  report submission. Never on every interaction.

## Layer 2 — application

| Control       | Implementation                                                                                                                                           |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transport     | HTTPS only; cookies `Secure` + `HttpOnly`; `SameSite=None` cross-site (Vercel → VPS) with CSRF double-submit on mutations                                |
| CORS          | explicit origin allowlist from `CORS_ORIGINS`; credentials only for allowed origins; no `*`; `OPTIONS` preflight max-age 600                             |
| Headers       | `helmet` on the API (HSTS, `X-Content-Type-Options`, `Referrer-Policy`, frame deny); Next.js adds its own in `next.config.ts`                            |
| Validation    | Zod on every request body/query/param; output encoded; `bodyLimit` 1 MiB — media never posts through the API                                             |
| Errors        | uniform `{ error: { code, message, requestId } }`; 5xx never exposes internals; stack traces only in logs                                                |
| Rate limiting | per-IP global bucket today (in-memory); Redis-backed multi-layer limits (IP / user / API key / endpoint / concurrency) in Phase 2                        |
| Passwords     | Argon2id (`ARGON2_MEMORY_KIB`, `ARGON2_TIME_COST`); plaintext never stored or logged                                                                     |
| Sessions      | random tokens stored hashed; rotation on login and privilege change; short TTL; revocation list                                                          |
| API keys      | generated once, stored as HMAC hash with display prefix, revocable, scoped, expiring, quota-tracked                                                      |
| Admin         | separate `admin_users` table, TOTP MFA, short sessions, IP allowlist, immutable audit row per mutation                                                   |
| Secrets       | environment/secret manager only; `.env` gitignored; pino redaction list covers `password`, `token`, `authorization`, `cookie`, `url`, `apiKey`, `secret` |

## Layer 3 — SSRF protection (mandatory)

**Implemented**: `src/security/ssrf.ts` — `assertSafeUrl` (parse → allowlist →
DNS → resolved-IP range checks) and `assertSafeAnalysisUrls` (re-sweep of
extractor-reported URLs), unit-tested by `tests/unit/ssrf.test.ts`.

User URLs are never handed to a network client without validation:

1. Parse with the WHATWG URL parser. Allow `https` only (`http` per source
   policy if explicitly required). Reject userinfo, non-allowlisted ports,
   `.onion`.
2. Resolve DNS and reject if **any** answer falls in:
   - `127.0.0.0/8`, `0.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`,
     `192.168.0.0/16`, `169.254.0.0/16` (link-local / cloud metadata),
     `100.64.0.0/10` (CGNAT), `192.0.0.0/24`, multicast/reserved
   - IPv6 `::1/128`, `fc00::/7`, `fe80::/10`, `::ffff:`-mapped IPv4 equivalents
   - `169.254.169.254`, `metadata.google.internal`, internal DNS suffixes,
     `localhost`
3. Connect to the **resolved IP** with the `Host` header pinned (defeats DNS
   rebinding).
4. Re-run the full check after **every** redirect (max 5 hops).
5. Container egress restrictions as the final layer.
6. Validate the response: `Content-Type` **and** magic bytes before anything is
   stored or uploaded.

## Layer 4 — command execution

**Implemented**: `src/downloader/executors/proc.ts` (spawn, argument arrays,
timeout/abort, stderr tails) + allowlists in `ytdlp.ts`.

- `execFile`/`spawn` with **argument arrays only** — never string interpolation,
  never `exec(`…`)`.
- Format identifiers and codecs are validated against allowlisted patterns
  (`^[a-z0-9]{1,10}$`) before becoming an argument.
- Output paths are server-generated UUIDs; remote filenames are never trusted.
- Workers run as non-root with CPU/memory limits and a read-only root FS where
  practical.

## Layer 5 — media/file security

**Implemented**: `src/media/ffmpeg.ts` (`sniffContainer`, `probeMedia`,
`ensureContainer`) + `downloadPhase` in `src/workers/pipeline.ts`; signed
delivery via `src/storage/{local,r2}.ts` and the token-gated
`GET /api/v1/files/*` dev route.

- MIME type, extension, size and magic bytes are all checked.
- A file named `video.mp4` is not evidence of anything.
- Generated media is never executable content; served only via signed URLs with
  a TTL, never as permanent public objects.

## Layer 6 — abuse prevention

- Multi-layer rate limits with plan-derived quotas (config/DB, not hard-coded).
- Per-user / per-IP / per-source concurrency caps.
- Risk scoring over multiple signals (`abuse_events`): request rate, repeated
  failed jobs, repeated source failures, suspicious IPs, automated signups.
- No automatic bans from a single signal — configurable thresholds plus human
  review.
- Dependency scanning (Dependabot + `npm audit` + CodeQL), container scanning,
  least-privilege DB role (no DDL for the runtime user).

## Never

- Never log passwords, tokens, cookies, API keys or raw user URLs.
- Never return stack traces or worker output to clients.
- Never commit `.env` or production credentials.
- Never claim or implement DRM/auth/paywall circumvention.

## Verification

Unit tests cover the SSRF corpus (private ranges, IPv6, mapped addresses,
metadata endpoints, rebinding), authz isolation, CSRF, cookie flags, API-key
hashing, log redaction and production-config hardening. Integration tests
exercise the full auth lifecycle plus the security surface: helmet/CORS
headers, cookie flags, API-key hashing at rest, file-upload token handling,
rate-limit envelopes with correct typed 429s, and quota enforcement. E2E
asserts that no stack trace reaches the DOM (`error-surface.spec.ts`) and
runs axe-core WCAG 2.1 A/AA audits on public, signed-in and admin routes
(`a11y.spec.ts`). CI gates `npm audit --omit=dev` (zero production
vulnerabilities) alongside CodeQL and Dependabot. The only known advisories
are four dev-only `braces`/`micromatch`/`fast-glob` findings pulled in by
`@next/eslint-plugin-next`'s glob chain — the advisory range is `*`, no fixed
release exists upstream, and none of it ships to production; the separate
`esbuild` chain is pinned with a root `overrides` entry
(`@esbuild-kit/core-utils` → `esbuild ^0.25`).
