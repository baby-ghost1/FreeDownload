import { createHmac, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { desc, eq } from 'drizzle-orm';

import { buildApp } from '../../src/server/app.js';
import { seed } from '../../src/database/seed.js';
import { closeDatabase, getDb } from '../../src/database/client.js';
import { closeQueues } from '../../src/queue/queues.js';
import { closeRedis } from '../../src/redis/client.js';
import {
  downloadJobs,
  downloadSources,
  mediaFormats,
  payments,
  plans,
  subscriptions,
} from '../../src/database/schema/index.js';
import { infraAvailable, inCi } from '../helpers/infra.js';

const infraUp = (await infraAvailable()) || inCi;
const WEBHOOK_SECRET = 'fd-test-webhook-secret';

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
  const found = res.cookies.find((c) => c.name === name);
  return found?.value;
}

function signWebhook(raw: string, t = Math.floor(Date.now() / 1000)): string {
  const mac = createHmac('sha256', WEBHOOK_SECRET).update(`${t}.${raw}`).digest('hex');
  return `t=${t},v1=${mac}`;
}

describe.runIf(infraUp)('billing: plans, quotas, API keys, payments', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let session: Session;

  beforeAll(async () => {
    await seed();
    app = await buildApp({ rateLimit: false });
    await app.ready();

    const reg = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: `t-${randomUUID().replace(/-/g, '').slice(0, 16)}@example.com`,
        password: 'correct-horse-1',
      },
    });
    expect(reg.statusCode).toBe(201);
    session = { cookie: cookieHeader(reg), csrf: cookieValue(reg, 'fd_csrf')! };
  });

  afterAll(async () => {
    // Restore seed values for whatever the quota tests tightened.
    await seed();
    await app.close();
    await closeQueues();
    await closeDatabase();
    await closeRedis();
  });

  async function meId(): Promise<string> {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie: session.cookie },
    });
    expect(res.statusCode).toBe(200);
    return res.json().id as string;
  }

  async function createDownload(
    headers: Record<string, string>,
    url = 'https://example.com/watch?v=billing',
  ) {
    return app.inject({
      method: 'POST',
      url: '/api/v1/downloads',
      headers,
      payload: { url },
    });
  }

  const authed = () => ({ cookie: session.cookie, 'x-csrf-token': session.csrf });

  it('lists active plans for public pricing', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/plans' });
    expect(res.statusCode).toBe(200);
    const codes = res.json().data.map((p: { code: string }) => p.code);
    expect(codes).toEqual(['free', 'pro', 'business']);
    const free = res.json().data[0];
    expect(free.priceCents).toBe(0);
    expect(free.limits).toHaveProperty('jobsPerDay');
  });

  it('answers 401 unauthenticated and defaults to free otherwise', async () => {
    const anon = await app.inject({ method: 'GET', url: '/api/v1/subscriptions/current' });
    expect(anon.statusCode).toBe(401);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/subscriptions/current',
      headers: { cookie: session.cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().plan.code).toBe('free');
    expect(res.json().status).toBe('active');
  });

  it('enforces the daily plan limit with a typed 429', async () => {
    const first = await createDownload(authed(), 'https://example.com/v/daily-1');
    expect(first.statusCode).toBe(201);

    await getDb()
      .update(plans)
      .set({ limits: { jobsPerDay: 1, concurrentJobs: 2, maxFileSizeMb: 512, apiPerHour: 60 } })
      .where(eq(plans.code, 'free'));

    const second = await createDownload(authed(), 'https://example.com/v/daily-2');
    expect(second.statusCode).toBe(429);
    const err = second.json().error;
    expect(err.code).toBe('RATE_LIMITED');
    expect(err.details).toMatchObject({ scope: 'daily', limit: 1, plan: 'free' });

    await seed();
  });

  it('enforces the concurrency plan limit', async () => {
    await getDb()
      .update(plans)
      .set({ limits: { jobsPerDay: 25, concurrentJobs: 1, maxFileSizeMb: 512, apiPerHour: 60 } })
      .where(eq(plans.code, 'free'));

    const blocked = await createDownload(authed(), 'https://example.com/v/concurrent-1');
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.details).toMatchObject({ scope: 'concurrent', limit: 1 });

    await seed();

    const allowed = await createDownload(authed(), 'https://example.com/v/concurrent-2');
    expect(allowed.statusCode).toBe(201);
  });

  it('assigns queue priority by actor and plan tier', async () => {
    const db = getDb();

    const anon = await createDownload(
      { 'x-anon-key': `anon-${randomUUID()}` },
      'https://example.com/v/anon',
    );
    expect(anon.statusCode).toBe(201);
    const anonJob = await db
      .select({ priority: downloadJobs.priority })
      .from(downloadJobs)
      .where(eq(downloadJobs.id, anon.json().id));
    expect(anonJob[0]?.priority).toBe(60);

    const userId = await meId();
    const earlier = await db
      .select({ id: downloadJobs.id, priority: downloadJobs.priority })
      .from(downloadJobs)
      .where(eq(downloadJobs.userId, userId))
      .orderBy(desc(downloadJobs.createdAt))
      .limit(10);
    expect(earlier.length).toBeGreaterThan(0);
    expect(earlier.every((j) => j.priority === 50)).toBe(true);

    const [pro] = await db.select().from(plans).where(eq(plans.code, 'pro'));
    await db
      .insert(subscriptions)
      .values({ userId, planId: pro!.id, provider: 'none', status: 'active' });

    const proJob = await createDownload(authed(), 'https://example.com/v/pro');
    expect(proJob.statusCode).toBe(201);
    const proRow = await db
      .select({ priority: downloadJobs.priority })
      .from(downloadJobs)
      .where(eq(downloadJobs.id, proJob.json().id));
    expect(proRow[0]?.priority).toBe(30);

    const [business] = await db.select().from(plans).where(eq(plans.code, 'business'));
    await db
      .update(subscriptions)
      .set({ planId: business!.id })
      .where(eq(subscriptions.userId, userId));

    const businessJob = await createDownload(authed(), 'https://example.com/v/business');
    expect(businessJob.statusCode).toBe(201);
    const businessRow = await db
      .select({ priority: downloadJobs.priority })
      .from(downloadJobs)
      .where(eq(downloadJobs.id, businessJob.json().id));
    expect(businessRow[0]?.priority).toBe(10);
  });

  it('rejects starting a ready job whose file exceeds the plan size cap', async () => {
    const reg = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: `t-${randomUUID().replace(/-/g, '').slice(0, 16)}@example.com`,
        password: 'correct-horse-1',
      },
    });
    expect(reg.statusCode).toBe(201);
    const sizeUser = { cookie: cookieHeader(reg), csrf: cookieValue(reg, 'fd_csrf')! };
    const sizeUserId = (
      await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: sizeUser.cookie } })
    ).json().id as string;

    const db = getDb();
    const [generic] = await db
      .select({ id: downloadSources.id })
      .from(downloadSources)
      .where(eq(downloadSources.slug, 'generic'));
    expect(generic).toBeDefined();

    const huge = await db
      .insert(downloadJobs)
      .values({
        userId: sizeUserId,
        sourceId: generic!.id,
        urlHash: 'size-huge',
        urlRedacted: 'https://example.com/huge',
        status: 'ready',
      })
      .returning();
    await db.insert(mediaFormats).values({
      jobId: huge[0]!.id,
      label: 'Huge',
      kind: 'video',
      container: 'mp4',
      extKey: 'huge.mp4',
      filesizeBytes: 600 * 1024 * 1024,
      isDefault: true,
    });

    const blocked = await app.inject({
      method: 'POST',
      url: `/api/v1/downloads/${huge[0]!.id}/start`,
      headers: { cookie: sizeUser.cookie, 'x-csrf-token': sizeUser.csrf },
      payload: { format: 'huge.mp4' },
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe('POLICY_RESTRICTED');
    expect(blocked.json().error.details).toMatchObject({ plan: 'free', maxFileSizeMb: 512 });

    const small = await db
      .insert(downloadJobs)
      .values({
        userId: sizeUserId,
        sourceId: generic!.id,
        urlHash: 'size-small',
        urlRedacted: 'https://example.com/small',
        status: 'ready',
      })
      .returning();
    await db.insert(mediaFormats).values({
      jobId: small[0]!.id,
      label: 'Tiny',
      kind: 'video',
      container: 'mp4',
      extKey: 'tiny.mp4',
      filesizeBytes: 1024 * 1024,
      isDefault: true,
    });

    const started = await app.inject({
      method: 'POST',
      url: `/api/v1/downloads/${small[0]!.id}/start`,
      headers: { cookie: sizeUser.cookie, 'x-csrf-token': sizeUser.csrf },
      payload: { format: 'tiny.mp4' },
    });
    expect(started.statusCode).toBe(200);
    expect(started.json().status).toBe('processing');
  });

  it('manages the API key lifecycle and meters Bearer traffic', async () => {
    const db = getDb();
    const userId = await meId();

    // Back to a clean free plan with idle jobs so the quota under test here
    // is only the API-key hourly meter.
    await db
      .update(downloadJobs)
      .set({ status: 'completed', completedAt: new Date() })
      .where(eq(downloadJobs.userId, userId));
    await db.delete(subscriptions).where(eq(subscriptions.userId, userId));
    await seed();

    const noCsrf = await app.inject({
      method: 'POST',
      url: '/api/v1/api-keys',
      headers: { cookie: session.cookie },
      payload: { name: 'nope' },
    });
    expect(noCsrf.statusCode).toBe(403);

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/api-keys',
      headers: authed(),
      payload: { name: 'ci-key' },
    });
    expect(created.statusCode).toBe(201);
    const key = created.json();
    expect(key.rawKey).toMatch(/^fd_live_[A-Za-z0-9_-]{22,}$/);
    expect(key.prefix).toBe(key.rawKey.slice(0, 12));
    expect(key.name).toBe('ci-key');

    const listed = await app.inject({
      method: 'GET',
      url: '/api/v1/api-keys',
      headers: { cookie: session.cookie },
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().data.some((k: { id: string }) => k.id === key.id)).toBe(true);

    // Bearer clients need no cookie and no CSRF token.
    const bearer = { authorization: `Bearer ${key.rawKey}` };
    const viaKey = await createDownload(bearer, 'https://example.com/v/bearer');
    expect(viaKey.statusCode).toBe(201);
    expect(viaKey.json().id).toBeTruthy();

    const usage = await app.inject({
      method: 'GET',
      url: `/api/v1/api-keys/${key.id}/usage`,
      headers: { cookie: session.cookie },
    });
    expect(usage.statusCode).toBe(200);
    expect(usage.json().totalRequests).toBeGreaterThanOrEqual(1);

    const revoked = await app.inject({
      method: 'DELETE',
      url: `/api/v1/api-keys/${key.id}`,
      headers: authed(),
    });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json().revokedAt).toBeTruthy();

    const afterRevoke = await app.inject({
      method: 'GET',
      url: '/api/v1/downloads',
      headers: bearer,
    });
    expect(afterRevoke.statusCode).toBe(401);
    expect(afterRevoke.json().error.code).toBe('UNAUTHORIZED');

    const invalid = await app.inject({
      method: 'GET',
      url: '/api/v1/downloads',
      headers: { authorization: 'Bearer fd_live_totally-bogus-key-value' },
    });
    expect(invalid.statusCode).toBe(401);

    // Foreign keys are invisible: 404, not 403.
    const other = await app.inject({
      method: 'POST',
      url: '/api/v1/api-keys',
      headers: authed(),
      payload: { name: 'mine' },
    });
    const strangerReg = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: `t-${randomUUID().replace(/-/g, '').slice(0, 16)}@example.com`,
        password: 'correct-horse-1',
      },
    });
    const stranger = {
      cookie: cookieHeader(strangerReg),
      csrf: cookieValue(strangerReg, 'fd_csrf')!,
    };
    const foreign = await app.inject({
      method: 'DELETE',
      url: `/api/v1/api-keys/${other.json().id}`,
      headers: { cookie: stranger.cookie, 'x-csrf-token': stranger.csrf },
    });
    expect(foreign.statusCode).toBe(404);
  });

  it('enforces the hourly API-key quota from plan limits', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/api-keys',
      headers: authed(),
      payload: { name: 'hourly' },
    });
    expect(created.statusCode).toBe(201);
    const bearer = { authorization: `Bearer ${created.json().rawKey}` };

    await getDb()
      .update(plans)
      .set({ limits: { jobsPerDay: 25, concurrentJobs: 2, maxFileSizeMb: 512, apiPerHour: 1 } })
      .where(eq(plans.code, 'free'));

    const first = await app.inject({ method: 'GET', url: '/api/v1/downloads', headers: bearer });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({ method: 'GET', url: '/api/v1/downloads', headers: bearer });
    expect(second.statusCode).toBe(429);
    expect(second.json().error.details).toMatchObject({ scope: 'api-hourly', limit: 1 });

    await seed();

    const third = await app.inject({ method: 'GET', url: '/api/v1/downloads', headers: bearer });
    expect(third.statusCode).toBe(200);
  });

  it('answers 503 for checkout while no provider is configured', async () => {
    const paid = await app.inject({
      method: 'POST',
      url: '/api/v1/payments/checkout',
      headers: authed(),
      payload: { planCode: 'pro' },
    });
    expect(paid.statusCode).toBe(503);
    expect(paid.json().error.code).toBe('SERVICE_UNAVAILABLE');

    const free = await app.inject({
      method: 'POST',
      url: '/api/v1/payments/checkout',
      headers: authed(),
      payload: { planCode: 'free' },
    });
    expect(free.statusCode).toBe(400);

    const anon = await app.inject({
      method: 'POST',
      url: '/api/v1/payments/checkout',
      payload: { planCode: 'pro' },
    });
    expect(anon.statusCode).toBe(403);
  });

  it('activates, deduplicates and closes subscriptions from signed webhooks', async () => {
    const db = getDb();
    const wReg = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: `t-${randomUUID().replace(/-/g, '').slice(0, 16)}@example.com`,
        password: 'correct-horse-1',
      },
    });
    expect(wReg.statusCode).toBe(201);
    const wSession = { cookie: cookieHeader(wReg), csrf: cookieValue(wReg, 'fd_csrf')! };
    const wUserId = (
      await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: wSession.cookie } })
    ).json().id as string;

    const checkoutEvent = JSON.stringify({
      id: 'evt_test_checkout',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_1',
          subscription: 'sub_test_1',
          amount_total: 900,
          currency: 'usd',
          metadata: { userId: wUserId, planCode: 'pro' },
        },
      },
    });

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/payments/webhook',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': signWebhook(checkoutEvent),
      },
      payload: checkoutEvent,
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ received: true });

    const current = await app.inject({
      method: 'GET',
      url: '/api/v1/subscriptions/current',
      headers: { cookie: wSession.cookie },
    });
    expect(current.statusCode).toBe(200);
    expect(current.json()).toMatchObject({
      status: 'active',
      provider: 'stripe',
      plan: { code: 'pro', priceCents: 900 },
    });

    // Redelivery: natural keys make it a no-op.
    const replay = await app.inject({
      method: 'POST',
      url: '/api/v1/payments/webhook',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': signWebhook(checkoutEvent),
      },
      payload: checkoutEvent,
    });
    expect(replay.statusCode).toBe(200);

    const subRows = await db
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(eq(subscriptions.providerRef, 'sub_test_1'));
    expect(subRows.length).toBe(1);
    const payRows = await db
      .select({ id: payments.id, amountCents: payments.amountCents })
      .from(payments)
      .where(eq(payments.providerRef, 'cs_test_1'));
    expect(payRows.length).toBe(1);
    expect(payRows[0]?.amountCents).toBe(900);

    // Bad signature and malformed payloads never reach the event handler.
    const badSig = await app.inject({
      method: 'POST',
      url: '/api/v1/payments/webhook',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': `t=${Math.floor(Date.now() / 1000)},v1=${'0'.repeat(64)}`,
      },
      payload: checkoutEvent,
    });
    expect(badSig.statusCode).toBe(401);

    const malformed = 'not-json-at-all';
    const badBody = await app.inject({
      method: 'POST',
      url: '/api/v1/payments/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': signWebhook(malformed) },
      payload: malformed,
    });
    expect(badBody.statusCode).toBe(400);

    // Cancellation at the provider closes the subscription.
    const deleted = JSON.stringify({
      id: 'evt_test_deleted',
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_test_1' } },
    });
    const delRes = await app.inject({
      method: 'POST',
      url: '/api/v1/payments/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': signWebhook(deleted) },
      payload: deleted,
    });
    expect(delRes.statusCode).toBe(200);

    const afterCancel = await app.inject({
      method: 'GET',
      url: '/api/v1/subscriptions/current',
      headers: { cookie: wSession.cookie },
    });
    expect(afterCancel.json()).toMatchObject({ status: 'canceled', plan: { code: 'free' } });

    // Downgrade and cancel from the account API.
    const paidSwitch = await app.inject({
      method: 'POST',
      url: '/api/v1/subscriptions',
      headers: { cookie: wSession.cookie, 'x-csrf-token': wSession.csrf },
      payload: { planCode: 'pro' },
    });
    expect(paidSwitch.statusCode).toBe(400);

    const downgrade = await app.inject({
      method: 'POST',
      url: '/api/v1/subscriptions',
      headers: { cookie: wSession.cookie, 'x-csrf-token': wSession.csrf },
      payload: { planCode: 'free' },
    });
    expect(downgrade.statusCode).toBe(200);
    expect(downgrade.json()).toMatchObject({ status: 'active', plan: { code: 'free' } });

    const cancel = await app.inject({
      method: 'POST',
      url: '/api/v1/subscriptions/cancel',
      headers: { cookie: wSession.cookie, 'x-csrf-token': wSession.csrf },
    });
    expect(cancel.statusCode).toBe(200);
    expect(cancel.json().status).toBe('canceled');

    const cancelAgain = await app.inject({
      method: 'POST',
      url: '/api/v1/subscriptions/cancel',
      headers: { cookie: wSession.cookie, 'x-csrf-token': wSession.csrf },
    });
    expect(cancelAgain.statusCode).toBe(409);
  });
});
