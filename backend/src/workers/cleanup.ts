import { and, eq, inArray, isNotNull, isNull, lte } from 'drizzle-orm';

import { config } from '../server/config.js';
import { logger } from '../logging/logger.js';
import { getDb, type Database } from '../database/client.js';
import {
  downloadAttempts,
  downloadJobs,
  emailVerifications,
  files,
  idempotencyKeys,
  mediaMetadata,
  passwordResets,
  sessions,
} from '../database/schema/index.js';
import type { JobStatus } from '../modules/downloads/state-machine.js';
import { enqueueDeadLetter, enqueueDownloadJob } from '../queue/queues.js';
import { getStorage } from '../storage/index.js';

/** Statuses a live job can sit in while holding a lease. */
const LEASED: JobStatus[] = ['analyzing', 'ready', 'processing', 'uploading'];

/**
 * Pre-completion statuses. Every one of them may reach `cancelled`, which is
 * how a job that never finished gets swept once it expires (contract: any
 * state before `COMPLETED` → `CANCELLED`).
 */
const PRE_COMPLETION: JobStatus[] = [
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
];

export interface SweepStats {
  expiredCompleted: number;
  cancelledStale: number;
  requeuedStale: number;
  deadLetteredStale: number;
  sessionsRevoked: number;
  idempotencyPurged: number;
  tokensPurged: number;
  filesPurged: number;
  metadataTrimmed: number;
}

/** How long the extractor's raw JSON dump stays in `media_metadata`. */
const METADATA_RAW_RETENTION_MS = 7 * 86_400_000;

/**
 * One cleanup pass. Bulk updates are guarded by `WHERE status = <legal source>`
 * — the same condition `transitionJob` enforces — so the state machine is
 * never bypassed, just applied in bulk.
 */
