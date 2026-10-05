import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';

import { config } from '../server/config.js';
import { logger } from '../logging/logger.js';
import * as schema from './schema/index.js';

export type Database = NodePgDatabase<typeof schema>;

let pool: pg.Pool | undefined;
let db: Database | undefined;

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: config.database.url,
      max: config.database.poolMax,
      // Fail fast instead of hanging requests when the database is down.
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      // Set by the migration role in production; the runtime role is least
      // privilege (no DDL) - contract §14.
      application_name: config.serviceName,
    });
    pool.on('error', (err) => {
      logger.error({ err }, 'unexpected postgres pool error');
    });
  }
  return pool;
}

export function getDb(): Database {
  if (!db) {
    db = drizzle(getPool(), { schema });
  }
  return db;
}

/** Readiness probe - coarse status only, never connection details. */
export async function pingDatabase(): Promise<'pass' | 'fail'> {
  try {
    await getPool().query('select 1');
    return 'pass';
  } catch {
    return 'fail';
  }
}

export async function closeDatabase(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
    db = undefined;
  }
}
