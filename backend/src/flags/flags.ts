import { createHash } from 'node:crypto';

import type { Database } from '../database/client.js';
import { featureFlags } from '../database/schema/index.js';

/**
 * Server-side feature-flag evaluation (Phase 7).
 *
 * `rollout` semantics: 0 = flag is on for every audience (the admin UI's
 * default), 100 = same; anything else is a percentage — anonymous subjects
 * (no id to bucket) only pass at 0/100.
 */
export function rolloutBucket(subject: string): number {
  const digest = createHash('sha256').update(subject).digest();
  return digest.readUInt32BE(0) % 100;
}

export function isFlagEnabled(
  flag: { enabled: boolean; rollout: number },
  subject: string | undefined,
): boolean {
  if (!flag.enabled) return false;
  if (flag.rollout <= 0 || flag.rollout >= 100) return true;
  if (!subject) return false;
  return rolloutBucket(subject) < flag.rollout;
}

export async function evaluateFlags(
  db: Database,
  subject: string | undefined,
): Promise<Record<string, boolean>> {
  const rows = await db.select().from(featureFlags);
  const out: Record<string, boolean> = {};
  for (const row of rows) out[row.key] = isFlagEnabled(row, subject);
  return out;
}
