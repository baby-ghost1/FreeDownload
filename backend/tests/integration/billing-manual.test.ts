import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { buildApp } from '../../src/server/app.js';
import { closeDatabase, getDb } from '../../src/database/client.js';
import { closeRedis } from '../../src/redis/client.js';
import { closeQueues } from '../../src/queue/queues.js';
import { seed } from '../../src/database/seed.js';
import { config } from '../../src/server/config.js';
import { hashPassword } from '../../src/security/passwords.js';
import { adminUsers, coupons, users } from '../../src/database/schema/index.js';
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
  let createdCouponCode: string | null = null;
  const extraCouponCodes: string[] = [];

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
    // The dev DB is shared with the live app - never leave test coupons in it.
    for (const code of [createdCouponCode, ...extraCouponCodes]) {
      if (code) await getDb().delete(coupons).where(eq(coupons.code, code));
    }
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
    createdCouponCode = coupon.code;
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

  it('deactivates, reactivates, rejects expired codes and deletes coupons', async () => {
    const code = `CTRL-${suffix.slice(0, 6).toUpperCase()}`;
    extraCouponCodes.push(code);
    const created = await admin('POST', '/api/v1/admin/coupons', {
      code,
      percentOff: 15,
      maxUses: 1,
      active: true,
    });
    expect(created.statusCode).toBe(201);
    expect((created.json() as { active: boolean }).active).toBe(true);

    // Deactivate -> the discount no longer applies.
    const off = await admin('PATCH', `/api/v1/admin/coupons/${code}`, { active: false });
    expect(off.statusCode).toBe(200);
    expect((off.json() as { active: boolean }).active).toBe(false);
    const blocked = await user('POST', '/api/v1/subscriptions/upgrade-requests/preview', {
      planCode: 'pro',
      couponCode: code,
    });
    expect(blocked.statusCode).toBe(400);

    // Reactivate -> applies again.
    const on = await admin('PATCH', `/api/v1/admin/coupons/${code}`, { active: true });
    expect(on.statusCode).toBe(200);
    expect((on.json() as { active: boolean }).active).toBe(true);

    // A coupon whose expiry already passed is refused at apply time.
    const expCode = `PAST-${suffix.slice(0, 6).toUpperCase()}`;
    extraCouponCodes.push(expCode);
    const expired = await admin('POST', '/api/v1/admin/coupons', {
      code: expCode,
      percentOff: 50,
      expiresAt: new Date(Date.now() - 86_400_000).toISOString(),
    });
    expect(expired.statusCode).toBe(201);
    const deadPreview = await user('POST', '/api/v1/subscriptions/upgrade-requests/preview', {
      planCode: 'pro',
      couponCode: expCode,
    });
    expect(deadPreview.statusCode).toBe(400);

    // Delete removes it outright; a second delete is a 404.
    const gone = await admin('DELETE', `/api/v1/admin/coupons/${expCode}`);
    expect(gone.statusCode).toBe(200);
    expect(gone.json()).toMatchObject({ ok: true });
    const again = await admin('DELETE', `/api/v1/admin/coupons/${expCode}`);
    expect(again.statusCode).toBe(404);
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

  it('auto-deactivates a coupon once its redemption cap is hit, and reactivation works', async () => {
    const code = `ONCE-${suffix.slice(0, 6).toUpperCase()}`;
    extraCouponCodes.push(code);
    const res = await admin('POST', '/api/v1/admin/coupons', {
      code,
      percentOff: 10,
      maxUses: 1,
    });
    expect(res.statusCode).toBe(201);

    const file = await user('POST', '/api/v1/subscriptions/upgrade-requests', {
      planCode: 'business',
      couponCode: code,
    });
    expect(file.statusCode).toBe(201);

    const list = await admin('GET', '/api/v1/admin/upgrade-requests?status=pending');
    expect(list.statusCode).toBe(200);
    const pending = (
      list.json() as { data: Array<{ id: string; couponCode: string | null }> }
    ).data;
    const mine = pending.find((r) => r.couponCode === code);
    expect(mine).toBeDefined();

    const approve = await admin('POST', `/api/v1/admin/upgrade-requests/${mine!.id}/approve`);
    expect(approve.statusCode).toBe(200);

    // Cap reached -> the coupon flips itself off (kill switch stays honest).
    const row = (await getDb().select().from(coupons).where(eq(coupons.code, code)))[0];
    expect(row?.usedCount).toBe(1);
    expect(row?.active).toBe(false);

    // Applying it again is refused while exhausted.
    const blocked = await user('POST', '/api/v1/subscriptions/upgrade-requests/preview', {
      planCode: 'pro',
      couponCode: code,
    });
    expect(blocked.statusCode).toBe(400);

    // Admin reactivates by raising the cap -> usable again.
    const reactivated = await admin('PATCH', `/api/v1/admin/coupons/${code}`, {
      active: true,
      maxUses: 2,
    });
    expect(reactivated.statusCode).toBe(200);
    const preview = await user('POST', '/api/v1/subscriptions/upgrade-requests/preview', {
      planCode: 'pro',
      couponCode: code,
    });
    expect(preview.statusCode).toBe(200);
    expect((preview.json() as { couponApplied: boolean }).couponApplied).toBe(true);
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
      // Exact phrase so the password check is what rejects (401, not 400).
      confirmText: 'DELETE ALL USERS',
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
