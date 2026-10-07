import Fastify from 'fastify';
import cors from '@fastify/cors';
import { describe, expect, it } from 'vitest';

/**
 * Weather-API model: any browser origin may call `/api/v1/downloads*`,
 * but WITHOUT credentials - browsers then refuse to attach session
 * cookies, so only Bearer API keys work cross-origin. Everything else
 * keeps the strict origin allowlist WITH credentials. Mirrors the
 * delegator in src/server/app.ts (preflights never carry Authorization,
 * so the decision is made on the request path, never on headers).
 */
const METHODS = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'];
const ALLOWED_HEADERS = ['Content-Type', 'Authorization', 'Idempotency-Key'];

async function testApp() {
  const app = Fastify();
  await app.register(cors, {
    delegator: (req, cb) => {
      const path = (req.url ?? '').split('?')[0] ?? '';
      if (path === '/api/v1/downloads' || path.startsWith('/api/v1/downloads/')) {
        cb(null, { origin: '*', credentials: false, methods: METHODS, maxAge: 600 });
        return;
      }
      cb(null, {
        origin(origin, originCb) {
          if (!origin) return originCb(null, true);
          if (['http://localhost:3000'].includes(origin)) return originCb(null, true);
          originCb(null, false);
        },
        credentials: true,
        methods: METHODS,
        allowedHeaders: ALLOWED_HEADERS,
        maxAge: 600,
      });
    },
  });
  app.post('/api/v1/downloads/analyze', async () => ({ ok: true }));
  app.get('/api/v1/me', async () => ({ ok: true }));
  return app;
}

describe('third-party CORS', () => {
  it('answers foreign origins with ACAO * and no credentials on API routes', async () => {
    const app = await testApp();
    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/downloads/analyze',
      headers: {
        origin: 'https://someone-elses-site.test',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,content-type',
      },
    });
    expect(preflight.headers['access-control-allow-origin']).toBe('*');
    expect(preflight.headers['access-control-allow-credentials']).toBeUndefined();
    await app.close();
  });

  it('keeps strict allowlist behaviour on non-API routes', async () => {
    const app = await testApp();
    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/me',
      headers: {
        origin: 'https://someone-elses-site.test',
        'access-control-request-method': 'GET',
      },
    });
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
    await app.close();
  });
});
