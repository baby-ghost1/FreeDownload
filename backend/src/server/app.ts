import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';

import { config } from './config.js';
import { AppError, isAppError } from '../errors/app-error.js';
import { logger } from '../logging/logger.js';
import { registerHealthRoutes } from '../modules/health/routes.js';
import { readinessRegistry } from '../modules/health/readiness.js';
import { registerInfrastructureChecks } from '../modules/health/checks.js';
import { registerAuthRoutes } from '../modules/auth/routes.js';
import { registerMeRoutes } from '../modules/me/routes.js';
import { registerDownloadRoutes } from '../modules/downloads/routes.js';
import { registerCatalogRoutes } from '../modules/catalog/routes.js';
import { registerFilesRoutes } from '../modules/files/routes.js';
import { registerAdminRoutes } from '../modules/admin/routes.js';
import { registerApiKeyRoutes } from '../modules/apikeys/routes.js';
import { registerBillingRoutes } from '../modules/billing/routes.js';
import { closeQueues } from '../queue/queues.js';
import { assertCsrf, setCsrfCookie } from '../security/csrf.js';
import {
  loadApiKey,
  meterApiKeyError,
  meterApiKeyRequest,
  readBearerToken,
  touchApiKey,
} from '../security/api-key.js';
import { assertApiHourly, resolveQuota } from '../limits/engine.js';
import { loadSession, readSessionToken, touchSession } from '../modules/auth/session.js';
import {
  loadAdminSession,
  readAdminSessionToken,
  touchAdminSession,
} from '../modules/admin/session.js';
import { getDb } from '../database/client.js';
import { getRedis } from '../redis/client.js';
import type { AppInstance } from '../types/app.js';

export interface BuildAppOptions {
  /** Disable the in-memory rate limiter (unit tests). */
  rateLimit?: boolean;
}

const REQUEST_ID_HEADER = 'x-request-id';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Accept a caller-supplied request id only if it looks sane. */
function genReqId(req: IncomingMessage): string {
  const incoming = req.headers[REQUEST_ID_HEADER];
  if (typeof incoming === 'string' && /^[A-Za-z0-9._-]{8,64}$/.test(incoming)) {
    return incoming;
  }
  return randomUUID();
}

