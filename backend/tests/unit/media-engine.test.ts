import { describe, expect, it } from 'vitest';

import { assertContainer, buildFetchArgs, buildSelector } from '../../src/downloader/executors/ytdlp.js';
import { audioEncoderFor } from '../../src/media/ffmpeg.js';
import { sniffContainer } from '../../src/media/ffmpeg.js';
import { presignRequest } from '../../src/storage/r2.js';
import { assertSourceUsable, type SourcePolicy } from '../../src/downloader/policy.js';
import { SourceError, SourcePolicyError } from '../../src/downloader/errors.js';

function policy(patch: Partial<SourcePolicy> = {}): SourcePolicy {
  return {
    sourceId: 'src-1',
    slug: 'generic',
    adapterKey: 'ytdlp',
    enabled: true,
    mode: 'active',
    allowedFormats: ['video', 'audio', 'mp4', 'webm', 'mp3', 'm4a'],
    maxFileSizeMb: 512,
    healthStatus: 'healthy',
    ...patch,
  };
}

describe('assertContainer (argument allowlist §Layer 4)', () => {
  it('accepts short lowercase containers', () => {
    expect(assertContainer('mp4')).toBe('mp4');
    expect(assertContainer('mkv')).toBe('mkv');
  });

  it('rejects anything that could smuggle shell arguments', () => {
    expect(() => assertContainer('mp4; rm -rf /')).toThrow(SourceError);
    expect(() => assertContainer('MP4')).toThrow(SourceError);
    expect(() => assertContainer('')).toThrow(SourceError);
    expect(() => assertContainer('../etc/passwd')).toThrow(SourceError);
  });
});

describe('buildSelector', () => {
  it('prefers best video+audio merge into the target container', () => {
    const sel = buildSelector({ container: 'mp4' });
    expect(sel).toContain('[ext=mp4]');
    expect(sel).toContain('+ba[ext=m4a]');
    expect(sel.endsWith('/best')).toBe(true);
  });

  it('uses audio-only selection for audio containers', () => {
    expect(buildSelector({ container: 'mp3', audioOnly: true })).toBe('ba/bestaudio/best');
    expect(buildSelector({ container: 'm4a' })).toContain('+ba[ext=m4a]');
  });

  it('clamps requested heights into the 144..4320 range', () => {
    expect(buildSelector({ container: 'webm', maxHeight: 9999 })).toContain('[height<=4320]');
    expect(buildSelector({ container: 'webm', maxHeight: 9 })).toContain('[height<=144]');
    expect(buildSelector({ container: 'webm', maxHeight: 1080 })).toContain('[height<=1080]');
    expect(buildSelector({ container: 'webm' })).not.toContain('[height<=');
  });

  it('omits the m4a audio hint for non-mp4 targets', () => {
    expect(buildSelector({ container: 'webm' })).not.toContain('[ext=m4a]');
  });

  it('never emits an unvalidated container', () => {
    expect(() => buildSelector({ container: 'mp4;id' })).toThrow(SourceError);
    expect(() => buildSelector({ container: 'MP4' })).toThrow(SourceError);
    expect(() => buildSelector({ container: '' })).toThrow(SourceError);
  });
});

describe('buildFetchArgs', () => {
  it('omits --merge-output-format for audio targets (yt-dlp rejects mp3)', () => {
    expect(buildFetchArgs({ container: 'mp3', audioOnly: true })).toEqual([
      '-f',
      'ba/bestaudio/best',
    ]);
    expect(buildFetchArgs({ container: 'm4a', audioOnly: true })).toEqual([
      '-f',
      'ba/bestaudio/best',
    ]);
  });

  it('keeps --merge-output-format for video targets', () => {
    const args = buildFetchArgs({ container: 'mp4', maxHeight: 1080 });
    expect(args).toContain('--merge-output-format');
    expect(args).toContain('mp4');
  });
});

describe('audioEncoderFor', () => {
  it('matches the encoder to the target container', () => {
    expect(audioEncoderFor('mp3')).toBe('libmp3lame');
    expect(audioEncoderFor('m4a')).toBe('aac');
    expect(audioEncoderFor('webm')).toBe('libopus');
    expect(audioEncoderFor('ogg')).toBe('libvorbis');
    expect(audioEncoderFor('wav')).toBe('pcm_s16le');
    expect(audioEncoderFor('flac')).toBe('flac');
    expect(audioEncoderFor('MP3')).toBe('libmp3lame');
    expect(audioEncoderFor('weird')).toBe('aac');
  });
});

