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
import { assertCsrf } from '../security/csrf.js';
import { loadSession, readSessionToken, touchSession } from '../modules/auth/session.js';
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
    bodyLimit: 1_048_576, // 1 MiB — media never posts through the API (§9)
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

  await app.register(cors, {
    origin(origin, cb) {
      // Same-origin / server-to-server callers send no Origin header.
      if (!origin) return cb(null, true);
      if (config.corsOrigins.includes(origin)) return cb(null, true);
      cb(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Idempotency-Key',
      'X-CSRF-Token',
      'X-Request-Id',
      'X-Turnstile-Token',
    ],
    exposedHeaders: ['X-Request-Id', 'RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset'],
    maxAge: 600,
  });

  // Signed when COOKIE_SECRET is configured — the token itself is
  // high-entropy and stored hashed, signing only adds tamper detection.
  await app.register(cookie, {
    ...(config.session.secret ? { secret: config.session.secret } : {}),
    parseOptions: { path: '/' },
  });

  if (options.rateLimit !== false) {
    await app.register(rateLimit, {
      global: true,
      max: config.rateLimit.max,
      timeWindow: `${config.rateLimit.windowSec} seconds`,
      // Redis store keeps limits correct across replicas (§25). If Redis is
      // unreachable we fail open rather than taking the API down.
      redis: getRedis(),
      skipOnError: true,
      errorResponseBuilder: (req, context) => ({
        error: {
          code: 'RATE_LIMITED',
          message: `Too many requests. Try again in ${context.after}.`,
          requestId: req.id,
        },
      }),
    });
  }

  // --- session context ---------------------------------------------------
  // Populated for every request; routes that need it call requireAuth().
  // Cookie-authenticated mutations also enforce double-submit CSRF here.
  app.decorateRequest('auth', null);
  app.addHook('preHandler', async (req: FastifyRequest) => {
    const token = readSessionToken(req);
    if (!token) {
      req.auth = null;
      return;
    }

    const db = getDb();
    const context = await loadSession(db, token);
    req.auth = context;

    if (context) {
      await touchSession(db, context.session);
      if (!SAFE_METHODS.has(req.method)) {
        assertCsrf(req);
      }
    }
  });

  app.addHook('onSend', async (req, reply, payload) => {
    reply.header(REQUEST_ID_HEADER, req.id);
    return payload;
  });

  // Uniform error envelope (contract §46) — never expose stack traces.
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
        error: { code: 'VALIDATION_ERROR', message: 'Request validation failed.', requestId },
      });
    }

    if (typeof fastifyError.statusCode === 'number' && fastifyError.statusCode < 500) {
      return reply.status(fastifyError.statusCode).send({
        error: {
          code: fastifyError.statusCode === 429 ? 'RATE_LIMITED' : 'VALIDATION_ERROR',
          message:
            fastifyError.statusCode === 429
              ? 'Too many requests. Please slow down.'
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
    },
    { prefix: '/api/v1' },
  );

  return app;
}

export { AppError, readinessRegistry };
