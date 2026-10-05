import { z } from 'zod';

import { config } from '../../server/config.js';
import { getDb } from '../../database/client.js';
import type { AppInstance } from '../../types/app.js';
import { AppError } from '../../errors/app-error.js';
import { verifyTurnstile } from '../../security/turnstile.js';
import { errorResponses } from '../../http/error-schema.js';
import type { DownloadJob } from '../../database/schema/index.js';
import {
  analyzeDownloadUrl,
  cancelDownload,
  createDownload,
  getJobResult,
  getOwnedJob,
  listOwnJobs,
  startDownload,
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

/** Format keys are ours (`1080p.mp4`); containers become exec arguments. */
const FormatKey = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9.#_-]{0,63}$/);
const ContainerKey = z.string().regex(/^[a-z0-9]{2,5}$/);

const CreateBody = z.object({
  url: z.string().min(4).max(4_096),
  format: FormatKey.optional(),
  container: ContainerKey.optional(),
});

const AnalyzeBody = z.object({ url: z.string().min(4).max(4_096) });

const AnalyzeFormatSchema = z.object({
  key: z.string(),
  label: z.string(),
  kind: z.enum(['video', 'audio', 'other']),
  container: z.string(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  fps: z.number().nullable(),
  filesizeBytes: z.number().nullable(),
  isDefault: z.boolean(),
});

const AnalyzeResponse = z.object({
  url: z.string(),
  title: z.string().nullable(),
  durationSec: z.number().nullable(),
  thumbnailUrl: z.string().nullable(),
  uploader: z.string().nullable(),
  description: z.string().nullable(),
  formats: z.array(AnalyzeFormatSchema),
  cachedAt: z.string(),
});

const StartBody = z
  .object({
    format: FormatKey.optional(),
    container: ContainerKey.optional(),
  })
  .refine((b) => b.format !== undefined || b.container !== undefined, {
    message: 'Provide `format` and/or `container`.',
  });

const ResultResponse = z.object({
  url: z.string(),
  expiresAt: z.coerce.date(),
  sizeBytes: z.number().nullable(),
  container: z.string().nullable(),
  mimeType: z.string().nullable(),
});

const ParamsId = z.object({ id: z.uuid() });

const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
});

const ANON_KEY_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,200}$/;

function header(req: { headers: Record<string, unknown> }, name: string): string | undefined {
  const value = req.headers[name];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Who is asking: the signed-in user, an API-key client (Bearer), or an
 * anonymous caller presenting an `X-Anon-Key` they persist locally.
 */
function actorOf(req: {
  auth: { user: { id: string } } | null;
  apiKey: { key: { id: string; userId: string } } | null;
  headers: Record<string, unknown>;
}): DownloadActor & { apiKeyId?: string } {
  if (req.auth) return { userId: req.auth.user.id };
  if (req.apiKey) return { userId: req.apiKey.key.userId, apiKeyId: req.apiKey.key.id };

  const anonKey = header(req, 'x-anon-key');
  if (anonKey && ANON_KEY_PATTERN.test(anonKey)) return { anonKey };

  throw new AppError(
    'UNAUTHORIZED',
    'Sign in, or send an X-Anon-Key header to track anonymous downloads.',
  );
}

/** Only `toJobResponse` output ever reaches a client - no hashes, IPs, leases. */
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

      // Anonymous creation is the higher-abuse path (contract §15). API-key
      // clients already passed key validation + hourly metering upstream.
      if (!req.auth && !req.apiKey) {
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
            apiKeyId: actor.apiKeyId,
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
        description:
          'Jobs owned by the caller (session or X-Anon-Key), newest first (cursor paginated).',
        querystring: ListQuery,
        response: {
          200: z.object({ data: z.array(JobSchema), nextCursor: z.string().nullable() }),
          ...errorResponses(400, 401),
        },
      },
    },
    async (req) => {
      const page = await listOwnJobs(actorOf(req), req.query, getDb());
      return { data: page.data.map(toJobResponse), nextCursor: page.nextCursor };
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

  app.post(
    '/downloads/analyze',
    {
      config: createRateLimit,
      schema: {
        description:
          'Synchronous metadata extraction (cached ≤ ANALYZE_CACHE_TTL_SEC). ' +
          'SSRF + source policy are enforced before and after extraction.',
        body: AnalyzeBody,
        response: {
          200: AnalyzeResponse,
          ...errorResponses(400, 401, 403, 422, 429, 503),
        },
      },
    },
    async (req) => {
      actorOf(req); // analyze is authenticated traffic too (session/anon key)

      if (!req.auth) {
        await verifyTurnstile(header(req, 'x-turnstile-token'), req.ip);
      }
      return analyzeDownloadUrl(req.body.url, getDb());
    },
  );

  app.post(
    '/downloads/:id/start',
    {
      schema: {
        description:
          'Start a parked (`ready`) job with a chosen format; the worker ' +
          'resumes without re-analyzing.',
        params: ParamsId,
        body: StartBody,
        response: { 200: JobSchema, ...errorResponses(400, 401, 403, 404, 409, 503) },
      },
    },
    async (req) => {
      const job = await startDownload(req.params.id, {
        ...actorOf(req),
        format: req.body.format,
        container: req.body.container,
      });
      return toJobResponse(job);
    },
  );

  app.get(
    '/downloads/:id/result',
    {
      schema: {
        description:
          'Short-lived signed URL once the job is `completed`; media bytes ' +
          'are fetched directly from storage (never through the API).',
        params: ParamsId,
        response: { 200: ResultResponse, ...errorResponses(401, 404, 409) },
      },
    },
    async (req) => getJobResult(req.params.id, actorOf(req), getDb()),
  );
}
