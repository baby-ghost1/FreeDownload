import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { config } from '../server/config.js';
import { SourceError } from '../downloader/errors.js';
import { ProcessError, runProcess } from '../downloader/executors/proc.js';

/**
 * FFmpeg remux-first pipeline (contract: "remux only if needed"): copying
 * streams is instant and lossless; re-encoding happens only when the target
 * container cannot hold the source codecs.
 */

export interface MediaProbe {
  durationSec: number | null;
  width: number | null;
  height: number | null;
  vcodec: string | null;
  acodec: string | null;
  sizeBytes: number | null;
  hasVideo: boolean;
  hasAudio: boolean;
}

/** Magic bytes first - a file named `video.mp4` proves nothing (layer 5). */
export function sniffContainer(buf: Buffer): string | null {
  if (buf.length < 12) return null;

  // ISO-BMFF: [size]['ftyp'][brand]
  if (buf.subarray(4, 8).toString('latin1') === 'ftyp') {
    const rawBrand = buf.subarray(8, 12).toString('latin1');
    const brand = rawBrand.trim();
    if (brand.startsWith('M4A')) return 'm4a';
    // QuickTime's brand is 'qt  ' - padding must survive the trim.
    if (rawBrand === 'qt  ' || brand === 'qt') return 'mov';
    return 'mp4';
  }
  // Matroska / WebM
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    const head = buf.subarray(0, Math.min(buf.length, 4096)).toString('latin1');
    return head.includes('webm') ? 'webm' : 'mkv';
  }
  if (
    buf.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buf.subarray(8, 12).toString('latin1') === 'AVI '
  )
    return 'avi';
  if (buf.subarray(0, 3).toString('latin1') === 'ID3') return 'mp3';
  if (buf[0] === 0xff && ((buf[1] ?? 0) & 0xe0) === 0xe0) return 'mp3';
  if (buf.subarray(0, 4).toString('latin1') === 'OggS') return 'ogg';
  if (buf.subarray(0, 4).toString('latin1') === 'fLaC') return 'flac';
  return null;
}

export async function probeMedia(
  filePath: string,
  opts: { signal?: AbortSignal | undefined; timeoutMs?: number | undefined } = {},
): Promise<MediaProbe> {
  const { stdout } = await runProcess(
    config.source.ffprobePath,
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath],
    { signal: opts.signal, timeoutMs: opts.timeoutMs ?? 15_000 },
  );

  let parsed: {
    format?: { duration?: string; size?: string };
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      width?: number;
      height?: number;
      duration?: string;
    }>;
  };
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new SourceError('SOURCE_INTEGRITY', 'The media file could not be inspected.');
  }

  const streams = parsed.streams ?? [];
  const video = streams.find((s) => s.codec_type === 'video');
  const audio = streams.find((s) => s.codec_type === 'audio');
  const duration = Number(parsed.format?.duration);
  const size = Number(parsed.format?.size);

  return {
    durationSec: Number.isFinite(duration) ? Math.round(duration) : null,
    width: video?.width ?? null,
    height: video?.height ?? null,
    vcodec: video?.codec_name ?? null,
    acodec: audio?.codec_name ?? null,
    sizeBytes: Number.isFinite(size) ? size : null,
    hasVideo: Boolean(video),
    hasAudio: Boolean(audio),
  };
}

export interface ConvertResult {
  path: string;
  container: string;
}

/**
 * Returns a file in `target` container: skips when already there, remuxes
 * (`-c copy`) when possible, re-encodes as a last resort.
 */
export async function ensureContainer(
  inputPath: string,
  target: string,
  opts: { signal?: AbortSignal | undefined; timeoutMs?: number | undefined } = {},
): Promise<ConvertResult> {
  const current = /\.([A-Za-z0-9]+)$/.exec(inputPath)?.[1]?.toLowerCase();
  if (current === target) return { path: inputPath, container: target };

  const outPath = join(dirname(inputPath), `converted-${randomBytes(6).toString('hex')}.${target}`);
  const faststart = target === 'mp4' || target === 'mov' ? ['-movflags', '+faststart'] : [];
  const timeoutMs = opts.timeoutMs ?? config.queue.jobTimeoutMs;

  // 1) Remux - container change only, streams untouched.
  try {
    await runProcess(
      config.source.ffmpegPath,
      [
        '-y',
        '-hide_banner',
        '-nostdin',
        '-loglevel',
        'error',
        '-i',
        inputPath,
        '-c',
        'copy',
        ...faststart,
        outPath,
      ],
      { signal: opts.signal, timeoutMs },
    );
    if (existsSync(outPath)) return { path: outPath, container: target };
  } catch (err) {
    if (err instanceof SourceError) throw err;
    // fall through to transcode - incompatible codecs are the usual cause
  }

  // 2) Transcode - video to H.264/AAC, audio-only to AAC.
  const probe = await probeMedia(inputPath, { signal: opts.signal }).catch(() => null);
  const codecArgs = probe?.hasVideo
    ? ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-c:a', 'aac']
    : ['-vn', '-c:a', 'aac'];

  try {
    await runProcess(
      config.source.ffmpegPath,
      [
        '-y',
        '-hide_banner',
        '-nostdin',
        '-loglevel',
        'error',
        '-i',
        inputPath,
        ...codecArgs,
        ...faststart,
        outPath,
      ],
      { signal: opts.signal, timeoutMs },
    );
  } catch (err) {
    if (err instanceof ProcessError || err instanceof SourceError) {
      throw new SourceError(
        'SOURCE_INTEGRITY',
        'The media could not be converted. Try another format.',
      );
    }
    throw err;
  }

  if (!existsSync(outPath)) {
    throw new SourceError('SOURCE_INTEGRITY', 'The conversion produced no file. Try another format.');
  }
  return { path: outPath, container: target };
}
