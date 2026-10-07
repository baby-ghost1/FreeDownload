import { createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';

import { config } from '../../server/config.js';
import { getDb } from '../../database/client.js';
import { assertSafeUrl } from '../../security/ssrf.js';
import { probeMedia } from '../../media/ffmpeg.js';
import { assertSourceUsable, findSourceBySlug } from '../policy.js';
import { SourceError } from '../errors.js';
import type {
  AnalyzeOptions,
  DownloadedArtifact,
  DownloadOptions,
  MediaAnalysis,
  MediaFormatInfo,
  SourceAdapter,
} from '../types.js';

/**
 * Cobalt fallback adapter - used only when the primary (yt-dlp) fails, never
 * first. Talks to a SELF-HOSTED cobalt instance (COBALT_API_URL); the public
 * api.cobalt.tools instance is bot-protected and not for third-party use.
 */

const CONTAINER_RE = /^[a-z0-9]{2,5}$/;
const COBALT_AUDIO_FORMATS = new Set(['best', 'mp3', 'ogg', 'wav', 'opus']);

const MIME_TO_EXT: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/x-matroska': 'mkv',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/flac': 'flac',
};

interface CobaltPickerItem {
  type?: unknown;
  url?: unknown;
  thumb?: unknown;
}

interface CobaltResponse {
  status?: unknown;
  url?: unknown;
  filename?: unknown;
  picker?: unknown;
  audio?: unknown;
  audioFilename?: unknown;
  error?: unknown;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** Container from a cobalt filename, sanitized like every other exec input. */
function containerOf(filename: string | null, fallback: string): string {
  const ext = filename ? /\.([A-Za-z0-9]{2,5})$/.exec(filename)?.[1]?.toLowerCase() : undefined;
  if (ext && CONTAINER_RE.test(ext)) return ext;
  return fallback;
}

function errorMessage(json: CobaltResponse): string {
  const err = (json.error ?? {}) as { code?: unknown };
  const code = str(err.code);
  if (code && /rate|limit|too many/i.test(code)) {
    return 'The fallback service is rate-limited right now. Try again in a bit.';
  }
  return 'The fallback service could not read this link. Try again in a bit.';
}

async function cobaltPost(
  pageUrl: string,
  body: Record<string, unknown>,
  opts: { signal: AbortSignal; timeoutMs: number },
): Promise<CobaltResponse> {
  const instance = config.cobalt.apiUrl;
  if (!instance) throw new Error('cobalt adapter used without COBALT_API_URL');
  let res: Response;
  try {
    res = await fetch(`${instance}/`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        ...(config.cobalt.apiKey ? { authorization: `Api-Key ${config.cobalt.apiKey}` } : {}),
      },
      body: JSON.stringify({ url: pageUrl, ...body }),
      signal: AbortSignal.any([opts.signal, AbortSignal.timeout(opts.timeoutMs)]),
    });
  } catch (err) {
    if (err instanceof SourceError) throw err;
    throw new SourceError(
      'SOURCE_UNAVAILABLE',
      'The fallback service did not answer. Try again in a bit.',
    );
  }
  if (!res.ok) {
    throw new SourceError(
      'SOURCE_UNAVAILABLE',
      `The fallback service answered ${res.status}. Try again in a bit.`,
    );
  }
  const json = (await res.json().catch(() => null)) as CobaltResponse | null;
  if (!json || typeof json !== 'object') {
    throw new SourceError(
      'SOURCE_EXTRACT_FAILED',
      'The fallback service returned data we could not understand.',
    );
  }
  if (json.status === 'error') throw new SourceError('SOURCE_EXTRACT_FAILED', errorMessage(json));
  return json;
}

function pickVideoLabel(index: number, total: number): string {
  return total > 1 ? `Video option ${index + 1}` : 'Best available (MP4)';
}

/**
 * First-party check: tunnel URLs live on our own configured instance, so
 * they are deployment-internal by construction. Everything else (CDN file
 * links, picker thumbs, redirects) goes through the SSRF sweep like any
 * extractor-reported URL.
 */
export function isInstanceUrl(rawUrl: string): boolean {
  try {
    const instance = config.cobalt.apiUrl;
    if (!instance) return false;
    return new URL(rawUrl).origin === new URL(instance).origin;
  } catch {
    return false;
  }
}

