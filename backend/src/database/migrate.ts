import { fileURLToPath } from 'node:url';

import { migrate } from 'drizzle-orm/node-postgres/migrator';

import { closeDatabase, getDb } from './client.js';
import { logger } from '../logging/logger.js';

/**
 * Applies committed SQL migrations from `src/database/migrations/`.
 *
 * Migrations are generated with `npm run db:generate`, reviewed like code and
 * applied with `npm run db:migrate`. They run in a transaction and the journal
 * lives in `__drizzle_migrations` (contract §14).
 */
export async function runMigrations(): Promise<void> {
  const db = getDb();
  const migrationsFolder = fileURLToPath(new URL('./migrations', import.meta.url));
  await migrate(db, { migrationsFolder });
}

const isDirectRun =
  import.meta.url.endsWith('migrate.ts') || import.meta.url.endsWith('migrate.js');

if (isDirectRun) {
  runMigrations()
    .then(async () => {
      logger.info('migrations applied');
      await closeDatabase();
      process.exit(0);
    })
    .catch(async (err: unknown) => {
      logger.error({ err }, 'migration failed');
      await closeDatabase();
      process.exit(1);
    });
}
