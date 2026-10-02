# Database

PostgreSQL 18 · Drizzle ORM + drizzle-kit · migrations committed as SQL under
`backend/src/database/migrations/`.

Workflow:

```bash
npm run db:generate -w @freedownload/backend  # emit SQL from schema changes
npm run db:migrate   -w @freedownload/backend  # apply pending migrations
npm run db:seed      -w @freedownload/backend  # idempotent reference data
```

Migrations are reviewed like code, applied in a transaction with a journal in
`__drizzle_migrations`, and copied into the runtime image so a deploy step can
run them (`node dist/database/migrate.js`).

Conventions:

- Identifiers: `uuid` v7 generated **in the application** (time-sortable, no
  DB extension needed).
- Every table: `created_at timestamptz not null default now()`; `updated_at`
  is maintained by the application layer (`$onUpdate`), not a DB trigger.
- Emails are stored lowercased in `text` — the `citext` extension is not used,
  so the schema works on stock Postgres images.
- Soft delete only on `users` and `download_jobs` — everywhere else rows are
  deleted by the cleanup worker per retention policy.
- Enums are `text` columns validated by TypeScript/Zod (`text(col, { enum })`).
  Values are still constrained by application code and covered by tests; a
  later migration can promote hot tables to native enums if needed.

## Schema

### Auth

| Table                 | Key columns                                                                                                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `users`               | `id`, `email text unique` (lowercased), `password_hash` (Argon2id), `status (pending\|active\|suspended\|deleted)`, `display_name`, `locale`, `email_verified_at`, `last_login_at`, `deleted_at` |
| `sessions`            | `id`, `user_id →`, `token_hash unique`, `csrf_token`, `ip inet`, `user_agent`, `mfa_ok`, `last_seen_at`, `expires_at`, `revoked_at`                                                              |
| `email_verifications` | `id`, `user_id →`, `token_hash unique`, `expires_at`, `consumed_at`                                                                                                                              |
| `password_resets`     | `id`, `user_id →`, `token_hash unique`, `expires_at`, `consumed_at`                                                                                                                              |

Tokens are stored **hashed**; the plaintext exists only in the emailed link.
`users.plan_id` does not exist — the current plan comes from
`subscriptions` (Phase 7).

### Downloads

| Table               | Key columns                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `download_sources`  | `id`, `slug unique`, `adapter_key`, `enabled`, `mode (active\|maintenance\|restricted\|disabled)`, `allowed_formats jsonb`, `max_file_size_mb`, `requires_auth`, `allowed_features jsonb`, `priority`, `health_status`, `last_health_at`, `policy_version`                                                                                                                    |
| `download_jobs`     | `id`, `user_id?`, `anon_key?`, `source_id →`, `url_hash` (sha256), `url_redacted`, `status`, `priority smallint`, `requested_format`, `idempotency_key?`, `progress smallint`, `error_code`, `retry_count`, `max_retries`, `lease_token`, `lease_expires_at`, `heartbeat_at`, `worker_id`, `ip inet`, `analyzed_at`, `started_at`, `completed_at`, `expires_at`, `deleted_at` |
| `download_attempts` | `id`, `job_id →`, `attempt_no`, `worker_id`, `status`, `error_code`, `started_at`, `finished_at`, `duration_ms`, `log_ref`                                                                                                                                                                                                                                                    |
| `media_metadata`    | `id`, `job_id → unique`, `title`, `duration_sec`, `thumbnail_url`, `uploader`, `page_url`, `raw jsonb`, `fetched_at`                                                                                                                                                                                                                                                          |
| `media_formats`     | `id`, `job_id →`, `label`, `container`, `width`, `height`, `fps`, `vcodec`, `acodec`, `bitrate_kbps`, `filesize_bytes`, `is_default`, `sort_order`, `ext_key`                                                                                                                                                                                                                 |
| `files`             | `id`, `job_id →`, `object_key unique`, `kind`, `size_bytes`, `mime_type`, `checksum_sha256`, `container`, `expires_at`, `purged_at`                                                                                                                                                                                                                                           |

`download_jobs` stores a **hash plus a redacted copy** of the URL — the raw URL
is dropped at expiry (privacy §51).

### Billing

