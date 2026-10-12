import { buildApp } from './app.js';
import { config } from './config.js';
import { runMigrations } from '../database/migrate.js';
import { resolveSelfPingUrl, startSelfPing, type SelfPingHandle } from '../keepalive/self-ping.js';
import { logger } from '../logging/logger.js';
import { closeQueues } from '../queue/queues.js';
import { closeRedis } from '../redis/client.js';
import { startWorkers, stopWorkers, type WorkerHandles } from '../workers/index.js';

/**
 * Refuse to boot in production against a guessable admin credential.
 *
 * The env-boot admin password (`ADMIN_PASSWORD`) is the fallback login for the
 * seeded admin. A short/shared value (the .env.example shipped `220128`) turns
 * the admin panel into a brute-force target, and nothing else in the stack
 * rejects these values. Fail loudly at boot instead of shipping it.
 *
 * MFA itself is optional and enforced at request time via `adminMfaRequired()`
 * (set `ADMIN_MFA_REQUIRED=true` to require a TOTP code on admin routes); it is
 * no longer a boot blocker.
 */
function assertProductionAdminHardening(): void {
  if (config.env !== 'production') return;

  const envPassword = process.env.ADMIN_PASSWORD ?? '';
  if (envPassword.length > 0 && envPassword.length < 16) {
    logger.fatal(
      { length: envPassword.length },
      'ADMIN_PASSWORD is set but shorter than 16 characters - refusing to start in production',
    );
    process.exit(1);
  }
}

async function main(): Promise<void> {
  assertProductionAdminHardening();

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

  // Diagnostic: confirm yt-dlp cookie credentials reached this process (length
  // only - never the value). Render env vars only apply after a redeploy, so
  // "unset" here means the var is missing OR the service was not redeployed.
  if (config.source.cookiesB64) {
    logger.info(
      { bytes: config.source.cookiesB64.length },
      'yt-dlp cookies loaded from YTDLP_COOKIES_B64',
    );
  } else {
    logger.warn(
      'YTDLP_COOKIES_B64 unset - YouTube downloads from this IP may hit the bot-wall',
    );
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
        logger.info({ target, intervalMin: config.selfPing.intervalMin }, 'self-ping keepalive on');
      }
    }
  } catch (err) {
    logger.fatal({ err }, 'failed to start api');
    process.exit(1);
  }
}

void main();
