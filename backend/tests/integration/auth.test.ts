import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/server/app.js';
import { closeDatabase } from '../../src/database/client.js';
import { closeRedis } from '../../src/redis/client.js';
import { setMailer, type MailMessage } from '../../src/modules/mailer/mailer.js';
import type { AppInstance } from '../../src/types/app.js';
import { infraAvailable, inCi } from '../helpers/infra.js';

const infraUp = await infraAvailable();
const describeInfra = describe.runIf(infraUp || inCi);

function uniqueEmail(): string {
  return `t-${randomUUID().replace(/-/g, '').slice(0, 16)}@example.com`;
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

describeInfra('auth lifecycle (integration)', () => {
  let app: AppInstance;
  const mailbox: MailMessage[] = [];

  beforeAll(async () => {
    setMailer({
      send: async (message) => {
        mailbox.push(message);
      },
    });
    app = await buildApp({ rateLimit: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    setMailer(undefined);
    await closeDatabase();
    await closeRedis();
  });

  it('registers, issues session + CSRF cookies and returns the public user', async () => {
    const email = uniqueEmail();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email, password: 'correct-horse-1', displayName: 'Ada' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.user.email).toBe(email);
    expect(body.user.status).toBe('pending');
    expect(body.csrfToken).toBeTruthy();

    const session = cookieValue(res, 'fd_session');
    expect(session).toBeTruthy();
    expect(cookieValue(res, 'fd_csrf')).toBe(body.csrfToken);

    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie: `fd_session=${session}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().email).toBe(email);
    expect(me.json().displayName).toBe('Ada');
  });

  it('rejects duplicate registration, weak passwords and bad payloads', async () => {
    const email = uniqueEmail();

    const weak = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email, password: 'short' },
    });
    expect(weak.statusCode).toBe(400);

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email, password: 'correct-horse-1' },
    });
    expect(first.statusCode).toBe(201);

    const dup = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email, password: 'correct-horse-1' },
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('CONFLICT');
  });

  it('returns the §46 envelope for unauthenticated /me', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/me' });

    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');
    expect(res.json().error.requestId).toBeTruthy();
  });

  it('logs in with good credentials and refuses bad ones', async () => {
    const email = uniqueEmail();
    const password = 'correct-horse-2';
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email, password },
    });

    const bad = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password: 'not-the-password' },
    });
    expect(bad.statusCode).toBe(401);
    expect(bad.json().error.message).toMatch(/incorrect/i);

    const unknown = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: uniqueEmail(), password: 'whatever-here' },
    });
    expect(unknown.statusCode).toBe(401);

    const ok = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().user.email).toBe(email);
    expect(cookieValue(ok, 'fd_session')).toBeTruthy();
  });

  it('enforces double-submit CSRF on cookie-authenticated mutations', async () => {
    const email = uniqueEmail();
    const reg = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email, password: 'correct-horse-3' },
    });
    const cookie = cookieHeader(reg);
    const csrf = cookieValue(reg, 'fd_csrf');

    const missing = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers: { cookie },
      payload: { displayName: 'Nope' },
    });
    expect(missing.statusCode).toBe(403);
    expect(missing.json().error.code).toBe('FORBIDDEN');

    const wrong = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers: { cookie, 'x-csrf-token': 'not-the-right-token' },
      payload: { displayName: 'Nope' },
    });
    expect(wrong.statusCode).toBe(403);

    const ok = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers: { cookie, 'x-csrf-token': csrf },
      payload: { displayName: 'Grace' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().displayName).toBe('Grace');
  });

  it('verifies the email exactly once', async () => {
    const email = uniqueEmail();
    mailbox.length = 0;

    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email, password: 'correct-horse-4' },
    });
    const mail = mailbox.find((m) => m.to === email && m.subject.includes('Confirm'));
    expect(mail).toBeDefined();

    const token = /token=([^&\s]+)/.exec(mail!.text)?.[1];
    expect(token).toBeTruthy();

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/verify-email',
      payload: { token },
    });
    expect(first.statusCode).toBe(200);

    const reuse = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/verify-email',
      payload: { token },
    });
    expect(reuse.statusCode).toBe(400);
  });

  it('resets a password without revealing whether the account exists', async () => {
    const email = uniqueEmail();
    const oldPassword = 'correct-horse-5';
    const reg = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email, password: oldPassword },
    });
    const oldSession = cookieHeader(reg);

    mailbox.length = 0;
    const unknown = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      payload: { email: uniqueEmail() },
    });
    expect(unknown.statusCode).toBe(200);
    expect(mailbox).toHaveLength(0);

    const known = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      payload: { email },
    });
    expect(known.statusCode).toBe(200);

    const mail = mailbox.find((m) => m.to === email && m.subject.includes('password'));
    expect(mail).toBeDefined();
    const token = /token=([^&\s]+)/.exec(mail!.text)?.[1];
    expect(token).toBeTruthy();

    const reset = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: { token, password: 'brand-new-pass-9' },
    });
    expect(reset.statusCode).toBe(200);

    // Every pre-existing session must be dead.
    const stale = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie: oldSession },
    });
    expect(stale.statusCode).toBe(401);

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password: 'brand-new-pass-9' },
    });
    expect(login.statusCode).toBe(200);
  });

  it('signs out and revokes the session', async () => {
    const email = uniqueEmail();
    const reg = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email, password: 'correct-horse-6' },
    });
    const cookie = cookieHeader(reg);
    const csrf = cookieValue(reg, 'fd_csrf');

    const noCsrf = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie },
    });
    expect(noCsrf.statusCode).toBe(403);

    const out = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie, 'x-csrf-token': csrf },
    });
    expect(out.statusCode).toBe(200);

    const me = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
    expect(me.statusCode).toBe(401);
  });

  it('changes the password for the signed-in user', async () => {
    const email = uniqueEmail();
    const reg = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email, password: 'correct-horse-7' },
    });
    const cookie = cookieHeader(reg);
    const csrf = cookieValue(reg, 'fd_csrf');

    const wrongCurrent = await app.inject({
      method: 'POST',
      url: '/api/v1/me/password',
      headers: { cookie, 'x-csrf-token': csrf },
      payload: { currentPassword: 'totally-wrong', newPassword: 'brand-new-pass-1' },
    });
    expect(wrongCurrent.statusCode).toBe(401);

    const ok = await app.inject({
      method: 'POST',
      url: '/api/v1/me/password',
      headers: { cookie, 'x-csrf-token': csrf },
      payload: { currentPassword: 'correct-horse-7', newPassword: 'brand-new-pass-1' },
    });
    expect(ok.statusCode).toBe(200);

    // The caller's session survives the change.
    const me = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
  });
});
