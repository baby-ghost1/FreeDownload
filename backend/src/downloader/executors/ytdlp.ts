import { statSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { config } from '../../server/config.js';
import { assertSafeUrl } from '../../security/ssrf.js';
import { SourceError } from '../errors.js';
import type {
  AnalyzeOptions,
  DownloadedArtifact,
  DownloadOptions,
  MediaAnalysis,
  MediaFormatInfo,
  SourceAdapter,
} from '../types.js';
import { ProcessError, runProcess } from './proc.js';

/**
 * Generic yt-dlp adapter - the only source-specific implementation in v1.
 * Everything source-specific stays behind the SourceAdapter interface, so a
 * future per-site adapter slots in without touching the pipeline.
 */

/** Format identifiers become command arguments - allowlist pattern §Layer 4. */
const CONTAINER_RE = /^[a-z0-9]{2,5}$/;

interface RawFormat {
  format_id?: unknown;
  ext?: unknown;
  width?: unknown;
  height?: unknown;
  fps?: unknown;
  vcodec?: unknown;
  acodec?: unknown;
  tbr?: unknown;
  filesize?: unknown;
  filesize_approx?: unknown;
  url?: unknown;
}

interface RawAnalysis {
  id?: unknown;
  title?: unknown;
  duration?: unknown;
  thumbnail?: unknown;
  uploader?: unknown;
  webpage_url?: unknown;
  original_url?: unknown;
  description?: unknown;
  ext?: unknown;
  formats?: RawFormat[];
  _type?: unknown;
  entries?: unknown;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function assertContainer(container: string): string {
  if (!CONTAINER_RE.test(container)) {
    throw new SourceError('SOURCE_EXTRACT_FAILED', 'unsupported output container');
  }
  return container;
}

/** Video formats grouped by (height, ext); best rendition wins per group. */
export function buildFormats(raw: RawAnalysis): MediaFormatInfo[] {
  const formats = Array.isArray(raw.formats) ? raw.formats : [];
  const out: MediaFormatInfo[] = [];
  const usedKeys = new Set<string>();

  const uniqueKey = (base: string): string => {
    let key = base;
    let n = 2;
    while (usedKeys.has(key)) key = `${base}#${n++}`;
    usedKeys.add(key);
    return key;
  };

  type Cand = { fmt: RawFormat; tbr: number };
  const videoBest = new Map<string, Cand>();
  // Audio grouped by container, best bitrate wins per group - mirrors the
  // video logic so every rendition the source offers (m4a, opus, mp3…)
  // shows up instead of a single "best" row.
  const audioBest = new Map<string, Cand>();

  for (const fmt of formats) {
    const ext = str(fmt.ext);
    if (!ext) continue;
    const height = num(fmt.height);
    const vcodec = str(fmt.vcodec) ?? 'none';
    const acodec = str(fmt.acodec) ?? 'none';
    const tbr = num(fmt.tbr) ?? 0;

    if (height !== null && height > 0 && vcodec !== 'none') {
      const key = `${height}p.${ext}`;
      const prev = videoBest.get(key);
      if (!prev || tbr > prev.tbr) videoBest.set(key, { fmt, tbr });
    } else if (acodec !== 'none' && vcodec === 'none') {
      const prev = audioBest.get(ext);
      if (!prev || tbr > prev.tbr) audioBest.set(ext, { fmt, tbr });
    }
  }

  const videoList = [...videoBest.entries()].sort((a, b) => {
    const [aH] = a[0].split('p.');
    const [bH] = b[0].split('p.');
    return Number(bH) - Number(aH) || b[1].tbr - a[1].tbr;
  });

  videoList.forEach(([group], idx) => {
    const [heightStr, ext] = group.split('.');
    // Group keys are `${height}p.${ext}` - parseInt("1080p") → 1080, whereas
    // Number("1080p") is NaN and would poison keys, labels and the DB row.
    const height = Number.parseInt(heightStr ?? '', 10);
    if (!Number.isFinite(height)) return;
    const { fmt } = videoBest.get(group)!;
    const width = num(fmt.width);
    out.push({
      key: uniqueKey(`${height}p.${ext}`),
      label: `${height}p ${ext!.toUpperCase()}`,
      kind: 'video',
      container: ext!,
      width,
      height,
      fps: num(fmt.fps),
      vcodec: str(fmt.vcodec),
      acodec: str(fmt.acodec),
      bitrateKbps: num(fmt.tbr) !== null ? Math.round(num(fmt.tbr)!) : null,
      filesizeBytes: num(fmt.filesize) ?? num(fmt.filesize_approx),
      isDefault: idx === 0,
      sortOrder: idx,
    });
  });

  // Highest bitrate first; the bitrate in the label keeps same-container
  // rows distinguishable (e.g. two opus renditions collapse to one row,
  // best wins - same rule as video).
  const audioList = [...audioBest.entries()].sort((a, b) => b[1].tbr - a[1].tbr);

  for (const [audioExt, { fmt }] of audioList) {
    const bitrate = num(fmt.tbr) !== null ? Math.round(num(fmt.tbr)!) : null;
    out.push({
      key: uniqueKey(`audio.${audioExt}`),
      label:
        bitrate !== null
          ? `Audio only (${audioExt.toUpperCase()} · ${bitrate}k)`
          : `Audio only (${audioExt.toUpperCase()})`,
      kind: 'audio',
      container: audioExt,
      vcodec: null,
      acodec: str(fmt.acodec),
      bitrateKbps: bitrate,
      filesizeBytes: num(fmt.filesize) ?? num(fmt.filesize_approx),
      isDefault: out.length === 0,
      sortOrder: out.length,
    });
  }

  if (out.length === 0) {
    // Extractor reported no format table - offer one honest "best" entry.
    // The raw ext is untrusted (yt-dlp emits values like `unknown_video`
    // for direct media) and must satisfy the same allowlist the API and the
    // pipeline enforce, or creating the job fails validation downstream.
    const rawExt = (str(raw.ext) ?? 'mp4').toLowerCase();
    const ext = CONTAINER_RE.test(rawExt) ? rawExt : 'mp4';
    out.push({
      key: uniqueKey(`best.${ext}`),
      label: `Best available (${ext.toUpperCase()})`,
      kind: 'video',
      container: ext,
      isDefault: true,
      sortOrder: 0,
    });
  }

  return out;
}

/**
 * yt-dlp stderr is developer-facing ("ERROR: [tiktok] ... TransportError").
 * Users get one of a small set of plain sentences instead - matched here so
 * both analyze and download report the same cause the same way.
 */
export interface ClassifiedFailure {
  code: string;
  message: string;
}

export function classifyExtractorFailure(stderrTail: string): ClassifiedFailure {
  const tail = stderrTail.toLowerCase();

  if (
    tail.includes('timed out') ||
    tail.includes('timeout') ||
    tail.includes('connect timeout') ||
    tail.includes('read timed out')
  ) {
    return {
      code: 'SOURCE_TIMEOUT',
      message: 'The source took too long to respond. Check the link and try again in a bit.',
    };
  }
  if (
    tail.includes('login required') ||
    tail.includes('log in') ||
    tail.includes('please login') ||
    tail.includes('sign in') ||
    tail.includes('cookies') ||
    tail.includes('account credentials') ||
    tail.includes('only works when logged') ||
    tail.includes('--username')
  ) {
    return {
      code: 'SOURCE_UNAVAILABLE',
      message:
        'This video needs a login on the source site, which downloads cannot use. Try a public link instead.',
    };
  }
  if (
    tail.includes('private video') ||
    tail.includes('video unavailable') ||
    tail.includes('no longer available') ||
    tail.includes('has been removed') ||
    tail.includes('has been deleted') ||
    tail.includes('no video could be found') ||
    tail.includes('removed by') ||
    tail.includes('not available in your country') ||
    tail.includes('blocked in your country') ||
    tail.includes('geo-block') ||
    tail.includes('geo block') ||
    tail.includes('copyright') ||
    tail.includes('account suspended') ||
    tail.includes('account terminated') ||
    tail.includes('does not exist') ||
    tail.includes('http error 404')
  ) {
    return {
      code: 'SOURCE_UNAVAILABLE',
      message:
        'This video is unavailable - it may be removed, private, or blocked in your region.',
    };
  }
  if (
    tail.includes('tls fingerprint') ||
    tail.includes('confirm you') ||
    tail.includes('too many requests') ||
    tail.includes('http error 429') ||
    tail.includes('temporarily blocked') ||
    tail.includes('access denied') ||
    tail.includes('http error 403')
  ) {
    return {
      code: 'SOURCE_UNAVAILABLE',
      message: 'The source blocked this request for now. Wait a few minutes and try again.',
    };
  }
  return {
    code: 'SOURCE_EXTRACT_FAILED',
    message:
      'We could not read this link. It may need a login, or the source changed how its pages work.',
  };
}

/**
 * Carousel/album links arrive as playlists. The flow works on one video, so
 * analyze the first entry that actually carries formats; a collection with
 * nothing playable gets a clear error instead of a bogus "best" row.
 */
export function pickVideoPayload(raw: RawAnalysis): RawAnalysis {
  if (raw._type !== 'playlist' || !Array.isArray(raw.entries)) return raw;
  for (const entry of raw.entries) {
    if (
      entry !== null &&
      typeof entry === 'object' &&
      Array.isArray((entry as RawAnalysis).formats) &&
      (entry as RawAnalysis).formats!.length > 0
    ) {
      return entry as RawAnalysis;
    }
  }
  throw new SourceError(
    'SOURCE_UNAVAILABLE',
    'This link is a collection, not a single video. Open one video from it and paste that link.',
  );
}

function collectUrls(raw: RawAnalysis): string[] {
  const urls = new Set<string>();
  const add = (v: unknown) => {
    if (typeof v === 'string' && /^https?:\/\//.test(v)) urls.add(v);
  };
  add(raw.webpage_url);
  add(raw.original_url);
  add(raw.thumbnail);
  for (const fmt of Array.isArray(raw.formats) ? raw.formats : []) add(fmt.url);
  return [...urls];
}

const AUDIO_EXTS = new Set(['mp3', 'm4a', 'aac', 'ogg', 'opus', 'wav', 'flac']);
const PAGE_FETCH_TIMEOUT_MS = 15_000;
const PAGE_FETCH_MAX_BYTES = 1_000_000;
const PAGE_FETCH_MAX_HOPS = 4;

export interface DirectMedia {
  url: string;
  ext: string;
  kind: 'video' | 'audio';
}

/**
 * Pure HTML scan for an embedded direct media file (og:audio / og:video /
 * audio-video tags first, then any same-shape file link). No fetching here,
 * so it is trivially unit-testable.
 */
export function extractDirectMediaUrl(
  html: string,
  baseUrl: string,
): { url: string; ext: string; kind: 'video' | 'audio' } | null {
  const text = html.replace(/&amp;/g, '&');
  const candidates: string[] = [];

  for (const prop of ['og:audio', 'og:video', 'twitter:player:stream']) {
    const m = new RegExp(
      `<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']+)["']`,
      'i',
    ).exec(text);
    if (m?.[1]) candidates.push(m[1]);
  }
  for (const tag of ['audio', 'video', 'source']) {
    const re = new RegExp(`<${tag}[^>]+src=["']([^"']+)["']`, 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null && candidates.length < 8) {
      if (m[1]) candidates.push(m[1]);
    }
  }
  const fileRe = /["'(\s=](https?:\/\/[^"'()\s<>]+\.(?:mp3|m4a|aac|ogg|opus|wav|flac|mp4|webm|mov|mkv)(?:\?[^"'()\s<>]*)?)/gi;
  let m: RegExpExecArray | null;
  while ((m = fileRe.exec(text)) !== null && candidates.length < 16) {
    if (m[1]) candidates.push(m[1]);
  }

  for (const raw of candidates) {
    let resolved: URL;
    try {
      resolved = new URL(raw, baseUrl);
    } catch {
      continue;
    }
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') continue;
    // Extension from the path, else from download-style query params
    // (`?f=song.mp3` as served by zedge's file endpoint).
    let ext: string | null = null;
    const pathMatch = /\.([A-Za-z0-9]{2,5})(?:[?#]|$)/.exec(resolved.pathname);
    if (pathMatch?.[1]) {
      ext = pathMatch[1].toLowerCase();
    } else {
      for (const key of ['f', 'file', 'filename', 'name']) {
        const param = resolved.searchParams.get(key) ?? '';
        const paramMatch = /\.([A-Za-z0-9]{2,5})$/.exec(param.trim().toLowerCase());
        if (paramMatch?.[1]) {
          ext = paramMatch[1];
          break;
        }
      }
    }
    if (!ext || !CONTAINER_RE.test(ext)) continue;
    return { url: resolved.toString(), ext, kind: AUDIO_EXTS.has(ext) ? 'audio' : 'video' };
  }
  return null;
}

async function fetchPageHtmlCapped(pageUrl: string, signal: AbortSignal): Promise<string | null> {
  let current = pageUrl;
  for (let hop = 0; hop < PAGE_FETCH_MAX_HOPS; hop++) {
    // Every hop is DNS-validated first - redirects to private addresses die here.
    await assertSafeUrl(current);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PAGE_FETCH_TIMEOUT_MS);
    const onParentAbort = () => ctrl.abort();
    if (signal.aborted) {
      clearTimeout(timer);
      return null;
    }
    signal.addEventListener('abort', onParentAbort, { once: true });
    try {
      const res = await fetch(current, {
        redirect: 'manual',
        signal: ctrl.signal,
        headers: {
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
          accept: 'text/html,application/xhtml+xml',
        },
      });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        await res.arrayBuffer().catch(() => undefined);
        if (!location) return null;
        try {
          current = new URL(location, current).toString();
        } catch {
          return null;
        }
        continue;
      }
      if (!res.ok) return null;
      const contentType = res.headers.get('content-type') ?? '';
      if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
        return null;
      }
      const reader = res.body?.getReader();
      if (!reader) return null;
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > PAGE_FETCH_MAX_BYTES) {
          await reader.cancel().catch(() => undefined);
          break;
        }
        chunks.push(value);
      }
      return Buffer.concat(chunks).toString('utf8');
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onParentAbort);
    }
  }
  return null;
}

