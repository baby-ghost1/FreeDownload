import { and, desc, eq, isNull } from 'drizzle-orm';

import { AppError } from '../../errors/app-error.js';
import { logger } from '../../logging/logger.js';
import { getDb, type Database } from '../../database/client.js';
import { downloadJobs, downloadSources, type DownloadJob } from '../../database/schema/index.js';
import { sha256 } from '../../utils/crypto.js';
import { enqueueDownloadJob } from '../../queue/queues.js';
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
