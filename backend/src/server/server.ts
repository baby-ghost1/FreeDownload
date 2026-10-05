import { buildApp } from './app.js';
import { config } from './config.js';
import { logger } from '../logging/logger.js';
import { closeQueues } from '../queue/queues.js';
import { closeRedis } from '../redis/client.js';
import { startWorkers, stopWorkers, type WorkerHandles } from '../workers/index.js';

async function main(): Promise<void> {
  const app = await buildApp();

  let workers: WorkerHandles | null = null;
  if (config.worker.embedded) {
    // Free-tier single service: the API process also drains the queue, so
    // one command (and one Render free instance) runs everything.
    workers = await startWorkers();
  }

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down');
    try {
      if (workers) {
        await stopWorkers(workers);
        await closeQueues();
        await closeRedis();
      }
      await app.close();
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'unhandled promise rejection');
  });

  if (config.env === 'production' && !config.turnstile.required) {
    logger.warn('turnstile bot-check is DISABLED - anonymous endpoints are abuse-prone');
  }

  try {
    await app.listen({ port: config.port, host: '0.0.0.0' });
    logger.info({ port: config.port, url: `http://localhost:${config.port}` }, 'api listening');
  } catch (err) {
    logger.fatal({ err }, 'failed to start api');
    process.exit(1);
  }
}

void main();
