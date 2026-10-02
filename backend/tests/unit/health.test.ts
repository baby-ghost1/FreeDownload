import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/server/app.js';
import { loadEnv } from '../../src/server/config.js';
import type { AppInstance } from '../../src/types/app.js';

describe('health endpoints', () => {
  let app: AppInstance;

  beforeEach(async () => {
    process.env.NODE_ENV = 'test';
    process.env.LOG_LEVEL = 'silent';
    app = await buildApp({ rateLimit: false });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /health returns liveness payload with request id header', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.service).toBe('backend-api');
    expect(typeof body.uptimeSec).toBe('number');
    expect(res.headers['x-request-id']).toBeDefined();
  });

  it('GET /ready returns 200 with an empty check set before infra lands', async () => {
    const res = await app.inject({ method: 'GET', url: '/ready' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ready');
    expect(body.checks).toEqual({});
  });

  it('returns the §46 error envelope for unknown routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/does-not-exist' });

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.requestId).toBeTruthy();
    expect(JSON.stringify(body)).not.toContain('at ');
  });

  it('preserves a caller-supplied valid request id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': 'req-abcdef123456' },
    });
    expect(res.headers['x-request-id']).toBe('req-abcdef123456');
  });
});

describe('loadEnv', () => {
  it('applies defaults for optional keys', () => {
    const env = loadEnv({ NODE_ENV: 'development' } as NodeJS.ProcessEnv);
    expect(env.PORT).toBe(4000);
    expect(env.LOG_LEVEL).toBe('info');
  });

  it('rejects a too-short session secret', () => {
    expect(() =>
      loadEnv({ NODE_ENV: 'production', SESSION_SECRET: 'short' } as NodeJS.ProcessEnv),
    ).toThrow(/SESSION_SECRET/);
  });

  it('rejects an invalid port', () => {
    expect(() => loadEnv({ PORT: '99999' } as NodeJS.ProcessEnv)).toThrow(/PORT/);
  });
});
