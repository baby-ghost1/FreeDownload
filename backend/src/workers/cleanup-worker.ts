import { Worker } from 'bullmq';

import { config } from '../server/config.js';
import { logger } from '../logging/logger.js';
import { QUEUE_NAMES } from '../queue/queues.js';
import { runCleanupSweep } from './cleanup.js';

/**
 * Periodic sweep: expiry, stale-lease requeue, row hygiene. Runs on its own
 * queue so a slow sweep can never delay a download job.
 */
export function createCleanupWorker(): Worker {
  const worker = new Worker(
    QUEUE_NAMES.cleanup,
    async (job) => {
      const stats = await runCleanupSweep();
      if (Object.values(stats).some((n) => n > 0)) {
        logger.info({ job: job.name, stats }, 'cleanup sweep applied changes');
      } else {
        logger.debug({ job: job.name }, 'cleanup sweep was a no-op');
      }
    },
    {
      connection: { url: config.redis.url },
      prefix: config.queue.prefix,
      concurrency: 1,
      lockDuration: 60_000,
    },
  );

  worker.on('error', (err) => logger.error({ err }, 'cleanup worker error'));
  return worker;
}
