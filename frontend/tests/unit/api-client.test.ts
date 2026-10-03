import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAnonKey, getAnonKey, isAnonKey } from '@/lib/api/anon';
import { ApiError, apiFetch } from '@/lib/api/client';

function memoryStore(initial?: Record<string, string>) {
  const data = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    data,
  };
}

describe('anon key', () => {
  it('mints a key that satisfies the API pattern', () => {
    const key = createAnonKey();
    expect(isAnonKey(key)).toBe(true);
    expect(key).not.toBe(createAnonKey());
  });

  it('persists and reuses the stored key', () => {
    const store = memoryStore();
    const first = getAnonKey(store);
    expect(first.length).toBeGreaterThanOrEqual(8);
    expect(getAnonKey(store)).toBe(first);
    expect(store.data.get('fd_anon_key')).toBe(first);
  });

  it('replaces a corrupted stored key', () => {
    const store = memoryStore({ fd_anon_key: 'not valid!!' });
    const key = getAnonKey(store);
    expect(isAnonKey(key)).toBe(true);
    expect(key).not.toBe('not valid!!');
  });

  it('degrades to empty when storage throws (privacy modes)', () => {
    const store = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(getAnonKey(store)).toBe('');
  });
});

describe('apiFetch', () => {
  const fetchMock = vi.fn();

  afterEach(() => {
    vi.stubGlobal('fetch', undefined);
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }

  it('returns parsed JSON on success', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const out = await apiFetch<{ ok: boolean }>('/ping');
    expect(out).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('/api/v1/ping');
    expect((init as RequestInit).credentials).toBe('include');
    expect((init as RequestInit).method ?? 'GET').toBe('GET');
  });

  it('serializes JSON bodies and sets the content type', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: '1' }, 201));
    vi.stubGlobal('fetch', fetchMock);

    await apiFetch('/downloads', { method: 'POST', body: { url: 'https://x.test/v' } });
    const [, init] = fetchMock.mock.calls[0]!;
    const req = init as RequestInit;
    expect(req.body).toBe(JSON.stringify({ url: 'https://x.test/v' }));
    expect(new Headers(req.headers).get('content-type')).toBe('application/json');
  });

  it('throws a typed ApiError from the §46 envelope', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: 'POLICY_RESTRICTED',
            message: 'This source is restricted by policy.',
            requestId: 'req-123',
          },
        },
        403,
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const err = await apiFetch('/downloads/analyze', { method: 'POST', body: {} }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    const apiErr = err as ApiError;
    expect(apiErr.status).toBe(403);
    expect(apiErr.code).toBe('POLICY_RESTRICTED');
    expect(apiErr.message).toContain('restricted');
    expect(apiErr.requestId).toBe('req-123');
  });

  it('maps network failure to ApiError(0)', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    vi.stubGlobal('fetch', fetchMock);

    const err = await apiFetch('/health').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(0);
  });

  it('handles 204 responses without a body', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(apiFetch('/nothing')).resolves.toBeUndefined();
  });
});
