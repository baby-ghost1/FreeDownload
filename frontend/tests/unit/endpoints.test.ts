import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  adminCancelJob,
  adminLogin,
  adminLogout,
  adminMe,
  adminMfaComplete,
  adminMfaSetup,
  changeAdminPassword,
  listAdminSessions,
  revokeAdminSession,
  adminRetryJob,
  analyzeUrl,
  cancelJob,
  cancelSubscription,
  createApiKey,
  createJob,
  downgradeToFree,
  forgotPassword,
  getAdminJob,
  getAdminOverview,
  getAdminSource,
  getApiKeyUsage,
  getCurrentSubscription,
  getJob,
  getJobResult,
  getPublicConfig,
  getSources,
  getTargetFormats,
  getUsage,
  listAdminAuditLogs,
  listAdminFlags,
  listAdminJobs,
  listAdminSettings,
  listAdminSources,
  listAdminUsers,
  listApiKeys,
  listJobs,
  listMySessions,
  listPlans,
  login,
  logout,
  me,
  register,
  resetPassword,
  revokeApiKey,
  revokeMySession,
  startCheckout,
  startJob,
  updateAdminFlag,
  updateAdminSource,
  updateAdminSetting,
  updateAdminUser,
  updateProfile,
  verifyEmail,
} from '@/lib/api/endpoints';

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));

vi.mock('@/lib/api/client', () => ({ apiFetch }));

type Case = {
  path: string;
  init: Record<string, unknown>;
  call: () => Promise<unknown>;
};

const BODY = { url: 'https://example.com/v' };