/**
 * Universal direct-media fallback: when yt-dlp reports no format table
 * (artwork-only pages like zedge ringtones, podcast/blog embeds), scan the
 * page HTML for the real file. Zero per-platform code - the same path serves
 * every site that embeds a playable file. Returns null when nothing usable
 * is found so callers keep their previous behaviour.
 */
export async function discoverDirectMedia(
  pageUrl: string,
  signal: AbortSignal,
): Promise<DirectMedia | null> {
  const html = await fetchPageHtmlCapped(pageUrl, signal).catch(() => null);
  if (!html) return null;
  const found = extractDirectMediaUrl(html, pageUrl);
  if (!found) return null;
  try {
    await assertSafeUrl(found.url);
  } catch {
    return null;
  }
  return found;
}

/**
 * yt-dlp format selector built from *our* validated selection - user input
 * never reaches the command line verbatim.
 */
export function buildSelector(selection: {
  container: string;
  maxHeight?: number | null;
  audioOnly?: boolean;
}): string {
  assertContainer(selection.container);
  if (selection.audioOnly) return 'ba/bestaudio/best';

  const height = selection.maxHeight
    ? `[height<=${Math.min(Math.max(Math.round(selection.maxHeight), 144), 4320)}]`
    : '';
  const audio = selection.container === 'mp4' || selection.container === 'm4a' ? '[ext=m4a]' : '';
  return `bv*${height}[ext=${selection.container}]+ba${audio}/bv*${height}/b${height}/best`;
}

