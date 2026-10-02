import { statSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { config } from '../../server/config.js';
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
 * Generic yt-dlp adapter — the only source-specific implementation in v1.
 * Everything source-specific stays behind the SourceAdapter interface, so a
 * future per-site adapter slots in without touching the pipeline.
 */

/** Format identifiers become command arguments — allowlist pattern §Layer 4. */
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
function buildFormats(raw: RawAnalysis): MediaFormatInfo[] {
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
  let audioBest: Cand | null = null;

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
      if (!audioBest || tbr > audioBest.tbr) audioBest = { fmt, tbr };
    }
  }

  const videoList = [...videoBest.entries()].sort((a, b) => {
    const [aH] = a[0].split('p.');
    const [bH] = b[0].split('p.');
    return Number(bH) - Number(aH) || b[1].tbr - a[1].tbr;
  });

  videoList.forEach(([group], idx) => {
    const [heightStr, ext] = group.split('.');
    const height = Number(heightStr);
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

  if (audioBest) {
    const ext = str(audioBest.fmt.ext) ?? 'm4a';
    out.push({
      key: uniqueKey(`audio.${ext}`),
      label: `Audio only (${ext.toUpperCase()})`,
      kind: 'audio',
      container: ext,
      vcodec: null,
      acodec: str(audioBest.fmt.acodec),
      bitrateKbps: num(audioBest.fmt.tbr) !== null ? Math.round(num(audioBest.fmt.tbr)!) : null,
      filesizeBytes: num(audioBest.fmt.filesize) ?? num(audioBest.fmt.filesize_approx),
      isDefault: out.length === 0,
      sortOrder: out.length,
    });
  }

  if (out.length === 0) {
    // Extractor reported no format table — offer one honest "best" entry.
    const ext = str(raw.ext) ?? 'mp4';
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

/**
 * yt-dlp format selector built from *our* validated selection — user input
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
          url,
        ],
        { signal: opts.signal, timeoutMs, maxStdoutBytes: 16 * 1024 * 1024 },
      );
      json = JSON.parse(stdout) as RawAnalysis;
    } catch (err) {
      if (err instanceof SourceError) throw err;
      if (err instanceof SyntaxError) {
        throw new SourceError('SOURCE_EXTRACT_FAILED', 'extractor returned unreadable data');
      }
      if (err instanceof ProcessError) {
        const tail = err.stderrTail.toLowerCase();
        if (tail.includes('timed out') || tail.includes('timeout')) {
          throw new SourceError('SOURCE_TIMEOUT', 'the source did not answer in time');
        }
        throw new SourceError('SOURCE_EXTRACT_FAILED', 'the source could not be analyzed');
      }
      throw err;
    }

    const duration = num(json.duration);
    return {
      externalId: str(json.id),
      title: str(json.title),
      durationSec: duration !== null ? Math.round(duration) : null,
      thumbnailUrl: str(json.thumbnail),
      uploader: str(json.uploader),
      pageUrl: str(json.webpage_url) ?? url,
      description: str(json.description),
      formats: buildFormats(json),
      sourceUrls: collectUrls(json),
    };
  },

  async download(url: string, opts: DownloadOptions): Promise<DownloadedArtifact> {
    const selector = buildSelector(opts.selection);
    const container = assertContainer(opts.selection.container);

    const controller = new AbortController();
    const onParentAbort = () => controller.abort();
    opts.signal.addEventListener('abort', onParentAbort, { once: true });

    let bail: Error | null = null;
    let lastProgress = 0;

    const args = [
      '--no-playlist',
      '--newline',
      '--no-warnings',
      '--socket-timeout',
      '15',
      '--max-filesize',
      `${opts.maxFileSizeMb}M`,
      '-f',
      selector,
      '--merge-output-format',
      container,
      '-o',
      join(opts.workDir, 'media.%(ext)s'),
      '--print',
      'after_move:filepath',
      url,
    ];

    try {
      const { stdout } = await runProcess(config.source.ytdlpPath, args, {
        signal: controller.signal,
        timeoutMs: config.source.timeoutMs,
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
      });

      if (bail) throw bail;

      const printed = stdout
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => /media\.[A-Za-z0-9]+$/.test(l));
      let filePath = printed.at(-1);

      if (!filePath) {
        const entries = await readdir(opts.workDir);
        const found = entries.find((e) => /^media\.[A-Za-z0-9]+$/.test(e));
        if (found) filePath = join(opts.workDir, found);
      }
      if (!filePath) {
        throw new SourceError('SOURCE_EXTRACT_FAILED', 'download produced no output file');
      }

      const stat = statSync(filePath);
      if (stat.size === 0) {
        throw new SourceError('SOURCE_INTEGRITY', 'downloaded file is empty');
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
          throw new SourceError('SOURCE_TOO_LARGE', 'the file exceeds the size limit');
        }
        if (tail.includes('timed out') || tail.includes('timeout')) {
          throw new SourceError('SOURCE_TIMEOUT', 'the source did not answer in time');
        }
        if (controller.signal.aborted) {
          throw new SourceError('SOURCE_TIMEOUT', 'download aborted');
        }
        throw new SourceError('SOURCE_UNAVAILABLE', 'the download could not be completed');
      }
      throw err;
    } finally {
      opts.signal.removeEventListener('abort', onParentAbort);
    }
  },
};
