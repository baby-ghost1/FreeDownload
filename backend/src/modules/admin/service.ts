import { and, count, desc, eq, gte, lt, type SQL } from 'drizzle-orm';

import { AppError } from '../../errors/app-error.js';
import type { Database } from '../../database/client.js';
import {
  auditLogs,
  downloadJobs,
  downloadSources,
  featureFlags,
  systemSettings,
  users,
  type DownloadJob,
} from '../../database/schema/index.js';
import { invalidateSourcePolicyCache } from '../../downloader/policy.js';
import { invalidateSettingsCache } from '../../limits/engine.js';
import { NAVBAR_SETTING_KEY, assertNavbarValue } from '../catalog/navbar.js';
import { enqueueDownloadJob } from '../../queue/queues.js';
import { transitionJob } from '../downloads/state-machine.js';

function defined(filters: Array<SQL | undefined>): SQL[] {
  return filters.filter((f): f is SQL => f !== undefined);
}

/**
 * Admin read/write queries (§76-§79). Every mutation in routes.ts is wrapped
 * with an audit entry; cache-sensitive writes also invalidate in-process
 * state here so a disable takes effect without a redeploy.
 */

/** Cursor = base64url(ISO createdAt) - keyset pagination over `created_at`. */
export function encodeCursor(createdAt: Date): string {
  return Buffer.from(createdAt.toISOString()).toString('base64url');
}

export function decodeCursor(raw: string): Date {
  try {
    const parsed = new Date(Buffer.from(raw, 'base64url').toString('utf8'));
    if (Number.isNaN(parsed.getTime())) throw new Error('bad date');
    return parsed;
  } catch {
    throw new AppError('VALIDATION_ERROR', 'Invalid cursor.');
  }
}

export interface Paged<T> {
  data: T[];
  nextCursor: string | null;
}

const DAY_MS = 86_400_000;

export interface Overview {
  jobs: { total: number; last24h: number; byStatus: Record<string, number> };
  users: { total: number; active: number; suspended: number };
  sources: { total: number; enabled: number };
  auditsLast24h: number;
}

export async function getOverview(db: Database): Promise<Overview> {
  const since = new Date(Date.now() - DAY_MS);

  const [jobsByStatus, jobsLast24h, usersByStatus, sourcesByEnabled, audits] = await Promise.all([
    db
      .select({ status: downloadJobs.status, n: count() })
      .from(downloadJobs)
      .groupBy(downloadJobs.status),
    db.select({ n: count() }).from(downloadJobs).where(gte(downloadJobs.createdAt, since)),
    db.select({ status: users.status, n: count() }).from(users).groupBy(users.status),
    db
      .select({ enabled: downloadSources.enabled, n: count() })
      .from(downloadSources)
      .groupBy(downloadSources.enabled),
    db.select({ n: count() }).from(auditLogs).where(gte(auditLogs.createdAt, since)),
  ]);

  const byStatus: Record<string, number> = {};
  let jobsTotal = 0;
  for (const row of jobsByStatus) {
    byStatus[row.status] = row.n;
    jobsTotal += row.n;
  }

  const userCounts = { total: 0, active: 0, suspended: 0 };
  for (const row of usersByStatus) {
    userCounts.total += row.n;
    if (row.status === 'active') userCounts.active = row.n;
    if (row.status === 'suspended') userCounts.suspended = row.n;
  }

  let sourcesTotal = 0;
  let sourcesEnabled = 0;
  for (const row of sourcesByEnabled) {
    sourcesTotal += row.n;
    if (row.enabled) sourcesEnabled = row.n;
  }

  return {
    jobs: { total: jobsTotal, last24h: jobsLast24h[0]?.n ?? 0, byStatus },
    users: userCounts,
    sources: { total: sourcesTotal, enabled: sourcesEnabled },
    auditsLast24h: audits[0]?.n ?? 0,
  };
}

