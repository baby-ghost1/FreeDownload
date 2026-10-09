import { Worker, type Job as BullJob } from 'bullmq';
import { eq, inArray, and, isNotNull, isNull, lte } from 'drizzle-orm';

import { config } from '../server/config.js';
import { logger } from '../logging/logger.js';
import { getDb, type Database } from '../database/client.js';
import { downloadAttempts, downloadJobs } from '../database/schema/index.js';
import { AppError } from '../errors/app-error.js';
import { SourceError, SourcePolicyError } from '../downloader/errors.js';
import { transitionJob, isTerminal, type JobStatus } from '../modules/downloads/state-machine.js';
import { QUEUE_NAMES, backoffDelay, enqueueDeadLetter } from '../queue/queues.js';
import { randomToken } from '../utils/crypto.js';
import { activeRunner } from './pipeline.js';
import { JobAbortedError, SimulatedCrashError, type RunnerContext } from './runner.js';

export interface DownloadJobData {
  jobId: string;
}

/** Stages a live worker can be sitting in while holding a lease. */
const LEASED: JobStatus[] = ['analyzing', 'ready', 'processing', 'uploading'];

/** Delivery should be retried by BullMQ (the lease is about to free up). */
export class LeaseBusyError extends Error {
  constructor() {
    super('job lease is held by another worker');
    this.name = 'LeaseBusyError';
  }
}

type AcquireResult =
  { kind: 'acquired'; token: string } | { kind: 'busy' } | { kind: 'unavailable' };

async function loadJob(db: Database, jobId: string) {
  const rows = await db.select().from(downloadJobs).where(eq(downloadJobs.id, jobId)).limit(1);
  return rows[0] ?? null;
}

/**
 * Requeues work whose worker died mid-run: the lease stopped heartbeating,
 * so the job (and its stuck `running` attempt) is pushed back through
 * `failed → retrying → queued` and becomes electable again.
 */
async function reclaimStaleLease(db: Database, jobId: string): Promise<boolean> {
  const now = new Date();
  const rows = await db
    .select()
    .from(downloadJobs)
    .where(
      and(
        eq(downloadJobs.id, jobId),
        inArray(downloadJobs.status, LEASED),
        isNotNull(downloadJobs.leaseExpiresAt),
        isNotNull(downloadJobs.leaseToken),
        lte(downloadJobs.leaseExpiresAt, now),
      ),
    )
    .limit(1);
  const stale = rows[0];
  if (!stale || !stale.leaseToken) return false;

  await db
    .update(downloadAttempts)
    .set({ status: 'failed', errorCode: 'LEASE_EXPIRED', finishedAt: now })
    .where(and(eq(downloadAttempts.jobId, jobId), eq(downloadAttempts.status, 'running')));

  const retryCount = Math.min(stale.retryCount + 1, stale.maxRetries);
  const failed = await transitionJob(db, {
    jobId,
    from: LEASED,
    to: 'failed',
    patch: {
      errorCode: 'LEASE_EXPIRED',
      errorMessage: 'The worker stopped reporting progress.',
      retryCount,
      leaseToken: null,
      leaseExpiresAt: null,
      workerId: null,
    },
    leaseToken: stale.leaseToken,
    soft: true,
  });
  if (!failed) return false;

  if (retryCount >= stale.maxRetries) {
    await transitionJob(db, { jobId, from: ['failed'], to: 'dead_letter', soft: true });
    await enqueueDeadLetter(jobId, 'LEASE_EXPIRED').catch((err) =>
      logger.error({ err, jobId }, 'failed to enqueue dead-letter entry'),
    );
    return false;
  }

  const retrying = await transitionJob(db, {
    jobId,
    from: ['failed'],
    to: 'retrying',
    soft: true,
  });
  if (!retrying) return false;
  const queued = await transitionJob(db, {
    jobId,
    from: ['retrying'],
    to: 'queued',
    soft: true,
  });
  return queued !== null;
}

/**
 * Sleeps until the current lease window ends. A live worker refreshes the
 * lease past our wake-up; a dead one lets it lapse.
 */