describe('sniffContainer (magic bytes, security layer 5)', () => {
  function isoBmff(brand: string): Buffer {
    const buf = Buffer.alloc(16);
    buf.writeUInt32BE(0x18, 0);
    buf.write('ftyp', 4);
    buf.write(brand, 8);
    return buf;
  }

  it('recognizes ISO-BMFF variants', () => {
    expect(sniffContainer(isoBmff('isom'))).toBe('mp4');
    expect(sniffContainer(isoBmff('M4A '))).toBe('m4a');
    expect(sniffContainer(isoBmff('qt  '))).toBe('mov');
  });

  it('recognizes Matroska, WebM, AVI, MP3, Ogg and FLAC', () => {
    expect(
      sniffContainer(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])),
    ).toBe('mkv');
    const webm = Buffer.concat([
      Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
      Buffer.from('....webm....'),
    ]);
    expect(sniffContainer(webm)).toBe('webm');
    expect(sniffContainer(Buffer.from('RIFF....AVI LIST'))).toBe('avi');
    expect(sniffContainer(Buffer.from('ID3\x04\x00\x00\x00\x00\x00\x00\x00\x00\x00'))).toBe('mp3');
    expect(sniffContainer(Buffer.from('OggS\x00\x02\x00\x00\x00\x00\x00\x00'))).toBe('ogg');
    expect(sniffContainer(Buffer.from('fLaC\x00\x00\x00\x22\x00\x00\x00\x00'))).toBe('flac');
  });

  it('rejects short or unrecognized payloads', () => {
    expect(sniffContainer(Buffer.from('html'))).toBeNull();
    expect(sniffContainer(Buffer.from('<!DOCTYPE html><html>'))).toBeNull();
    expect(sniffContainer(Buffer.alloc(4))).toBeNull();
  });
});

describe('presignRequest (SigV4, deterministic)', () => {
  const base = {
    method: 'GET' as const,
    url: new URL('https://acct.r2.cloudflarestorage.com/bucket/jobs/abc/media.mp4'),
    accessKeyId: 'AKIAFDFREE00000000',
    secretAccessKey: 'secret-key-for-tests',
    now: new Date('2026-10-02T12:00:00.000Z'),
  };
  const expiresAt = new Date('2026-10-02T12:05:00.000Z');

  it('is a pure function of its inputs (signature pinned)', () => {
    const a = presignRequest({ ...base, expiresAt });
    const b = presignRequest({ ...base, expiresAt: new Date(expiresAt) });
    expect(a).toBe(b);
    expect(a).toContain('X-Amz-Signature=');
    expect(a).toContain('X-Amz-Expires=300');
    expect(a).toContain('X-Amz-Date=20261002T120000Z');
    expect(a).toContain(
      'X-Amz-Credential=AKIAFDFREE00000000%2F20261002%2Fauto%2Fs3%2Faws4_request',
    );
  });

  it('changes when the clock, key or method changes', () => {
    const sig = (u: URL) => /X-Amz-Signature=([a-f0-9]+)/.exec(u.toString())?.[1];

    const later = presignRequest({
      ...base,
      expiresAt,
      now: new Date('2026-10-02T12:00:01.000Z'),
    });
    expect(sig(new URL(later))).not.toBe(sig(new URL(presignRequest({ ...base, expiresAt }))));

    const otherKey = presignRequest({ ...base, expiresAt, accessKeyId: 'AKIAFDFREE11111111' });
    expect(sig(new URL(otherKey))).not.toBe(sig(new URL(presignRequest({ ...base, expiresAt }))));

    const put = presignRequest({ ...base, expiresAt, method: 'PUT' });
    expect(sig(new URL(put))).not.toBe(sig(new URL(presignRequest({ ...base, expiresAt }))));
  });

  it('never embeds the secret key', () => {
    const url = presignRequest({ ...base, expiresAt });
    expect(url).not.toContain('secret-key-for-tests');
  });
});

describe('assertSourceUsable (runtime policy §12)', () => {
  it('passes an active healthy source and allowed container', () => {
    expect(() => assertSourceUsable(policy(), 'mp4')).not.toThrow();
  });

  it('treats a missing policy as restricted', () => {
    expect(() => assertSourceUsable(null)).toThrow(SourcePolicyError);
  });

  it('blocks disabled and restricted sources without retrying', () => {
    expect(() => assertSourceUsable(policy({ enabled: false }))).toThrow(SourcePolicyError);
    expect(() => assertSourceUsable(policy({ mode: 'disabled' }))).toThrow(SourcePolicyError);
    expect(() => assertSourceUsable(policy({ mode: 'restricted' }))).toThrow(SourcePolicyError);
  });

  it('defers on maintenance and source-down (retryable, not policy)', () => {
    expect(() => assertSourceUsable(policy({ mode: 'maintenance' }))).toThrow(SourceError);
    expect(() => assertSourceUsable(policy({ healthStatus: 'down' }))).toThrow(SourceError);
    try {
      assertSourceUsable(policy({ mode: 'maintenance' }));
    } catch (err) {
      expect(err).toBeInstanceOf(SourceError);
      expect(err).not.toBeInstanceOf(SourcePolicyError);
    }
  });

  it('enforces the container allowlist', () => {
    expect(() => assertSourceUsable(policy(), 'mkv')).toThrow(SourcePolicyError);
    expect(() => assertSourceUsable(policy(), 'opus')).toThrow(SourcePolicyError);
    expect(() => assertSourceUsable(policy({ allowedFormats: [] }), 'mkv')).not.toThrow();
  });
});
