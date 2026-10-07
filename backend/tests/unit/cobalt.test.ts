import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withFallback } from '../../src/downloader/executors/fallback.js';
import { cobaltAdapter } from '../../src/downloader/executors/cobalt.js';
import { SourcePolicyError } from '../../src/downloader/errors.js';
import { config } from '../../src/server/config.js';
import { invalidateSourcePolicyCache } from '../../src/downloader/policy.js';

const POLICY_ROW = {
  id: 'src-cobalt',
  slug: 'cobalt',
  adapterKey: 'cobalt',
  enabled: true,
  mode: 'active',
  allowedFormats: ['video', 'audio', 'mp4', 'webm', 'mp3', 'm4a'],
  maxFileSizeMb: 4096,
  healthStatus: 'unknown',
};

let sourceRows: unknown[] = [POLICY_ROW];

vi.mock('../../src/database/client.js', async (importOriginal: () => Promise<object>) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getDb: () => ({
      select: () => ({
        from: () => ({
          where: () => ({ limit: async () => sourceRows }),
        }),
      }),
    }),
  };
});
import { SourceError } from '../../src/downloader/errors.js';
import type { SourceAdapter } from '../../src/downloader/types.js';

function stubAdapter(
  key: string,
  impl: Partial<Pick<SourceAdapter, 'analyze' | 'download'>>,
): SourceAdapter {
  return {
    key,
    canHandle: () => true,
    analyze: impl.analyze ?? (async () => ({ formats: [] })),
    download:
      impl.download ??
      (async () => {
        throw new Error('not stubbed');
      }),
  };
}

describe('withFallback', () => {
  it('uses the primary result when it succeeds', async () => {
    const fallback = stubAdapter('fallback', {
      analyze: async () => {
        throw new Error('must not be called');
      },
    });
    const primary = stubAdapter('primary', {
      analyze: async () => ({ formats: [] }),
    });
    const wrapped = withFallback(primary, fallback);
    expect(wrapped.key).toBe('primary');
    await expect(
      wrapped.analyze('https://example.com/v', { signal: AbortSignal.timeout(1000) }),
    ).resolves.toEqual({ formats: [] });
  });

  it('falls back on transient SourceError', async () => {
    const fallback = stubAdapter('fallback', {
      analyze: async () => ({ formats: [], title: 'via fallback' }),
    });
    const primary = stubAdapter('primary', {
      analyze: async () => {
        throw new SourceError('SOURCE_EXTRACT_FAILED', 'yt-dlp choked');
      },
    });
    const wrapped = withFallback(primary, fallback);
    await expect(
      wrapped.analyze('https://example.com/v', { signal: AbortSignal.timeout(1000) }),
    ).resolves.toMatchObject({ title: 'via fallback' });
  });

  it('never falls back on policy rejections', async () => {
    const fallback = stubAdapter('fallback', {
      analyze: async () => ({ formats: [] }),
    });
    const primary = stubAdapter('primary', {
      analyze: async () => {
        throw new SourcePolicyError('blocked');
      },
    });
    const wrapped = withFallback(primary, fallback);
    await expect(
      wrapped.analyze('https://example.com/v', { signal: AbortSignal.timeout(1000) }),
    ).rejects.toThrow(SourcePolicyError);
  });

  it('returns the primary untouched when no fallback is configured', () => {
    const primary = stubAdapter('primary', {});
    expect(withFallback(primary, null)).toBe(primary);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });
});

describe('cobaltAdapter mapping', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    (config.cobalt as { apiUrl: string | undefined }).apiUrl = 'https://cobalt.test';
    sourceRows = [POLICY_ROW];
    invalidateSourcePolicyCache();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    (config.cobalt as { apiUrl: string | undefined }).apiUrl = undefined;
    vi.unstubAllGlobals();
  });
  it('maps tunnel responses to a best-available video row', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          status: 'tunnel',
          url: 'https://cobalt.test/tunnel/abc',
          filename: 'video.mp4',
        }),
      })),
    );
    const analysis = await cobaltAdapter.analyze('https://example.com/v', {
      signal: AbortSignal.timeout(5000),
      timeoutMs: 5000,
    });
    expect(analysis.formats).toHaveLength(1);
    expect(analysis.formats[0]).toMatchObject({
      key: 'cobalt.best.mp4',
      kind: 'video',
      container: 'mp4',
      isDefault: true,
    });
    expect(analysis.sourceUrls).toEqual(['https://cobalt.test/tunnel/abc']);
  });

  it('maps picker responses to per-item rows plus audio', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          status: 'picker',
          picker: [
            { type: 'video', url: 'https://cobalt.test/t/1' },
            { type: 'video', url: 'https://cobalt.test/t/2' },
          ],
          audio: 'https://cobalt.test/a/1',
        }),
      })),
    );
    const analysis = await cobaltAdapter.analyze('https://example.com/v', {
      signal: AbortSignal.timeout(5000),
      timeoutMs: 5000,
    });
    expect(analysis.formats.map((f) => f.key)).toEqual([
      'cobalt.pick.0',
      'cobalt.pick.1',
      'cobalt.audio',
    ]);
    expect(analysis.formats[2]).toMatchObject({ kind: 'audio', isDefault: false });
  });

  it('throws a user-safe error on cobalt error responses', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'error', error: { code: 'error.api.rate_limit' } }),
    });
    await expect(
      cobaltAdapter.analyze('https://example.com/v', {
        signal: AbortSignal.timeout(5000),
        timeoutMs: 5000,
      }),
    ).rejects.toThrow(SourceError);
  });

  it('fails closed before any network when the source row is missing/disabled', async () => {
    sourceRows = [];
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ status: 'tunnel' }) });
    await expect(
      cobaltAdapter.analyze('https://example.com/v', {
        signal: AbortSignal.timeout(5000),
        timeoutMs: 5000,
      }),
    ).rejects.toThrow(SourcePolicyError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
