/**
 * Worker entrypoint — Phase 1 placeholder.
 *
 * The real download/media/cleanup workers (BullMQ consumers, leases,
 * heartbeats) arrive in Phase 3. This process exists now so the `worker`
 * Docker target, healthcheck and deploy topology are exercised from day one.
 */
import { logger } from '../logging/logger.js';

const log = logger.child({ component: 'worker' });

log.info('worker placeholder started — queues arrive in Phase 3');

let ticks = 0;
const heartbeat = setInterval(() => {
  ticks += 1;
  log.debug({ ticks }, 'heartbeat');
}, 30_000);

function shutdown(signal: string): void {
  log.info({ signal }, 'worker placeholder shutting down');
  clearInterval(heartbeat);
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
