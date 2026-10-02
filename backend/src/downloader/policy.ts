import { and, eq } from 'drizzle-orm';

import { getDb, type Database } from '../database/client.js';
import { downloadSources } from '../database/schema/index.js';
import { SourceError, SourcePolicyError } from './errors.js';

/**
 * Runtime source policy (contract §12): admins flip `mode` in PostgreSQL and
 * every worker picks it up within the cache TTL — no redeploy.
 */
export interface SourcePolicy {
  sourceId: string;
  slug: string;
  adapterKey: string;
  enabled: boolean;
  mode: 'active' | 'maintenance' | 'restricted' | 'disabled';
  allowedFormats: string[];
  maxFileSizeMb: number | null;
  healthStatus: 'unknown' | 'healthy' | 'degraded' | 'down';
}

const POLICY_TTL_MS = 30_000;
const cache = new Map<string, { policy: SourcePolicy | null; expires: number }>();

export function invalidateSourcePolicyCache(): void {
  cache.clear();
}

export async function loadSourcePolicy(
  sourceId: string,
  db: Database = getDb(),
): Promise<SourcePolicy | null> {
  const hit = cache.get(sourceId);
  if (hit && hit.expires > Date.now()) return hit.policy;

  const rows = await db
    .select({
      id: downloadSources.id,
      slug: downloadSources.slug,
      adapterKey: downloadSources.adapterKey,
      enabled: downloadSources.enabled,
      mode: downloadSources.mode,
      allowedFormats: downloadSources.allowedFormats,
      maxFileSizeMb: downloadSources.maxFileSizeMb,
      healthStatus: downloadSources.healthStatus,
    })
    .from(downloadSources)
    .where(eq(downloadSources.id, sourceId))
    .limit(1);

  const row = rows[0];
  const policy: SourcePolicy | null = row
    ? {
        sourceId: row.id,
        slug: row.slug,
        adapterKey: row.adapterKey,
        enabled: row.enabled,
        mode: row.mode,
        allowedFormats: (row.allowedFormats ?? []) as string[],
        maxFileSizeMb: row.maxFileSizeMb,
        healthStatus: row.healthStatus,
      }
    : null;

  cache.set(sourceId, { policy, expires: Date.now() + POLICY_TTL_MS });
  return policy;
}

/**
 * Throws before any network work:
 * - `SourcePolicyError` — deliberately taken out of rotation (disabled/
 *   restricted) or the container is not allowed → `policy_restricted`;
 * - `SourceError` — temporary (maintenance, source down) → retried;
 * - missing policy — treated as restricted.
 */
export function assertSourceUsable(
  policy: SourcePolicy | null,
  container?: string,
): asserts policy is SourcePolicy {
  if (!policy) {
    throw new SourcePolicyError('This source is not available.');
  }
  if (!policy.enabled || policy.mode === 'disabled') {
    throw new SourcePolicyError('This source is disabled.');
  }
  if (policy.mode === 'restricted') {
    throw new SourcePolicyError('This source is restricted by policy.');
  }
  if (policy.mode === 'maintenance') {
    throw new SourceError('SOURCE_UNAVAILABLE', 'This source is under maintenance.');
  }
  if (policy.healthStatus === 'down') {
    throw new SourceError('SOURCE_UNAVAILABLE', 'This source is currently failing.');
  }
  if (container && policy.allowedFormats.length > 0 && !policy.allowedFormats.includes(container)) {
    throw new SourcePolicyError(`This source does not allow ${container} output.`);
  }
}

/** Convenience for the API side (create/analyze) — policy rows only. */
export async function assertSourceUsableById(
  sourceId: string,
  container?: string,
  db: Database = getDb(),
): Promise<SourcePolicy> {
  const policy = await loadSourcePolicy(sourceId, db);
  assertSourceUsable(policy, container);
  return policy;
}

/** Test/db helpers get a fresh read instead of waiting out the TTL. */
export async function reloadSourcePolicy(
  sourceId: string,
  db: Database = getDb(),
): Promise<SourcePolicy | null> {
  cache.delete(sourceId);
  return loadSourcePolicy(sourceId, db);
}

/** Used by the seed/analyzer to find the generic source by slug. */
export async function findSourceBySlug(
  slug: string,
  db: Database = getDb(),
): Promise<SourcePolicy | null> {
  const rows = await db
    .select({ id: downloadSources.id })
    .from(downloadSources)
    .where(and(eq(downloadSources.slug, slug), eq(downloadSources.enabled, true)))
    .limit(1);
  return rows[0] ? loadSourcePolicy(rows[0].id, db) : null;
}