async function waitForLeaseExpiry(db: Database, jobId: string): Promise<void> {
  const rows = await db
    .select({ leaseExpiresAt: downloadJobs.leaseExpiresAt })
    .from(downloadJobs)
    .where(eq(downloadJobs.id, jobId))
    .limit(1);
  const expiry = rows[0]?.leaseExpiresAt?.getTime();
  if (expiry === undefined) return;

  // A little past expiry so a live worker's refresh or a dead worker's lapse
  // has definitely resolved by the time we look again.
  const waitMs = Math.min(expiry + 250 - Date.now(), config.queue.leaseTtlMs + 1_000);
  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

/**
 * Lease acquisition doubles as work election: only the first worker to flip
 * `queued|retrying → analyzing` proceeds, everyone else skips, so duplicate
 * enqueues are harmless (contract invariants 1-2).
 *
 * A delivery can also arrive for a job that is already `analyzing`:
 * - the previous attempt crashed → its lease lapses, we reclaim and rerun;
 * - another worker is genuinely on it → we yield (`unavailable`).
 * BullMQ deliveries are deduped per database job (see `enqueueDownloadJob`),
 * so "another worker" can only come from a cleanup requeue.
 */
async function acquireLease(db: Database, jobId: string, workerId: string): Promise<AcquireResult> {
  const token = randomToken(16);
  const now = new Date();
  const patch = {
    leaseToken: token,
    leaseExpiresAt: new Date(now.getTime() + config.queue.leaseTtlMs),
    heartbeatAt: now,
    workerId,
    errorCode: null,
    errorMessage: null,
  };
  const freshAcquire = async (): Promise<string | null> => {
    const leased = await transitionJob(db, {
      jobId,
      from: ['queued', 'retrying'],
      to: 'analyzing',
      patch,
      soft: true,
    });
    return leased ? token : null;
  };

  const acquired = await freshAcquire();
  if (acquired) return { kind: 'acquired', token: acquired };

  if (await reclaimStaleLease(db, jobId)) {
    const reclaimed = await freshAcquire();
    if (reclaimed) return { kind: 'acquired', token: reclaimed };
  }

  // Hand-off takeover: the API moved the job to `ready`/`processing`
  // (POST /downloads/:id/start) without attaching a lease - take it over
  // as-is; the pipeline picks up from whatever stage the status says.
  const taken = await db
    .update(downloadJobs)
    .set({ ...patch, errorCode: null, errorMessage: null })
    .where(
      and(
        eq(downloadJobs.id, jobId),
        inArray(downloadJobs.status, ['ready', 'processing']),
        isNull(downloadJobs.leaseToken),
      ),
    )
    .returning({ id: downloadJobs.id });
  if (taken.length > 0) return { kind: 'acquired', token };

  let current = await loadJob(db, jobId);
  if (!current || !LEASED.includes(current.status)) {
    return { kind: 'unavailable' }; // terminal, or already requeued elsewhere
  }

  const leaseAlive =
    current.leaseExpiresAt !== null && current.leaseExpiresAt.getTime() > Date.now();
  if (leaseAlive) {
    // Give the owner (or their corpse) time to settle the lease.
    await waitForLeaseExpiry(db, jobId);
    if (await reclaimStaleLease(db, jobId)) {
      const reclaimed = await freshAcquire();
      if (reclaimed) return { kind: 'acquired', token: reclaimed };
    }
    current = await loadJob(db, jobId);
    if (!current || !LEASED.includes(current.status)) {
      return { kind: 'unavailable' };
    }
  }

  const stillAlive =
    current.leaseExpiresAt !== null && current.leaseExpiresAt.getTime() > Date.now();
  // Alive → somebody else is doing the work (skip). Expired → we could not
  // take it over; ask BullMQ to come back once the lease frees up.
  return stillAlive ? { kind: 'unavailable' } : { kind: 'busy' };
}

/** Extends the lease; `false` means the job moved on without us. */
async function refreshLease(
  db: Database,
  jobId: string,
  leaseToken: string,
  progress?: number,
): Promise<boolean> {
  const now = new Date();
  const rows = await db
    .update(downloadJobs)
    .set({
      heartbeatAt: now,
      leaseExpiresAt: new Date(now.getTime() + config.queue.leaseTtlMs),
      ...(progress === undefined ? {} : { progress }),
    })
    .where(
      and(
        eq(downloadJobs.id, jobId),
        eq(downloadJobs.leaseToken, leaseToken),
        inArray(downloadJobs.status, LEASED),
      ),
    )
    .returning({ id: downloadJobs.id });
  return rows.length > 0;
}

async function releaseLease(db: Database, jobId: string, leaseToken: string): Promise<void> {
  await db
    .update(downloadJobs)
    .set({ leaseToken: null, leaseExpiresAt: null, workerId: null })
    .where(and(eq(downloadJobs.id, jobId), eq(downloadJobs.leaseToken, leaseToken)));
}

async function startAttempt(db: Database, jobId: string, attemptNo: number, workerId: string) {
  const rows = await db
    .insert(downloadAttempts)
    .values({ jobId, attemptNo, workerId, status: 'running' })
    .onConflictDoUpdate({
      target: [downloadAttempts.jobId, downloadAttempts.attemptNo],
      set: { workerId, status: 'running', finishedAt: null, durationMs: null },
    })
    .returning({ id: downloadAttempts.id });
  return rows[0]!;
}

async function finishAttempt(
  db: Database,
  attemptId: string,
  status: 'succeeded' | 'failed' | 'timeout',
  errorCode: string | null,
  durationMs: number,
): Promise<void> {
  await db
    .update(downloadAttempts)
    .set({ status, errorCode, finishedAt: new Date(), durationMs })
    .where(eq(downloadAttempts.id, attemptId));
}

function errorCodeOf(err: unknown): string {
  if (err instanceof AppError) return err.code;
  if (err instanceof SourceError) return err.code;
  if (err instanceof SourcePolicyError) return err.code;
  if (err instanceof JobAbortedError) return 'JOB_ABORTED';
  return 'WORKER_ERROR';
}

/**
 * Failures no retry can fix: login-walled, removed/geo-blocked, oversized
 * and media-less pages fail identically on every attempt. Burning all
 * retries on them is what made doomed jobs bounce between `analyzing` and
 * `processing` for minutes - park them as `failed` immediately (still
 * admin-retryable) and never throw to BullMQ.
 */
const PERMANENT_SOURCE_CODES = new Set([
  'SOURCE_UNAVAILABLE',
  'SOURCE_TOO_LARGE',
  'SOURCE_EXTRACT_FAILED',
]);

export function isPermanentFailure(err: unknown): boolean {
  return err instanceof SourceError && PERMANENT_SOURCE_CODES.has(err.code);
}

/**
 * Parks a live job as `failed` through LEGAL hops only. `retrying → failed`
 * does not exist in the state machine (and `transitionJob` throws when a
 * `from` list even contains an illegal hop), so retrying jobs hop through
 * `queued` first. Returns false when someone else already decided the
 * outcome - callers must treat that as settled, never as an error.
 */
async function parkAsFailed(
  db: Database,
  jobId: string,
  patch: {
    errorCode: string;
    errorMessage: string;
    retryCount?: number;
  },
  leaseToken?: string,
): Promise<boolean> {
  const job = await loadJob(db, jobId);
  if (!job || isTerminal(job.status)) return false;
  if (job.status === 'failed') return true;
  if (job.status === 'retrying') {
    const queued = await transitionJob(db, {
      jobId,
      from: ['retrying'],
      to: 'queued',
      ...(leaseToken !== undefined ? { leaseToken } : {}),
      soft: true,
    });
    if (!queued) return false;
  }
  const parked = await transitionJob(db, {
    jobId,
    from: ['queued', ...LEASED],
    to: 'failed',
    patch: {
      ...patch,
      leaseToken: null,
      leaseExpiresAt: null,
      workerId: null,
    },
    ...(leaseToken !== undefined ? { leaseToken } : {}),
    soft: true,
  });
  return parked !== null;
}

async function finishSuccess(
  db: Database,
  jobId: string,
  leaseToken: string,
  attemptId: string,
  durationMs: number,
): Promise<void> {
  // Record the attempt first: an observer who sees `completed` must always
  // find a finished attempt row, never a lingering `running` one.
  await finishAttempt(db, attemptId, 'succeeded', null, durationMs);

  const completed = await transitionJob(db, {
    jobId,
    from: ['uploading'],
    to: 'completed',
    patch: {
      progress: 100,
      completedAt: new Date(),
      // The raw URL served its purpose (extraction) - the redacted copy is
      // all history/result surfaces ever read.
      url: null,
      leaseToken: null,
      leaseExpiresAt: null,
      workerId: null,
    },
    leaseToken,
    soft: true,
  });

  if (!completed) {
    // Cancelled/expired mid-run - the attempt still happened, the job did
    // not finish. Nobody else's outcome is overwritten: only our own row.
    await finishAttempt(db, attemptId, 'failed', 'CANCELLED', durationMs);
    logger.warn({ jobId }, 'job left the pipeline before completion');
    return;
  }

  logger.info({ jobId, durationMs }, 'download job completed');
}

/**
 * Records the failure on the job, then routes it to `retrying` or
 * `dead_letter` depending on whether BullMQ has attempts left.
 */
async function finishFailure(
  db: Database,
  bullJob: BullJob<DownloadJobData>,
  leaseToken: string,
  attemptId: string,
  err: unknown,
  timedOut: boolean,
  startedAt: number,
): Promise<void> {
  const jobId = bullJob.data.jobId;
  const durationMs = Math.min(Date.now() - startedAt, 2_147_483_647);
  const code = timedOut ? 'JOB_TIMEOUT' : errorCodeOf(err);
  const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
  const attemptsLimit = bullJob.opts.attempts ?? config.queue.retryLimit + 1;
  const attemptNo = bullJob.attemptsMade + 1;

  await finishAttempt(db, attemptId, timedOut ? 'timeout' : 'failed', code, durationMs);

  // Policy/SSRF violations are user-actionable, not transient: park the job
  // as `policy_restricted` immediately instead of burning retries.
  if (err instanceof SourcePolicyError) {
    const parked = await transitionJob(db, {
      jobId,
      from: LEASED,
      to: 'policy_restricted',
      patch: {
        errorCode: code,
        errorMessage: message,
        leaseToken: null,
        leaseExpiresAt: null,
        workerId: null,
      },
      leaseToken,
      soft: true,
    });
    if (parked) {
      logger.info({ jobId, message }, 'download job blocked by source policy');
    } else {
      logger.warn({ jobId, code }, 'job changed state during policy handling');
    }
    return;
  }

  const current = await loadJob(db, jobId);
  const retryCount = Math.min(
    (current?.retryCount ?? 0) + 1,
    current?.maxRetries ?? config.queue.retryLimit,
  );

  const failed = await transitionJob(db, {
    jobId,
    from: LEASED,
    to: 'failed',
    patch: {
      errorCode: code,
      errorMessage: message,
      retryCount,
      leaseToken: null,
      leaseExpiresAt: null,
      workerId: null,
    },
    leaseToken,
    soft: true,
  });

  if (!failed) {
    // Cancelled while we were failing - keep the terminal state it picked.
    logger.warn({ jobId, code }, 'job changed state during failure handling');
    return;
  }

  if (attemptNo >= attemptsLimit) {
    await transitionJob(db, { jobId, from: ['failed'], to: 'dead_letter', soft: true });
    await enqueueDeadLetter(jobId, code).catch((dlqErr) =>
      logger.error({ err: dlqErr, jobId }, 'failed to enqueue dead-letter entry'),
    );
    logger.error({ jobId, code, attemptNo }, 'download job dead-lettered');
    return;
  }

  await transitionJob(db, { jobId, from: ['failed'], to: 'retrying', soft: true });
  logger.warn({ jobId, code, attemptNo, attemptsLimit }, 'download job scheduled for retry');
}

async function handleDownloadJob(bullJob: BullJob<DownloadJobData>): Promise<void> {
  const db = getDb();
  const jobId = bullJob.data.jobId;
  const attemptNo = bullJob.attemptsMade + 1;

  const job = await loadJob(db, jobId);
  if (!job || isTerminal(job.status)) {
    logger.debug({ jobId, status: job?.status }, 'skipping download job (not runnable)');
    return;
  }

  const workerId = `worker-${process.pid}`;
  const acquisition = await acquireLease(db, jobId, workerId);
  if (acquisition.kind === 'busy') {
    // A dead worker's lease has not expired yet - come back after the
    // backoff instead of stealing the job mid-run.
    logger.debug({ jobId }, 'download job lease still settling; retrying');
    throw new LeaseBusyError();
  }
  if (acquisition.kind === 'unavailable') {
    logger.debug({ jobId, status: job.status }, 'skipping download job (lease not acquired)');
    return;
  }
  const leaseToken = acquisition.token;

  const attempt = await startAttempt(db, jobId, attemptNo, workerId);
  const startedAt = Date.now();
  const controller = new AbortController();
  let leaseLost = false;
  let timedOut = false;
  // A simulated crash must leave every column exactly as a kill -9 would.
  let hardCrash = false;

  const beatMs = Math.max(1_000, Math.floor(config.queue.leaseTtlMs / 3));
  const heartbeat = setInterval(() => {
    void refreshLease(db, jobId, leaseToken).then((ok) => {
      if (!ok && !leaseLost) {
        leaseLost = true;
        controller.abort('lease lost');
      }
    });
  }, beatMs);

  const deadline = setTimeout(() => {
    if (!timedOut) {
      timedOut = true;
      controller.abort('timeout');
    }
  }, config.queue.jobTimeoutMs);

  const ctx: RunnerContext = {
    jobId,
    signal: controller.signal,
    async report(progress, transition) {
      if (transition) {
        const next = await transitionJob(db, {
          jobId,
          from: transition.from,
          to: transition.to,
          patch: {
            progress,
            leaseExpiresAt: new Date(Date.now() + config.queue.leaseTtlMs),
            heartbeatAt: new Date(),
            ...transition.patch,
          },
          leaseToken,
          soft: true,
        });
        if (!next) throw new JobAbortedError(`job left ${transition.from.join('/')}`);
        return;
      }
      if (!(await refreshLease(db, jobId, leaseToken, progress))) {
        throw new JobAbortedError('lease lost');
      }
    },
  };

  try {
    const outcome = await activeRunner().run(ctx);
    if (outcome === 'awaiting_format') {
      // The attempt did its job: analysis is stored and the job parks in
      // `ready` until the user starts it. Lease is released in `finally`.
      await finishAttempt(db, attempt.id, 'succeeded', 'AWAITING_FORMAT', Date.now() - startedAt);
      logger.info({ jobId }, 'download job awaiting format selection');
      return;
    }
    await finishSuccess(db, jobId, leaseToken, attempt.id, Date.now() - startedAt);
  } catch (err) {
    if (err instanceof SimulatedCrashError) {
      hardCrash = true;
      logger.warn({ jobId, attemptNo }, 'worker crashed mid-job; lease will expire');
      throw err;
    }

    const durationMs = Date.now() - startedAt;
    const status = (await loadJob(db, jobId))?.status;

    if (status === 'cancelled') {
      await finishAttempt(db, attempt.id, 'failed', 'CANCELLED', durationMs);
      logger.info({ jobId }, 'download job cancelled mid-run');
      return;
    }
    if (leaseLost) {
      // Another worker may own it now - write nothing, let them continue.
      await finishAttempt(db, attempt.id, 'failed', 'LEASE_LOST', durationMs);
      logger.warn({ jobId }, 'lease lost during download job; deferring to new owner');
      return;
    }

    if (!timedOut && isPermanentFailure(err)) {
      const code = errorCodeOf(err);
      const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
      const current = await loadJob(db, jobId);
      const retryCount = Math.min(
        (current?.retryCount ?? 0) + 1,
        current?.maxRetries ?? config.queue.retryLimit,
      );
      await finishAttempt(db, attempt.id, 'failed', code, durationMs);
      await parkAsFailed(
        db,
        jobId,
        { errorCode: code, errorMessage: message, retryCount },
        leaseToken,
      );
      logger.warn({ jobId, code }, 'download job failed permanently; not retrying');
      return;
    }

    await finishFailure(db, bullJob, leaseToken, attempt.id, err, timedOut, startedAt);
    throw err;
  } finally {
    clearInterval(heartbeat);
    clearTimeout(deadline);
    if (!hardCrash) {
      await releaseLease(db, jobId, leaseToken).catch(() => undefined);
    }
  }
}

/**
 * BullMQ has exhausted its attempts. Whatever state the row is in, it must
 * not stay in-flight forever - the job is parked in `dead_letter` for admin
 * replay (Phase 6). Best-effort: the cleanup sweep is the safety net.
 */
export async function deadLetterExhaustedJob(
  db: Database,
  jobId: string,
  code: string,
): Promise<void> {
  const job = await loadJob(db, jobId);
  if (!job || isTerminal(job.status)) return;

  const leaseAlive =
    LEASED.includes(job.status) &&
    job.leaseExpiresAt !== null &&
    job.leaseExpiresAt.getTime() > Date.now();
  if (leaseAlive) {
    // A worker is still heartbeating this job - BullMQ ran out of attempts
    // (e.g. a very slow but healthy run). Leave the row alone; it finishes
    // normally or the cleanup sweep requeues it with fresh attempts.
    logger.warn({ jobId }, 'retries exhausted while a live worker holds the lease');
    return;
  }

  if (job.status !== 'failed') {
    const parked = await parkAsFailed(db, jobId, {
      errorCode: code,
      errorMessage: 'Retries exhausted.',
    });
    if (!parked) return; // somebody else already decided the outcome
  }

  const dead = await transitionJob(db, {
    jobId,
    from: ['failed'],
    to: 'dead_letter',
    soft: true,
  });
  if (!dead) return;
  await enqueueDeadLetter(jobId, code).catch((err) =>
    logger.error({ err, jobId }, 'failed to enqueue dead-letter entry'),
  );
  logger.error({ jobId, code }, 'download job dead-lettered after exhausted retries');
}

/**
 * The download worker. Stateless: any worker can pick up any job, and the
 * lease in PostgreSQL decides who actually runs it (contract §7).
 */
export function createDownloadWorker(concurrency = config.queue.workerConcurrency): Worker {
  const worker = new Worker<DownloadJobData>(QUEUE_NAMES.downloads, handleDownloadJob, {
    connection: { url: config.redis.url },
    prefix: config.queue.prefix,
    concurrency,
    // BullMQ reads `backoffStrategy` off the *worker* that owns the job
    // (jobs are constructed with the worker as their queue), which is what
    // resolves `backoff: { type: 'custom' }` on the download jobs.
    settings: { backoffStrategy: backoffDelay },
    lockDuration: config.queue.leaseTtlMs,
  });

  worker.on('failed', (job, err) => {
    logger.warn(
      { jobId: job?.data.jobId, attemptsMade: job?.attemptsMade, err: err.message },
      'download job attempt failed',
    );
    const attempts = job?.opts.attempts ?? 0;
    if (job && attempts > 0 && job.attemptsMade >= attempts) {
      void deadLetterExhaustedJob(getDb(), job.data.jobId, errorCodeOf(err)).catch((deadErr) =>
        logger.error({ err: deadErr, jobId: job.data.jobId }, 'dead-letter finalize failed'),
      );
    }
  });
  worker.on('error', (err) => logger.error({ err }, 'download worker error'));

  return worker;
}
