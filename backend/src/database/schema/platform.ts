import {
  boolean,
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

import { createdAt, id, inet, updatedAt } from './helpers.js';
import { users } from './auth.js';

export const apiKeys = pgTable(
  'api_keys',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    // Display prefix (e.g. fd_live_a1b2) so users can identify the key.
    prefix: text('prefix').notNull(),
    // HMAC of the secret — the raw key is shown exactly once at creation.
    keyHash: text('key_hash').notNull(),
    scopes: jsonb('scopes')
      .notNull()
      .$defaultFn(() => []),
    rateTier: text('rate_tier').notNull().default('free'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('api_keys_key_hash_unique').on(t.keyHash),
    index('api_keys_user_id_idx').on(t.userId),
    index('api_keys_prefix_idx').on(t.prefix),
  ],
);

export const apiUsage = pgTable(
  'api_usage',
  {
    id: id(),
    apiKeyId: uuid('api_key_id')
      .notNull()
      .references(() => apiKeys.id, { onDelete: 'cascade' }),
    bucketStart: timestamp('bucket_start', { withTimezone: true }).notNull(),
    requests: integer('requests').notNull().default(0),
    errors: integer('errors').notNull().default(0),
    bytes: integer('bytes').notNull().default(0),
  },
  (t) => [uniqueIndex('api_usage_api_key_id_bucket_start_unique').on(t.apiKeyId, t.bucketStart)],
);

export const reports = pgTable(
  'reports',
  {
    id: id(),
    type: text('type', {
      enum: ['broken_source', 'abuse', 'copyright', 'other'],
    }).notNull(),
    reporterEmail: text('reporter_email'),
    targetUrl: text('target_url'),
    detail: text('detail').notNull(),
    status: text('status', {
      enum: ['open', 'reviewing', 'resolved', 'rejected'],
    })
      .notNull()
      .default('open'),
    assignedAdminId: text('assigned_admin_id'),
    resolution: text('resolution'),
    ip: inet('ip'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('reports_status_created_at_idx').on(t.status, t.createdAt)],
);

export const copyrightRequests = pgTable(
  'copyright_requests',
  {
    id: id(),
    kind: text('kind', { enum: ['notice', 'counter'] }).notNull(),
    claimant: text('claimant').notNull(),
    contact: text('contact').notNull(),
    workUrl: text('work_url').notNull(),
    evidence: jsonb('evidence'),
    status: text('status', {
      enum: ['received', 'under_review', 'action_taken', 'rejected', 'withdrawn'],
    })
      .notNull()
      .default('received'),
    actions: jsonb('actions')
      .notNull()
      .$defaultFn(() => []),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('copyright_requests_status_created_at_idx').on(t.status, t.createdAt)],
);

export const abuseEvents = pgTable(
  'abuse_events',
  {
    id: id(),
    subjectType: text('subject_type', { enum: ['user', 'ip', 'anonymous'] }).notNull(),
    subjectId: text('subject_id'),
    ip: inet('ip'),
    signal: text('signal').notNull(),
    score: smallint('score').notNull().default(1),
    action: text('action', {
      enum: ['log', 'throttle', 'challenge', 'review', 'blocked'],
    })
      .notNull()
      .default('log'),
    reviewedBy: text('reviewed_by'),
    metadata: jsonb('metadata'),
    createdAt: createdAt(),
  },
  (t) => [index('abuse_events_subject_idx').on(t.subjectType, t.subjectId)],
);

export const adminUsers = pgTable(
  'admin_users',
  {
    id: id(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: text('role', { enum: ['owner', 'admin', 'support', 'viewer'] })
      .notNull()
      .default('viewer'),
    // Argon2id of the TOTP secret — MFA is required for admin sessions (§75).
    totpSecretEnc: text('totp_secret_enc'),
    ipAllowlist: jsonb('ip_allowlist')
      .notNull()
      .$defaultFn(() => []),
    active: boolean('active').notNull().default(true),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('admin_users_email_unique').on(t.email)],
);

/**
 * Admin sessions live apart from user sessions (§75): separate cookie, short
 * TTL and `mfa_ok` gating — MFA is verified at login before this flips true.
 */
export const adminSessions = pgTable(
  'admin_sessions',
  {
    id: id(),
    adminId: uuid('admin_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    csrfToken: text('csrf_token').notNull(),
    mfaOk: boolean('mfa_ok').notNull().default(false),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('admin_sessions_token_hash_unique').on(t.tokenHash),
    index('admin_sessions_admin_id_idx').on(t.adminId),
    index('admin_sessions_expires_at_idx').on(t.expiresAt),
  ],
);

/**
 * Append-only audit trail. The runtime database role has no UPDATE/DELETE
 * grant on this table (see migrations).
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    adminId: text('admin_id'),
    action: text('action').notNull(),
    resource: text('resource'),
    resourceId: text('resource_id'),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    metadata: jsonb('metadata'),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_logs_created_at_idx').on(t.createdAt),
    index('audit_logs_resource_resource_id_idx').on(t.resource, t.resourceId),
    index('audit_logs_admin_id_idx').on(t.adminId),
  ],
);

export const systemSettings = pgTable('system_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedBy: text('updated_by'),
  updatedAt: updatedAt(),
});

export const featureFlags = pgTable('feature_flags', {
  key: text('key').primaryKey(),
  enabled: boolean('enabled').notNull().default(false),
  rollout: smallint('rollout').notNull().default(0),
  updatedAt: updatedAt(),
});

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    key: text('key').primaryKey(),
    scope: text('scope').notNull(),
    requestHash: text('request_hash').notNull(),
    status: text('status', { enum: ['in_progress', 'completed'] }).notNull(),
    response: jsonb('response'),
    jobId: uuid('job_id'),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('idempotency_keys_expires_at_idx').on(t.expiresAt)],
);

export type ApiKey = typeof apiKeys.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
export type AdminUser = typeof adminUsers.$inferSelect;
export type AdminSession = typeof adminSessions.$inferSelect;
