import { and, desc, eq, isNull } from 'drizzle-orm';

import { AppError } from '../../errors/app-error.js';
import { config } from '../../server/config.js';
import { logger } from '../../logging/logger.js';
import { getDb, type Database } from '../../database/client.js';
import {
  downloadJobs,
  downloadSources,
  files,
  type DownloadJob,
} from '../../database/schema/index.js';
import { sha256 } from '../../utils/crypto.js';
import { enqueueDownloadJob } from '../../queue/queues.js';
import { getRedis } from '../../redis/client.js';
import { assertSafeAnalysisUrls, assertSafeUrl } from '../../security/ssrf.js';
import { getAdapterForUrl } from '../../downloader/detector.js';
import { SourceError, SourcePolicyError } from '../../downloader/errors.js';
import { assertSourceUsable, findSourceBySlug, loadSourcePolicy } from '../../downloader/policy.js';
import { getStorage } from '../../storage/index.js';
import { transitionJob } from './state-machine.js';

export interface DownloadActor {
  userId?: string | undefined;
  anonKey?: string | undefined;
}

export interface CreateDownloadInput extends DownloadActor {
  url: string;
  requestedFormat?: string | undefined;
  targetContainer?: string | undefined;
  ip?: string | undefined;
}

/** Statuses the user may cancel (everything before COMPLETED). */
const CANCELLABLE = [
  'created',
  'validating',
  'queued',
  'analyzing',
  'ready',
  'processing',
  'uploading',
  'failed',
  'retrying',
  'policy_restricted',
] as const;

/**
 * Basic URL sanity. Full SSRF validation (private ranges, redirects, DNS
 * rebinding) is the Phase 4 guard and runs again on every hop — this only
 * keeps obviously broken input out of the database.
 */
export function parsePublicUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new AppError('VALIDATION_ERROR', 'That does not look like a valid URL.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new AppError('VALIDATION_ERROR', 'Only http(s) URLs are supported.');
  }
  if (parsed.username || parsed.password) {
    throw new AppError('VALIDATION_ERROR', 'URLs with embedded credentials are not allowed.');
  }
  if (!parsed.hostname) {
    throw new AppError('VALIDATION_ERROR', 'URL must include a host.');
  }
  if (parsed.pathname.length > 2_048) {
    throw new AppError('VALIDATION_ERROR', 'URL is too long.');
  }
  return parsed;
}

/** Drop query/fragment/userinfo — tokens and tracking never hit the row. */
export function redactUrl(url: URL): string {
  return `${url.protocol}//${url.host}${url.pathname}`;
}

async function resolveSource(db: Database): Promise<string> {
  const rows = await db
    .select({ id: downloadSources.id, mode: downloadSources.mode })
    .from(downloadSources)
    .where(and(eq(downloadSources.slug, 'generic'), eq(downloadSources.enabled, true)))
    .limit(1);

  const source = rows[0];
  if (!source) {
    throw new AppError('UNSUPPORTED_SOURCE', 'No download source is currently available.');
  }
  if (source.mode !== 'active') {
    // Admins flip sources at runtime — no redeploy needed (contract §12).
    throw new AppError(
      source.mode === 'restricted' ? 'POLICY_RESTRICTED' : 'UNSUPPORTED_SOURCE',
      source.mode === 'restricted'
        ? 'This source is restricted by policy.'
        : 'This source is temporarily unavailable.',
    );
  }
  return source.id;
}

/**
 * Creates the job row, walks `created → validating → queued` and enqueues it.
 * The API performs **no** media work itself (contract invariant 1).
 */
export async function createDownload(
  input: CreateDownloadInput,
  db: Database = getDb(),
): Promise<DownloadJob> {
  const parsed = parsePublicUrl(input.url);
  const sourceId = await resolveSource(db);
  const urlHash = sha256(parsed.toString());
  const urlRedacted = redactUrl(parsed);

  const inserted = await db
    .insert(downloadJobs)
    .values({
      userId: input.userId ?? null,
      anonKey: input.anonKey ?? null,
      sourceId,
      url: parsed.toString(),
      urlHash,
      urlRedacted,
      requestedFormat: input.requestedFormat ?? null,
      targetContainer: input.targetContainer ?? null,
      // Fairness: authenticated jobs outrank anonymous ones; plan tiers
      // refine this in Phase 7 (clients never set priority).
      priority: input.userId ? 50 : 60,
      ip: input.ip ?? null,
      status: 'created',
      expiresAt: new Date(Date.now() + 24 * 3_600_000),
    })
    .returning();

  const job = inserted[0]!;

  try {
    const validating = await transitionJob(db, {
      jobId: job.id,
      from: ['created'],
      to: 'validating',
    });
    const queued = await transitionJob(db, {
      jobId: validating!.id,
      from: ['validating'],
      to: 'queued',
    });
    await enqueueDownloadJob(queued!.id);
    return queued!;
  } catch (err) {
    // Never leave a row stuck in a pre-queue state when enqueueing failed.
    await transitionJob(db, {
      jobId: job.id,
      from: ['created'],
      to: 'validating',
      soft: true,
    }).catch(() => undefined);
    await transitionJob(db, {
      jobId: job.id,
      from: ['validating', 'queued'],
      to: 'failed',
      patch: {
        errorCode: 'ENQUEUE_FAILED',
        errorMessage: 'Could not hand the job to the queue.',
      },
      soft: true,
    }).catch(() => undefined);

    logger.error({ err, jobId: job.id }, 'failed to enqueue download job');
    throw new AppError('SERVICE_UNAVAILABLE', 'The queue is unavailable. Please retry shortly.', {
      cause: err,
    });
  }
}