/**
 * Admin-console gate: the `cobalt` source row (enabled/mode/formats) applies
 * here exactly like yt-dlp's `generic` row. Missing or disabled row fails
 * closed with SourcePolicyError - which the fallback wrapper never retries
 * past and never falls back from.
 */
async function assertCobaltUsable(container?: string): Promise<void> {
  const policy = await findSourceBySlug('cobalt', getDb());
  assertSourceUsable(policy, container);
}

export const cobaltAdapter: SourceAdapter = {
  key: 'cobalt',

  canHandle(url: URL): boolean {
    return url.protocol === 'http:' || url.protocol === 'https:';
  },

  async analyze(pageUrl: string, opts: AnalyzeOptions): Promise<MediaAnalysis> {
    await assertCobaltUsable();
    const timeoutMs = opts.timeoutMs ?? config.source.timeoutMs;
    const json = await cobaltPost(
      pageUrl,
      { videoQuality: 'max', audioFormat: 'best' },
      { signal: opts.signal, timeoutMs },
    );

    const formats: MediaFormatInfo[] = [];
    const sourceUrls: string[] = [];

    if (json.status === 'tunnel' || json.status === 'redirect') {
      const fileUrl = str(json.url);
      if (!fileUrl) throw new SourceError('SOURCE_EXTRACT_FAILED', errorMessage(json));
      const container = containerOf(str(json.filename), 'mp4');
      formats.push({
        key: `cobalt.best.${container}`,
        label: `Best available (${container.toUpperCase()})`,
        kind: 'video',
        container,
        width: null,
        height: null,
        fps: null,
        vcodec: null,
        acodec: null,
        bitrateKbps: null,
        filesizeBytes: null,
        isDefault: true,
        sortOrder: 0,
      });
      // Instance tunnels are first-party (checked by origin at download);
      // only third-party URLs enter the SSRF sweep lists.
      if (!isInstanceUrl(fileUrl)) sourceUrls.push(fileUrl);
    } else if (json.status === 'picker' && Array.isArray(json.picker)) {      const items = (json.picker as CobaltPickerItem[]).filter(
        (it) => (it.type === 'video' || it.type === 'gif') && str(it.url),
      );
      items.forEach((it, i) => {
        formats.push({
          key: `cobalt.pick.${i}`,
          label: pickVideoLabel(i, items.length),
          kind: 'video',
          container: 'mp4',
          width: null,
          height: null,
          fps: null,
          vcodec: null,
          acodec: null,
          bitrateKbps: null,
          filesizeBytes: null,
          isDefault: i === 0,
          sortOrder: i,
        });
        sourceUrls.push(...[str(it.url)!].filter((u) => !isInstanceUrl(u)));
      });
      const audioUrl = str(json.audio);
      if (audioUrl) {
        formats.push({
          key: 'cobalt.audio',
          label: 'Audio only',
          kind: 'audio',
          container: 'mp3',
          width: null,
          height: null,
          fps: null,
          vcodec: null,
          acodec: null,
          bitrateKbps: null,
          filesizeBytes: null,
          isDefault: formats.length === 0,
          sortOrder: formats.length,
        });
        sourceUrls.push(...[audioUrl].filter((u) => !isInstanceUrl(u)));
      }
      if (formats.length === 0) {
        throw new SourceError(
          'SOURCE_UNAVAILABLE',
          'The fallback found nothing playable in this link.',
        );
      }
    } else {
      throw new SourceError('SOURCE_EXTRACT_FAILED', errorMessage(json));
    }

    return {
      externalId: null,
      title: null,
      durationSec: null,
      thumbnailUrl: null,
      uploader: null,
      pageUrl,
      description: null,
      formats,
      sourceUrls,
    };
  },

  async download(pageUrl: string, opts: DownloadOptions): Promise<DownloadedArtifact> {
    await assertCobaltUsable(opts.selection.container.toLowerCase());
    const timeoutMs = config.source.timeoutMs;
    const audioOnly = opts.selection.audioOnly === true;
    const videoQuality = audioOnly
      ? undefined
      : opts.selection.maxHeight
        ? String(Math.min(Math.max(Math.round(opts.selection.maxHeight), 144), 4320))
        : 'max';
    const requested = opts.selection.container.toLowerCase();
    const json = await cobaltPost(
      pageUrl,
      {
        ...(videoQuality ? { videoQuality } : {}),
        audioFormat: COBALT_AUDIO_FORMATS.has(requested) ? requested : 'best',
        downloadMode: audioOnly ? 'audio' : 'auto',
      },
      { signal: opts.signal, timeoutMs },
    );

    // Resolve the direct file: tunnel/redirect carry it, picker reuses the
    // item the analyze step already showed (encoded in the format key).
    let fileUrl: string | null = null;
    if (json.status === 'tunnel' || json.status === 'redirect') {
      fileUrl = str(json.url);
    } else if (json.status === 'picker' && Array.isArray(json.picker)) {
      // Same item the analyze step showed: the picked index travels inside
      // the selection (see resolveSelection), audio uses the picker audio.
      const items = json.picker as CobaltPickerItem[];
      if (audioOnly) {
        fileUrl = str(json.audio);
      } else {
        const idx = opts.selection.cobaltIndex ?? 0;
        const item = items[idx] ?? items[0];
        fileUrl = item ? str(item.url) : null;
      }
    }
    if (!fileUrl) {
      throw new SourceError(
        'SOURCE_UNAVAILABLE',
        'The fallback finished without a file. Try another format.',
      );
    }
    if (!isInstanceUrl(fileUrl)) await assertSafeUrl(fileUrl);

    // Stream to disk with a hard size cap - cobalt tunnels rarely send
    // content-length, so the cap (not the header) is the guard.
    const maxBytes = opts.maxFileSizeMb * 1024 * 1024;
    const res = await fetch(fileUrl, { signal: opts.signal }).catch(() => null);
    if (!res || !res.ok || !res.body) {
      throw new SourceError(
        'SOURCE_UNAVAILABLE',
        'The fallback file could not be fetched. Try again in a bit.',
      );
    }
    const total = Number(res.headers.get('content-length'));
    const hasTotal = Number.isFinite(total) && total > 0;
    if (hasTotal && total > maxBytes) {
      await res.arrayBuffer().catch(() => undefined);
      throw new SourceError(
        'SOURCE_TOO_LARGE',
        'This file is bigger than the size limit. Try a lower quality.',
      );
    }
    const ext =
      (res.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() &&
        MIME_TO_EXT[res.headers.get('content-type')!.split(';')[0]!.trim().toLowerCase()]) ||
      (CONTAINER_RE.test(requested) ? requested : 'mp4');
    const tmpPath = join(opts.workDir, `cobalt.${ext}`);
    const file = createWriteStream(tmpPath);
    let received = 0;
    try {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        if (opts.signal.aborted) throw new SourceError('SOURCE_TIMEOUT', 'The download was stopped.');
        received += chunk.length;
        if (received > maxBytes) {
          throw new SourceError(
            'SOURCE_TOO_LARGE',
            'This file is bigger than the size limit. Try a lower quality.',
          );
        }
        if (!file.write(chunk)) await new Promise<void>((r) => file.once('drain', r));
        if (hasTotal) {
          try {
            opts.onProgress(Math.min(99, Math.round((received / total) * 100)));
          } catch (err) {
            throw err instanceof Error ? err : new Error(String(err));
          }
        }
      }
    } finally {
      await new Promise<void>((resolve, reject) => {
        file.on('finish', () => resolve());
        file.on('error', reject);
        file.end();
      }).catch(() => undefined);
    }
    if (received === 0) {
      throw new SourceError('SOURCE_INTEGRITY', 'The fallback file came back empty. Try again.');
    }
    const { size } = await stat(tmpPath);

    // Never hand an audio request a video file (or vice versa) - the pipeline
    // would otherwise transcode it into a corrupt container.
    const probe = await probeMedia(tmpPath, { signal: opts.signal }).catch(() => null);
    if (audioOnly && probe?.hasVideo) {
      throw new SourceError(
        'SOURCE_EXTRACT_FAILED',
        'The fallback returned video instead of audio. Try another format.',
      );
    }

    return { path: tmpPath, container: ext, sizeBytes: size };
  },
};

/** Null when COBALT_API_URL is unset - yt-dlp runs solo. */
export function getCobaltAdapter(): SourceAdapter | null {
  if (!config.cobalt.apiUrl) return null;
  return cobaltAdapter;
}
