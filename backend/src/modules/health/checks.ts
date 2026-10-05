import { pingDatabase } from '../../database/client.js';
import { pingRedis } from '../../redis/client.js';
import { readinessRegistry } from './readiness.js';

/**
 * Registers Postgres and Redis readiness probes (contract §43).
 *
 * Under Vitest the probes report `skipped` so unit tests stay hermetic -
 * integration tests set `READINESS_LIVE=1` to exercise them against the
 * containers from `docker-compose.yml`.
 */
export function registerInfrastructureChecks(): void {
  const live = process.env.VITEST !== 'true' || process.env.READINESS_LIVE === '1';

  readinessRegistry.register({
    name: 'postgres',
    run: () => (live ? pingDatabase() : 'skipped'),
  });
  readinessRegistry.register({
    name: 'redis',
    run: () => (live ? pingRedis() : 'skipped'),
  });
}