/** Ownership is checked here so handlers can answer 404 for foreign jobs. */
export async function getOwnedJob(
  jobId: string,
  actor: DownloadActor,
  db: Database = getDb(),
): Promise<DownloadJob | null> {
  const rows = await db.select().from(downloadJobs).where(eq(downloadJobs.id, jobId)).limit(1);

  const job = rows[0];
  if (!job) return null;

  const owns =
    (job.userId !== null && job.userId === actor.userId) ||
    (job.anonKey !== null && job.anonKey === actor.anonKey);

  return owns ? job : null;
}

export async function cancelDownload(
  jobId: string,
  actor: DownloadActor,
  db: Database = getDb(),
): Promise<DownloadJob> {
  const job = await getOwnedJob(jobId, actor, db);
  if (!job) {
    throw new AppError('NOT_FOUND', 'Download job not found.');
  }

  const cancelled = await transitionJob(db, {
    jobId: job.id,
    from: CANCELLABLE,
    to: 'cancelled',
    patch: { errorCode: 'CANCELLED', errorMessage: 'Cancelled by the user.' },
    soft: true,
  });

  if (!cancelled) {
    throw new AppError('CONFLICT', `A ${job.status} job can no longer be cancelled.`);
  }
  return cancelled;
}

export async function listOwnJobs(
  actor: DownloadActor,
  limit: number,
  db: Database = getDb(),
): Promise<DownloadJob[]> {
  if (!actor.userId && !actor.anonKey) {
    throw new AppError('UNAUTHORIZED', 'Authentication is required.');
  }

  const condition =
    actor.userId !== undefined
      ? eq(downloadJobs.userId, actor.userId)
      : and(eq(downloadJobs.anonKey, actor.anonKey ?? ''), isNull(downloadJobs.userId));

  return db
    .select()
    .from(downloadJobs)
    .where(condition)
    .orderBy(desc(downloadJobs.createdAt))
    .limit(Math.min(Math.max(limit, 1), 100));
}

export function actorFromRequest(
  auth: { user: { id: string } } | null,
  anonKey?: string,
): DownloadActor {
  return {
    userId: auth?.user.id,
    anonKey: auth ? undefined : anonKey,
  };
}

/** Source trouble never reaches clients verbatim — mapped to §46 codes. */
function mapSourceError(err: unknown): never {
  if (err instanceof SourcePolicyError) {
    throw new AppError('POLICY_RESTRICTED', err.message);
  }
  if (err instanceof SourceError) {
    throw new AppError(
      'SERVICE_UNAVAILABLE',
      'The source could not be reached. Try again shortly.',
      {
        cause: err,
      },
    );
  }
  throw err;
}

export interface AnalyzeFormat {
  key: string;
  label: string;
  kind: 'video' | 'audio' | 'other';
  container: string;
  width: number | null;
  height: number | null;
  fps: number | null;
  filesizeBytes: number | null;
  isDefault: boolean;
}

export interface AnalyzeResult {
  url: string;
  title: string | null;
  durationSec: number | null;
  thumbnailUrl: string | null;
  uploader: string | null;
  description: string | null;
  formats: AnalyzeFormat[];
  cachedAt: string;
}

const DESC_MAX = 1_000;

/**
 * Synchronous metadata extraction for `POST /downloads/analyze`: SSRF +
 * policy first, Redis-cached for ANALYZE_CACHE_TTL_SEC, then yt-dlp
 * `--skip-download`. Every URL the extractor reports is swept again before
 * anything is cached or returned (redirects, cross-host hops).
 */
