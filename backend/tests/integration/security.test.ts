import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { buildApp } from '../../src/server/app.js';
import { closeDatabase, getDb } from '../../src/database/client.js';
import { closeQueues } from '../../src/queue/queues.js';
import { closeRedis } from '../../src/redis/client.js';
import { apiKeys } from '../../src/database/schema/index.js';
import { sha256 } from '../../src/utils/crypto.js';
import { signFileToken } from '../../src/storage/local.js';
import { infraAvailable, inCi } from '../helpers/infra.js';

const infraUp = (await infraAvailable()) || inCi;

interface Session {
  cookie: string;
  csrf: string;
}

function cookieHeader(res: { cookies: Array<{ name: string; value: string }> }): string {
  return res.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

function cookieValue(
  res: { cookies: Array<{ name: string; value: string }> },
  name: string,
): string | undefined {
  return res.cookies.find((c) => c.name === name)?.value;
}

/** Every error response must be the §46 envelope — never internals. */
function expectCleanEnvelope(res: { json: () => unknown }): void {
  const body = res.json() as { error?: Record<string, unknown> };
  expect(body.error).toBeDefined();
  const { code, message, requestId } = body.error as {
    code: string;
    message: string;
    requestId: string;
  };
  expect(code).toMatch(/^[A-Z][A-Z_]*$/);
  expect(typeof message).toBe('string');
  expect(message.length).toBeGreaterThan(0);
  expect(requestId).toBeTruthy();
  expect(body.error).not.toHaveProperty('stack');
  const raw = JSON.stringify(body);
  expect(raw).not.toMatch(/\bat\s+\S+:\d+:\d+/); // V8 stack frames
  expect(raw).not.toContain('node_modules');
  expect(raw).not.toContain(process.cwd().replace(/\\/g, '/'));
}

describe.runIf(infraUp)('security: headers, CORS, cookies, limits, secrets', () => {
  // `app` runs without the rate limiter (deterministic assertions);
  // `limited` registers it so burst behaviour can be observed.
  let app: Awaited<ReturnType<typeof buildApp>>;
  let limited: Awaited<ReturnType<typeof buildApp>>;
  let session: Session;
  let userId: string;

  beforeAll(async () => {
    app = await buildApp({ rateLimit: false });
    limited = await buildApp();
    await app.ready();
    await limited.ready();

    const reg = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: `sec-${randomUUID().replace(/-/g, '').slice(0, 16)}@example.com`,
        password: 'correct-horse-1',
      },
    });
    expect(reg.statusCode).toBe(201);
    session = { cookie: cookieHeader(reg), csrf: cookieValue(reg, 'fd_csrf')! };

    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie: session.cookie },
    });
    userId = (me.json() as { id: string }).id;
  });

  afterAll(async () => {
    await app.close();
    await limited.close();
    await closeQueues();
    await closeDatabase();
    await closeRedis();
  });

  it('sets hardened security headers on API responses', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(['DENY', 'SAMEORIGIN']).toContain(res.headers['x-frame-options']);
    expect(res.headers['referrer-policy']).toBeTruthy();
    expect(res.headers['cross-origin-resource-policy']).toBeTruthy();
    // request id on every response
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('sends HSTS only in production', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    // vitest runs NODE_ENV=test — production-only header must stay off.
    expect(res.headers['strict-transport-security']).toBeUndefined();
  });

  it('allows only configured CORS origins and always with credentials', async () => {
    const allowed = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'http://localhost:3000' },
    });
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');
    // rate-limit headers must be readable by the browser
    expect(String(allowed.headers['access-control-expose-headers'])).toContain('RateLimit-Limit');

    const foreign = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://evil.example' },
    });
    expect(foreign.headers['access-control-allow-origin']).toBeUndefined();
    expect(foreign.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('answers preflight with the exact allowed surface', async () => {
    const ok = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/downloads',
      headers: {
        origin: 'http://localhost:3000',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type,x-csrf-token',
      },
    });
    expect(ok.statusCode).toBe(204);
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(ok.headers['access-control-allow-credentials']).toBe('true');
    expect(String(ok.headers['access-control-allow-methods'])).toContain('POST');
    expect(String(ok.headers['access-control-allow-headers']).toLowerCase()).toContain(
      'x-csrf-token',
    );
    expect(ok.headers['access-control-max-age']).toBe('600');

    const denied = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/downloads',
      headers: {
        origin: 'https://evil.example',
        'access-control-request-method': 'POST',
      },
    });
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('keeps the session cookie HttpOnly and the CSRF cookie readable', async () => {
    const reg = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: `sec-${randomUUID().replace(/-/g, '').slice(0, 16)}@example.com`,
        password: 'correct-horse-1',
      },
    });
    expect(reg.statusCode).toBe(201);

    const sess = reg.cookies.find((c) => c.name === 'fd_session');
    expect(sess).toBeDefined();
    expect(sess!.httpOnly).toBe(true);
    expect(String(sess!.sameSite).toLowerCase()).toBe('lax');
    expect(sess!.path).toBe('/');
    expect(sess!.secure).toBeFalsy(); // Secure flips on in production (config.ts)

    const csrf = reg.cookies.find((c) => c.name === 'fd_csrf');
    expect(csrf).toBeDefined();
    expect(csrf!.httpOnly).toBeFalsy(); // double-submit needs JS to read it
    expect(String(csrf!.sameSite).toLowerCase()).toBe('lax');
  });

  it('stores API keys as hashes and never the raw value', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/api-keys',
      headers: { cookie: session.cookie, 'x-csrf-token': session.csrf },
      payload: { name: 'security-suite' },
    });
    expect(res.statusCode).toBe(201);
    const { rawKey } = res.json() as { rawKey: string };
    expect(rawKey).toMatch(/^fd_live_[A-Za-z0-9_-]{22,}$/);

    const rows = await getDb().select().from(apiKeys).where(eq(apiKeys.userId, userId));
    expect(rows.length).toBeGreaterThan(0);
    const row = rows.find((r) => r.name === 'security-suite');
    expect(row).toBeDefined();
    expect(row!.keyHash).toBe(sha256(rawKey));
    expect(row!.keyHash).not.toContain(rawKey);
    expect(JSON.stringify(row)).not.toContain(rawKey);
    expect(rawKey.startsWith(row!.prefix)).toBe(true);
  });

  it('rejects unsigned, forged and cross-keyed file tokens', async () => {
    const uuid = randomUUID();
    const keyA = `jobs/${uuid}/video.mp4`;
    const keyB = `jobs/${uuid}/audio.mp3`;
    const exp = Math.floor(Date.now() / 1000) + 300;

    // query schema demands exp+sig
    const missing = await app.inject({ method: 'GET', url: `/api/v1/files/${keyA}` });
    expect(missing.statusCode).toBe(400);

    const forged = await app.inject({
      method: 'GET',
      url: `/api/v1/files/${keyA}?exp=${exp}&sig=${'0'.repeat(64)}`,
    });
    expect(forged.statusCode).toBe(403);

    // a token minted for keyA must not unlock keyB (HMAC binds the path)
    const cross = await app.inject({
      method: 'GET',
      url: `/api/v1/files/${keyB}?exp=${exp}&sig=${signFileToken(keyA, exp)}`,
    });
    expect(cross.statusCode).toBe(403);

    // outside the key grammar → 404, never a file
    const traversal = await app.inject({
      method: 'GET',
      url: `/api/v1/files/evil?exp=${exp}&sig=${'0'.repeat(64)}`,
    });
    expect(traversal.statusCode).toBe(404);
  });

  it('answers a battery of failures with the clean error envelope', async () => {
    const unknown = await app.inject({ method: 'GET', url: '/api/v1/does-not-exist' });
    expect(unknown.statusCode).toBe(404);
    expectCleanEnvelope(unknown);

    const unauth = await app.inject({ method: 'GET', url: '/api/v1/me' });
    expect(unauth.statusCode).toBe(401);
    expectCleanEnvelope(unauth);

    const badJson = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: '{not json',
    });
    expect(badJson.statusCode).toBe(400);
    expectCleanEnvelope(badJson);

    const csrf = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers: { cookie: session.cookie },
      payload: { displayName: 'no-csrf' },
    });
    expect(csrf.statusCode).toBe(403);
    expectCleanEnvelope(csrf);
  });

  it('answers a global burst with a typed 429 and rate-limit headers', async () => {
    // Limiter keys live in Redis for the whole window and outlive the test
    // process — randomize the bucket IP so rapid reruns never inherit counts.
    const remoteAddress = `198.51.100.${1 + Math.floor(Math.random() * 200)}`;
    let first = true;
    for (let i = 0; i < 10; i += 1) {
      const res = await limited.inject({ method: 'GET', url: '/health', remoteAddress });
      expect(res.statusCode).toBe(200);
      expect(res.headers['ratelimit-limit']).toBe('10');
      expect(res.headers['ratelimit-remaining']).toBeDefined();
      if (first) {
        expect(res.headers['ratelimit-reset']).toBeDefined();
        first = false;
      }
    }

    const blocked = await limited.inject({ method: 'GET', url: '/health', remoteAddress });
    expect(blocked.statusCode).toBe(429);
    const body = blocked.json() as { error: { code: string; message: string; requestId: string } };
    expect(body.error.code).toBe('RATE_LIMITED');
    expect(body.error.requestId).toBeTruthy();
    expect(blocked.headers['retry-after']).toBeDefined();
    expectCleanEnvelope(blocked);
  });

  it('applies the tighter per-route auth limit', async () => {
    const remoteAddress = `198.51.100.${1 + Math.floor(Math.random() * 200)}`;
    // AUTH_RATE_LIMIT_MAX=5 (vitest env) — the sixth attempt is rejected
    // before the handler runs, regardless of credentials.
    let blocked = false;
    for (let i = 0; i < 6; i += 1) {
      const res = await limited.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        remoteAddress,
        payload: { email: `burst-${i}@example.com`, password: 'wrong-password' },
      });
      if (res.statusCode === 429) {
        blocked = true;
        expect((res.json() as { error: { code: string } }).error.code).toBe('RATE_LIMITED');
        break;
      }
      expect([200, 401]).toContain(res.statusCode);
    }
    expect(blocked).toBe(true);
  });
});