/** Every endpoint is a thin apiFetch wrapper - assert path, method and body. */
const CASES: Case[] = [
  // downloads + catalog
  {
    path: '/downloads/analyze',
    init: { method: 'POST', body: { url: BODY.url } },
    call: () => analyzeUrl(BODY.url),
  },
  {
    path: '/downloads',
    init: { method: 'POST', body: { url: BODY.url, format: 'mp4' } },
    call: () => createJob({ url: BODY.url, format: 'mp4' }),
  },
  { path: '/downloads/j1', init: {}, call: () => getJob('j1') },
  { path: '/downloads/j1', init: { anon: true }, call: () => getJob('j1', { anon: true }) },
  { path: '/downloads?limit=20', init: {}, call: () => listJobs() },
  { path: '/downloads?limit=50', init: {}, call: () => listJobs(50) },
  {
    path: '/downloads?limit=50&cursor=c1',
    init: {},
    call: () => listJobs(50, 'c1'),
  },
  { path: '/downloads/j1/cancel', init: { method: 'POST' }, call: () => cancelJob('j1') },
  {
    path: '/downloads/j1/start',
    init: { method: 'POST', body: { format: 'mp4' } },
    call: () => startJob('j1', { format: 'mp4' }),
  },
  { path: '/downloads/j1/result', init: {}, call: () => getJobResult('j1') },
  { path: '/sources', init: {}, call: () => getSources() },
  { path: '/formats', init: {}, call: () => getTargetFormats() },
  { path: '/config/public', init: {}, call: () => getPublicConfig() },

  // auth + me
  {
    path: '/auth/register',
    init: { method: 'POST', body: { email: 'a@b.c', password: 'x' } },
    call: () => register({ email: 'a@b.c', password: 'x' }),
  },
  {
    path: '/auth/login',
    init: { method: 'POST', body: { email: 'a@b.c', password: 'x' } },
    call: () => login({ email: 'a@b.c', password: 'x' }),
  },
  { path: '/auth/logout', init: { method: 'POST' }, call: () => logout() },
  { path: '/me', init: {}, call: () => me() },
  {
    path: '/me',
    init: { method: 'PATCH', body: { displayName: 'Ada' } },
    call: () => updateProfile({ displayName: 'Ada' }),
  },
  {
    path: '/auth/forgot-password',
    init: { method: 'POST', body: { email: 'a@b.c' } },
    call: () => forgotPassword({ email: 'a@b.c' }),
  },
  {
    path: '/auth/reset-password',
    init: { method: 'POST', body: { token: 't', password: 'p' } },
    call: () => resetPassword({ token: 't', password: 'p' }),
  },
  {
    path: '/auth/verify-email',
    init: { method: 'POST', body: { token: 't' } },
    call: () => verifyEmail({ token: 't' }),
  },

  // account
  { path: '/me/usage?days=30', init: {}, call: () => getUsage() },
  { path: '/me/usage?days=7', init: {}, call: () => getUsage(7) },
  { path: '/me/sessions', init: {}, call: () => listMySessions() },
  { path: '/me/sessions/s1', init: { method: 'DELETE' }, call: () => revokeMySession('s1') },

  // billing + API keys
  { path: '/plans', init: {}, call: () => listPlans() },
  { path: '/subscriptions/current', init: {}, call: () => getCurrentSubscription() },
  {
    path: '/subscriptions',
    init: { method: 'POST', body: { planCode: 'free' } },
    call: () => downgradeToFree(),
  },
  { path: '/subscriptions/cancel', init: { method: 'POST' }, call: () => cancelSubscription() },
  {
    path: '/payments/checkout',
    init: { method: 'POST', body: { planCode: 'pro' } },
    call: () => startCheckout('pro'),
  },
  { path: '/api-keys', init: {}, call: () => listApiKeys() },
  {
    path: '/api-keys',
    init: { method: 'POST', body: { name: 'ci' } },
    call: () => createApiKey('ci'),
  },
  { path: '/api-keys/k1', init: { method: 'DELETE' }, call: () => revokeApiKey('k1') },
  { path: '/api-keys/k1/usage', init: {}, call: () => getApiKeyUsage('k1') },

  // admin auth
  {
    path: '/admin/auth/login',
    init: { method: 'POST', body: { email: 'a@b.c', password: 'x', code: '1' } },
    call: () => adminLogin({ email: 'a@b.c', password: 'x', code: '1' }),
  },
  { path: '/admin/auth/logout', init: { method: 'POST' }, call: () => adminLogout() },
  { path: '/admin/auth/me', init: {}, call: () => adminMe() },
  { path: '/admin/auth/mfa/setup', init: { method: 'POST' }, call: () => adminMfaSetup() },
  {
    path: '/admin/auth/mfa/complete',
    init: { method: 'POST', body: { code: '123456' } },
    call: () => adminMfaComplete('123456'),
  },
  { path: '/admin/auth/sessions', init: {}, call: () => listAdminSessions() },
  {
    path: '/admin/auth/sessions/s1',
    init: { method: 'DELETE' },
    call: () => revokeAdminSession('s1'),
  },
  {
    path: '/admin/auth/password',
    init: { method: 'POST', body: { currentPassword: 'old', newPassword: 'newpass123' } },
    call: () => changeAdminPassword({ currentPassword: 'old', newPassword: 'newpass123' }),
  },

  // admin resources - query builders called empty (all branches false) and
  // fully populated (all branches true)
  { path: '/admin/overview', init: {}, call: () => getAdminOverview() },
  { path: '/admin/jobs', init: {}, call: () => listAdminJobs() },
  {
    path: '/admin/jobs?status=queued&cursor=c1&limit=10',
    init: {},
    call: () => listAdminJobs({ status: 'queued', cursor: 'c1', limit: 10 }),
  },
  { path: '/admin/jobs/j1', init: {}, call: () => getAdminJob('j1') },
  { path: '/admin/jobs/j1/cancel', init: { method: 'POST' }, call: () => adminCancelJob('j1') },
  { path: '/admin/jobs/j1/retry', init: { method: 'POST' }, call: () => adminRetryJob('j1') },
  { path: '/admin/sources', init: {}, call: () => listAdminSources() },
  { path: '/admin/sources/s1', init: {}, call: () => getAdminSource('s1') },
  {
    path: '/admin/sources/s1',
    init: { method: 'PATCH', body: { enabled: false } },
    call: () => updateAdminSource('s1', { enabled: false }),
  },
  { path: '/admin/users', init: {}, call: () => listAdminUsers() },
  {
    path: '/admin/users?cursor=c1&limit=5',
    init: {},
    call: () => listAdminUsers({ cursor: 'c1', limit: 5 }),
  },
  {
    path: '/admin/users/u1',
    init: { method: 'PATCH', body: { status: 'suspended' } },
    call: () => updateAdminUser('u1', { status: 'suspended' }),
  },
  { path: '/admin/audit-logs', init: {}, call: () => listAdminAuditLogs() },
  {
    path: '/admin/audit-logs?resource=users&action=suspend&cursor=c1&limit=5',
    init: {},
    call: () =>
      listAdminAuditLogs({ resource: 'users', action: 'suspend', cursor: 'c1', limit: 5 }),
  },
  { path: '/admin/flags', init: {}, call: () => listAdminFlags() },
  {
    path: '/admin/flags/ads',
    init: { method: 'PATCH', body: { enabled: true } },
    call: () => updateAdminFlag('ads', { enabled: true }),
  },
  { path: '/admin/settings', init: {}, call: () => listAdminSettings() },
  {
    path: '/admin/settings/k',
    init: { method: 'PATCH', body: { value: 'v' } },
    call: () => updateAdminSetting('k', 'v'),
  },
];

afterEach(() => {
  apiFetch.mockReset();
});

describe('typed endpoints', () => {
  it.each(CASES)('$path ($init.method or GET)', async ({ path, init, call }) => {
    const payload = { ok: true };
    apiFetch.mockResolvedValueOnce(payload);

    await expect(call()).resolves.toBe(payload);
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch).toHaveBeenCalledWith(path, init);
  });

  it('propagates apiFetch rejections untouched', async () => {
    const failure = new Error('network down');
    apiFetch.mockRejectedValueOnce(failure);

    await expect(me()).rejects.toBe(failure);
  });

  it('forwards AbortSignal options to the client', async () => {
    const signal = new AbortController().signal;
    apiFetch.mockResolvedValueOnce({});

    await getJob('j1', { signal });
    expect(apiFetch).toHaveBeenCalledWith('/downloads/j1', { signal });
  });
});
