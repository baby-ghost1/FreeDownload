import { eq } from 'drizzle-orm';

import { config } from '../../server/config.js';
import { AppError } from '../../errors/app-error.js';
import type { Database } from '../../database/client.js';
import { idempotencyKeys } from '../../database/schema/index.js';
import { sha256 } from '../../utils/crypto.js';
import { getRedis } from '../../redis/client.js';
import { logger } from '../../logging/logger.js';

export type IdempotencyResolution = { kind: 'fresh' } | { kind: 'replay'; response: unknown };

export function hashRequest(payload: unknown): string {
  return sha256(JSON.stringify(payload ?? null));
}

function redisKey(key: string): string {
  return `idem:${key}`;
}

/** Best-effort Redis guard - never fails the request if Redis is down. */
async function redisBegin(key: string, ttlSec: number): Promise<'taken' | 'free' | 'unknown'> {
  try {
    const res = await getRedis().set(redisKey(key), 'in_progress', 'EX', ttlSec, 'NX');
    return res === 'OK' ? 'free' : 'taken';
  } catch (err) {
    logger.warn({ err: { message: (err as Error).message } }, 'idempotency redis guard skipped');
    return 'unknown';
  }
}

async function redisSet(key: string, value: string, ttlSec: number): Promise<void> {
  try {
    await getRedis().set(redisKey(key), value, 'EX', ttlSec);
  } catch {
    // The database row is authoritative; losing the cache only costs a read.
  }
}

async function redisDrop(key: string): Promise<void> {
  try {
    await getRedis().del(redisKey(key));
  } catch {
    // see above
  }
}

/**
 * Resolves an `Idempotency-Key` (contract §Job lifecycle, 24h window).
 *
 * - first use  → `{ kind: 'fresh' }`, an in-progress row is created
 * - replay      → the stored response, verbatim
 * - same key + different payload → `CONFLICT`
 * - concurrent use → `CONFLICT` (retry after the first request settles)
 */
export async function beginIdempotency(
  db: Database,
  params: { key: string; scope: string; request: unknown },
): Promise<IdempotencyResolution> {
  const ttlSeconds = config.idempotency.ttlHours * 3_600;
  const requestHash = hashRequest(params.request);

  const existing = await db
    .select()
    .from(idempotencyKeys)
    .where(eq(idempotencyKeys.key, params.key))
    .limit(1);

  const row = existing[0];
  if (row) {
    assertSameRequest(row.requestHash, requestHash);
    if (row.status === 'completed') {
      await redisSet(params.key, 'completed', ttlSeconds);
      return { kind: 'replay', response: row.response };
    }
    throw new AppError(
      'CONFLICT',
      'This Idempotency-Key is still being processed. Retry in a moment.',
    );
  }

  const guard = await redisBegin(params.key, ttlSeconds);

  try {
    await db.insert(idempotencyKeys).values({
      key: params.key,
      scope: params.scope,
      requestHash,
      status: 'in_progress',
      expiresAt: new Date(Date.now() + ttlSeconds * 1_000),
    });
  } catch (err) {
    // Unique violation → someone else won the race between our read and write.
    if ((err as { cause?: { code?: string } }).cause?.code === '23505' || guard === 'taken') {
      const raced = await db
        .select()
        .from(idempotencyKeys)
        .where(eq(idempotencyKeys.key, params.key))
        .limit(1);
      const racedRow = raced[0];
      if (racedRow) {
        assertSameRequest(racedRow.requestHash, requestHash);
        if (racedRow.status === 'completed') {
          return { kind: 'replay', response: racedRow.response };
        }
        throw new AppError(
          'CONFLICT',
          'This Idempotency-Key is still being processed. Retry in a moment.',
        );
      }
    }
    throw err;
  }

  return { kind: 'fresh' };
}

function assertSameRequest(stored: string, incoming: string): void {
  if (stored !== incoming) {
    throw new AppError(
      'CONFLICT',
      'This Idempotency-Key was already used with a different payload.',
    );
  }
}

export async function completeIdempotency(
  db: Database,
  key: string,
  response: unknown,
): Promise<void> {
  const ttlSeconds = config.idempotency.ttlHours * 3_600;
  await db
    .update(idempotencyKeys)
    .set({
      status: 'completed',
      response: response as Record<string, unknown>,
      expiresAt: new Date(Date.now() + ttlSeconds * 1_000),
    })
    .where(eq(idempotencyKeys.key, key));
  await redisSet(key, 'completed', ttlSeconds);
}

/** Failed work releases the key so the caller can retry with the same one. */
export async function abortIdempotency(db: Database, key: string): Promise<void> {
  await db.delete(idempotencyKeys).where(eq(idempotencyKeys.key, key));
  await redisDrop(key);
}
