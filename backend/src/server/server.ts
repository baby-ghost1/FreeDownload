import { buildApp } from './app.js';
import { config } from './config.js';
import { runMigrations } from '../database/migrate.js';
import { resolveSelfPingUrl, startSelfPing, type SelfPingHandle } from '../keepalive/self-ping.js';
import { logger } from '../logging/logger.js';
import { closeQueues } from '../queue/queues.js';
import { closeRedis } from '../redis/client.js';
import { startWorkers, stopWorkers, type WorkerHandles } from '../workers/index.js';

async function main(): Promise<void> {
  // The deploy image never runs `db:seed`, and until now nothing ran
  // migrations either - databases provisioned before a schema/data change
  // stayed stale after a redeploy (e.g. the missing `cobalt` source row).
  // Migrations are idempotent (journal-tracked), so running them on boot
  // keeps every environment in sync with the committed SQL.
  try {
    await runMigrations();
    logger.info('migrations up to date');
  } catch (err) {
    logger.error({ err }, 'migration failed - refusing to start against a stale schema');
    process.exit(1);
  }

  const app = await buildApp();

  let workers: WorkerHandles | null = null;
  if (config.worker.embedded) {
    // Free-tier single service: the API process also drains the queue, so
    // one command (and one Render free instance) runs everything.
    workers = await startWorkers();
  }
  let selfPing: SelfPingHandle | null = null;

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down');
    try {
      if (selfPing) selfPing.stop();
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
    if (config.selfPing.enabled) {
      const target = resolveSelfPingUrl(config.selfPing.url, config.selfPing.renderUrl);
      if (!target) {
        logger.warn(
          'SELF_PING_ENABLED without SELF_PING_URL or RENDER_EXTERNAL_URL - keepalive stays off',
        );
      } else {
        selfPing = startSelfPing({ url: target, intervalMs: config.selfPing.intervalMin * 60_000 });
        logger.info(
          { target, intervalMin: config.selfPing.intervalMin },
          'self-ping keepalive on',
        );
      }
    }
  } catch (err) {
    logger.fatal({ err }, 'failed to start api');
    process.exit(1);
  }
}

void main();