export interface AdminJobView {
  id: string;
  status: DownloadJob['status'];
  progress: number;
  url: string;
  requestedFormat: string | null;
  targetContainer: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  retryCount: number;
  userId: string | null;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date | null;
  completedAt: Date | null;
}

function toJobView(job: DownloadJob): AdminJobView {
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    // Raw URL while the row is young; the retention sweep nulls it, and the
    // redacted copy keeps the list readable afterwards.
    url: job.url ?? job.urlRedacted ?? '',
    requestedFormat: job.requestedFormat,
    targetContainer: job.targetContainer,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
    retryCount: job.retryCount,
    userId: job.userId,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    expiresAt: job.expiresAt,
    completedAt: job.completedAt,
  };
}

export async function listJobs(
  db: Database,
  input: { status?: DownloadJob['status'] | undefined; cursor?: string | undefined; limit: number },
): Promise<Paged<AdminJobView>> {
  const filters = [input.status ? eq(downloadJobs.status, input.status) : undefined];
  if (input.cursor) filters.push(lt(downloadJobs.createdAt, decodeCursor(input.cursor)));

  const rows = await db
    .select()
    .from(downloadJobs)
    .where(and(...defined(filters)))
    .orderBy(desc(downloadJobs.createdAt))
    .limit(input.limit + 1);

  const page = rows.slice(0, input.limit);
  const last = page[page.length - 1];
  return {
    data: page.map(toJobView),
    nextCursor: rows.length > input.limit && last ? encodeCursor(last.createdAt) : null,
  };
}

async function getJobOr404(db: Database, jobId: string): Promise<DownloadJob> {
  const rows = await db.select().from(downloadJobs).where(eq(downloadJobs.id, jobId)).limit(1);
  const job = rows[0];
  if (!job) throw new AppError('NOT_FOUND', 'Download job not found.');
  return job;
}

export async function getJob(db: Database, jobId: string): Promise<AdminJobView> {
  return toJobView(await getJobOr404(db, jobId));
}

const ADMIN_CANCELLABLE = [
  'created',
  'validating',
  'queued',
  'analyzing',
  'ready',
  'processing',
  'uploading',
  'failed',
  'retrying',
  'policy_restricted',
] as const;

export async function cancelJob(db: Database, jobId: string): Promise<AdminJobView> {
  const job = await getJobOr404(db, jobId);
  const cancelled = await transitionJob(db, {
    jobId: job.id,
    from: ADMIN_CANCELLABLE,
    to: 'cancelled',
    patch: {
      errorCode: 'ADMIN_CANCELLED',
      errorMessage: 'Cancelled by an administrator.',
    },
    soft: true,
  });
  if (!cancelled) {
    throw new AppError('CONFLICT', `A ${job.status} job can no longer be cancelled.`);
  }
  return toJobView(cancelled);
}

const RETRYABLE: DownloadJob['status'][] = [
  'failed',
  'dead_letter',
  'policy_restricted',
  'retrying',
];

export async function retryJob(db: Database, jobId: string): Promise<AdminJobView> {
  const job = await getJobOr404(db, jobId);
  if (!RETRYABLE.includes(job.status)) {
    throw new AppError('CONFLICT', `A ${job.status} job cannot be retried.`);
  }

  const requeued = await transitionJob(db, {
    jobId: job.id,
    from: RETRYABLE,
    to: 'queued',
    patch: {
      retryCount: 0,
      errorCode: null,
      errorMessage: null,
      progress: 0,
      leaseToken: null,
    },
  });

  try {
    await enqueueDownloadJob(requeued!.id, { dedupe: false });
  } catch (err) {
    await transitionJob(db, {
      jobId: requeued!.id,
      from: ['queued'],
      to: 'failed',
      patch: { errorCode: 'ENQUEUE_FAILED', errorMessage: 'Could not hand the job to the queue.' },
      soft: true,
    }).catch(() => undefined);
    throw new AppError('SERVICE_UNAVAILABLE', 'The queue is unavailable. Please retry shortly.', {
      cause: err,
    });
  }

  return toJobView(requeued!);
}

