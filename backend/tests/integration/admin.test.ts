import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/server/app.js';
import { closeDatabase, getDb } from '../../src/database/client.js';
import { closeRedis } from '../../src/redis/client.js';
import { closeQueues } from '../../src/queue/queues.js';
import { seed } from '../../src/database/seed.js';
import { config } from '../../src/server/config.js';
import { hashPassword } from '../../src/security/passwords.js';
import { totp } from '../../src/security/totp.js';
import {
  adminUsers,
  auditLogs,
  downloadJobs,
  downloadSources,
} from '../../src/database/schema/index.js';
import type { AppInstance } from '../../src/types/app.js';
import { infraAvailable, inCi } from '../helpers/infra.js';

const infraUp = await infraAvailable();
const describeInfra = describe.runIf(infraUp || inCi);

const suffix = randomUUID().replace(/-/g, '').slice(0, 12);
const OWNER_EMAIL = `owner-${suffix}@example.com`;
const SUPPORT_EMAIL = `support-${suffix}@example.com`;
const OWNER_PASSWORD = 'correct-horse-admin-1';
const SUPPORT_PASSWORD = 'correct-horse-support-1';
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

describeInfra('admin + account API (integration)', () => {
  let app: AppInstance;
  let owner: Session;
  let ownerSecret = '';
  let support: Session;
  let genericSourceId = '';
  // Admin cookies cannot call user routes - download creation needs a
  // regular signed-in user alongside them.
  let userSession: Session;

  beforeAll(async () => {
    await seed();

    const db = getDb();
    await db.insert(adminUsers).values([
      {
        email: OWNER_EMAIL,
        passwordHash: await hashPassword(OWNER_PASSWORD),
        role: 'owner',
        active: true,
      },
      {
        email: SUPPORT_EMAIL,
        passwordHash: await hashPassword(SUPPORT_PASSWORD),
        role: 'support',
        active: true,
      },
    ]);

    app = await buildApp({ rateLimit: false });
    await app.ready();

    const registerRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: `t-${randomUUID().replace(/-/g, '').slice(0, 16)}@example.com`,
        password: 'correct-horse-1',
      },
    });
    expect(registerRes.statusCode).toBe(201);
    userSession = {
      cookie: cookieHeader(registerRes),
      csrf: cookieValue(registerRes, 'fd_csrf'),
    };
  });

  afterAll(async () => {
    // Always leave the shared `generic` source usable for later files.
    await getDb()
      .update(downloadSources)
      .set({ enabled: true })
      .where(eq(downloadSources.slug, 'generic'));
    await app.close();
    await closeQueues();
    await closeDatabase();
    await closeRedis();
  });

  async function login(email: string, password: string, code?: string) {
    return app.inject({
      method: 'POST',
      url: '/api/v1/admin/auth/login',
      payload: code ? { email, password, code } : { email, password },
    });
  }

  async function setupMfa(session: Session) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/auth/mfa/setup',
      headers: { cookie: session.cookie, [CSRF_HEADER]: session.csrf },
    });
    expect(res.statusCode).toBe(200);
    return res.json() as { secret: string; otpauthUrl: string };
  }

  async function completeMfa(session: Session, secret: string, code?: string) {
    return app.inject({
      method: 'POST',
      url: '/api/v1/admin/auth/mfa/complete',
      headers: { cookie: session.cookie, [CSRF_HEADER]: session.csrf },
      payload: { code: code ?? totp(secret) },
    });
  }

  /** Login → enroll TOTP → confirm; returns an MFA-verified session. */
  async function enrolledLogin(email: string, password: string): Promise<Session> {
    const loginRes = await login(email, password);
    expect(loginRes.statusCode).toBe(200);
    const session: Session = {
      cookie: cookieHeader(loginRes),
      csrf: cookieValue(loginRes, 'fd_csrf'),
    };
    const { secret } = await setupMfa(session);
    const completeRes = await completeMfa(session, secret);
    expect(completeRes.statusCode).toBe(200);
    return session;
  }

  function adminGet(url: string, session: Session) {
    return app.inject({ method: 'GET', url, headers: { cookie: session.cookie } });
  }

  /**
   * The §75 MFA gate is off by default (ADMIN_MFA_REQUIRED unset/false);
   * tests that assert its 401/403 behavior flip it on around themselves -
   * the gate is read at request time, so no restart is needed.
   */
  async function withMfaRequired<T>(fn: () => Promise<T>): Promise<T> {
    const previous = process.env.ADMIN_MFA_REQUIRED;
    process.env.ADMIN_MFA_REQUIRED = 'true';
    try {
      return await fn();
    } finally {
      if (previous === undefined) delete process.env.ADMIN_MFA_REQUIRED;
      else process.env.ADMIN_MFA_REQUIRED = previous;
    }
  }

  function adminPatch(url: string, session: Session, payload: Record<string, unknown>) {
    return app.inject({
      method: 'PATCH',
      url,
      headers: { cookie: session.cookie, [CSRF_HEADER]: session.csrf },
      payload,
    });
  }

  it('rejects bad credentials with 401', async () => {
    const res = await login(OWNER_EMAIL, 'not-the-password');
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');
  });

  it('logs the owner in with an unverified (pre-MFA) session', async () => {
    const res = await login(OWNER_EMAIL, OWNER_PASSWORD);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.mfaEnrolled).toBe(false);
    expect(body.mfaOk).toBe(false);
    owner = { cookie: cookieHeader(res), csrf: cookieValue(res, 'fd_csrf') };
  });

  it('serves admin data to an unenrolled session while the gate is off', async () => {
    const res = await adminGet('/api/v1/admin/overview', owner);
    expect(res.statusCode).toBe(200);
    expect(res.json().jobs.total).toBeGreaterThanOrEqual(0);
  });

  it('blocks admin data until MFA enrollment completes', async () => {
    await withMfaRequired(async () => {
      const res = await adminGet('/api/v1/admin/overview', owner);
      expect(res.statusCode).toBe(403);
      expect(res.json().error.details).toEqual({ mfaRequired: true });
    });
  });

  it('requires the CSRF header on admin mutations', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/auth/mfa/setup',
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(403);
  });

  it('completing MFA with a wrong code fails', async () => {
    const { secret } = await setupMfa(owner);
    ownerSecret = secret;
    const res = await completeMfa(owner, ownerSecret, '000000');
    expect(res.statusCode).toBe(400);
  });

  it('upgrades the session once a real code confirms enrollment', async () => {
    const res = await completeMfa(owner, ownerSecret);
    expect(res.statusCode).toBe(200);

    const overview = await adminGet('/api/v1/admin/overview', owner);
    expect(overview.statusCode).toBe(200);
    const body = overview.json();
    expect(body.jobs.total).toBeGreaterThanOrEqual(0);
    expect(body.sources.total).toBeGreaterThanOrEqual(1);
    expect(body.users.total).toBeGreaterThanOrEqual(2);
  });

  it('logout revokes the session', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/auth/logout',
      headers: { cookie: owner.cookie, [CSRF_HEADER]: owner.csrf },
    });
    expect(res.statusCode).toBe(200);

    const after = await adminGet('/api/v1/admin/overview', owner);
    expect(after.statusCode).toBe(401);
  });

  it('requires the second factor on every login once enrolled', async () => {
    await withMfaRequired(async () => {
      const noCode = await login(OWNER_EMAIL, OWNER_PASSWORD);
      expect(noCode.statusCode).toBe(401);
      expect(noCode.json().error.details).toEqual({ mfaRequired: true });

      const withCode = await login(OWNER_EMAIL, OWNER_PASSWORD, totp(ownerSecret));
      expect(withCode.statusCode).toBe(200);
      const body = withCode.json();
      expect(body.mfaEnrolled).toBe(true);
      expect(body.mfaOk).toBe(true);
      owner = { cookie: cookieHeader(withCode), csrf: cookieValue(withCode, 'fd_csrf') };
    });
  });

  it('gates mutations by role: support may read but not mutate', async () => {
    support = await enrolledLogin(SUPPORT_EMAIL, SUPPORT_PASSWORD);

    const overview = await adminGet('/api/v1/admin/overview', support);
    expect(overview.statusCode).toBe(200);

    const sources = await adminGet('/api/v1/admin/sources', support);
    expect(sources.statusCode).toBe(200);
    genericSourceId = sources.json().data.find((s: { slug: string }) => s.slug === 'generic').id;

    const patched = await adminPatch(`/api/v1/admin/sources/${genericSourceId}`, support, {
      enabled: false,
    });
    expect(patched.statusCode).toBe(403);
    expect(patched.json().error.code).toBe('FORBIDDEN');
  });

  it('exit criterion: disabling a source takes effect with no redeploy', async () => {
    const before = await app.inject({ method: 'GET', url: '/api/v1/sources' });
    expect(before.json().data.some((s: { slug: string }) => s.slug === 'generic')).toBe(true);

    const off = await adminPatch(`/api/v1/admin/sources/${genericSourceId}`, owner, {
      enabled: false,
    });
    expect(off.statusCode).toBe(200);
    expect(off.json().enabled).toBe(false);

    const after = await app.inject({ method: 'GET', url: '/api/v1/sources' });
    expect(after.json().data.some((s: { slug: string }) => s.slug === 'generic')).toBe(false);

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/downloads',
      headers: { cookie: userSession.cookie, [CSRF_HEADER]: userSession.csrf },
      payload: { url: 'https://example.com/watch?v=1' },
    });
    expect(create.statusCode).toBe(422);
    expect(create.json().error.code).toBe('UNSUPPORTED_SOURCE');

    const backOn = await adminPatch(`/api/v1/admin/sources/${genericSourceId}`, owner, {
      enabled: true,
    });
    expect(backOn.statusCode).toBe(200);

    const restored = await app.inject({ method: 'GET', url: '/api/v1/sources' });
    expect(restored.json().data.some((s: { slug: string }) => s.slug === 'generic')).toBe(true);
  });

  it('suspends a user and their sessions die immediately', async () => {
    const email = `t-${randomUUID().replace(/-/g, '').slice(0, 16)}@example.com`;
    const registerRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email, password: 'correct-horse-1' },
    });
    expect(registerRes.statusCode).toBe(201);
    const userCookie = cookieHeader(registerRes);

    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie: userCookie },
    });
    expect(me.statusCode).toBe(200);
    const userId = me.json().id;

    const users = await adminGet('/api/v1/admin/users?limit=100', owner);
    expect(users.statusCode).toBe(200);
    const listed = users.json().data.find((u: { id: string }) => u.id === userId);
    expect(listed).toBeDefined();

    const suspended = await adminPatch(`/api/v1/admin/users/${userId}`, owner, {
      status: 'suspended',
    });
    expect(suspended.statusCode).toBe(200);
    expect(suspended.json().status).toBe('suspended');

    const after = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie: userCookie },
    });
    expect(after.statusCode).toBe(401);

    const restored = await adminPatch(`/api/v1/admin/users/${userId}`, owner, {
      status: 'active',
    });
    expect(restored.statusCode).toBe(200);
  });

  it('records every mutation and the audit log is append-only', async () => {
    const res = await adminGet('/api/v1/admin/audit-logs?action=source.update', owner);
    expect(res.statusCode).toBe(200);
    const rows = res.json().data;
    expect(rows.length).toBeGreaterThanOrEqual(2);

    let caught: unknown;
    try {
      await getDb()
        .update(auditLogs)
        .set({ action: 'tampered' })
        .where(eq(auditLogs.id, rows[0].id));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    const messages: string[] = [];
    for (let e: unknown = caught; e instanceof Error; e = (e as { cause?: unknown }).cause) {
      messages.push(e.message);
    }
    expect(messages.join(' | ')).toMatch(/append-only/);
  });

  it('exposes flags and settings for runtime toggles', async () => {
    const flags = await adminGet('/api/v1/admin/flags', owner);
    expect(flags.statusCode).toBe(200);

    const patchedFlag = await adminPatch('/api/v1/admin/flags/test-flag', owner, {
      enabled: true,
      rollout: 50,
    });
    expect(patchedFlag.statusCode).toBe(200);
    expect(patchedFlag.json()).toMatchObject({ key: 'test-flag', enabled: true, rollout: 50 });

    const settings = await adminGet('/api/v1/admin/settings', owner);
    expect(settings.statusCode).toBe(200);

    const patchedSetting = await adminPatch('/api/v1/admin/settings/test_setting', owner, {
      value: 'hello',
    });
    expect(patchedSetting.statusCode).toBe(200);
    expect(patchedSetting.json()).toMatchObject({ key: 'test_setting', value: 'hello' });
  });

  it('lists, cancels and retries jobs from the admin surface', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/downloads',
      headers: { cookie: userSession.cookie, [CSRF_HEADER]: userSession.csrf },
      payload: { url: 'https://example.com/watch?v=9' },
    });
    expect(createRes.statusCode).toBe(201);
    const jobId = createRes.json().id as string;

    const list = await adminGet('/api/v1/admin/jobs?limit=50', owner);
    expect(list.statusCode).toBe(200);
    expect(list.json().data.some((j: { id: string }) => j.id === jobId)).toBe(true);

    const cancelled = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/jobs/${jobId}/cancel`,
      headers: { cookie: owner.cookie, [CSRF_HEADER]: owner.csrf },
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().status).toBe('cancelled');

    const conflict = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/jobs/${jobId}/retry`,
      headers: { cookie: owner.cookie, [CSRF_HEADER]: owner.csrf },
    });
    expect(conflict.statusCode).toBe(409);

    // Park it as dead-lettered (workers normally do this) and revive it.
    await getDb()
      .update(downloadJobs)
      .set({ status: 'dead_letter' })
      .where(eq(downloadJobs.id, jobId));

    const retried = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/jobs/${jobId}/retry`,
      headers: { cookie: owner.cookie, [CSRF_HEADER]: owner.csrf },
    });
    expect(retried.statusCode).toBe(200);
    expect(retried.json().status).toBe('queued');
  });

  it('serves the signed-in user usage and session lists', async () => {
    const email = `t-${randomUUID().replace(/-/g, '').slice(0, 16)}@example.com`;
    const registerRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email, password: 'correct-horse-1' },
    });
    expect(registerRes.statusCode).toBe(201);
    const cookie = cookieHeader(registerRes);
    const csrf = cookieValue(registerRes, 'fd_csrf');

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/downloads',
      headers: { cookie, [CSRF_HEADER]: csrf },
      payload: { url: 'https://example.com/watch?v=3' },
    });
    expect(createRes.statusCode).toBe(201);

    const usage = await app.inject({
      method: 'GET',
      url: '/api/v1/me/usage?days=7',
      headers: { cookie },
    });
    expect(usage.statusCode).toBe(200);
    const usageBody = usage.json();
    expect(usageBody.days).toBe(7);
    expect(usageBody.total).toBeGreaterThanOrEqual(1);
    expect(usageBody.byDay.length).toBeGreaterThanOrEqual(1);

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/me/sessions',
      headers: { cookie },
    });
    expect(list.statusCode).toBe(200);
    const sessionsList = list.json().data as Array<{ id: string; current: boolean }>;
    expect(sessionsList.length).toBeGreaterThanOrEqual(1);
    expect(sessionsList[0]?.current).toBe(true);

    // A second session, revoked from the first one.
    const secondRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password: 'correct-horse-1' },
    });
    expect(secondRes.statusCode).toBe(200);
    const secondCookie = cookieHeader(secondRes);

    const list2 = await app.inject({
      method: 'GET',
      url: '/api/v1/me/sessions',
      headers: { cookie },
    });
    expect(list2.json().data.length).toBe(2);
    const target = list2.json().data.find((s: { current: boolean }) => s.current === false) as {
      id: string;
    };

    const revoked = await app.inject({
      method: 'DELETE',
      url: `/api/v1/me/sessions/${target.id}`,
      headers: { cookie, [CSRF_HEADER]: csrf },
    });
    expect(revoked.statusCode).toBe(200);

    const secondAfter = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie: secondCookie },
    });
    expect(secondAfter.statusCode).toBe(401);

    // Revoking the current session also clears the cookies.
    const current = list2.json().data.find((s: { current: boolean }) => s.current);
    const selfRevoked = await app.inject({
      method: 'DELETE',
      url: `/api/v1/me/sessions/${(current as { id: string }).id}`,
      headers: { cookie, [CSRF_HEADER]: csrf },
    });
    expect(selfRevoked.statusCode).toBe(200);
    const meAfter = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie },
    });
    expect(meAfter.statusCode).toBe(401);
  });
});
