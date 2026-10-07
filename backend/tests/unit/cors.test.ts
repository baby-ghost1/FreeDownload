import Fastify from 'fastify';
import cors from '@fastify/cors';
import { describe, expect, it } from 'vitest';

/**
 * Weather-API model: any browser origin may call `/api/v1/downloads*`,
 * but WITHOUT credentials - browsers then refuse to attach session
 * cookies, so only Bearer API keys work cross-origin. Own origins keep
 * reflect + credentials (their fetches use `credentials: include`).
 * Everything else stays rejected. Mirrors the delegator in
 * src/server/app.ts (preflights never carry Authorization, so the
 * decision is made on origin first, then request path).
 */
const METHODS = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'];
const ALLOWED_HEADERS = ['Content-Type', 'Authorization', 'Idempotency-Key'];
const ALLOWLIST = ['http://localhost:3000'];

async function testApp() {
  const app = Fastify();
  await app.register(cors, {
    delegator: (req, cb) => {
      const shared = { methods: METHODS, allowedHeaders: ALLOWED_HEADERS, maxAge: 600 };
      const origin = req.headers.origin;
      if (!origin || ALLOWLIST.includes(origin)) {
        cb(null, { ...shared, origin: true, credentials: true });
        return;
      }
      const path = (req.url ?? '').split('?')[0] ?? '';
      if (path === '/api/v1/downloads' || path.startsWith('/api/v1/downloads/')) {
        cb(null, { ...shared, origin: '*', credentials: false });
        return;
      }
      cb(null, { ...shared, origin: false, credentials: true });
    },
  });
  app.post('/api/v1/downloads/analyze', async () => ({ ok: true }));
  app.get('/api/v1/me', async () => ({ ok: true }));
  return app;
}

function preflight(url: string, origin: string, method = 'POST') {
  return {
    method: 'OPTIONS' as const,
    url,
    headers: {
      origin,
      'access-control-request-method': method,
      'access-control-request-headers': 'authorization,content-type',
    },
  };
}

describe('third-party CORS', () => {
  it('answers foreign origins with ACAO * and no credentials on API routes', async () => {
    const app = await testApp();
    const res = await app.inject(
      preflight('/api/v1/downloads/analyze', 'https://someone-elses-site.test'),
    );
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    await app.close();
  });

  it('reflects allowlisted origins with credentials, even on API routes', async () => {
    const app = await testApp();
    const res = await app.inject(
      preflight('/api/v1/downloads/analyze', 'http://localhost:3000'),
    );
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    await app.close();
  });

  it('keeps strict behaviour on non-API routes', async () => {
    const app = await testApp();
    const res = await app.inject(preflight('/api/v1/me', 'https://someone-elses-site.test', 'GET'));
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    await app.close();
  });
});
