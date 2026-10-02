import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/server/app.js';
import { closeDatabase } from '../../src/database/client.js';
import { closeRedis } from '../../src/redis/client.js';
import { closeQueues } from '../../src/queue/queues.js';
import { seed } from '../../src/database/seed.js';
import type { AppInstance } from '../../src/types/app.js';
import { infraAvailable, inCi } from '../helpers/infra.js';

const infraUp = await infraAvailable();
const describeInfra = describe.runIf(infraUp || inCi);

const ANON_KEY = 'anonymous-key-123';
const RUNNABLE = ['queued', 'analyzing', 'ready', 'processing', 'uploading', 'completed'];

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
): string {
  const found = res.cookies.find((c) => c.name === name);
  expect(found).toBeDefined();
  return found!.value;
}

describeInfra('downloads API (integration)', () => {
  let app: AppInstance;

  beforeAll(async () => {
    await seed();
    app = await buildApp({ rateLimit: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await closeQueues();
    await closeDatabase();
    await closeRedis();
  });

  async function register(): Promise<Session> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: `t-${randomUUID().replace(/-/g, '').slice(0, 16)}@example.com`,
        password: 'correct-horse-1',
      },
    });
    expect(res.statusCode).toBe(201);
    return { cookie: cookieHeader(res), csrf: cookieValue(res, 'fd_csrf') };
  }

  it('refuses anonymous creation without an X-Anon-Key', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/downloads',
      payload: { url: 'https://example.com/watch?v=1' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');
  });

  it('rejects malformed and non-http(s) URLs', async () => {
    for (const url of ['not-a-url', 'ftp://example.com/file', 'https://user:pass@x.test/a']) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/downloads',
        headers: { 'x-anon-key': ANON_KEY },
        payload: { url },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('creates an anonymous job with a redacted URL and reads it back', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/downloads',
      headers: { 'x-anon-key': ANON_KEY },
      payload: { url: 'https://example.com/watch?v=SECRET_TOKEN&list=42' },
    });

    expect(res.statusCode).toBe(201);
    const job = res.json();
    expect(RUNNABLE).toContain(job.status);
    expect(job.progress).toBe(0);
    // Query strings (tracking, tokens) never reach the stored URL.
    expect(job.url).toBe('https://example.com/watch');

    const read = await app.inject({
      method: 'GET',
      url: `/api/v1/downloads/${job.id}`,
      headers: { 'x-anon-key': ANON_KEY },
    });
    expect(read.statusCode).toBe(200);
    expect(read.json().id).toBe(job.id);

    const anonymous = await app.inject({
      method: 'GET',
      url: `/api/v1/downloads/${job.id}`,
    });
    expect(anonymous.statusCode).toBe(401);
  });

  it('requires CSRF for cookie-authenticated creation and lists owned jobs', async () => {
    const session = await register();

    const noCsrf = await app.inject({
      method: 'POST',
      url: '/api/v1/downloads',
      headers: { cookie: session.cookie },
      payload: { url: 'https://example.com/v/1' },
    });
    expect(noCsrf.statusCode).toBe(403);

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/downloads',
      headers: { cookie: session.cookie, 'x-csrf-token': session.csrf },
      payload: { url: 'https://example.com/v/1' },
    });
    expect(created.statusCode).toBe(201);
    const jobId = created.json().id;

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/downloads',
      headers: { cookie: session.cookie },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.map((j: { id: string }) => j.id)).toContain(jobId);
  });

  it('answers 404 for jobs owned by somebody else', async () => {
    const owner = await register();
    const stranger = await register();

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/downloads',
      headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf },
      payload: { url: 'https://example.com/v/private' },
    });
    const jobId = created.json().id;

    const read = await app.inject({
      method: 'GET',
      url: `/api/v1/downloads/${jobId}`,
      headers: { cookie: stranger.cookie },
    });
    expect(read.statusCode).toBe(404);

    const cancel = await app.inject({
      method: 'POST',
      url: `/api/v1/downloads/${jobId}/cancel`,
      headers: { cookie: stranger.cookie, 'x-csrf-token': stranger.csrf },
    });
    expect(cancel.statusCode).toBe(404);
  });

  it('replays an Idempotency-Key and rejects payload drift', async () => {
    const key = `idem-${randomUUID()}`;
    const payload = { url: 'https://example.com/v/idempotent' };

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/downloads',
      headers: { 'x-anon-key': ANON_KEY, 'idempotency-key': key },
      payload,
    });
    expect(first.statusCode).toBe(201);

    const replay = await app.inject({
      method: 'POST',
      url: '/api/v1/downloads',
      headers: { 'x-anon-key': ANON_KEY, 'idempotency-key': key },
      payload,
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.headers['idempotent-replay']).toBe('true');
    expect(replay.json().id).toBe(first.json().id);

    const drifted = await app.inject({
      method: 'POST',
      url: '/api/v1/downloads',
      headers: { 'x-anon-key': ANON_KEY, 'idempotency-key': key },
      payload: { url: 'https://example.com/v/something-else' },
    });
    expect(drifted.statusCode).toBe(409);
    expect(drifted.json().error.code).toBe('CONFLICT');
  });

  it('cancels a job exactly once', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/downloads',
      headers: { 'x-anon-key': ANON_KEY },
      payload: { url: 'https://example.com/v/cancel-me' },
    });
    const jobId = created.json().id;

    const cancelled = await app.inject({
      method: 'POST',
      url: `/api/v1/downloads/${jobId}/cancel`,
      // Content-Type with no body: body-less POSTs must not die at the parser.
      headers: { 'x-anon-key': ANON_KEY, 'content-type': 'application/json' },
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().status).toBe('cancelled');

    const again = await app.inject({
      method: 'POST',
      url: `/api/v1/downloads/${jobId}/cancel`,
      headers: { 'x-anon-key': ANON_KEY },
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('CONFLICT');
  });
});
