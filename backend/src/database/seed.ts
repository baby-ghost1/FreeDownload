import { eq } from 'drizzle-orm';
import { pathToFileURL } from 'node:url';

import { closeDatabase, getDb } from './client.js';
import { logger } from '../logging/logger.js';
import { adminUsers, downloadSources, plans } from './schema/index.js';
import { hashPassword } from '../security/passwords.js';
import { normalizeEmail } from '../utils/crypto.js';

/**
 * Idempotent seed: safe to run repeatedly (contract §12, §75).
 *
 * Only reference/operational data lives here — no user rows unless an owner
 * account is explicitly requested through ADMIN_EMAIL/ADMIN_PASSWORD.
 */
export async function seed(): Promise<void> {
  const db = getDb();

  const planRows = [
    {
      code: 'free' as const,
      name: 'Free',
      tier: 0,
      priceCents: 0,
      interval: 'month' as const,
      limits: { jobsPerDay: 5, maxFileSizeMb: 512, concurrentJobs: 1 },
      features: { watermark: false, priorityQueue: false },
      sortOrder: 1,
    },
    {
      code: 'pro' as const,
      name: 'Pro',
      tier: 10,
      priceCents: 900,
      interval: 'month' as const,
      limits: { jobsPerDay: 100, maxFileSizeMb: 4096, concurrentJobs: 3 },
      features: { watermark: false, priorityQueue: true },
      sortOrder: 2,
    },
    {
      code: 'business' as const,
      name: 'Business',
      tier: 20,
      priceCents: 4900,
      interval: 'month' as const,
      limits: { jobsPerDay: 1000, maxFileSizeMb: 16384, concurrentJobs: 10 },
      features: { watermark: false, priorityQueue: true, api: true },
      sortOrder: 3,
    },
  ];

  for (const plan of planRows) {
    await db
      .insert(plans)
      .values(plan)
      .onConflictDoUpdate({ target: plans.code, set: { ...plan, updatedAt: new Date() } });
  }

  const sourceRow = {
    slug: 'generic',
    name: 'Generic (yt-dlp)',
    adapterKey: 'ytdlp',
    enabled: true,
    mode: 'active' as const,
    allowedFormats: ['video', 'audio', 'mp4', 'webm', 'mp3', 'm4a'],
    maxFileSizeMb: 4096,
    allowedFeatures: ['metadata', 'formats'],
    priority: 100,
    policyVersion: 1,
  };
  await db
    .insert(downloadSources)
    .values(sourceRow)
    .onConflictDoUpdate({
      target: downloadSources.slug,
      set: { ...sourceRow, updatedAt: new Date() },
    });

  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (adminEmail && adminPassword) {
    const email = normalizeEmail(adminEmail);
    const exists = await db
      .select({ id: adminUsers.id })
      .from(adminUsers)
      .where(eq(adminUsers.email, email))
      .limit(1);

    if (exists.length === 0) {
      await db.insert(adminUsers).values({
        email,
        passwordHash: await hashPassword(adminPassword),
        role: 'owner',
        active: true,
      });
      logger.info({ email }, 'seeded admin user');
    }
  }

  logger.info('seed complete');
}

// True only when this file is the process entrypoint (tsx/node src/database/
// seed.ts) — importing it from tests or the API must never seed or exit.
const isDirectRun =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  seed()
    .then(async () => {
      await closeDatabase();
      process.exit(0);
    })
    .catch(async (err: unknown) => {
      logger.error({ err }, 'seed failed');
      await closeDatabase();
      process.exit(1);
    });
}
