import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';

import { afterAll, describe, expect, it } from 'vitest';

import { closeDatabase, getDb } from '../../src/database/client.js';
import { closeRedis } from '../../src/redis/client.js';
import { closeQueues, getQueue, QUEUE_NAMES } from '../../src/queue/queues.js';
import {
  downloadAttempts,
  downloadJobs,
  files,
  idempotencyKeys,
  sessions,
  users,
} from '../../src/database/schema/index.js';
import type { NewDownloadJob } from '../../src/database/schema/index.js';
import { runCleanupSweep } from '../../src/workers/cleanup.js';
import { infraAvailable, inCi } from '../helpers/infra.js';

const infraUp = await infraAvailable();
const describeInfra = describe.runIf(infraUp || inCi);

const PAST = new Date(Date.now() - 60_000);
const FUTURE = new Date(Date.now() + 3_600_000);

describeInfra('cleanup sweep (integration)', () => {
  afterAll(async () => {
    await closeQueues();
    await closeDatabase();
    await closeRedis();
  });

  async function insertJob(patch: Partial<NewDownloadJob>) {
    const rows = await getDb()
      .insert(downloadJobs)
      .values({
        urlHash: `hash-${randomUUID()}`,
        urlRedacted: 'https://example.com/x',
        expiresAt: FUTURE,
        ...patch,
      })
      .returning();
    return rows[0]!;
  }

  it('expires finished jobs, cancels stale ones and recovers crashed leases', async () => {
    const db = getDb();

    const done = await insertJob({
      status: 'completed',
      progress: 100,
      completedAt: PAST,
      expiresAt: PAST,
    });
    const unfinished = await insertJob({ status: 'queued', expiresAt: PAST });
    const recoverable = await insertJob({
      status: 'analyzing',
      leaseToken: 'lease-recoverable',
      leaseExpiresAt: PAST,
      retryCount: 0,
      maxRetries: 3,
      expiresAt: FUTURE,
    });
    const exhausted = await insertJob({
      status: 'analyzing',
      leaseToken: 'lease-exhausted',
      leaseExpiresAt: PAST,
      retryCount: 3,
      maxRetries: 3,
      expiresAt: FUTURE,
    });
    await db.insert(downloadAttempts).values({
      jobId: recoverable.id,
      attemptNo: 1,
      status: 'running',
    });

    const stats = await runCleanupSweep(db);

    expect(stats.expiredCompleted).toBeGreaterThanOrEqual(1);
    expect(stats.cancelledStale).toBeGreaterThanOrEqual(1);
    expect(stats.requeuedStale).toBeGreaterThanOrEqual(1);
    expect(stats.deadLetteredStale).toBeGreaterThanOrEqual(1);

    const pick = async (id: string) =>
      (await db.select().from(downloadJobs).where(eq(downloadJobs.id, id)))[0];

    expect((await pick(done.id))!.status).toBe('expired');
    expect((await pick(unfinished.id))!.status).toBe('cancelled');
    expect((await pick(unfinished.id))!.errorCode).toBe('EXPIRED');

    // Recovered job is electable again and its stuck attempt was closed out.
    expect((await pick(recoverable.id))!.status).toBe('queued');
    expect((await pick(recoverable.id))!.leaseToken).toBeNull();
    const recoverableAttempts = await db
      .select()
      .from(downloadAttempts)
      .where(eq(downloadAttempts.jobId, recoverable.id));
    expect(recoverableAttempts).toHaveLength(1);
    expect(recoverableAttempts[0]!.status).toBe('failed');
    expect(recoverableAttempts[0]!.errorCode).toBe('LEASE_EXPIRED');

    // Out of retries: parked for admin replay instead of looping forever.
    expect((await pick(exhausted.id))!.status).toBe('dead_letter');
    const dlq = getQueue(QUEUE_NAMES.deadLetter);
    const parked = await dlq.getJobs(['wait', 'waiting', 'completed', 'failed']);
    expect(parked.some((job) => job.data.jobId === exhausted.id)).toBe(true);
  }, 30_000);

  it('purges expired sessions, idempotency keys and marks files purged', async () => {
    const db = getDb();
    const userId = (
      await db
        .insert(users)
        .values({
          email: `cleanup-${randomUUID().replace(/-/g, '').slice(0, 12)}@example.com`,
          passwordHash: '$argon2id$placeholder',
          status: 'active',
        })
        .returning({ id: users.id })
    )[0]!.id;

    const makeSession = (expiresAt: Date) =>
      db
        .insert(sessions)
        .values({
          userId,
          tokenHash: `hash-${randomUUID()}`,
          csrfToken: 'csrf-token',
          expiresAt,
        })
        .returning({ id: sessions.id });
    const oldSession = (await makeSession(PAST))[0]!;
    const freshSession = (await makeSession(FUTURE))[0]!;

    const oldKeyName = `idem-old-${randomUUID()}`;
    const newKeyName = `idem-new-${randomUUID()}`;
    await db.insert(idempotencyKeys).values([
      {
        key: oldKeyName,
        scope: 'POST /downloads',
        requestHash: 'x',
        status: 'completed',
        expiresAt: PAST,
      },
      {
        key: newKeyName,
        scope: 'POST /downloads',
        requestHash: 'x',
        status: 'completed',
        expiresAt: FUTURE,
      },
    ]);

    const jobId = (await insertJob({ status: 'completed', expiresAt: FUTURE })).id;
    const oldFile = (
      await db
        .insert(files)
        .values({
          jobId,
          objectKey: `old/${randomUUID()}.mp4`,
          expiresAt: PAST,
        })
        .returning({ id: files.id })
    )[0]!;
    const freshFile = (
      await db
        .insert(files)
        .values({
          jobId,
          objectKey: `fresh/${randomUUID()}.mp4`,
          expiresAt: FUTURE,
        })
        .returning({ id: files.id })
    )[0]!;

    const stats = await runCleanupSweep(db);

    expect(stats.sessionsRevoked).toBeGreaterThanOrEqual(1);
    expect(stats.idempotencyPurged).toBeGreaterThanOrEqual(1);
    expect(stats.filesPurged).toBeGreaterThanOrEqual(1);

    const oldSessionRow = (
      await db.select().from(sessions).where(eq(sessions.id, oldSession.id))
    )[0];
    const freshSessionRow = (
      await db.select().from(sessions).where(eq(sessions.id, freshSession.id))
    )[0];
    expect(oldSessionRow).toBeUndefined();
    expect(freshSessionRow).toBeDefined();

    const oldKey = (
      await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.key, oldKeyName))
    ).length;
    const newKey = (
      await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.key, newKeyName))
    ).length;
    expect(oldKey).toBe(0);
    expect(newKey).toBe(1);

    const oldFileRow = (await db.select().from(files).where(eq(files.id, oldFile.id)))[0];
    const freshFileRow = (await db.select().from(files).where(eq(files.id, freshFile.id)))[0];
    expect(oldFileRow!.purgedAt).not.toBeNull();
    expect(freshFileRow!.purgedAt).toBeNull();
  }, 30_000);
});
