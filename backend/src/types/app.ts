import type { RawServerDefault } from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { IncomingMessage } from 'node:http';
import type { ServerResponse } from 'node:http';
import type { Logger } from 'pino';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

/**
 * The API app instance type: Fastify 5 + Zod type provider + pino logger.
 * Shared by route modules and tests so every registration site agrees.
 */
export type AppInstance = FastifyInstance<
  RawServerDefault,
  IncomingMessage,
  ServerResponse<IncomingMessage>,
  Logger,
  ZodTypeProvider
>;
