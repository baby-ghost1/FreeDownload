import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/server/app.js';
import { closeDatabase, getDb } from '../../src/database/client.js';
import { closeRedis } from '../../src/redis/client.js';
import { closeQueues } from '../../src/queue/queues.js';
import { seed } from '../../src/database/seed.js';
import { config } from '../../src/server/config.js';
import { hashPassword } from '../../src/security/passwords.js';
import { adminUsers, users } from '../../src/database/schema/index.js';
import type { AppInstance } from '../../src/types/app.js';
import { infraAvailable, inCi } from '../helpers/infra.js';

const infraUp = await infraAvailable();
const describeInfra = describe.runIf(infraUp || inCi);

const suffix = randomUUID().replace(/-/g, '').slice(0, 12);
const OWNER_EMAIL = `billing-owner-${suffix}@example.com`;
const OWNER_PASSWORD = 'correct-horse-billing-1';
const USER_PASSWORD = 'correct-horse-user-1';
const CSRF_HEADER = config.session.csrfHeaderName;

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

describeInfra('manual UPI billing (integration)', () => {
  let app: AppInstance;
  let owner: Session;
  let userSession: Session;
  let userId = '';

  beforeAll(async () => {
    await seed();
    await getDb().insert(adminUsers).values({
      email: OWNER_EMAIL,
      passwordHash: await hashPassword(OWNER_PASSWORD),
      role: 'owner',
      active: true,
    });
    app = await buildApp({ rateLimit: false });
    await app.ready();

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/auth/login',
      payload: { email: OWNER_EMAIL, password: OWNER_PASSWORD },
    });
    expect(loginRes.statusCode).toBe(200);
    owner = { cookie: cookieHeader(loginRes), csrf: cookieValue(loginRes, 'fd_csrf') };

    const registerRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: `billing-user-${suffix}@example.com`,
        password: USER_PASSWORD,
      },
    });
    expect(registerRes.statusCode).toBe(201);
    userSession = {
      cookie: cookieHeader(registerRes),
      csrf: cookieValue(registerRes, 'fd_csrf'),
    };
    userId = (registerRes.json() as { user: { id: string } }).user.id;
  });

  afterAll(async () => {
    await app.close();
    await closeQueues();
    await closeDatabase();
    await closeRedis();
  });

  function admin(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    payload?: Record<string, unknown>,
  ) {
    return app.inject({
      method,
      url,
      headers: { cookie: owner.cookie, [CSRF_HEADER]: owner.csrf },
      ...(payload ? { payload } : {}),
    });
  }

  function user(
    method: 'GET' | 'POST' | 'DELETE',
    url: string,
    payload?: Record<string, unknown>,
  ) {
    return app.inject({
      method,
      url,
      headers: { cookie: userSession.cookie, [CSRF_HEADER]: userSession.csrf },
      ...(payload ? { payload } : {}),
    });
  }

  it('creates a coupon, previews a discount and files an upgrade request', async () => {
    const couponRes = await admin('POST', '/api/v1/admin/coupons', {
      code: `LAUNCH-${suffix.slice(0, 6).toUpperCase()}`,
      percentOff: 20,
      maxUses: 5,
    });
    expect(couponRes.statusCode).toBe(201);
    const coupon = couponRes.json() as { code: string };
    expect(coupon.code).toMatch(/^[A-Z0-9-]+$/);

    const preview = await user('POST', '/api/v1/subscriptions/upgrade-requests/preview', {
      planCode: 'pro',
      couponCode: coupon.code,
    });
    expect(preview.statusCode).toBe(200);
    const body = preview.json() as { amountCents: number; couponApplied: boolean };
    expect(body.couponApplied).toBe(true);
    expect(body.amountCents).toBeGreaterThanOrEqual(0);

    const badPreview = await user('POST', '/api/v1/subscriptions/upgrade-requests/preview', {
      planCode: 'pro',
      couponCode: 'NOPE-NOPE',
    });
    expect(badPreview.statusCode).toBe(400);

    const created = await user('POST', '/api/v1/subscriptions/upgrade-requests', {
      planCode: 'pro',
      couponCode: coupon.code,
    });
    expect(created.statusCode).toBe(201);

    const second = await user('POST', '/api/v1/subscriptions/upgrade-requests', {
      planCode: 'business',
    });
    expect(second.statusCode).toBe(409);
  });

  it('approves the request and activates the plan', async () => {
    const list = await admin('GET', '/api/v1/admin/upgrade-requests?status=pending');
    expect(list.statusCode).toBe(200);
    const pending = (list.json() as { data: Array<{ id: string }> }).data;
    expect(pending.length).toBeGreaterThanOrEqual(1);

    const approve = await admin('POST', `/api/v1/admin/upgrade-requests/${pending[0]!.id}/approve`);
    expect(approve.statusCode).toBe(200);

    const current = await user('GET', '/api/v1/subscriptions/current');
    expect(current.statusCode).toBe(200);
    expect((current.json() as { plan: { code: string } }).plan.code).toBe('pro');
  });

  it('bulk-deletes users with one password confirmation', async () => {
    const db = getDb();
    const mkUser = async (tag: string) =>
      (
        await db
          .insert(users)
          .values({
            email: `bulk-${tag}-${suffix}@example.com`,
            passwordHash: await hashPassword(USER_PASSWORD),
            status: 'active',
          })
          .returning({ id: users.id })
      )[0]!.id;
    const a = await mkUser('a');
    const b = await mkUser('b');

    const denied = await admin('POST', '/api/v1/admin/users/bulk-delete', {
      ids: [a, b],
      password: 'not-the-password',
    });
    expect(denied.statusCode).toBe(401);

    const done = await admin('POST', '/api/v1/admin/users/bulk-delete', {
      ids: [a, b, '00000000-0000-0000-0000-000000000000'],
      password: OWNER_PASSWORD,
    });
    expect(done.statusCode).toBe(200);
    expect(done.json()).toMatchObject({ deleted: 2, requested: 3 });
  });

  it('refuses delete-all without exact phrase and correct password', async () => {
    const wrongText = await admin('POST', '/api/v1/admin/users/delete-all', {
      password: OWNER_PASSWORD,
      confirmText: 'delete everything',
    });
    expect(wrongText.statusCode).toBe(400);

    const wrongPassword = await admin('POST', '/api/v1/admin/users/delete-all', {
      password: 'not-the-password',
      confirmText: 'delete all the users',
    });
    expect(wrongPassword.statusCode).toBe(401);
  });

  it('sets plans directly and deletes users with password confirmation', async () => {
    const setPlan = await admin('PATCH', `/api/v1/admin/users/${userId}/plan`, {
      planCode: 'business',
    });
    expect(setPlan.statusCode).toBe(200);

    const wrongPassword = await admin('DELETE', `/api/v1/admin/users/${userId}`, {
      password: 'not-the-password',
    });
    expect(wrongPassword.statusCode).toBe(401);

    const deleted = await admin('DELETE', `/api/v1/admin/users/${userId}`, {
      password: OWNER_PASSWORD,
    });
    expect(deleted.statusCode).toBe(200);

    const gone = await admin('PATCH', `/api/v1/admin/users/${userId}/plan`, {
      planCode: 'free',
    });
    expect(gone.statusCode).toBe(404);
  });
});
