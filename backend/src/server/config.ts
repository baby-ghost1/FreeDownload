import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

/**
 * Load env files if present - no dotenv dependency, Node's built-in loader.
 * Production reads `.env`, local development reads the committed
 * `.env.example`. Real environments (Render) inject variables directly, so
 * missing files are fine (injected values always win over file values).
 */
function loadDotEnv(): void {
  const name = process.env.NODE_ENV === 'production' ? '.env' : '.env.example';
  for (const base of [process.cwd(), resolve(process.cwd(), '..')]) {
    const candidate = resolve(base, name);
    if (existsSync(candidate)) {
      try {
        process.loadEnvFile(candidate);
      } catch {
        // A malformed file must not crash startup silently - surface below via schema.
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
  // Admin sessions live until explicit logout, capped at 30 days (§75).
  ADMIN_SESSION_TTL_MIN: z.coerce.number().int().min(5).default(43200),

  // --- rate limits (config-driven, contract §25) ---------------------------
  RATE_LIMIT_WINDOW_SEC: z.coerce.number().int().min(1).default(60),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
  DOWNLOAD_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(60),

  // --- quotas / billing (Phase 7) ------------------------------------------
  // Fallbacks only - `plans.limits` in the database wins (contract §25, §71).
  ANONYMOUS_DAILY_LIMIT: z.coerce.number().int().min(1).default(5),
  FREE_DAILY_LIMIT: z.coerce.number().int().min(1).default(25),
  PRO_DAILY_LIMIT: z.coerce.number().int().min(1).default(200),
  ANON_CONCURRENCY: z.coerce.number().int().min(1).default(1),
  USER_CONCURRENCY: z.coerce.number().int().min(1).default(2),
  API_KEY_HOURLY_LIMIT: z.coerce.number().int().min(1).default(60),
  PAYMENT_PROVIDER: z.enum(['none', 'stripe']).default('none'),
  PAYMENT_PROVIDER_SECRET: z.string().optional(),
  PAYMENT_WEBHOOK_SECRET: z.string().optional(),

  // --- abuse / Turnstile --------------------------------------------------
  TURNSTILE_SECRET_KEY: z.string().optional(),
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().optional(),
  // Temporary kill-switch for the bot check (abuse-prone - re-enable with
  // real keys before opening up). Defaults to enforced.
  TURNSTILE_DISABLED: boolish.default(false),

  // --- queue / workers (Phase 3) ------------------------------------------
  BULLMQ_PREFIX: z.string().min(1).default('fd'),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(4),
  QUEUE_RETRY_LIMIT: z.coerce.number().int().min(0).max(10).default(3),
  LEASE_TTL_MS: z.coerce.number().int().min(1_000).default(30_000),
  // Long 4K videos download for many minutes - 5 minutes killed them
  // mid-run (dead_letter SOURCE_TIMEOUT after 3 wasted retries).
  JOB_TIMEOUT_MS: z.coerce.number().int().min(1_000).default(1_800_000),
  CLEANUP_INTERVAL_MIN: z.coerce.number().int().min(1).default(15),
  SHUTDOWN_GRACE_MS: z.coerce.number().int().min(0).default(20_000),
  IDEMPOTENCY_TTL_H: z.coerce.number().int().min(1).default(24),
  // Which JobRunner the download worker drives: the real pipeline, or the
  // Phase 3 placeholder (tests default to placeholder; Phase 4 tests opt in).
  WORKER_RUNNER: z.enum(['pipeline', 'placeholder']).default('pipeline'),
  // Run the download/cleanup workers INSIDE the API process (free-tier
  // single service: one command serves HTTP and drains the queue).
  WORKER_IN_API: boolish.default(false),

  // --- download engine (Phase 4) ------------------------------------------
  SOURCE_TIMEOUT_MS: z.coerce.number().int().min(1_000).default(60_000),
  ANALYZE_CACHE_TTL_SEC: z.coerce.number().int().min(0).default(300),
  MAX_FILE_SIZE_MB: z.coerce.number().int().min(1).default(512),
  YTDLP_PATH: z.string().min(1).default('yt-dlp'),
  FFMPEG_PATH: z.string().min(1).default('ffmpeg'),
  FFPROBE_PATH: z.string().min(1).default('ffprobe'),
  // Tests exercise the full pipeline against a loopback fixture server; this
  // must stay false outside tests (contract security layer 3).
  SSRF_ALLOW_PRIVATE: boolish.default(false),

  // --- storage (Phase 4) ---------------------------------------------------
  STORAGE_DRIVER: z.enum(['local', 'r2']).default('local'),
  STORAGE_LOCAL_DIR: z.string().min(1).default('.storage'),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  R2_ENDPOINT: z.string().optional(),
  SIGNED_URL_TTL_SEC: z.coerce.number().int().min(30).default(300),
  R2_RETENTION_DAYS: z.coerce.number().int().min(1).default(7),

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
    if (env.STORAGE_DRIVER === 'r2') {
      for (const key of [
        'R2_ACCOUNT_ID',
        'R2_ACCESS_KEY_ID',
        'R2_SECRET_ACCESS_KEY',
        'R2_BUCKET',
      ] as const) {
        if (!env[key]) missing.push(key);
      }
    }
    if (env.SSRF_ALLOW_PRIVATE) missing.push('SSRF_ALLOW_PRIVATE (never in production)');
    if (env.WORKER_RUNNER === 'placeholder') missing.push('WORKER_RUNNER (pipeline required)');
    if (env.PAYMENT_PROVIDER === 'stripe') {
      if (!env.PAYMENT_PROVIDER_SECRET) missing.push('PAYMENT_PROVIDER_SECRET');
      if (!env.PAYMENT_WEBHOOK_SECRET) missing.push('PAYMENT_WEBHOOK_SECRET');
    }
    if (missing.length > 0) {
      throw new Error(
        `Production configuration incomplete - missing or default: ${missing.join(', ')}`,
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
  /** Admin panel (Phase 6) - separate cookie + short TTL (§75). */
  admin: {
    cookieName: 'fd_admin',
    ttlMinutes: env.ADMIN_SESSION_TTL_MIN,
    ttlSeconds: env.ADMIN_SESSION_TTL_MIN * 60,
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
  /** Plan/anonymous quotas (Phase 7) - DB `plans.limits` overrides these. */
  limits: {
    anonDaily: env.ANONYMOUS_DAILY_LIMIT,
    freeDaily: env.FREE_DAILY_LIMIT,
    proDaily: env.PRO_DAILY_LIMIT,
    anonConcurrency: env.ANON_CONCURRENCY,
    userConcurrency: env.USER_CONCURRENCY,
    apiKeyHourly: env.API_KEY_HOURLY_LIMIT,
  },
  /** Payments (Phase 7) - `none` keeps dev/test billing-free (NullProvider). */
  payment: {
    provider: env.PAYMENT_PROVIDER,
    secret: env.PAYMENT_PROVIDER_SECRET ?? '',
    webhookSecret: env.PAYMENT_WEBHOOK_SECRET ?? '',
    successUrl: `${env.APP_URL}/account?checkout=success`,
    cancelUrl: `${env.APP_URL}/account?checkout=cancelled`,
  },
  turnstile: {
    secretKey: env.TURNSTILE_SECRET_KEY,
    siteKey: env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
    // Verification is enforced in production; dev/test run without a key.
    // TURNSTILE_DISABLED=true drops enforcement entirely (temporary only).
    required: env.NODE_ENV === 'production' && !env.TURNSTILE_DISABLED,
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
  /** Download engine (Phase 4) - yt-dlp/FFmpeg executors, source policy. */
  source: {
    timeoutMs: env.SOURCE_TIMEOUT_MS,
    analyzeCacheTtlSec: env.ANALYZE_CACHE_TTL_SEC,
    maxFileSizeMb: env.MAX_FILE_SIZE_MB,
    ytdlpPath: env.YTDLP_PATH,
    ffmpegPath: env.FFMPEG_PATH,
    ffprobePath: env.FFPROBE_PATH,
    /** Test-only escape hatch; production validation rejects it below. */
    allowPrivate: env.SSRF_ALLOW_PRIVATE,
  },
  storage: {
    driver: env.STORAGE_DRIVER,
    localDir: env.STORAGE_LOCAL_DIR,
    signedUrlTtlSec: env.SIGNED_URL_TTL_SEC,
    retentionDays: env.R2_RETENTION_DAYS,
    r2: {
      accountId: env.R2_ACCOUNT_ID,
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      bucket: env.R2_BUCKET,
      endpoint: env.R2_ENDPOINT,
    },
  },
  worker: {
    runner: env.WORKER_RUNNER,
    embedded: env.WORKER_IN_API,
  },
} as const;

export type AppConfig = typeof config;

/**
 * Admin 2FA gate (§75): when on, login demands a TOTP code and every admin
 * route rejects sessions that have not completed enrollment. Off by default -
 * ADMIN_EMAIL/ADMIN_PASSWORD from .env are the boot credentials. Read at
 * request time so tests and ops can flip it without a restart.
 */
export function adminMfaRequired(): boolean {
  const raw = process.env.ADMIN_MFA_REQUIRED;
  return raw === 'true' || raw === '1';
}
