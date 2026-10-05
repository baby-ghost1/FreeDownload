import { describe, expect, it } from 'vitest';

import {
  buildFormats,
  extractDirectMediaUrl,
} from '../../src/downloader/executors/ytdlp.js';

describe('buildFormats', () => {
  it('derives real heights from group keys (no NaN keys, labels or heights)', () => {
    const formats = buildFormats({
      formats: [
        {
          ext: 'mp4',
          height: 1080,
          width: 1920,
          fps: 30,
          vcodec: 'avc1',
          acodec: 'mp4a',
          tbr: 4500,
          filesize: 1_000,
        },
        {
          ext: 'mp4',
          height: 720,
          width: 1280,
          fps: 30,
          vcodec: 'avc1',
          acodec: 'mp4a',
          tbr: 2500,
          filesize: 500,
        },
        {
          ext: 'mp4',
          height: 720,
          width: 1280,
          fps: 30,
          vcodec: 'avc1',
          acodec: 'mp4a',
          tbr: 3500,
        },
        { ext: 'm4a', vcodec: 'none', acodec: 'mp4a', tbr: 128 },
      ],
    });

    const video = formats.filter((f) => f.kind === 'video');
    expect(video.map((f) => f.key)).toEqual(['1080p.mp4', '720p.mp4']);
    expect(video.map((f) => f.label)).toEqual(['1080p MP4', '720p MP4']);
    expect(video[0]!.height).toBe(1080);
    expect(video[0]!.isDefault).toBe(true);
    // Best rendition wins per (height, ext) group: 3500 kbps beats 2500.
    expect(video[1]!.bitrateKbps).toBe(3500);
    expect(video[1]!.filesizeBytes).toBeNull();

    const audio = formats.find((f) => f.kind === 'audio');
    expect(audio?.key).toBe('audio.m4a');
    expect(audio?.isDefault).toBe(false);

    for (const f of formats) {
      expect(f.key).not.toContain('NaN');
      expect(f.label).not.toContain('NaN');
      for (const n of [f.height, f.width, f.fps, f.filesizeBytes]) {
        if (n !== null && n !== undefined) expect(Number.isFinite(n)).toBe(true);
      }
    }
  });

  it('sorts renditions highest height first', () => {
    const formats = buildFormats({
      formats: [
        { ext: 'mp4', height: 360, width: 640, vcodec: 'avc1', acodec: 'mp4a', tbr: 800 },
        { ext: 'mp4', height: 1440, width: 2560, vcodec: 'avc1', acodec: 'mp4a', tbr: 9000 },
        { ext: 'mp4', height: 720, width: 1280, vcodec: 'avc1', acodec: 'mp4a', tbr: 2500 },
      ],
    });
    expect(formats.map((f) => f.key)).toEqual(['1440p.mp4', '720p.mp4', '360p.mp4']);
    expect(formats[0]!.isDefault).toBe(true);
  });

  it('falls back to one honest best entry when the extractor reports no formats', () => {
    const formats = buildFormats({ ext: 'webm' });
    expect(formats).toHaveLength(1);
    expect(formats[0]!.key).toBe('best.webm');
    expect(formats[0]!.isDefault).toBe(true);
    expect(formats[0]!.height ?? null).toBeNull();
  });

  it('sanitizes junk extractor extensions so the entry passes API validation', () => {
    // yt-dlp emits values like `unknown_video` for direct media (zedge) -
    // the key/container must satisfy the route + pipeline allowlists.
    for (const ext of ['unknown_video', 'MKV-STREAM', '', 'avc1']) {
      const formats = buildFormats({ ext });
      expect(formats).toHaveLength(1);
      expect(formats[0]!.key).toMatch(/^[A-Za-z0-9][A-Za-z0-9.#_-]{0,63}$/);
      expect(formats[0]!.container).toMatch(/^[a-z0-9]{2,5}$/);
    }
    expect(buildFormats({ ext: 'unknown_video' })[0]).toMatchObject({
      key: 'best.mp4',
      container: 'mp4',
    });
  });
});

describe('extractDirectMediaUrl', () => {
  const base = 'https://www.zedge.net/ringtones/abc-123';

  it('prefers og:audio over stray file links', () => {
    const html = [
      '<html><head>',
      '<meta property="og:audio" content="https://cdn.test/a.mp3" />',
      '<a href="https://ads.test/b.mp3">ad</a>',
      '</head></html>',
    ].join('');
    expect(extractDirectMediaUrl(html, base)).toMatchObject({
      url: 'https://cdn.test/a.mp3',
      ext: 'mp3',
      kind: 'audio',
    });
  });

  it('finds zedge-style embedded mp3 links with escaped ampersands', () => {
    const html = `<script>{"url":"https://dw.zobj.net/download/v1/tok?a=&amp;c=72&amp;f=song.mp3"}</script>`;
    expect(extractDirectMediaUrl(html, base)).toMatchObject({
      ext: 'mp3',
      kind: 'audio',
    });
  });

  it('finds audio and video tags', () => {
    expect(
      extractDirectMediaUrl('<audio src="/media/ep.mp3"></audio>', base),
    ).toMatchObject({ url: 'https://www.zedge.net/media/ep.mp3', ext: 'mp3', kind: 'audio' });
    expect(
      extractDirectMediaUrl('<video><source src="https://cdn.test/v.mp4" /></video>', base),
    ).toMatchObject({ ext: 'mp4', kind: 'video' });
  });

  it('returns null for pages without playable files', () => {
    expect(extractDirectMediaUrl('<html><body>hello</body></html>', base)).toBeNull();
    expect(
      extractDirectMediaUrl('<img src="https://cdn.test/a.jpg" />', base),
    ).toBeNull();
  });
});
