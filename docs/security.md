# Security

Threat model focus: a hostile internet user submitting arbitrary URLs to a
service that performs network requests on their behalf.

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

- `execFile`/`spawn` with **argument arrays only** — never string interpolation,
  never `exec(`…`)`.
- Format identifiers and codecs are validated against allowlisted patterns
  (`^[a-z0-9]{1,10}$`) before becoming an argument.
- Output paths are server-generated UUIDs; remote filenames are never trusted.
- Workers run as non-root with CPU/memory limits and a read-only root FS where
  practical.

## Layer 5 — media/file security

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
hashing and log redaction. Integration tests exercise the full auth lifecycle.
E2E asserts that no stack trace reaches the DOM.