| Table           | Key columns                                                                                                                                          |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plans`         | `id`, `code unique (free\|pro\|business)`, `tier`, `price_cents`, `currency`, `interval`, `limits jsonb`, `features jsonb`, `active`, `sort_order`   |
| `subscriptions` | `id`, `user_id →`, `plan_id →`, `provider`, `provider_ref unique`, `status`, `current_period_start/end`, `cancel_at_period_end`                      |
| `payments`      | `id`, `user_id →`, `provider`, `provider_ref unique`, `amount_cents`, `currency`, `status`, `kind (charge\|refund\|invoice)`, `paid_at`, `raw jsonb` |
| `usage_records` | `id`, `user_id →`, `day`, `jobs_created`, `jobs_completed`, `bytes_served`, `api_calls`, `unique(user_id, day)`                                      |

Limits are **database/configuration driven** — never hard-coded in application
logic (contract §25, §71).

### API, trust, admin, system

| Table                | Key columns                                                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api_keys`           | `id`, `user_id →`, `name`, `prefix`, `key_hash unique`, `scopes jsonb`, `rate_tier`, `expires_at`, `revoked_at`, `last_used_at`                         |
| `api_usage`          | `id`, `api_key_id →`, `bucket_start`, `requests`, `errors`, `bytes`                                                                                     |
| `reports`            | `id`, `type`, `reporter_email?`, `target_url`, `detail`, `status`, `assigned_admin_id`, `resolution`                                                    |
| `copyright_requests` | `id`, `kind (notice\|counter)`, `claimant`, `contact`, `work_url`, `evidence jsonb`, `status`, `actions jsonb`, `resolved_at`                           |
| `abuse_events`       | `id`, `subject_type`, `subject_id?`, `ip inet`, `signal`, `score smallint`, `action (log\|throttle\|challenge\|review\|blocked)`, `reviewed_by`         |
| `admin_users`        | `id`, `email unique`, `role (owner\|admin\|support\|viewer)`, `totp_secret_enc`, `ip_allowlist jsonb`, `active`, `last_login_at`                        |
| `audit_logs`         | `id`, `admin_id`, `action`, `resource`, `resource_id`, `ip`, `metadata jsonb`, `created_at` — **append-only** (no UPDATE/DELETE grant for the app role) |
| `system_settings`    | `key` (PK), `value jsonb`, `updated_by`, `updated_at`                                                                                                   |
| `feature_flags`      | `key` (PK), `enabled`, `rollout smallint`, `updated_at`                                                                                                 |
| `idempotency_keys`   | `key` (PK), `scope`, `request_hash`, `status`, `response jsonb`, `job_id?`, `expires_at`                                                                |

## Indexes (query-pattern driven)

```
users                          (email) unique
sessions                       (token_hash) unique · (user_id) · (expires_at)
email_verifications            (token_hash) unique
password_resets                (token_hash) unique
download_sources               (slug) unique
download_jobs                  (user_id, created_at)
download_jobs                  (status, priority, created_at)
download_jobs                  (url_hash)
download_jobs                  (anon_key)          partial where anon_key is not null
download_jobs                  (expires_at)        partial where deleted_at is null
download_jobs                  (idempotency_key)   partial unique
download_attempts              (job_id, attempt_no) unique
media_metadata                 (job_id) unique
media_formats                  (job_id)
files                          (object_key) unique · (job_id)
files                          (expires_at)        partial where purged_at is null
plans                          (code) unique · subscriptions (provider_ref) unique
usage_records                  (user_id, day) unique
api_keys                       (key_hash) unique · (user_id) · (prefix)
reports                        (status, created_at)
copyright_requests             (status, created_at)
abuse_events                   (subject_type, subject_id)
audit_logs                     (created_at) · (resource, resource_id) · (admin_id)
idempotency_keys               (expires_at)
```

No blanket indexing — every index must correspond to a real query. Ordering
columns are ascending in the generated SQL; add `desc` only when a query
proves it (the planner usually gets it right either way).

## Constraints

`CHECK (progress between 0 and 100)` · `CHECK (retry_count <= max_retries)` ·
FKs with explicit `ON DELETE` · `unique (user_id, day)` on `usage_records`.
`NOT NULL` plus application-side validation covers `url_hash`.

## Retention

| Data                  | Policy                                                    |
| --------------------- | --------------------------------------------------------- |
| R2 objects            | `expires_at` → cleanup worker deletes, then rows redacted |
| job URL hash/redacted | purged at job expiry                                      |
| `media_metadata.raw`  | trimmed after 7 days                                      |
| sessions / tokens     | TTL job                                                   |
| logs                  | per `LOG_RETENTION_DAYS`, structured logs only            |
| audit_logs            | retained (append-only, compliance)                        |