export async function buildApp(options: BuildAppOptions = {}): Promise<AppInstance> {
  const app = Fastify({
    loggerInstance: logger,
    trustProxy: config.trustProxy,
    genReqId,
    bodyLimit: 1_048_576, // 1 MiB â€” media never posts through the API (Â§9)
    ajv: { customOptions: { allErrors: true } },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(helmet, {
    // Frontend serves its own CSP (Next.js); the API only needs hard defaults.
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    hsts: config.isProduction ? { maxAge: 31_536_000, includeSubDomains: true } : false,
  });

  // Weather-API model for third-party sites: any browser origin may call
  // `/api/v1/downloads*`, but WITHOUT credentials - browsers then refuse
  // to attach session cookies, so only Bearer API keys work cross-origin.
  // Everything else keeps the strict origin allowlist WITH credentials.
  // Preflights never carry Authorization, so the decision is made on the
  // request path, never on headers.
  const corsMethods = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'];
  const corsAllowedHeaders = [
    'Content-Type',
    'Authorization',
    'Idempotency-Key',
    'X-Anon-Key',
    'X-CSRF-Token',
    'X-Request-Id',
    'X-Turnstile-Token',
  ];
  const corsExposedHeaders = [
    'X-Request-Id',
    'RateLimit-Limit',
    'RateLimit-Remaining',
    'RateLimit-Reset',
  ];
  await app.register(cors, {
    delegator: (req, cb) => {
      const shared = {
        methods: corsMethods,
        allowedHeaders: corsAllowedHeaders,
        exposedHeaders: corsExposedHeaders,
        maxAge: 600,
      };
      const origin = req.headers.origin;
      if (!origin || config.corsOrigins.includes(origin)) {
        // Own frontend / server-to-server: reflect + credentials.
        cb(null, { ...shared, origin: true, credentials: true });
        return;
      }
      const path = (req.url ?? '').split('?')[0] ?? '';
      if (path === '/api/v1/downloads' || path.startsWith('/api/v1/downloads/')) {
        cb(null, { ...shared, origin: '*', credentials: false });
        return;
      }
      cb(null, { ...shared, origin: false, credentials: true });
    },
  });

  // Signed when COOKIE_SECRET is configured â€” the token itself is
  // high-entropy and stored hashed, signing only adds tamper detection.
  await app.register(cookie, {
    ...(config.session.secret ? { secret: config.session.secret } : {}),
    parseOptions: { path: '/' },
  });

  if (options.rateLimit !== false) {
    await app.register(rateLimit, {
      global: true,
      // Emits `Ratelimit-*` (RFC draft) - the names the CORS expose list
      // below already publishes to browsers.
      enableDraftSpec: true,
      max: config.rateLimit.max,
      timeWindow: `${config.rateLimit.windowSec} seconds`,
      // Redis store keeps limits correct across replicas (§25). If Redis is
      // unreachable we fail open rather than taking the API down.
      redis: getRedis(),
      skipOnError: true,
      // The plugin *throws* this value (index.js), so it must arrive as a
      // real 429 error - a bare envelope object would fall through the
      // generic handler below and become a 500.
      errorResponseBuilder: (_req, context) => {
        const err = new Error(`Too many requests. Try again in ${context.after}.`) as Error & {
          statusCode?: number;
        };
        err.statusCode = 429;
        return err;
      },
    });
  }

  // --- session context ---------------------------------------------------
  // Body-less POSTs (cancel, logout) still arrive as `application/json` from
  // many clients. Treat an empty payload as "no body" instead of failing at
  // the parser; routes with a body schema keep rejecting it via validation.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_req, body: string, done) => {
      if (body.trim().length === 0) {
        done(null, undefined);
        return;
      }
      try {
        done(null, JSON.parse(body) as unknown);
      } catch {
        const err = new Error('Invalid JSON payload.') as Error & { statusCode?: number };
        err.statusCode = 400;
        done(err, undefined);
      }
    },
  );

  // Populated for every request; routes that need it call requireAuth().
  // Cookie-authenticated mutations also enforce double-submit CSRF here.
  app.decorateRequest('auth', null);
  app.decorateRequest('adminAuth', null);
  app.decorateRequest('apiKey', null);
  app.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
    const db = getDb();

    const token = readSessionToken(req);
    const context = token ? await loadSession(db, token) : null;
    req.auth = context;
    if (context) await touchSession(db, context.session);

    const adminToken = readAdminSessionToken(req);
    const adminContext = adminToken ? await loadAdminSession(db, adminToken, req.ip) : null;
    req.adminAuth = adminContext;
    if (adminContext) await touchAdminSession(db, adminContext.session);

    // Bearer API key (Phase 7): validated, metered and hourly-quota gated
    // before the route runs. An invalid key answers 401 - it never degrades
    // into anonymous traffic.
    if (!context) {
      const bearer = readBearerToken(req);
      if (bearer) {
        const keyContext = await loadApiKey(db, bearer);
        if (!keyContext) {
          throw new AppError('UNAUTHORIZED', 'The API key is invalid, expired or revoked.');
        }
        req.apiKey = keyContext;
        const quota = await resolveQuota(db, { userId: keyContext.key.userId });
        await assertApiHourly(db, keyContext.key.id, quota);
        await meterApiKeyRequest(db, keyContext.key.id).catch((err: unknown) =>
          req.log.warn({ err }, 'api usage meter failed'),
        );
        await touchApiKey(db, keyContext.key.id).catch(() => undefined);
      }
    }

    // Either ambient credential (user or admin cookie) demands double-submit.
    // Login/register are exempt: a stale session cookie whose CSRF cookie was
    // lost (expired, cleared, cross-device) would otherwise deadlock sign-in
    // - the login POST itself is rejected before it can issue fresh cookies.
    const path = req.routeOptions?.url ?? req.url;
    const isAuthEntryPoint =
      path.includes('/auth/login') || path.includes('/auth/register');
    if (!SAFE_METHODS.has(req.method) && (context || adminContext) && !isAuthEntryPoint) {
      assertCsrf(req);
    }

    // Self-heal: any safe request with a live session but a missing CSRF
    // cookie re-issues it (the session row is the source of truth), so the
    // next mutation no longer fails with "Invalid or missing CSRF token".
    if (SAFE_METHODS.has(req.method)) {
      const existing = req.cookies?.[config.session.csrfCookieName];
      if (!existing) {
        const token = adminContext?.session.csrfToken ?? context?.session.csrfToken;
        if (token) {
          setCsrfCookie(
            reply,
            token,
            adminContext ? config.admin.ttlSeconds : config.session.ttlSeconds,
          );
        }
      }
    }
  });

  // Failed API-key requests count toward the hourly `errors` bucket.
  app.addHook('onResponse', async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.apiKey && reply.statusCode >= 400) {
      await meterApiKeyError(getDb(), req.apiKey.key.id).catch((err: unknown) =>
        req.log.warn({ err }, 'api error meter failed'),
      );
    }
  });

  app.addHook('onSend', async (req, reply, payload) => {
    reply.header(REQUEST_ID_HEADER, req.id);
    return payload;
  });

  // Uniform error envelope (contract Â§46) â€” never expose stack traces.
  app.setErrorHandler((error: unknown, req: FastifyRequest, reply: FastifyReply) => {
    const requestId = String(req.id);

    if (isAppError(error)) {
      if (error.statusCode >= 500) {
        req.log.error({ err: error, code: error.code, requestId }, 'application error');
      } else {
        req.log.warn({ code: error.code, requestId, details: error.details }, 'client error');
      }
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.expose ? error.message : 'An unexpected error occurred.',
          requestId,
          ...(error.details ? { details: error.details } : {}),
        },
      });
    }

    const fastifyError = error as { statusCode?: number; validation?: unknown; message?: string };

    if (fastifyError.validation) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed.',
          requestId,
          // Field-level issues so clients can say WHAT failed, not just that it did.
          details: { fields: fastifyError.validation },
        },
      });
    }

    if (typeof fastifyError.statusCode === 'number' && fastifyError.statusCode < 500) {
      return reply.status(fastifyError.statusCode).send({
        error: {
          code: fastifyError.statusCode === 429 ? 'RATE_LIMITED' : 'VALIDATION_ERROR',
          message:
            fastifyError.statusCode === 429
              ? // The limiter builds a safe, actionable message ("retry in Ns").
                fastifyError.message || 'Too many requests. Please slow down.'
              : 'The request could not be processed.',
          requestId,
        },
      });
    }

    req.log.error({ err: error, requestId }, 'unhandled error');
    return reply.status(500).send({
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.', requestId },
    });
  });

  app.setNotFoundHandler((req: FastifyRequest, reply: FastifyReply) => {
    reply.status(404).send({
      error: {
        code: 'NOT_FOUND',
        message: `Route ${req.method} ${req.url} not found.`,
        requestId: String(req.id),
      },
    });
  });

  registerInfrastructureChecks();

  await app.register(registerHealthRoutes, { prefix: '' });
  // Business endpoints live under /api/v1; health probes stay at the root so
  // container orchestrators can reach them without knowing the API version.
  await app.register(
    async (scope: AppInstance) => {
      await registerAuthRoutes(scope);
      await registerMeRoutes(scope);
      await registerDownloadRoutes(scope);
      await registerCatalogRoutes(scope);
      await registerFilesRoutes(scope);
      await registerAdminRoutes(scope);
      await registerApiKeyRoutes(scope);
      await registerBillingRoutes(scope);
    },
    { prefix: '/api/v1' },
  );

  app.addHook('onClose', async () => {
    await closeQueues();
  });

  return app;
}

export { AppError, readinessRegistry };
