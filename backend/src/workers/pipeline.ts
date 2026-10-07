import { open, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';

import { config } from '../server/config.js';
import { logger } from '../logging/logger.js';
import { getDb, type Database } from '../database/client.js';
import {
  downloadJobs,
  files,
  mediaFormats,
  mediaMetadata,
  type DownloadJob,
} from '../database/schema/index.js';
import { AppError } from '../errors/app-error.js';
import { assertSafeAnalysisUrls, assertSafeUrl } from '../security/ssrf.js';
import { getAdapterForUrl } from '../downloader/detector.js';
import { SourceError, SourcePolicyError } from '../downloader/errors.js';
import { assertSourceUsable, loadSourcePolicy, type SourcePolicy } from '../downloader/policy.js';
import type { FormatSelection, MediaAnalysis } from '../downloader/types.js';
import { ensureContainer, probeMedia, sniffContainer } from '../media/ffmpeg.js';
import { getStorage, jobObjectKey } from '../storage/index.js';
import {
  JobAbortedError,
  SimulatedCrashError,
  placeholderRunner,
  runnerControls,
  type JobRunner,
  type RunnerContext,
  type RunOutcome,
} from './runner.js';

/**
 * The real download pipeline (Phase 4). Stage transitions still go through
 * `ctx.report`, so leases, heartbeats, cancellation and retries behave
 * exactly as they did under the Phase 3 placeholder.
 *
 *   queued → analyzing   policy + SSRF + extract metadata   (30%)
 *          → ready       format chosen? else park here
 *          → processing  yt-dlp download + verify + convert  (50-85%)
 *          → uploading   storage.put + files row             (88-95%)
 *          → completed   (finishSuccess in the worker)
 */

const CONTAINER_RE = /^[a-z0-9]{2,5}$/;
const DESC_MAX = 1_000;
const MB = 1024 * 1024;

function mimeOf(container: string): string {
  switch (container) {
    case 'mp4':
    case 'mov':
      return 'video/mp4';
    case 'm4a':
      return 'audio/mp4';
    case 'webm':
      return 'video/webm';
    case 'mkv':
      return 'video/x-matroska';
    case 'mp3':
      return 'audio/mpeg';
    case 'ogg':
    case 'opus':
      return 'audio/ogg';
    case 'flac':
      return 'audio/flac';
    case 'avi':
      return 'video/x-msvideo';
    default:
      return 'application/octet-stream';
  }
}

async function loadJob(db: Database, jobId: string): Promise<DownloadJob | null> {
  const rows = await db.select().from(downloadJobs).where(eq(downloadJobs.id, jobId)).limit(1);
  return rows[0] ?? null;
}

/** URL/policy violations are terminal - never retried, never dead-lettered. */
function asPolicy(err: unknown, message: string): never {
  if (err instanceof AppError && err.code === 'VALIDATION_ERROR') {
    throw new SourcePolicyError(message);
  }
  throw err;
}

async function sweepAnalysisUrls(analysis: MediaAnalysis): Promise<void> {
  try {
    await assertSafeAnalysisUrls([
      analysis.pageUrl,
      analysis.thumbnailUrl,
      ...(analysis.sourceUrls ?? []),
    ]);
  } catch (err) {
    asPolicy(err, 'The source redirected to a private or internal address.');
  }
}

async function saveAnalysis(
  db: Database,
  jobId: string,
  analysis: MediaAnalysis,
  adapterKey: string,
): Promise<void> {
  await db
    .insert(mediaMetadata)
    .values({
      jobId,
      externalId: analysis.externalId ?? null,
      title: analysis.title?.slice(0, 500) ?? null,
      durationSec: analysis.durationSec,
      thumbnailUrl: analysis.thumbnailUrl,
      uploader: analysis.uploader?.slice(0, 250) ?? null,
      pageUrl: analysis.pageUrl,
      descriptionTrunc: analysis.description?.slice(0, DESC_MAX) ?? null,
      raw: { adapter: adapterKey, analyzedAt: new Date().toISOString() },
      fetchedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: mediaMetadata.jobId,
      set: {
        externalId: analysis.externalId ?? null,
        title: analysis.title?.slice(0, 500) ?? null,
        durationSec: analysis.durationSec,
        thumbnailUrl: analysis.thumbnailUrl,
        uploader: analysis.uploader?.slice(0, 250) ?? null,
        pageUrl: analysis.pageUrl,
        descriptionTrunc: analysis.description?.slice(0, DESC_MAX) ?? null,
        raw: { adapter: adapterKey, analyzedAt: new Date().toISOString() },
        fetchedAt: new Date(),
      },
    });

  await db.delete(mediaFormats).where(eq(mediaFormats.jobId, jobId));
  if (analysis.formats.length > 0) {
    await db.insert(mediaFormats).values(
      analysis.formats.map((f) => ({
        jobId,
        label: f.label.slice(0, 120),
        kind: f.kind,
        container: f.container,
        width:
          f.width !== null && f.width !== undefined && Number.isFinite(f.width) ? f.width : null,
        height:
          f.height !== null && f.height !== undefined && Number.isFinite(f.height)
            ? f.height
            : null,
        fps:
          f.fps !== null && f.fps !== undefined && Number.isFinite(f.fps)
            ? Math.round(f.fps)
            : null,
        vcodec: f.vcodec,
        acodec: f.acodec,
        bitrateKbps: f.bitrateKbps,
        filesizeBytes: f.filesizeBytes,
        isDefault: f.isDefault,
        sortOrder: f.sortOrder,
        extKey: f.key,
      })),
    );
  }
}

/** Turns `requestedFormat`/`targetContainer` into a validated selection. */
async function resolveSelection(
  db: Database,
  job: DownloadJob,
): Promise<{ selection: FormatSelection; policy: SourcePolicy | null }> {
  const policy = job.sourceId ? await loadSourcePolicy(job.sourceId, db) : null;

  let container = job.targetContainer?.toLowerCase() ?? '';
  let maxHeight: number | null = null;
  let audioOnly = false;

  if (job.requestedFormat) {
    const rows = await db
      .select()
      .from(mediaFormats)
      .where(eq(mediaFormats.jobId, job.id))
      .limit(50);
    const picked =
      rows.find(
        (r) =>
          r.extKey === job.requestedFormat ||
          r.label.toLowerCase() === job.requestedFormat!.toLowerCase(),
      ) ?? rows.find((r) => r.container === job.requestedFormat!.toLowerCase());

    if (picked) {
      container ||= picked.container;
      maxHeight = picked.height;
      audioOnly = picked.kind === 'audio';
    } else {
      // No analysis row - accept it as a plain container request.
      container ||= job.requestedFormat.toLowerCase();
    }
  }

  container ||= 'mp4';
  if (!CONTAINER_RE.test(container)) {
    throw new SourcePolicyError('That output container is not supported.');
  }
  assertSourceUsable(policy, container);

  return { selection: { container, maxHeight, audioOnly }, policy };
}

async function sniffHead(path: string): Promise<string | null> {
  const handle = await open(path, 'r');
  try {
    const buf = Buffer.alloc(16);
    const { bytesRead } = await handle.read(buf, 0, 16, 0);
    return sniffContainer(buf.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

async function downloadPhase(db: Database, ctx: RunnerContext, job: DownloadJob): Promise<void> {
  const rawUrl = job.url;
  if (!rawUrl) {
    // The raw URL is nulled only at expiry - a missing one here means the
    // row was tampered with or expired mid-run. Retrying cannot help.
    throw new SourceError('SOURCE_UNAVAILABLE', 'The original URL is no longer available.');
  }

  const { selection, policy } = await resolveSelection(db, job);

  if (job.status === 'ready') {
    await ctx.report(50, {
      from: ['ready'],
      to: 'processing',
      patch: { startedAt: new Date() },
    });
  } else {
    // `processing` (start endpoint) - heartbeat only.
    await ctx.report(50);
  }

  const workDir = await mkdtemp(join(tmpdir(), `fd-${ctx.jobId.slice(0, 8)}-`));
  let asyncErr: unknown = null;

  try {
    const adapter = getAdapterForUrl(new URL(rawUrl));
    const maxMb = policy?.maxFileSizeMb ?? config.source.maxFileSizeMb;

    const artifact = await adapter.download(rawUrl, {
      workDir,
      signal: ctx.signal,
      selection,
      maxFileSizeMb: maxMb,
      onProgress(percent) {
        // A failed progress write (cancel/lease loss) aborts the fetcher on
        // the next progress line instead of running to completion.
        if (asyncErr) throw asyncErr;
        void ctx.report(50 + Math.round(Math.min(percent, 100) * 0.3)).catch((err) => {
          asyncErr ??= err;
        });
      },
    });
    if (asyncErr) throw asyncErr;
    if (ctx.signal.aborted) throw new JobAbortedError('job aborted');

    // Layer 5: magic bytes + size + a real stream probe before storage.
    const sniffed = await sniffHead(artifact.path);
    if (!sniffed) {
      throw new SourceError(
        'SOURCE_INTEGRITY',
        'The downloaded file is not recognized media. Try another format.',
      );
    }
    const size = (await stat(artifact.path)).size;
    if (size > maxMb * MB) {
      throw new SourceError(
        'SOURCE_TOO_LARGE',
        'This file is bigger than the size limit. Try a lower quality.',
      );
    }

    const probe = await probeMedia(artifact.path, { signal: ctx.signal });
    if (!probe.hasAudio && !probe.hasVideo) {
      throw new SourceError(
        'SOURCE_INTEGRITY',
        'The downloaded file has no playable streams. Try another format.',
      );
    }

    const ensured =
      artifact.container === selection.container
        ? artifact
        : await ensureContainer(artifact.path, selection.container, { signal: ctx.signal });

    if ((await stat(ensured.path)).size === 0) {
      throw new SourceError(
        'SOURCE_INTEGRITY',
        'The conversion produced an empty file. Try another format.',
      );
    }

    await ctx.report(86, { from: ['processing'], to: 'uploading' });

    const key = jobObjectKey(ctx.jobId, ensured.container);
    const stored = await getStorage().put(ensured.path, key, mimeOf(ensured.container));
    await ctx.report(95);

    await db
      .insert(files)
      .values({
        jobId: ctx.jobId,
        objectKey: key,
        kind: 'media',
        sizeBytes: stored.sizeBytes,
        mimeType: mimeOf(ensured.container),
        checksumSha256: stored.sha256,
        container: ensured.container,
        expiresAt: new Date(Date.now() + config.storage.retentionDays * 86_400_000),
      })
      .onConflictDoUpdate({
        target: files.objectKey,
        set: {
          sizeBytes: stored.sizeBytes,
          mimeType: mimeOf(ensured.container),
          checksumSha256: stored.sha256,
          container: ensured.container,
          purgedAt: null,
          expiresAt: new Date(Date.now() + config.storage.retentionDays * 86_400_000),
        },
      });

    logger.info(
      { jobId: ctx.jobId, container: ensured.container, bytes: stored.sizeBytes },
      'pipeline artifact stored',
    );
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

const pipelineRunner: JobRunner = {
  async run(ctx: RunnerContext): Promise<RunOutcome> {
    if (runnerControls.failNext > 0) {
      runnerControls.failNext -= 1;
      throw new SimulatedCrashError();
    }

    const db = getDb();
    const job = await loadJob(db, ctx.jobId);
    if (!job) throw new JobAbortedError('job disappeared');
    if (job.status === 'cancelled') throw new JobAbortedError('job cancelled');

    // Takeover entries (start endpoint, reclaim) skip straight to download.
    if (job.status === 'ready' || job.status === 'processing') {
      if (!job.url) {
        throw new SourceError('SOURCE_UNAVAILABLE', 'The original URL is no longer available.');
      }
      try {
        await assertSafeUrl(job.url);
      } catch (err) {
        asPolicy(err, 'That URL points to a private or internal address.');
      }
      if (job.sourceId) {
        const policy = await loadSourcePolicy(job.sourceId, db);
        assertSourceUsable(policy, job.targetContainer ?? undefined);
      }
      await downloadPhase(db, ctx, job);
      return 'completed';
    }

    // Retries and crash recoveries already store the extractor output -
    // re-running a full analyze on every attempt is what bounced doomed
    // jobs between `analyzing` and `processing` for minutes. Reuse it.
    // (Lease acquisition already moved the row to `analyzing`, so that
    // status counts as "not yet analyzed this attempt" here too.)
    const savedFormats = await db
      .select({ id: mediaFormats.id })
      .from(mediaFormats)
      .where(eq(mediaFormats.jobId, ctx.jobId))
      .limit(1);
    if (
      savedFormats.length > 0 &&
      (job.status === 'queued' || job.status === 'retrying' || job.status === 'analyzing')
    ) {
      if (job.status !== 'analyzing') {
        await ctx.report(5, { from: [job.status], to: 'analyzing' });
      } else {
        await ctx.report(5);
      }
      // Same lifecycle as a fresh analysis: `analyzing → ready` first, then
      // download with a freshly loaded row. Skipping the `ready` hop leaves
      // the row in `analyzing`, and every later `processing → ...`
      // transition aborts with "job left processing" on every single retry.
      await ctx.report(30, {
        from: ['analyzing'],
        to: 'ready',
        patch: { analyzedAt: new Date() },
      });
      const reloaded = await loadJob(db, ctx.jobId);
      if (!reloaded) throw new JobAbortedError('job disappeared');
      if (!reloaded.requestedFormat && !reloaded.targetContainer) {
        return 'awaiting_format';
      }
      await downloadPhase(db, ctx, reloaded);
      return 'completed';
    }

    // --- analysis stage (entry: `analyzing`) ------------------------------
    const rawUrl = job.url;
    if (!rawUrl) {
      throw new SourceError('SOURCE_UNAVAILABLE', 'The original URL is no longer available.');
    }
    await ctx.report(5);

    try {
      await assertSafeUrl(rawUrl);
    } catch (err) {
      asPolicy(err, 'That URL points to a private or internal address.');
    }

    if (job.sourceId) {
      const policy = await loadSourcePolicy(job.sourceId, db);
      assertSourceUsable(policy, job.targetContainer ?? undefined);
    }

    const adapter = getAdapterForUrl(new URL(rawUrl));
    const analysis = await adapter.analyze(rawUrl, {
      signal: ctx.signal,
      timeoutMs: config.source.timeoutMs,
    });
    await sweepAnalysisUrls(analysis);

    await saveAnalysis(db, ctx.jobId, analysis, adapter.key);
    await ctx.report(30, {
      from: ['analyzing'],
      to: 'ready',
      patch: { analyzedAt: new Date() },
    });

    // No format chosen yet: park in `ready` until POST /downloads/:id/start.
    if (!job.requestedFormat && !job.targetContainer) return 'awaiting_format';

    const reloaded = await loadJob(db, ctx.jobId);
    if (!reloaded) throw new JobAbortedError('job disappeared');
    await downloadPhase(db, ctx, reloaded);
    return 'completed';
  },
};

/** Chosen per delivery so tests can flip `runnerControls.mode` mid-suite. */
export function activeRunner(): JobRunner {
  return runnerControls.mode === 'pipeline' ? pipelineRunner : placeholderRunner;
}
