import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveSelfPingUrl, startSelfPing } from '../../src/keepalive/self-ping.js';

describe('resolveSelfPingUrl', () => {
  it('prefers the explicit URL', () => {
    expect(resolveSelfPingUrl('https://api.example.com/health', 'https://x.onrender.com')).toBe(
      'https://api.example.com/health',
    );
  });

  it('falls back to Render-injected URL with /health appended', () => {
    expect(resolveSelfPingUrl(undefined, 'https://x.onrender.com/')).toBe(
      'https://x.onrender.com/health',
    );
  });

  it('returns null when nothing is configured', () => {
    expect(resolveSelfPingUrl(undefined, undefined)).toBeNull();
    expect(resolveSelfPingUrl('  ', '  ')).toBeNull();
  });
});

describe('startSelfPing', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('pings on a schedule and never throws on failure', async () => {
    const fetchMock = vi.fn(async () => new Response('ok'));
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers();

    const handle = startSelfPing({ url: 'https://x.onrender.com/health', intervalMs: 60_000 });
    // Boot ping fires immediately.
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://x.onrender.com/health',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    // Next ping after the interval (jitter may shift it ±60s).
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);

    handle.stop();
    const calls = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(600_000);
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it('survives unreachable targets without throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );
    vi.useFakeTimers();
    const handle = startSelfPing({ url: 'http://127.0.0.1:1/health', intervalMs: 60_000 });
    await vi.advanceTimersByTimeAsync(200_000);
    handle.stop();
  });
});
