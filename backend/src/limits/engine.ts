import { and, count, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';

import { AppError } from '../errors/app-error.js';
import { config } from '../server/config.js';
import type { Database } from '../database/client.js';
import {
  apiUsage,
  downloadJobs,
  plans,
  subscriptions,
  systemSettings,
  usageRecords,
} from '../database/schema/index.js';

/**
 * Quota enforcement (contract §25, §71): plan limits are database rows, env
 * values only backstop a missing plan. Every limit answers with 429
 * RATE_LIMITED and machine-readable `details.scope`.
 */

export type QuotaPlanCode = 'anonymous' | 'free' | 'pro' | 'business';

export interface PlanQuota {
  planId: string | null;
  planCode: QuotaPlanCode;
  tier: number;
  /** Null = no daily cap (anonymous limit is off until an admin sets one). */
  jobsPerDay: number | null;
  concurrentJobs: number;
  maxFileSizeMb: number;
  apiPerHour: number;
  /** Queue priority: anonymous 60 > free 50 > pro 30 > business 10. */
  priority: number;
}

export interface QuotaActor {
  userId?: string | null | undefined;
  anonKey?: string | null | undefined;
}

/** Anonymous jobs outrank every paid tier - capacity release valve (§12). */
export const ANON_PRIORITY = 60;

/** `tier` is 0/10/20 → 50/30/10, clamped into [10, 50] (contract §Job queue). */
export function priorityForTier(tier: number): number {
  return Math.min(50, Math.max(10, 50 - tier * 2));
}

/** Job statuses that still occupy a concurrency slot. */
const ACTIVE_STATUSES = [
  'created',
  'validating',
  'queued',
  'analyzing',
  'ready',
  'processing',
  'uploading',
  'retrying',
] as const;

export function startOfUtcDay(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function utcDayString(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function startOfUtcHour(now: Date = new Date()): Date {
  return new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000);
}

function limitValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

function defaultDailyFor(code: QuotaPlanCode): number {
  return code === 'free' ? config.limits.freeDaily : config.limits.proDaily;
}

export const ANON_DAILY_LIMIT_KEY = 'anon_daily_limit';

const SETTINGS_TTL_MS = 30_000;
const settingsCache = new Map<string, { value: unknown; expires: number }>();

export function invalidateSettingsCache(): void {
  settingsCache.clear();
}

async function readSetting(db: Database, key: string): Promise<unknown> {
  const hit = settingsCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const rows = await db
    .select({ value: systemSettings.value })
    .from(systemSettings)
    .where(eq(systemSettings.key, key))
    .limit(1);
  const value = rows[0]?.value ?? null;
  settingsCache.set(key, { value, expires: Date.now() + SETTINGS_TTL_MS });
  return value;
}

/**
 * Anonymous daily cap, owned by the admin console (`system_settings` row
 * `anon_daily_limit`). Missing or 0 = no cap. The env var is only a boot-time
 * fallback and is ignored once the setting row exists.
 */
export async function getAnonDailyLimit(db: Database): Promise<number | null> {
  const raw = await readSetting(db, ANON_DAILY_LIMIT_KEY);
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return Math.min(Math.floor(raw), 1_000_000);
  }
  return null;
}

/**
 * The effective quota for an actor: an active subscription wins, otherwise the
 * `free` plan row, otherwise env fallbacks (seed missing). Anonymous callers
 * are quota'd against their X-Anon-Key; their daily cap comes from the admin
 * console setting and is off until an admin sets a value.
 */
export async function resolveQuota(db: Database, actor: QuotaActor): Promise<PlanQuota> {
  if (!actor.userId) {
    return {
      planId: null,
      planCode: 'anonymous',
      tier: -1,
      jobsPerDay: await getAnonDailyLimit(db),
      concurrentJobs: config.limits.anonConcurrency,
      maxFileSizeMb: config.source.maxFileSizeMb,
      apiPerHour: config.limits.apiKeyHourly,
      priority: ANON_PRIORITY,
    };
  }

  const active = await db
    .select({ plan: plans })
    .from(subscriptions)
    .innerJoin(plans, eq(subscriptions.planId, plans.id))
    .where(
      and(
        eq(subscriptions.userId, actor.userId),
        eq(subscriptions.status, 'active'),
        eq(plans.active, true),
      ),
    )
    .orderBy(desc(subscriptions.createdAt))
    .limit(1);

  const fallback =
    active[0]?.plan ??
    (await db.select().from(plans).where(eq(plans.code, 'free')).limit(1))[0] ??
    null;

  const planCode = (fallback?.code ?? 'free') as QuotaPlanCode;
  const limits = (fallback?.limits ?? {}) as Record<string, unknown>;

  return {
    planId: fallback?.id ?? null,
    planCode,
    tier: fallback?.tier ?? 0,
    jobsPerDay: limitValue(limits.jobsPerDay, defaultDailyFor(planCode)),
    concurrentJobs: limitValue(limits.concurrentJobs, config.limits.userConcurrency),
    maxFileSizeMb: limitValue(limits.maxFileSizeMb, config.source.maxFileSizeMb),
    apiPerHour: limitValue(limits.apiPerHour, config.limits.apiKeyHourly),
    priority: priorityForTier(fallback?.tier ?? 0),
  };
}

function actorCondition(actor: QuotaActor) {
  if (actor.userId) return eq(downloadJobs.userId, actor.userId);
  return and(eq(downloadJobs.anonKey, actor.anonKey ?? ''), isNull(downloadJobs.userId));
}

/** Daily volume + concurrency gate. Throws 429 with `details.scope`. */
export async function assertQuota(
  db: Database,
  quota: PlanQuota,
  actor: QuotaActor,
): Promise<void> {
  if (quota.jobsPerDay !== null) {
    const [daily] = await db
      .select({ n: count() })
      .from(downloadJobs)
      .where(and(actorCondition(actor), gte(downloadJobs.createdAt, startOfUtcDay())));

    if ((daily?.n ?? 0) >= quota.jobsPerDay) {
      throw new AppError(
        'RATE_LIMITED',
        `Daily limit of ${quota.jobsPerDay} downloads reached on the ${quota.planCode} plan.`,
        { details: { scope: 'daily', limit: quota.jobsPerDay, plan: quota.planCode } },
      );
    }
  }

  const [active] = await db
    .select({ n: count() })
    .from(downloadJobs)
    .where(
      and(
        actorCondition(actor),
        isNull(downloadJobs.deletedAt),
        inArray(downloadJobs.status, [...ACTIVE_STATUSES]),
      ),
    );

  if ((active?.n ?? 0) >= quota.concurrentJobs) {
    throw new AppError(
      'RATE_LIMITED',
      `At most ${quota.concurrentJobs} concurrent downloads are allowed on the ${quota.planCode} plan.`,
      { details: { scope: 'concurrent', limit: quota.concurrentJobs, plan: quota.planCode } },
    );
  }
}

/** Hourly API-key metering gate - checked before the request is served. */
export async function assertApiHourly(
  db: Database,
  apiKeyId: string,
  quota: PlanQuota,
): Promise<void> {
  const [row] = await db
    .select({ requests: apiUsage.requests })
    .from(apiUsage)
    .where(and(eq(apiUsage.apiKeyId, apiKeyId), eq(apiUsage.bucketStart, startOfUtcHour())));

  if ((row?.requests ?? 0) >= quota.apiPerHour) {
    throw new AppError(
      'RATE_LIMITED',
      `Hourly API limit of ${quota.apiPerHour} requests reached on the ${quota.planCode} plan.`,
      { details: { scope: 'api-hourly', limit: quota.apiPerHour, plan: quota.planCode } },
    );
  }
}

/** Daily usage_records rollup for the account usage surface. */
export async function recordJobCreated(db: Database, userId: string): Promise<void> {
  await db
    .insert(usageRecords)
    .values({ userId, day: utcDayString(), jobsCreated: 1 })
    .onConflictDoUpdate({
      target: [usageRecords.userId, usageRecords.day],
      set: { jobsCreated: sql`${usageRecords.jobsCreated} + 1` },
    });
}
