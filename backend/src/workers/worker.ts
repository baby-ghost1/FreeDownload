import { logger } from '../logging/logger.js';
import { closeQueues } from '../queue/queues.js';
import { closeRedis } from '../redis/client.js';
import { startWorkers, stopWorkers, type WorkerHandles } from './index.js';

/**
 * Worker process entrypoint (`npm run start:worker -w @freedownload/backend`).
 * Deliberately separate from the API process so the two scale independently.
 */
async function main(): Promise<void> {
  const handles: WorkerHandles = await startWorkers();

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'worker shutting down');

    await stopWorkers(handles);
    await closeQueues();
    await closeRedis();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'unhandled rejection in worker process');
  });
}

main().catch((err) => {
  logger.error({ err }, 'worker failed to start');
  process.exit(1);
});
