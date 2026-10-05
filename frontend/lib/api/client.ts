import { SITE_CONFIG } from '@/lib/constants/site';
import { getAnonKey } from './anon';
import type { ApiErrorBody } from './types';

/**
 * Every API call funnels through here: JSON in/out, `credentials: include`
 * for session cookies, `X-Anon-Key` ownership and the `X-CSRF-Token`
 * double-submit header on cookie-authenticated mutations (§36).
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string;
  readonly details: Record<string, unknown> | undefined;

  constructor(status: number, body?: ApiErrorBody) {
    const err = body?.error;
    super(
      err?.message ?? (status >= 500 ? 'The server had a problem. Try again.' : 'Request failed.'),
    );
    this.name = 'ApiError';
    this.status = status;
    this.code = err?.code ?? (status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED');
    this.requestId = err?.requestId ?? '';
    this.details = err?.details;
  }
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  /** JSON body - serialized here; omit for GET/DELETE without a payload. */
  body?: unknown;
  /** Attach `X-Anon-Key` (default true - harmless alongside a session). */
  anon?: boolean;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, anon = true, headers, ...rest } = options;
  const method = (rest.method ?? 'GET').toUpperCase();
  const h = new Headers(headers);
  h.set('accept', 'application/json');
  if (body !== undefined) h.set('content-type', 'application/json');
  if (anon && typeof document !== 'undefined') {
    const key = getAnonKey();
    if (key) h.set('x-anon-key', key);
  }
  if (method !== 'GET' && method !== 'HEAD') {
    const csrf = readCookie('fd_csrf');
    if (csrf) h.set('x-csrf-token', csrf);
  }

  let res: Response;
  const init: RequestInit = { ...rest, headers: h, credentials: 'include' };
  if (body !== undefined) init.body = JSON.stringify(body);
  try {
    res = await fetch(`${SITE_CONFIG.api.baseUrl}${path}`, init);
  } catch {
    // Network-level failure (API down, offline) - a typed error either way.
    throw new ApiError(0);
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let json: unknown;
  if (text) {
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      json = undefined;
    }
  }
  if (!res.ok) throw new ApiError(res.status, json as ApiErrorBody | undefined);
  return json as T;
}
