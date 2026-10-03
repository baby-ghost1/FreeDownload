import { z } from 'zod';
import { asc, eq } from 'drizzle-orm';

import { config } from '../../server/config.js';
import { getDb } from '../../database/client.js';
import type { AppInstance } from '../../types/app.js';
import { downloadSources, plans } from '../../database/schema/index.js';
import { evaluateFlags } from '../../flags/flags.js';

const SourceSchema = z.object({
  slug: z.string(),
  name: z.string(),
  mode: z.enum(['active', 'maintenance', 'restricted', 'disabled']),
  allowedFormats: z.array(z.string()),
  maxFileSizeMb: z.number().nullable(),
  requiresAuth: z.boolean(),
});

const TargetFormatSchema = z.object({
  key: z.string(),
  label: z.string(),
  kind: z.enum(['video', 'audio']),
  container: z.string(),
});

const PublicConfigSchema = z.object({
  turnstile: z.object({
    enabled: z.boolean(),
    siteKey: z.string().nullable(),
  }),
  limits: z.object({
    maxFileSizeMb: z.number(),
    analyzeCacheTtlSec: z.number(),
    signedUrlTtlSec: z.number(),
  }),
  flags: z.record(z.string(), z.boolean()),
  plans: z.array(
    z.object({
      code: z.string(),
      name: z.string(),
      tier: z.number(),
      priceCents: z.number(),
      currency: z.string(),
      interval: z.string(),
      limits: z.unknown(),
      features: z.unknown(),
    }),
  ),
});

/** What the API can turn a URL into — static contract surface (docs/api.md). */
const TARGET_FORMATS = [
  { key: 'mp4', label: 'MP4 (best quality)', kind: 'video' as const, container: 'mp4' },
  { key: 'webm', label: 'WebM (smallest size)', kind: 'video' as const, container: 'webm' },
  { key: 'mkv', label: 'MKV (lossless remux)', kind: 'video' as const, container: 'mkv' },
  { key: 'mp3', label: 'MP3 (audio)', kind: 'audio' as const, container: 'mp3' },
  { key: 'm4a', label: 'M4A (audio)', kind: 'audio' as const, container: 'm4a' },
  { key: 'opus', label: 'Opus (audio)', kind: 'audio' as const, container: 'opus' },
];

/**
 * Public catalog + client bootstrap: source health, supported output formats,
 * and safe public config (site key, limits, feature flags, pricing). No
 * infrastructure details — contract §43.
 */
export async function registerCatalogRoutes(app: AppInstance): Promise<void> {
  app.get(
    '/sources',
    {
      schema: {
        description: 'Enabled download sources and their current health mode.',
        response: {
          200: z.object({ data: z.array(SourceSchema) }),
        },
      },
    },
    async () => {
      const rows = await getDb()
        .select()
        .from(downloadSources)
        .where(eq(downloadSources.enabled, true))
        .orderBy(asc(downloadSources.slug));
      return {
        data: rows.map((row) => ({
          slug: row.slug,
          name: row.name,
          mode: row.mode,
          allowedFormats: Array.isArray(row.allowedFormats)
            ? (row.allowedFormats as unknown as string[])
            : [],
          maxFileSizeMb: row.maxFileSizeMb ?? null,
          requiresAuth: row.requiresAuth,
        })),
      };
    },
  );

  app.get(
    '/formats',
    {
      schema: {
        description: 'Supported output formats for POST /downloads body.format.',
        response: { 200: z.object({ data: z.array(TargetFormatSchema) }) },
      },
    },
    async () => ({ data: TARGET_FORMATS }),
  );

  app.get(
    '/config/public',
    {
      schema: {
        description: 'Client bootstrap config: Turnstile key, limits, flags, plans.',
        response: { 200: PublicConfigSchema },
      },
    },
    async (req, reply) => {
      const db = getDb();
      // Rollout is subject-stable: signed-in users bucket by id, anonymous
      // callers by their X-Anon-Key when present.
      const anonHeader = req.headers['x-anon-key'];
      const anonKey = typeof anonHeader === 'string' ? anonHeader : undefined;
      const subject = req.auth?.user.id ?? anonKey;

      const [flags, planRows] = await Promise.all([
        evaluateFlags(db, subject),
        db.select().from(plans).where(eq(plans.active, true)).orderBy(asc(plans.sortOrder)),
      ]);

      reply.header('cache-control', 'public, max-age=60');
      return {
        turnstile: {
          enabled: config.turnstile.secretKey !== undefined,
          siteKey: config.turnstile.siteKey ?? null,
        },
        limits: {
          maxFileSizeMb: config.source.maxFileSizeMb,
          analyzeCacheTtlSec: config.source.analyzeCacheTtlSec,
          signedUrlTtlSec: config.storage.signedUrlTtlSec,
        },
        flags,
        plans: planRows.map((plan) => ({
          code: plan.code,
          name: plan.name,
          tier: plan.tier,
          priceCents: plan.priceCents,
          currency: plan.currency,
          interval: plan.interval,
          limits: plan.limits,
          features: plan.features,
        })),
      };
    },
  );
}
