import type { FastifyRequest } from 'fastify';
import { eq, sql } from 'drizzle-orm';

import type { Database } from '../database/client.js';
import { apiKeys, apiUsage, users, type ApiKey, type User } from '../database/schema/index.js';
import { randomToken, sha256 } from '../utils/crypto.js';
import { startOfUtcHour } from '../limits/engine.js';

/**
 * API keys (Phase 7): raw `fd_live_…` shown once, stored as SHA-256, and
 * presented as `Authorization: Bearer fd_live_…` (CSRF-exempt by design —
 * there is no ambient cookie credential behind it).
 */
export const API_KEY_PREFIX = 'fd_live_';
const RAW_PATTERN = /^fd_live_[A-Za-z0-9_-]{22,128}$/;
const TOUCH_INTERVAL_MS = 60_000;

export interface ApiKeyContext {
  key: ApiKey;
  user: User;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Populated by the preHandler when a valid Bearer API key is presented. */
    apiKey: ApiKeyContext | null;
  }
}

export function generateApiKey(): { raw: string; prefix: string; keyHash: string } {
  const raw = `${API_KEY_PREFIX}${randomToken(32)}`;
  // Display prefix: enough to tell keys apart, never enough to reconstruct.
  return { raw, prefix: raw.slice(0, 12), keyHash: sha256(raw) };
}

export function readBearerToken(req: FastifyRequest): string | undefined {
  const header = req.headers.authorization;
  if (typeof header !== 'string') return undefined;
  const match = /^Bearer\s+(\S+)\s*$/.exec(header);
  return match?.[1];
}

/** Resolves a raw key, enforcing revocation, expiry and account status. */
export async function loadApiKey(db: Database, raw: string): Promise<ApiKeyContext | null> {
  if (!RAW_PATTERN.test(raw)) return null;

  const rows = await db
    .select({ key: apiKeys, user: users })
    .from(apiKeys)
    .innerJoin(users, eq(apiKeys.userId, users.id))
    .where(eq(apiKeys.keyHash, sha256(raw)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  const now = Date.now();
  if (row.key.revokedAt !== null) return null;
  if (row.key.expiresAt !== null && row.key.expiresAt.getTime() <= now) return null;
  if (row.user.deletedAt !== null || row.user.status === 'suspended') return null;

  return { key: row.key, user: row.user };
}

/** `last_used_at` slides at most once a minute — no write per request. */
export async function touchApiKey(db: Database, keyId: string): Promise<void> {
  const last = touchedAt.get(keyId) ?? 0;
  if (Date.now() - last < TOUCH_INTERVAL_MS) return;
  touchedAt.set(keyId, Date.now());
  await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, keyId));
}
const touchedAt = new Map<string, number>();

/** Increments the current UTC-hour `requests` bucket. */
export async function meterApiKeyRequest(db: Database, keyId: string): Promise<void> {
  await db
    .insert(apiUsage)
    .values({ apiKeyId: keyId, bucketStart: startOfUtcHour(), requests: 1 })
    .onConflictDoUpdate({
      target: [apiUsage.apiKeyId, apiUsage.bucketStart],
      set: { requests: sql`${apiUsage.requests} + 1` },
    });
}

/** Increments the current UTC-hour `errors` bucket (status >= 400). */
export async function meterApiKeyError(db: Database, keyId: string): Promise<void> {
  await db
    .insert(apiUsage)
    .values({ apiKeyId: keyId, bucketStart: startOfUtcHour(), errors: 1 })
    .onConflictDoUpdate({
      target: [apiUsage.apiKeyId, apiUsage.bucketStart],
      set: { errors: sql`${apiUsage.errors} + 1` },
    });
}
