import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit configuration. SQL migrations are generated and committed under
 * `src/database/migrations/` — they are reviewed like code, never auto-applied
 * in production.
 */
export default defineConfig({
  schema: './src/database/schema/index.ts',
  out: './src/database/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      'postgres://freedownload:freedownload_dev@localhost:5432/freedownload',
  },
  strict: true,
  verbose: true,
});
