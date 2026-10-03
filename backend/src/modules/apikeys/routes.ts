import { z } from 'zod';

import { and, desc, eq } from 'drizzle-orm';

import { getDb } from '../../database/client.js';
import type { AppInstance } from '../../types/app.js';
import { AppError } from '../../errors/app-error.js';
import { assertCsrf } from '../../security/csrf.js';
import { apiKeys, apiUsage } from '../../database/schema/index.js';
import { generateApiKey } from '../../security/api-key.js';
import { requireAuth } from '../auth/session.js';
import { errorResponses } from '../../http/error-schema.js';

const KeySchema = z.object({
  id: z.string(),
  name: z.string(),
  prefix: z.string(),
  scopes: z.array(z.string()),
  rateTier: z.string(),
  lastUsedAt: z.date().nullable(),
  expiresAt: z.date().nullable(),
  revokedAt: z.date().nullable(),
  createdAt: z.date(),
});

/** The raw secret appears exactly once — in the create response only. */
const CreatedKeySchema = KeySchema.extend({ rawKey: z.string() });

const KeyListSchema = z.object({ data: z.array(KeySchema) });

const CreateBody = z.object({ name: z.string().min(1).max(64) });

const ParamsId = z.object({ id: z.uuid() });

const UsageSchema = z.object({
  totalRequests: z.number(),
  totalErrors: z.number(),
  buckets: z.array(
    z.object({
      bucketStart: z.date(),
      requests: z.number(),
      errors: z.number(),
      bytes: z.number(),
    }),
  ),
});

const RevokedSchema = z.object({ id: z.string(), revokedAt: z.date() });

function toKeyResponse(key: typeof apiKeys.$inferSelect) {
  return {
    id: key.id,
    name: key.name,
    prefix: key.prefix,
    scopes: key.scopes as string[],
    rateTier: key.rateTier,
    lastUsedAt: key.lastUsedAt,
    expiresAt: key.expiresAt,
    revokedAt: key.revokedAt,
    createdAt: key.createdAt,
  };
}

/** API key management (Phase 7): session-only, CSRF-protected, raw shown once. */
export async function registerApiKeyRoutes(app: AppInstance): Promise<void> {
  app.get(
    '/api-keys',
    {
      schema: {
        description: 'API keys belonging to the signed-in user.',
        response: { 200: KeyListSchema, ...errorResponses(401) },
      },
    },
    async (req) => {
      const auth = requireAuth(req);
      const rows = await getDb()
        .select()
        .from(apiKeys)
        .where(eq(apiKeys.userId, auth.user.id))
        .orderBy(desc(apiKeys.createdAt))
        .limit(50);
      return { data: rows.map(toKeyResponse) };
    },
  );

  app.post(
    '/api-keys',
    {
      schema: {
        description: 'Create an API key. The raw key is returned exactly once.',
        body: CreateBody,
        response: { 201: CreatedKeySchema, ...errorResponses(400, 401, 403) },
      },
    },
    async (req, reply) => {
      assertCsrf(req);
      const auth = requireAuth(req);

      const generated = generateApiKey();
      const inserted = await getDb()
        .insert(apiKeys)
        .values({
          userId: auth.user.id,
          name: req.body.name,
          prefix: generated.prefix,
          keyHash: generated.keyHash,
          scopes: [],
        })
        .returning();

      return reply.status(201).send({ ...toKeyResponse(inserted[0]!), rawKey: generated.raw });
    },
  );

  app.delete(
    '/api-keys/:id',
    {
      schema: {
        description: 'Revoke an API key immediately.',
        params: ParamsId,
        response: { 200: RevokedSchema, ...errorResponses(401, 403, 404) },
      },
    },
    async (req) => {
      assertCsrf(req);
      const auth = requireAuth(req);

      const revoked = await getDb()
        .update(apiKeys)
        .set({ revokedAt: new Date() })
        .where(and(eq(apiKeys.id, req.params.id), eq(apiKeys.userId, auth.user.id)))
        .returning();

      const row = revoked[0];
      if (!row) throw new AppError('NOT_FOUND', 'API key not found.');
      return { id: row.id, revokedAt: row.revokedAt! };
    },
  );

  app.get(
    '/api-keys/:id/usage',
    {
      schema: {
        description: 'Hourly usage buckets for one API key.',
        params: ParamsId,
        response: { 200: UsageSchema, ...errorResponses(401, 403, 404) },
      },
    },
    async (req) => {
      const auth = requireAuth(req);

      const owned = await getDb()
        .select({ id: apiKeys.id })
        .from(apiKeys)
        .where(and(eq(apiKeys.id, req.params.id), eq(apiKeys.userId, auth.user.id)))
        .limit(1);
      if (!owned[0]) throw new AppError('NOT_FOUND', 'API key not found.');

      const buckets = await getDb()
        .select()
        .from(apiUsage)
        .where(eq(apiUsage.apiKeyId, req.params.id))
        .orderBy(desc(apiUsage.bucketStart))
        .limit(168);

      return {
        totalRequests: buckets.reduce((sum, b) => sum + b.requests, 0),
        totalErrors: buckets.reduce((sum, b) => sum + b.errors, 0),
        buckets: buckets.map((b) => ({
          bucketStart: b.bucketStart,
          requests: b.requests,
          errors: b.errors,
          bytes: b.bytes,
        })),
      };
    },
  );
}
