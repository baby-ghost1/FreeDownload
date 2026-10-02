import { Redis } from 'ioredis';

import { config } from '../server/config.js';
import { logger } from '../logging/logger.js';

let client: Redis | undefined;

export function getRedis(): Redis {
  if (!client) {
    client = new Redis(config.redis.url, {
      // Tuned for rate limiting / queue use rather than interactive sessions
      // (recommended by @fastify/rate-limit).
      connectTimeout: 5_000,
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
      keyPrefix: `${config.redis.prefix}:`,
    });
    client.on('error', (err: Error) => {
      // Redis being down must degrade the app, not crash the process.
      logger.warn({ err: { message: err.message } }, 'redis connection error');
    });
  }
  return client;
}

export async function pingRedis(): Promise<'pass' | 'fail'> {
  try {
    const pong = await getRedis().ping();
    return pong === 'PONG' ? 'pass' : 'fail';
  } catch {
    return 'fail';
  }
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit().catch(() => undefined);
    client = undefined;
  }
}