/**
 * yt-dlp fetch arguments for a validated selection. `--merge-output-format`
 * only accepts muxer containers (mp4/mkv/webm...) - audio targets like mp3
 * are rejected and yt-dlp exits immediately, so audio fetches omit it.
 * Container fixups for audio happen later in `ensureContainer`.
 */
export function buildFetchArgs(selection: {
  container: string;
  maxHeight?: number | null;
  audioOnly?: boolean;
}): string[] {
  const container = assertContainer(selection.container);
  const selector = buildSelector(selection);
  return selection.audioOnly
    ? ['-f', selector]
    : ['-f', selector, '--merge-output-format', container];
}

const PROGRESS_RE = /\]\s+(\d+(?:\.\d+)?)%/;

export const ytdlpAdapter: SourceAdapter = {
  key: 'generic',

  canHandle(url: URL): boolean {
    return url.protocol === 'http:' || url.protocol === 'https:';
  },

  async analyze(url: string, opts: AnalyzeOptions): Promise<MediaAnalysis> {
    const timeoutMs = opts.timeoutMs ?? config.source.timeoutMs;
    let json: RawAnalysis;
    try {
      const { stdout } = await runProcess(
        config.source.ytdlpPath,
        [
          '--dump-single-json',
          '--skip-download',
          '--no-playlist',
          '--no-warnings',
          '--socket-timeout',
          '15',
          // Fail fast on blocked hosts (yt-dlp defaults to 10 retries -
          // minutes of hanging on e.g. firewalled TikTok) instead of
          // burning the whole analyze timeout.
          '--retries',
          '2',
          url,
        ],
        { signal: opts.signal, timeoutMs, maxStdoutBytes: 16 * 1024 * 1024 },
      );
      json = JSON.parse(stdout) as RawAnalysis;
      json = pickVideoPayload(json);
    } catch (err) {
      if (err instanceof SourceError) throw err;
      if (err instanceof SyntaxError) {
        throw new SourceError(
          'SOURCE_EXTRACT_FAILED',
          'The extractor returned data we could not understand. Try again in a bit.',
        );
      }
      if (err instanceof ProcessError) {
        const { code, message } = classifyExtractorFailure(err.stderrTail);
        throw new SourceError(code, message);
      }
      throw err;
    }

    const duration = num(json.duration);
    let formats = buildFormats(json);
    let directUrl: string | null = null;
    if (!Array.isArray(json.formats) || json.formats.length === 0) {
      // No format table - offer the embedded direct file when the page has
      // one, instead of a blind "best" entry that may only fetch artwork.
      const direct = await discoverDirectMedia(url, opts.signal).catch(() => null);
      if (direct) {
        directUrl = direct.url;
        formats = [
          {
            key: `direct.${direct.ext}`,
            label: `Direct file (${direct.ext.toUpperCase()})`,
            kind: direct.kind,
            container: direct.ext,
            width: null,
            height: null,
            fps: null,
            vcodec: null,
            acodec: null,
            bitrateKbps: null,
            filesizeBytes: null,
            isDefault: true,
            sortOrder: 0,
          },
        ];
      }
    }
    const sourceUrls = collectUrls(json);
    if (directUrl) sourceUrls.push(directUrl);
    return {
      externalId: str(json.id),
      title: str(json.title),
      durationSec: duration !== null ? Math.round(duration) : null,
      thumbnailUrl: str(json.thumbnail),
      uploader: str(json.uploader),
      pageUrl: str(json.webpage_url) ?? url,
      description: str(json.description),
      formats,
      sourceUrls,
    };
  },

  async download(url: string, opts: DownloadOptions): Promise<DownloadedArtifact> {
    const fetchArgs = buildFetchArgs(opts.selection);
    const container = assertContainer(opts.selection.container);

    const controller = new AbortController();
    const onParentAbort = () => controller.abort();
    opts.signal.addEventListener('abort', onParentAbort, { once: true });

    let bail: Error | null = null;
    let lastProgress = 0;

    const baseArgs = [
      '--no-playlist',
      '--newline',
      '--no-warnings',
      '--socket-timeout',
      '15',
      '--max-filesize',
      `${opts.maxFileSizeMb}M`,
    ];

    const runFetcher = async (
      targetUrl: string,
      selectorArgs: string[],
    ): Promise<string | undefined> => {
      // The whole-run deadline (ctx.signal, from JOB_TIMEOUT_MS) aborts slow
      // downloads; this spawn backstop must not fire first, or long videos
      // die early no matter how generous the job timeout is.
      const { stdout } = await runProcess(
        config.source.ytdlpPath,
        [
          ...baseArgs,
          ...selectorArgs,
          '-o',
          join(opts.workDir, 'media.%(ext)s'),
          '--print',
          'after_move:filepath',
          targetUrl,
        ],
        {
          signal: controller.signal,
          timeoutMs: config.queue.jobTimeoutMs,
          onStdoutLine: (line) => {
            if (bail) return;
            const match = PROGRESS_RE.exec(line);
            if (match) {
              lastProgress = Math.min(Number(match[1]), 99);
              try {
                opts.onProgress(lastProgress);
              } catch (err) {
                // Cancellation arrived mid-download: stop the fetcher.
                bail = err instanceof Error ? err : new Error(String(err));
                controller.abort();
              }
            }
          },
        },
      );

      if (bail) throw bail;

      const printed = stdout
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => /media\.[A-Za-z0-9]+$/.test(l));
      const fromStdout = printed.at(-1);
      if (fromStdout) return fromStdout;

      const entries = await readdir(opts.workDir);
      const found = entries.find((e) => /^media\.[A-Za-z0-9]+$/.test(e));
      return found ? join(opts.workDir, found) : undefined;
    };

    try {
      let filePath = await runFetcher(url, fetchArgs);

      if (!filePath && !controller.signal.aborted) {
        // The page gave yt-dlp nothing playable (artwork-only pages like
        // zedge ringtones) - retry against the embedded direct file when the
        // page carries one. Still fully generic: no per-site code anywhere.
        const direct = await discoverDirectMedia(url, controller.signal).catch(() => null);
        if (direct) {
          opts.onProgress(5);
          filePath = await runFetcher(direct.url, []);
        }
      }
      if (!filePath) {
        throw new SourceError(
          'SOURCE_EXTRACT_FAILED',
          'The download finished but produced no file. Try another format.',
        );
      }

      const stat = statSync(filePath);
      if (stat.size === 0) {
        throw new SourceError('SOURCE_INTEGRITY', 'The downloaded file came back empty. Try again.');
      }

      const extMatch = /\.([A-Za-z0-9]+)$/.exec(basename(filePath));
      return {
        path: filePath,
        container: (extMatch?.[1] ?? container).toLowerCase(),
        sizeBytes: stat.size,
      };
    } catch (err) {
      if (bail) throw bail;
      if (err instanceof SourceError) throw err;
      if (err instanceof ProcessError) {
        const tail = err.stderrTail.toLowerCase();
        if (tail.includes('max-filesize') || tail.includes('larger than')) {
          throw new SourceError(
            'SOURCE_TOO_LARGE',
            'This file is bigger than the size limit. Try a lower quality.',
          );
        }
        if (controller.signal.aborted) {
          throw new SourceError('SOURCE_TIMEOUT', 'The download was stopped before it finished.');
        }
        const { code, message } = classifyExtractorFailure(err.stderrTail);
        throw new SourceError(code, message);
      }
      throw err;
    } finally {
      opts.signal.removeEventListener('abort', onParentAbort);
    }
  },
};
