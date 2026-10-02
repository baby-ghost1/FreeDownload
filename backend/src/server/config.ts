import { z } from 'zod';

/**
 * Environment schema (contract §56, §71).
 *
 * The process refuses to start on invalid/missing configuration rather than
 * booting with silently wrong defaults. `.env.example` documents every key.
 */
const boolish = z
  .union([z.boolean(), z.string()])
  .transform((v) => v === true || v === 'true' || v === '1');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  SERVICE_NAME: z.string().min(1).default('backend-api'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  APP_URL: z.url().default('http://localhost:3000'),
  API_URL: z.url().default('http://localhost:4000'),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  TRUST_PROXY: boolish.default(false),

  // Populated in Phase 2+; declared now so .env.example stays authoritative.
  DATABASE_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),

  SESSION_SECRET: z.string().min(32).optional(),
  COOKIE_SECRET: z.string().min(32).optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    // Fail fast: misconfigured security-sensitive env must never boot silently.
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const env: Env = loadEnv();

export const config = {
  env: env.NODE_ENV,
  isProduction: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',
  port: env.PORT,
  serviceName: env.SERVICE_NAME,
  appUrl: env.APP_URL,
  apiUrl: env.API_URL,
  corsOrigins: env.CORS_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  logLevel: env.LOG_LEVEL,
  trustProxy: env.TRUST_PROXY,
  database: {
    url: env.DATABASE_URL ?? '',
    poolMax: 10,
  },
  redis: {
    url: env.REDIS_URL ?? '',
  },
} as const;

export type AppConfig = typeof config;
