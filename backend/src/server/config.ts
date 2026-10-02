import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

/**
 * Load `.env` if present — no dotenv dependency, Node's built-in loader.
 * Checked in the workspace directory first, then the monorepo root.
 */
function loadDotEnv(): void {
  for (const candidate of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../.env')]) {
    if (existsSync(candidate)) {
      try {
        process.loadEnvFile(candidate);
      } catch {
        // A malformed .env must not crash startup silently — surface below via schema.
      }
      return;
    }
  }
}

loadDotEnv();

const boolish = z
  .union([z.boolean(), z.string()])
  .transform((v) => v === true || v === 'true' || v === '1');

const localDb = 'postgres://freedownload:freedownload_dev@localhost:5432/freedownload';

/**
 * Environment schema (contract §56, §71).
 *
 * The process refuses to start on invalid/missing configuration rather than
 * booting with silently wrong defaults. `.env.example` documents every key.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  SERVICE_NAME: z.string().min(1).default('backend-api'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  APP_URL: z.url().default('http://localhost:3000'),
  API_URL: z.url().default('http://localhost:4000'),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  TRUST_PROXY: boolish.default(false),

  // --- data ---------------------------------------------------------------
  DATABASE_URL: z.string().min(1).default(localDb),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  REDIS_PREFIX: z.string().min(1).default('fd'),

  // --- auth ---------------------------------------------------------------
  SESSION_SECRET: z.string().min(32).optional(),
  COOKIE_SECRET: z.string().min(32).optional(),
  SESSION_TTL_MIN: z.coerce.number().int().min(5).default(10_080),
  VERIFY_TOKEN_TTL_H: z.coerce.number().int().min(1).default(24),
  RESET_TOKEN_TTL_MIN: z.coerce.number().int().min(5).default(30),
  ARGON2_MEMORY_KIB: z.coerce.number().int().min(8192).default(65_536),
  ARGON2_TIME_COST: z.coerce.number().int().min(1).default(3),
  ARGON2_PARALLELISM: z.coerce.number().int().min(1).default(1),
  // Cross-site (Vercel frontend → VPS API) needs SameSite=None + Secure.
  // localhost is treated as trustworthy by browsers, so dev stays Lax.
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).optional(),
  COOKIE_SECURE: boolish.optional(),

  // --- rate limits (config-driven, contract §25) ---------------------------
  RATE_LIMIT_WINDOW_SEC: z.coerce.number().int().min(1).default(60),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
  DOWNLOAD_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(60),

  // --- abuse / Turnstile --------------------------------------------------
  TURNSTILE_SECRET_KEY: z.string().optional(),
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().optional(),

  // --- queue / workers (Phase 3) ------------------------------------------
  BULLMQ_PREFIX: z.string().min(1).default('fd'),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(4),
  QUEUE_RETRY_LIMIT: z.coerce.number().int().min(0).max(10).default(3),
  LEASE_TTL_MS: z.coerce.number().int().min(1_000).default(30_000),
  JOB_TIMEOUT_MS: z.coerce.number().int().min(1_000).default(300_000),
  CLEANUP_INTERVAL_MIN: z.coerce.number().int().min(1).default(15),
  SHUTDOWN_GRACE_MS: z.coerce.number().int().min(0).default(20_000),
  IDEMPOTENCY_TTL_H: z.coerce.number().int().min(1).default(24),

  // --- email --------------------------------------------------------------
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().default('FreeDownload <no-reply@example.com>'),
  MAIL_TRANSPORT: z.enum(['console', 'smtp']).default('console'),

  // --- observability ------------------------------------------------------
  SENTRY_DSN: z.string().optional(),
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

  const env = parsed.data;

  // Production hardening: secrets and real infrastructure are mandatory and
  // the local dev defaults must never be used (contract §56).
  if (env.NODE_ENV === 'production') {
    const missing: string[] = [];
    if (!env.SESSION_SECRET) missing.push('SESSION_SECRET');
    if (!env.COOKIE_SECRET) missing.push('COOKIE_SECRET');
    if (env.DATABASE_URL === localDb) missing.push('DATABASE_URL (dev default forbidden)');
    if (env.REDIS_URL === 'redis://localhost:6379')
      missing.push('REDIS_URL (dev default forbidden)');
    if (missing.length > 0) {
      throw new Error(
        `Production configuration incomplete — missing or default: ${missing.join(', ')}`,
      );
    }
  }

  return env;
}

export const env: Env = loadEnv();

const sameSite = env.COOKIE_SAMESITE ?? (env.NODE_ENV === 'production' ? 'none' : 'lax');
const cookieSecure = env.COOKIE_SECURE ?? env.NODE_ENV === 'production';

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
    url: env.DATABASE_URL,
    poolMax: env.DATABASE_POOL_MAX,
  },
  redis: {
    url: env.REDIS_URL,
    prefix: env.REDIS_PREFIX,
  },
  session: {
    ttlMinutes: env.SESSION_TTL_MIN,
    cookieName: 'fd_session',
    csrfCookieName: 'fd_csrf',
    csrfHeaderName: 'x-csrf-token',
    secure: cookieSecure,
    sameSite,
    ttlSeconds: env.SESSION_TTL_MIN * 60,
    /** Signs the session cookie when set (production). Empty = unsigned. */
    secret: env.COOKIE_SECRET ?? '',
  },
  tokens: {
    verifyTtlHours: env.VERIFY_TOKEN_TTL_H,
    resetTtlMinutes: env.RESET_TOKEN_TTL_MIN,
  },
  argon2: {
    memoryKib: env.ARGON2_MEMORY_KIB,
    timeCost: env.ARGON2_TIME_COST,
    parallelism: env.ARGON2_PARALLELISM,
  },
  rateLimit: {
    windowSec: env.RATE_LIMIT_WINDOW_SEC,
    max: env.RATE_LIMIT_MAX,
    authMax: env.AUTH_RATE_LIMIT_MAX,
    downloadMax: env.DOWNLOAD_RATE_LIMIT_MAX,
  },
  turnstile: {
    secretKey: env.TURNSTILE_SECRET_KEY,
    siteKey: env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
    // Verification is enforced in production; dev/test run without a key.
    required: env.NODE_ENV === 'production',
  },
  queue: {
    prefix: env.BULLMQ_PREFIX,
    workerConcurrency: env.WORKER_CONCURRENCY,
    /** Extra attempts after the first (total attempts = this + 1). */
    retryLimit: env.QUEUE_RETRY_LIMIT,
    leaseTtlMs: env.LEASE_TTL_MS,
    jobTimeoutMs: env.JOB_TIMEOUT_MS,
    cleanupIntervalMin: env.CLEANUP_INTERVAL_MIN,
    shutdownGraceMs: env.SHUTDOWN_GRACE_MS,
    /** Backoff base: 1s, 4s, 16s, 64s, 256s … (contract §Job lifecycle). */
    backoffBaseMs: 1_000,
  },
  idempotency: {
    ttlHours: env.IDEMPOTENCY_TTL_H,
    headerName: 'idempotency-key',
  },
  email: {
    transport: env.MAIL_TRANSPORT,
    from: env.SMTP_FROM,
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    user: env.SMTP_USER,
    password: env.SMTP_PASSWORD,
  },
} as const;

export type AppConfig = typeof config;