export interface SourceAdminView {
  id: string;
  slug: string;
  name: string;
  adapterKey: string;
  enabled: boolean;
  mode: 'active' | 'maintenance' | 'restricted' | 'disabled';
  allowedFormats: unknown;
  maxFileSizeMb: number | null;
  requiresAuth: boolean;
  priority: number;
  healthStatus: 'unknown' | 'healthy' | 'degraded' | 'down';
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toSourceView(row: typeof downloadSources.$inferSelect): SourceAdminView {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    adapterKey: row.adapterKey,
    enabled: row.enabled,
    mode: row.mode,
    allowedFormats: row.allowedFormats,
    maxFileSizeMb: row.maxFileSizeMb,
    requiresAuth: row.requiresAuth,
    priority: row.priority,
    healthStatus: row.healthStatus,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listSources(db: Database): Promise<SourceAdminView[]> {
  const rows = await db.select().from(downloadSources).orderBy(downloadSources.priority);
  return rows.map(toSourceView);
}

export async function getSource(db: Database, sourceId: string): Promise<SourceAdminView> {
  const rows = await db
    .select()
    .from(downloadSources)
    .where(eq(downloadSources.id, sourceId))
    .limit(1);
  const row = rows[0];
  if (!row) throw new AppError('NOT_FOUND', 'Source not found.');
  return toSourceView(row);
}

export interface SourcePatch {
  enabled?: boolean | undefined;
  mode?: 'active' | 'maintenance' | 'restricted' | 'disabled' | undefined;
  allowedFormats?: string[] | undefined;
  maxFileSizeMb?: number | null | undefined;
  requiresAuth?: boolean | undefined;
  notes?: string | null | undefined;
}

/**
 * The Phase 6 exit criterion: flipping `enabled`/`mode` here is picked up by
 * the policy layer (cache invalidated below) - no redeploy.
 */
export async function updateSource(
  db: Database,
  sourceId: string,
  patch: SourcePatch,
): Promise<SourceAdminView> {
  const set: Partial<typeof downloadSources.$inferInsert> = {};
  if (patch.enabled !== undefined) set.enabled = patch.enabled;
  if (patch.mode !== undefined) set.mode = patch.mode;
  if (patch.allowedFormats !== undefined) set.allowedFormats = patch.allowedFormats;
  if (patch.maxFileSizeMb !== undefined) set.maxFileSizeMb = patch.maxFileSizeMb;
  if (patch.requiresAuth !== undefined) set.requiresAuth = patch.requiresAuth;
  if (patch.notes !== undefined) set.notes = patch.notes;

  const rows = await db
    .update(downloadSources)
    .set(set)
    .where(eq(downloadSources.id, sourceId))
    .returning();

  const updated = rows[0];
  if (!updated) throw new AppError('NOT_FOUND', 'Source not found.');

  invalidateSourcePolicyCache();
  return toSourceView(updated);
}

export interface UserAdminView {
  id: string;
  email: string;
  displayName: string | null;
  status: 'pending' | 'active' | 'suspended' | 'deleted';
  emailVerifiedAt: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
}

export async function listUsers(
  db: Database,
  input: { cursor?: string | undefined; limit: number },
): Promise<Paged<UserAdminView>> {
  const filters = [input.cursor ? lt(users.createdAt, decodeCursor(input.cursor)) : undefined];

  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      status: users.status,
      emailVerifiedAt: users.emailVerifiedAt,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(and(...defined(filters)))
    .orderBy(desc(users.createdAt))
    .limit(input.limit + 1);

  const page = rows.slice(0, input.limit);
  const last = page[page.length - 1];
  return {
    data: page,
    nextCursor: rows.length > input.limit && last ? encodeCursor(last.createdAt) : null,
  };
}

export async function updateUser(
  db: Database,
  userId: string,
  input: { status: 'active' | 'suspended' },
): Promise<UserAdminView> {
  const rows = await db
    .update(users)
    .set({ status: input.status })
    .where(eq(users.id, userId))
    .returning({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      status: users.status,
      emailVerifiedAt: users.emailVerifiedAt,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
    });

  const updated = rows[0];
  if (!updated) throw new AppError('NOT_FOUND', 'User not found.');
  // Suspended users are rejected by loadSession() on their next request.
  return updated;
}

export interface AuditView {
  id: string;
  adminId: string | null;
  action: string;
  resource: string | null;
  resourceId: string | null;
  ip: string | null;
  metadata: unknown;
  createdAt: Date;
}

export async function listAuditLogs(
  db: Database,
  input: {
    resource?: string | undefined;
    action?: string | undefined;
    cursor?: string | undefined;
    limit: number;
  },
): Promise<Paged<AuditView>> {
  const filters = [
    input.resource ? eq(auditLogs.resource, input.resource) : undefined,
    input.action ? eq(auditLogs.action, input.action) : undefined,
    input.cursor ? lt(auditLogs.createdAt, decodeCursor(input.cursor)) : undefined,
  ];

  const rows = await db
    .select({
      id: auditLogs.id,
      adminId: auditLogs.adminId,
      action: auditLogs.action,
      resource: auditLogs.resource,
      resourceId: auditLogs.resourceId,
      ip: auditLogs.ip,
      metadata: auditLogs.metadata,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .where(and(...defined(filters)))
    .orderBy(desc(auditLogs.createdAt))
    .limit(input.limit + 1);

  const page = rows.slice(0, input.limit);
  const last = page[page.length - 1];
  return {
    data: page,
    nextCursor: rows.length > input.limit && last ? encodeCursor(last.createdAt) : null,
  };
}

export interface FlagView {
  key: string;
  enabled: boolean;
  rollout: number;
  updatedAt: Date | null;
}

export async function listFlags(db: Database): Promise<FlagView[]> {
  return db
    .select({
      key: featureFlags.key,
      enabled: featureFlags.enabled,
      rollout: featureFlags.rollout,
      updatedAt: featureFlags.updatedAt,
    })
    .from(featureFlags)
    .orderBy(featureFlags.key);
}

export async function updateFlag(
  db: Database,
  key: string,
  input: { enabled?: boolean | undefined; rollout?: number | undefined },
): Promise<FlagView> {
  const rows = await db
    .insert(featureFlags)
    .values({
      key,
      enabled: input.enabled ?? false,
      rollout: input.rollout ?? 0,
    })
    .onConflictDoUpdate({
      target: featureFlags.key,
      set: {
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.rollout !== undefined ? { rollout: input.rollout } : {}),
      },
    })
    .returning();

  const row = rows[0]!;
  return { key: row.key, enabled: row.enabled, rollout: row.rollout, updatedAt: row.updatedAt };
}

export interface SettingView {
  key: string;
  value: unknown;
  updatedAt: Date | null;
}

export async function listSettings(db: Database): Promise<SettingView[]> {
  const rows = await db
    .select({
      key: systemSettings.key,
      value: systemSettings.value,
      updatedAt: systemSettings.updatedAt,
    })
    .from(systemSettings)
    .orderBy(systemSettings.key);
  return rows;
}

export async function updateSetting(
  db: Database,
  key: string,
  value: unknown,
  updatedBy: string,
): Promise<SettingView> {
  if (key === 'anon_daily_limit') {
    const ok =
      typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100000;
    if (!ok) {
      throw new AppError(
        'VALIDATION_ERROR',
        'anon_daily_limit must be 0 (no cap) or a whole number of downloads per day.',
      );
    }
  }
  if (key === NAVBAR_SETTING_KEY) {
    assertNavbarValue(value);
  }
  const rows = await db
    .insert(systemSettings)
    .values({ key, value, updatedBy })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: { value, updatedBy },
    })
    .returning();
  const row = rows[0]!;
  if (key === 'anon_daily_limit') invalidateSettingsCache();
  return { key: row.key, value: row.value, updatedAt: row.updatedAt };
}
