import { z } from 'zod';

import { config } from '../../server/config.js';
import { getDb } from '../../database/client.js';
import type { AppInstance } from '../../types/app.js';
import { AppError } from '../../errors/app-error.js';
import { verifyTurnstile } from '../../security/turnstile.js';
import { errorResponses } from '../../http/error-schema.js';
import type { DownloadJob } from '../../database/schema/index.js';
import {
  cancelDownload,
  createDownload,
  getOwnedJob,
  listOwnJobs,
  type DownloadActor,
} from './service.js';
import { abortIdempotency, beginIdempotency, completeIdempotency } from './idempotency.js';
import { JOB_STATUSES, type JobStatus } from './state-machine.js';

const JobStatusSchema = z.enum(JOB_STATUSES as [JobStatus, ...JobStatus[]]);

const JobSchema = z.object({
  id: z.string(),
  status: JobStatusSchema,
  progress: z.number(),
  url: z.string().nullable(),
  requestedFormat: z.string().nullable(),
  targetContainer: z.string().nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  retryCount: z.number(),
  // Coerce because an idempotent replay is sent from the JSON row stored in
  // `idempotency_keys.response`, where timestamps are ISO strings.
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  expiresAt: z.coerce.date().nullable(),
  completedAt: z.coerce.date().nullable(),
});

const CreateBody = z.object({
  url: z.string().min(4).max(4_096),
  format: z.string().max(64).optional(),
  container: z.string().max(32).optional(),
});

const ParamsId = z.object({ id: z.uuid() });

const ListQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) });

const ANON_KEY_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,200}$/;

function header(req: { headers: Record<string, unknown> }, name: string): string | undefined {
  const value = req.headers[name];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Who is asking: the signed-in user, or an anonymous caller presenting an
 * `X-Anon-Key` they persist locally (Phase 7 attaches quotas to it).
 */
function actorOf(req: {
  auth: { user: { id: string } } | null;
  headers: Record<string, unknown>;
}): DownloadActor {
  if (req.auth) return { userId: req.auth.user.id };

  const anonKey = header(req, 'x-anon-key');
  if (anonKey && ANON_KEY_PATTERN.test(anonKey)) return { anonKey };

  throw new AppError(
    'UNAUTHORIZED',
    'Sign in, or send an X-Anon-Key header to track anonymous downloads.',
  );
}

/** Only `toJobResponse` output ever reaches a client — no hashes, IPs, leases. */
function toJobResponse(job: DownloadJob) {
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    url: job.urlRedacted,
    requestedFormat: job.requestedFormat,
    targetContainer: job.targetContainer,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
    retryCount: job.retryCount,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    expiresAt: job.expiresAt,
    completedAt: job.completedAt,
  };
}

export async function registerDownloadRoutes(app: AppInstance): Promise<void> {
  const createRateLimit = {
    rateLimit: {
      max: config.rateLimit.downloadMax,
      timeWindow: `${config.rateLimit.windowSec} seconds`,
    },
  } as const;

  app.post(
    '/downloads',
    {
      config: createRateLimit,
      schema: {
        description:
          'Create a download job. Honors Idempotency-Key; anonymous callers ' +
          'must present X-Anon-Key.',
        body: CreateBody,
        response: { 201: JobSchema, ...errorResponses(400, 401, 409, 422, 429, 503) },
      },
    },
    async (req, reply) => {
      const db = getDb();
      const actor = actorOf(req);

      // Anonymous creation is the higher-abuse path (contract §15).
      if (!req.auth) {
        await verifyTurnstile(header(req, 'x-turnstile-token'), req.ip);
      }

      const rawKey = header(req, config.idempotency.headerName);
      if (rawKey !== undefined && !IDEMPOTENCY_KEY_PATTERN.test(rawKey)) {
        throw new AppError(
          'VALIDATION_ERROR',
          'Idempotency-Key must be 8–200 characters of [A-Za-z0-9._:-].',
        );
      }

      const request = {
        url: req.body.url,
        format: req.body.format ?? null,
        container: req.body.container ?? null,
        owner: actor.userId ?? actor.anonKey ?? null,
      };

      if (rawKey) {
        const resolution = await beginIdempotency(db, {
          key: rawKey,
          scope: 'POST /downloads',
          request,
        });
        if (resolution.kind === 'replay') {
          return reply
            .status(201)
            .header('idempotent-replay', 'true')
            .send(resolution.response as z.infer<typeof JobSchema>);
        }
      }

      try {
        const job = await createDownload(
          {
            url: req.body.url,
            requestedFormat: req.body.format,
            targetContainer: req.body.container,
            userId: actor.userId,
            anonKey: actor.anonKey,
            ip: req.ip,
          },
          db,
        );

        const response = toJobResponse(job);
        if (rawKey) await completeIdempotency(db, rawKey, response);
        return reply.status(201).send(response);
      } catch (err) {
        // Release the key so the caller can retry the same request.
        if (rawKey) await abortIdempotency(db, rawKey);
        throw err;
      }
    },
  );

  app.get(
    '/downloads',
    {
      schema: {
        description: 'Jobs owned by the caller (session or X-Anon-Key).',
        querystring: ListQuery,
        response: { 200: z.object({ data: z.array(JobSchema) }) },
      },
    },
    async (req) => {
      const jobs = await listOwnJobs(actorOf(req), req.query.limit, getDb());
      return { data: jobs.map(toJobResponse) };
    },
  );

  app.get(
    '/downloads/:id',
    {
      schema: {
        description: 'Job status and progress. Foreign jobs answer 404.',
        params: ParamsId,
        response: { 200: JobSchema, ...errorResponses(401, 404) },
      },
    },
    async (req) => {
      const job = await getOwnedJob(req.params.id, actorOf(req), getDb());
      if (!job) throw new AppError('NOT_FOUND', 'Download job not found.');
      return toJobResponse(job);
    },
  );

  app.post(
    '/downloads/:id/cancel',
    {
      schema: {
        description: 'Cancel a job that has not completed yet.',
        params: ParamsId,
        response: { 200: JobSchema, ...errorResponses(401, 403, 404, 409) },
      },
    },
    async (req) => {
      const job = await cancelDownload(req.params.id, actorOf(req), getDb());
      return toJobResponse(job);
    },
  );
}
