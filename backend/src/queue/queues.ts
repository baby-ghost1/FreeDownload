import { Queue, type ConnectionOptions, type JobsOptions, type QueueOptions } from 'bullmq';

import { config } from '../server/config.js';
import { logger } from '../logging/logger.js';

/** Named queues (contract §Job lifecycle). */
export const QUEUE_NAMES = {
  downloads: 'downloads',
  cleanup: 'cleanup',
  deadLetter: 'dead-letter',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/**
 * BullMQ gets its own connection settings (no `keyPrefix`, and BullMQ's
 * workers require `maxRetriesPerRequest: null`) - deliberately separate from
 * the general-purpose client in `src/redis/client.ts`.
 */
function connectionOptions(): ConnectionOptions {
  return { url: config.redis.url };
}

/** Exponential backoff with jitter: 1s, 4s, 16s, 64s, 256s … (contract §9). */
export function backoffDelay(attemptsMade: number): number {
  const exponential = config.queue.backoffBaseMs * 4 ** Math.max(0, attemptsMade - 1);
  const capped = Math.min(exponential, 300_000);
  const jitter = Math.floor(Math.random() * (capped * 0.25));
  return capped + jitter;
}

const downloadJobOptions: JobsOptions = {
  attempts: config.queue.retryLimit + 1,
  backoff: { type: 'custom' },
  // Keep the failed set small but replayable for a day.
  removeOnComplete: { age: 3_600, count: 5_000 },
  removeOnFail: { age: 86_400, count: 10_000 },
};

const queues = new Map<string, Queue>();

export function getQueue(name: string): Queue {
  const existing = queues.get(name);
  if (existing) return existing;

  const opts: QueueOptions = {
    connection: connectionOptions(),
    prefix: config.queue.prefix,
  };
  if (name === QUEUE_NAMES.downloads) opts.defaultJobOptions = downloadJobOptions;

  const queue = new Queue(name, opts);
  queues.set(name, queue);
  return queue;
}

/**
 * Enqueue a download job for processing.
 *
 * The BullMQ job id is pinned to the database job id so a double enqueue
 * (client retry, API crash between insert and enqueue, cleanup requeue) can
 * never create a second concurrent delivery - duplicates would burn retry
 * attempts while a healthy worker owns the job. Cleanup passes
 * `dedupe: false` because it only runs when the previous BullMQ entry is
 * known to be gone.
 */
export async function enqueueDownloadJob(
  jobId: string,
  options: { dedupe?: boolean } = {},
): Promise<void> {
  const opts: JobsOptions = {
    attempts: config.queue.retryLimit + 1,
    backoff: { type: 'custom' },
    removeOnComplete: { age: 3_600, count: 5_000 },
    removeOnFail: { age: 86_400, count: 10_000 },
  };
  if (options.dedupe ?? true) opts.jobId = jobId;

  await getQueue(QUEUE_NAMES.downloads).add('process', { jobId }, opts);
  logger.debug({ jobId, dedupe: options.dedupe ?? true }, 'download job enqueued');
}

/** Terminal failures land here for admin inspection and replay (Phase 6). */
export async function enqueueDeadLetter(jobId: string, reason: string): Promise<void> {
  await getQueue(QUEUE_NAMES.deadLetter).add(
    'dead',
    { jobId, reason, at: new Date().toISOString() },
    { removeOnComplete: false, removeOnFail: false },
  );
}

/** Runs the periodic cleanup pass (expiry, requeue of stale leases, sweeps). */
export async function scheduleCleanup(): Promise<void> {
  const queue = getQueue(QUEUE_NAMES.cleanup);
  await queue.upsertJobScheduler(
    'cleanup',
    { every: config.queue.cleanupIntervalMin * 60_000 },
    { name: 'sweep', data: {} },
  );
  logger.debug({ everyMin: config.queue.cleanupIntervalMin }, 'cleanup scheduler registered');
}

export async function closeQueues(): Promise<void> {
  const open = [...queues.values()];
  queues.clear();
  await Promise.all(open.map((queue) => queue.close().catch(() => undefined)));
}
