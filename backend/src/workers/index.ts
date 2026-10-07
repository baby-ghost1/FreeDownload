import type { Worker } from 'bullmq';

import { config } from '../server/config.js';
import { logger } from '../logging/logger.js';
import { scheduleCleanup } from '../queue/queues.js';
import { createCleanupWorker } from './cleanup-worker.js';
import { createDownloadWorker } from './download-worker.js';

export interface WorkerHandles {
  download: Worker;
  cleanup: Worker;
}

/** Boots both workers and registers the periodic cleanup schedule. */
export async function startWorkers(
  downloadConcurrency = config.queue.workerConcurrency,
): Promise<WorkerHandles> {
  const handles: WorkerHandles = {
    download: createDownloadWorker(downloadConcurrency),
    cleanup: createCleanupWorker(),
  };
  await scheduleCleanup();
  logger.info({ concurrency: downloadConcurrency }, 'workers started (download, cleanup)');
  if (config.cobalt.apiUrl) {
    logger.info('cobalt fallback enabled for downloads');
  } else {
    // Env-gap trap: the API and worker are separate processes - COBALT_API_URL
    // must be set in BOTH terminals, or analyze falls back while downloads
    // stay yt-dlp-only and fail the same way as before.
    logger.warn('COBALT_API_URL unset - downloads run yt-dlp-only (no fallback)');
  }
  return handles;
}

/**
 * Graceful shutdown: stop taking new jobs, let in-flight ones finish within
 * `graceMs`, then force-close. Unfinished jobs simply lose their lease and
 * are retried elsewhere - workers are stateless (contract §7).
 */
export async function stopWorkers(
  handles: WorkerHandles,
  graceMs = config.queue.shutdownGraceMs,
): Promise<void> {
  await Promise.all([
    handles.download.pause().catch(() => undefined),
    handles.cleanup.pause().catch(() => undefined),
  ]);

  const closed = Promise.all([
    handles.download.close().catch(() => undefined),
    handles.cleanup.close().catch(() => undefined),
  ]);
  const grace = new Promise<'timeout'>((resolve) => {
    const timer = setTimeout(() => resolve('timeout'), graceMs);
    timer.unref?.();
  });

  const outcome = await Promise.race([closed.then(() => 'closed' as const), grace]);
  if (outcome === 'timeout') {
    // Jobs still running past the grace window are abandoned mid-flight;
    // their leases expire and another worker picks them up.
    await Promise.all([
      handles.download.close(true).catch(() => undefined),
      handles.cleanup.close(true).catch(() => undefined),
    ]);
  }
  logger.info({ graceMs, forced: outcome === 'timeout' }, 'workers stopped');
}
