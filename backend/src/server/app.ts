import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
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
import type { AppInstance } from '../types/app.js';

export interface BuildAppOptions {
  /** Disable the in-memory rate limiter (unit tests). */
  rateLimit?: boolean;
}

const REQUEST_ID_HEADER = 'x-request-id';

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

  if (options.rateLimit !== false) {
    await app.register(rateLimit, {
      global: true,
      max: 300,
      timeWindow: '1 minute',
      // Phase 2 moves limits to Redis with per-plan buckets (§25).
      keyGenerator: (req) => req.ip,
      errorResponseBuilder: (req, context) => ({
        error: {
          code: 'RATE_LIMITED',
          message: `Too many requests. Try again in ${context.after}.`,
          requestId: req.id,
        },
      }),
    });
  }

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

  await app.register(registerHealthRoutes, { prefix: '' });

  return app;
}

export { AppError, readinessRegistry };
