import net from 'node:net';

const PG_PORT = Number(process.env.PGPORT ?? 5432);
const REDIS_PORT = Number(process.env.REDISPORT ?? 6379);

function canConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    const finish = (ok: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(1_000, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

/**
 * Integration tests need Postgres and Redis (docker compose up). Locally they
 * skip when the containers are down so `npm test` stays green; in CI they
 * always run - a missing service there is a pipeline failure, not a skip.
 */
export async function infraAvailable(): Promise<boolean> {
  const [pg, redis] = await Promise.all([canConnect(PG_PORT), canConnect(REDIS_PORT)]);
  return pg && redis;
}

export const inCi = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