export async function analyzeDownloadUrl(
  rawUrl: string,
  db: Database = getDb(),
): Promise<AnalyzeResult> {
  const parsed = parsePublicUrl(rawUrl);
  await assertSafeUrl(parsed);

  const policy = await findSourceBySlug('generic', db);
  try {
    assertSourceUsable(policy);
  } catch (err) {
    mapSourceError(err);
  }

  const adapter = getAdapterForUrl(parsed);
  const cacheKey = `analyze:${sha256(parsed.toString())}`;
  const ttl = config.source.analyzeCacheTtlSec;

  if (ttl > 0) {
    try {
      const hit = await getRedis().get(cacheKey);
      if (hit) return JSON.parse(hit) as AnalyzeResult;
    } catch (err) {
      logger.warn({ err }, 'analyze cache read failed; continuing');
    }
  }

  let analysis;
  try {
    analysis = await adapter.analyze(parsed.toString(), {
      signal: AbortSignal.timeout(config.source.timeoutMs),
      timeoutMs: config.source.timeoutMs,
    });
  } catch (err) {
    mapSourceError(err);
  }

  try {
    await assertSafeAnalysisUrls([
      analysis.pageUrl,
      analysis.thumbnailUrl,
      ...(analysis.sourceUrls ?? []),
    ]);
  } catch (err) {
    // Redirects can land anywhere — a private hop is a policy block, and
    // VALIDATION_ERROR from SSRF is exactly that.
    if (err instanceof AppError && err.code === 'VALIDATION_ERROR') {
      throw new AppError('POLICY_RESTRICTED', 'That source redirected to a private address.');
    }
    throw err;
  }

  const result: AnalyzeResult = {
    url: redactUrl(parsed),
    title: analysis.title?.slice(0, 500) ?? null,
    durationSec: analysis.durationSec ?? null,
    thumbnailUrl: analysis.thumbnailUrl ?? null,
    uploader: analysis.uploader?.slice(0, 250) ?? null,
    description: analysis.description?.slice(0, DESC_MAX) ?? null,
    formats: analysis.formats.map((f) => ({
      key: f.key,
      label: f.label,
      kind: f.kind,
      container: f.container,
      width: f.width ?? null,
      height: f.height ?? null,
      fps: f.fps !== null && f.fps !== undefined ? Math.round(f.fps) : null,
      filesizeBytes: f.filesizeBytes ?? null,
      isDefault: f.isDefault,
    })),
    cachedAt: new Date().toISOString(),
  };

  if (ttl > 0) {
    try {
      await getRedis().set(cacheKey, JSON.stringify(result), 'EX', ttl);
    } catch (err) {
      logger.warn({ err }, 'analyze cache write failed');
    }
  }
  return result;
}

export interface StartDownloadInput extends DownloadActor {
  format?: string | undefined;
  container?: string | undefined;
}

/**
 * Picks a format for a parked (`ready`) job and hands it back to the queue;
 * the worker takes the lease over without re-analyzing.
 */
export async function startDownload(
  jobId: string,
  input: StartDownloadInput,
  db: Database = getDb(),
): Promise<DownloadJob> {
  const job = await getOwnedJob(jobId, input, db);
  if (!job) throw new AppError('NOT_FOUND', 'Download job not found.');
  if (job.status !== 'ready') {
    throw new AppError('CONFLICT', `A ${job.status} job cannot be started.`);
  }

  const policy = job.sourceId ? await loadSourcePolicy(job.sourceId, db) : null;
  try {
    assertSourceUsable(policy, input.container ?? job.targetContainer ?? undefined);
  } catch (err) {
    mapSourceError(err);
  }

  const started = await transitionJob(db, {
    jobId,
    from: ['ready'],
    to: 'processing',
    patch: {
      requestedFormat: input.format ?? job.requestedFormat,
      targetContainer: input.container ?? job.targetContainer,
      errorCode: null,
      errorMessage: null,
    },
  });
  if (!started) {
    throw new AppError('CONFLICT', 'The job changed state — reload and try again.');
  }

  try {
    // A completed BullMQ entry from the analysis run still holds this id;
    // a fresh entry (dedupe off) is required to run the download phase.
    await enqueueDownloadJob(jobId, { dedupe: false });
  } catch (err) {
    logger.error({ err, jobId }, 'failed to enqueue started download');
    await transitionJob(db, {
      jobId,
      from: ['processing'],
      to: 'failed',
      patch: { errorCode: 'ENQUEUE_FAILED', errorMessage: 'Could not hand the job to the queue.' },
      soft: true,
    }).catch(() => undefined);
    throw new AppError('SERVICE_UNAVAILABLE', 'The queue is unavailable. Please retry shortly.');
  }
  return started;
}

export interface JobResult {
  url: string;
  expiresAt: Date;
  sizeBytes: number | null;
  container: string | null;
  mimeType: string | null;
}

/** Short-lived signed URL for a finished download (contract invariant 5). */
export async function getJobResult(
  jobId: string,
  actor: DownloadActor,
  db: Database = getDb(),
): Promise<JobResult> {
  const job = await getOwnedJob(jobId, actor, db);
  if (!job) throw new AppError('NOT_FOUND', 'Download job not found.');
  if (job.status !== 'completed') {
    throw new AppError('CONFLICT', `The download is ${job.status} — no result yet.`);
  }

  const rows = await db
    .select()
    .from(files)
    .where(and(eq(files.jobId, jobId), isNull(files.purgedAt)))
    .orderBy(desc(files.createdAt))
    .limit(1);
  const file = rows[0];
  if (!file) {
    throw new AppError('NOT_FOUND', 'The file has expired and been purged.');
  }

  const ttl = config.storage.signedUrlTtlSec;
  const url = await getStorage().signedUrl(file.objectKey, ttl);
  return {
    url,
    expiresAt: new Date(Date.now() + ttl * 1000),
    sizeBytes: file.sizeBytes ?? null,
    container: file.container ?? null,
    mimeType: file.mimeType ?? null,
  };
}
