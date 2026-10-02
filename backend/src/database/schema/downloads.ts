import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { createdAt, id, inet, updatedAt } from './helpers.js';
import { users } from './auth.js';

export const downloadSources = pgTable(
  'download_sources',
  {
    id: id(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    adapterKey: text('adapter_key').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    // active | maintenance | restricted | disabled — admin-controlled, no
    // redeploy needed to take a source out of rotation (contract §12).
    mode: text('mode', { enum: ['active', 'maintenance', 'restricted', 'disabled'] })
      .notNull()
      .default('active'),
    allowedFormats: jsonb('allowed_formats')
      .notNull()
      .$defaultFn(() => []),
    maxFileSizeMb: integer('max_file_size_mb'),
    requiresAuth: boolean('requires_auth').notNull().default(false),
    allowedFeatures: jsonb('allowed_features')
      .notNull()
      .$defaultFn(() => []),
    priority: smallint('priority').notNull().default(100),
    healthStatus: text('health_status', {
      enum: ['unknown', 'healthy', 'degraded', 'down'],
    })
      .notNull()
      .default('unknown'),
    lastHealthAt: timestamp('last_health_at', { withTimezone: true }),
    policyVersion: integer('policy_version').notNull().default(1),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('download_sources_slug_unique').on(t.slug),
    index('download_sources_enabled_idx').on(t.enabled),
  ],
);

export const downloadJobs = pgTable(
  'download_jobs',
  {
    id: id(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    anonKey: text('anon_key'),
    sourceId: uuid('source_id').references(() => downloadSources.id, {
      onDelete: 'set null',
    }),
    // Privacy: keep a hash for dedupe/lookup and a redacted copy for support;
    // the raw URL is never retained past expiry (contract §51).
    urlHash: text('url_hash').notNull(),
    urlRedacted: text('url_redacted'),
    // Raw URL — workers need the full query (`?v=…`) to actually fetch, and
    // retries must survive Redis flushes. Lives in PG only until the job
    // expires; the cleanup sweep nulls it (contract §51).
    url: text('url'),
    status: text('status', {
      enum: [
        'created',
        'validating',
        'queued',
        'analyzing',
        'ready',
        'processing',
        'uploading',
        'completed',
        'failed',
        'retrying',
        'cancelled',
        'expired',
        'policy_restricted',
        'dead_letter',
      ],
    })
      .notNull()
      .default('created'),
    priority: smallint('priority').notNull().default(50),
    requestedFormat: text('requested_format'),
    targetContainer: text('target_container'),
    idempotencyKey: text('idempotency_key'),
    progress: smallint('progress').notNull().default(0),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    retryCount: integer('retry_count').notNull().default(0),
    maxRetries: integer('max_retries').notNull().default(3),
    leaseToken: text('lease_token'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }),
    workerId: text('worker_id'),
    turnstileOk: boolean('turnstile_ok').notNull().default(false),
    ip: inet('ip'),
    analyzedAt: timestamp('analyzed_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('download_jobs_user_id_created_at_idx').on(t.userId, t.createdAt),
    index('download_jobs_status_priority_created_at_idx').on(t.status, t.priority, t.createdAt),
    index('download_jobs_url_hash_idx').on(t.urlHash),
    // Partial: only the rows the cleanup worker and queue actually read.
    index('download_jobs_anon_key_idx')
      .on(t.anonKey)
      .where(sql`${t.anonKey} is not null`),
    index('download_jobs_expires_at_idx')
      .on(t.expiresAt)
      .where(sql`${t.deletedAt} is null`),
    uniqueIndex('download_jobs_idempotency_key_unique')
      .on(t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null`),
    check('download_jobs_progress_range', sql`${t.progress} between 0 and 100`),
    check('download_jobs_retry_range', sql`${t.retryCount} <= ${t.maxRetries}`),
  ],
);

export const downloadAttempts = pgTable(
  'download_attempts',
  {
    id: id(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => downloadJobs.id, { onDelete: 'cascade' }),
    attemptNo: integer('attempt_no').notNull(),
    workerId: text('worker_id'),
    status: text('status', { enum: ['running', 'succeeded', 'failed', 'timeout'] }).notNull(),
    errorCode: text('error_code'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    durationMs: integer('duration_ms'),
    logRef: text('log_ref'),
  },
  (t) => [
    uniqueIndex('download_attempts_job_id_attempt_no_unique').on(t.jobId, t.attemptNo),
    index('download_attempts_job_id_idx').on(t.jobId),
  ],
);

export const mediaMetadata = pgTable(
  'media_metadata',
  {
    id: id(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => downloadJobs.id, { onDelete: 'cascade' }),
    externalId: text('external_id'),
    title: text('title'),
    durationSec: integer('duration_sec'),
    thumbnailUrl: text('thumbnail_url'),
    uploader: text('uploader'),
    pageUrl: text('page_url'),
    descriptionTrunc: text('description_trunc'),
    raw: jsonb('raw'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('media_metadata_job_id_unique').on(t.jobId)],
);

export const mediaFormats = pgTable(
  'media_formats',
  {
    id: id(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => downloadJobs.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    kind: text('kind', { enum: ['video', 'audio', 'other'] })
      .notNull()
      .default('video'),
    container: text('container').notNull(),
    width: integer('width'),
    height: integer('height'),
    fps: integer('fps'),
    vcodec: text('vcodec'),
    acodec: text('acodec'),
    bitrateKbps: integer('bitrate_kbps'),
    filesizeBytes: integer('filesize_bytes'),
    isDefault: boolean('is_default').notNull().default(false),
    sortOrder: smallint('sort_order').notNull().default(0),
    extKey: text('ext_key'),
  },
  (t) => [index('media_formats_job_id_idx').on(t.jobId)],
);

export const files = pgTable(
  'files',
  {
    id: id(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => downloadJobs.id, { onDelete: 'cascade' }),
    objectKey: text('object_key').notNull(),
    kind: text('kind', { enum: ['media', 'thumbnail', 'audio'] })
      .notNull()
      .default('media'),
    sizeBytes: integer('size_bytes'),
    mimeType: text('mime_type'),
    checksumSha256: text('checksum_sha256'),
    container: text('container'),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    purgedAt: timestamp('purged_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('files_object_key_unique').on(t.objectKey),
    index('files_job_id_idx').on(t.jobId),
    index('files_expires_at_idx')
      .on(t.expiresAt)
      .where(sql`${t.purgedAt} is null`),
  ],
);

export type DownloadJob = typeof downloadJobs.$inferSelect;
export type NewDownloadJob = typeof downloadJobs.$inferInsert;
export type DownloadSource = typeof downloadSources.$inferSelect;