export async function runCleanupSweep(db: Database = getDb()): Promise<SweepStats> {
  const now = new Date();
  const stats: SweepStats = {
    expiredCompleted: 0,
    cancelledStale: 0,
    requeuedStale: 0,
    deadLetteredStale: 0,
    sessionsRevoked: 0,
    idempotencyPurged: 0,
    tokensPurged: 0,
    filesPurged: 0,
    metadataTrimmed: 0,
  };

  // 1. Finished jobs past their retention window become `expired`. The raw
  //    URL is nullified here too (contract §51) — it has no purpose once the
  //    download window closes.
  const expired = await db
    .update(downloadJobs)
    .set({ status: 'expired', url: null })
    .where(and(eq(downloadJobs.status, 'completed'), lte(downloadJobs.expiresAt, now)))
    .returning({ id: downloadJobs.id });
  stats.expiredCompleted = expired.length;

  // 2. Anything still unfinished past its deadline is cancelled, not retried
  //    forever — the user's link window has closed.
  const stale = await db
    .update(downloadJobs)
    .set({
      status: 'cancelled',
      errorCode: 'EXPIRED',
      errorMessage: 'The job expired before it completed.',
      url: null,
      leaseToken: null,
      leaseExpiresAt: null,
      workerId: null,
    })
    .where(and(inArray(downloadJobs.status, PRE_COMPLETION), lte(downloadJobs.expiresAt, now)))
    .returning({ id: downloadJobs.id });
  stats.cancelledStale = stale.length;

  // 3. Crash recovery safety net: leases that stopped heartbeating get their
  //    work re-queued (BullMQ retries cover the common case; this catches
  //    jobs whose queue entry vanished, e.g. after a Redis flush).
  const leaseCutoff = new Date(now.getTime() - config.queue.leaseTtlMs);
  const stuck = await db
    .select({
      id: downloadJobs.id,
      retryCount: downloadJobs.retryCount,
      maxRetries: downloadJobs.maxRetries,
    })
    .from(downloadJobs)
    .where(
      and(
        inArray(downloadJobs.status, LEASED),
        isNotNull(downloadJobs.leaseExpiresAt),
        lte(downloadJobs.leaseExpiresAt, leaseCutoff),
        isNull(downloadJobs.deletedAt),
      ),
    )
    .limit(500);

  for (const job of stuck) {
    const failed = await db
      .update(downloadJobs)
      .set({
        status: 'failed',
        errorCode: 'LEASE_EXPIRED',
        errorMessage: 'The worker stopped reporting progress.',
        retryCount: Math.min(job.retryCount + 1, job.maxRetries),
        leaseToken: null,
        leaseExpiresAt: null,
        workerId: null,
      })
      .where(and(eq(downloadJobs.id, job.id), inArray(downloadJobs.status, LEASED)))
      .returning({ id: downloadJobs.id });
    if (failed.length === 0) continue;

    // The dead worker's attempt never reported back — close it out so the
    // attempt log reflects reality.
    await db
      .update(downloadAttempts)
      .set({ status: 'failed', errorCode: 'LEASE_EXPIRED', finishedAt: now })
      .where(and(eq(downloadAttempts.jobId, job.id), eq(downloadAttempts.status, 'running')));

    if (job.retryCount + 1 > job.maxRetries) {
      await db
        .update(downloadJobs)
        .set({ status: 'dead_letter' })
        .where(and(eq(downloadJobs.id, job.id), eq(downloadJobs.status, 'failed')));
      await enqueueDeadLetter(job.id, 'LEASE_EXPIRED').catch((err) =>
        logger.error({ err, jobId: job.id }, 'dead-letter enqueue failed'),
      );
      stats.deadLetteredStale += 1;
      continue;
    }

    await db
      .update(downloadJobs)
      .set({ status: 'retrying' })
      .where(and(eq(downloadJobs.id, job.id), eq(downloadJobs.status, 'failed')));
    await db
      .update(downloadJobs)
      .set({ status: 'queued' })
      .where(and(eq(downloadJobs.id, job.id), eq(downloadJobs.status, 'retrying')));
    await enqueueDownloadJob(job.id, { dedupe: false }).catch((err) =>
      logger.error({ err, jobId: job.id }, 'stale job re-enqueue failed'),
    );
    stats.requeuedStale += 1;
  }

  // 4. Row hygiene: expired sessions, tokens and idempotency keys.
  stats.sessionsRevoked = (
    await db.delete(sessions).where(lte(sessions.expiresAt, now)).returning({ id: sessions.id })
  ).length;

  stats.idempotencyPurged = (
    await db
      .delete(idempotencyKeys)
      .where(lte(idempotencyKeys.expiresAt, now))
      .returning({ key: idempotencyKeys.key })
  ).length;

  stats.tokensPurged =
    (
      await db
        .delete(emailVerifications)
        .where(lte(emailVerifications.expiresAt, now))
        .returning({ id: emailVerifications.id })
    ).length +
    (
      await db
        .delete(passwordResets)
        .where(lte(passwordResets.expiresAt, now))
        .returning({ id: passwordResets.id })
    ).length;

  // 5. Files past retention are deleted from object storage first, then
  //    marked purged — a failed delete leaves the row for the next sweep.
  const expiringFiles = await db
    .select({ id: files.id, objectKey: files.objectKey })
    .from(files)
    .where(and(isNull(files.purgedAt), lte(files.expiresAt, now)))
    .limit(500);

  for (const file of expiringFiles) {
    try {
      await getStorage().remove(file.objectKey);
    } catch (err) {
      logger.warn({ err, fileId: file.id }, 'storage purge failed; will retry next sweep');
      continue;
    }
    const purged = await db
      .update(files)
      .set({ purgedAt: now })
      .where(and(eq(files.id, file.id), isNull(files.purgedAt)))
      .returning({ id: files.id });
    stats.filesPurged += purged.length;
  }

  // 6. The extractor's raw JSON dump only matters while the job is young;
  //    structured columns stay forever.
  const rawCutoff = new Date(now.getTime() - METADATA_RAW_RETENTION_MS);
  stats.metadataTrimmed = (
    await db
      .update(mediaMetadata)
      .set({ raw: null })
      .where(and(isNotNull(mediaMetadata.raw), lte(mediaMetadata.fetchedAt, rawCutoff)))
      .returning({ id: mediaMetadata.id })
  ).length;

  return stats;
}
