# Database

PostgreSQL 18 · Drizzle ORM + drizzle-kit · migrations committed as SQL under
`backend/src/database/migrations/`.

Conventions:

- Identifiers: `uuid` v7 (time-sortable) unless noted.
- Every table: `created_at timestamptz not null default now()`,
  `updated_at` trigger where mutable.
- Soft delete only on `users` and `download_jobs` — everywhere else rows are
  deleted by the cleanup worker per retention policy.
- Enums are PostgreSQL `enum`/check domains, never free text.

## Schema

### Auth

| Table                 | Key columns                                                                                                                                                            |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`               | `id`, `email citext unique`, `password_hash` (Argon2id), `status (pending\|active\|suspended\|deleted)`, `email_verified_at`, `plan_id`, `last_login_at`, `deleted_at` |
| `sessions`            | `id`, `user_id →`, `token_hash unique`, `ip inet`, `user_agent`, `mfa_ok`, `last_seen_at`, `expires_at`, `revoked_at`                                                  |
| `email_verifications` | `id`, `user_id →`, `token_hash unique`, `expires_at`, `consumed_at`                                                                                                    |
| `password_resets`     | `id`, `user_id →`, `token_hash unique`, `expires_at`, `consumed_at`                                                                                                    |

Tokens are stored **hashed**; the plaintext exists only in the emailed link.

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

| Table                | Key columns                                                                                                                                               |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api_keys`           | `id`, `user_id →`, `name`, `prefix`, `key_hash unique`, `scopes jsonb`, `rate_tier`, `expires_at`, `revoked_at`, `last_used_at`                           |
| `api_usage`          | `id`, `api_key_id →`, `bucket_start`, `requests`, `errors`, `bytes`                                                                                       |
| `reports`            | `id`, `type`, `reporter_email?`, `url`, `detail`, `status`, `assigned_admin_id`, `resolution`                                                             |
| `copyright_requests` | `id`, `kind (notice\|counter)`, `claimant`, `contact`, `work_url`, `evidence jsonb`, `status`, `actions jsonb`, `resolved_at`                             |
| `abuse_events`       | `id`, `subject_type`, `subject_id?`, `ip inet`, `signal`, `score smallint`, `action (log\|throttle\|challenge\|review)`, `reviewed_by`                    |
| `admin_users`        | `id`, `email unique`, `role (owner\|admin\|support\|viewer)`, `totp_secret_enc`, `ip_allowlist cidr[]`, `active`, `last_login_at`                         |
| `audit_logs`         | `id`, `admin_id →`, `action`, `resource`, `resource_id`, `ip`, `metadata jsonb`, `created_at` — **append-only** (no UPDATE/DELETE grant for the app role) |
| `system_settings`    | `key` (PK), `value jsonb`, `updated_by`, `updated_at`                                                                                                     |
| `feature_flags`      | `key` (PK), `enabled`, `rollout smallint`, `updated_at`                                                                                                   |
| `idempotency_keys`   | `key` (PK), `scope`, `request_hash`, `status`, `response jsonb`, `job_id?`, `expires_at`                                                                  |

## Indexes (query-pattern driven)

```
users                          (email)
download_jobs                  (user_id, created_at desc)
download_jobs                  (status, priority desc, created_at)
download_jobs                  (anon_key) partial
download_jobs                  (expires_at) partial where deleted_at is null
download_jobs                  (idempotency_key) partial
download_jobs                  (url_hash)
download_attempts              (job_id, attempt_no)
files                          (job_id)
files                          (expires_at) partial where purged_at is null
api_keys                       (user_id)
api_keys                       (prefix)
usage_records                  (user_id, day desc)
audit_logs                     (created_at desc)
audit_logs                     (resource, resource_id)
sessions                       (token_hash)
sessions                       (expires_at)
```

No blanket indexing — every index must correspond to a real query.

## Constraints

`CHECK (progress between 0 and 100)` · `CHECK (retry_count <= max_retries)` ·
`CHECK (url_hash is not null)` · FKs with explicit `ON DELETE` ·
`unique (user_id, day)` on `usage_records`.

## Retention

| Data                  | Policy                                                    |
| --------------------- | --------------------------------------------------------- |
| R2 objects            | `expires_at` → cleanup worker deletes, then rows redacted |
| job URL hash/redacted | purged at job expiry                                      |
| `media_metadata.raw`  | trimmed after 7 days                                      |
| sessions / tokens     | TTL job                                                   |
| logs                  | per `LOG_RETENTION_DAYS`, structured logs only            |
| audit_logs            | retained (append-only, compliance)                        |
