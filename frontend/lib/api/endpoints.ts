import { apiFetch, type RequestOptions } from './client';
import type {
  AdminJob,
  AdminLoginResult,
  AdminOverview,
  AdminSource,
  AdminSourcePatch,
  AdminUser,
  AnalyzeResult,
  AuditEntry,
  FeatureFlag,
  Job,
  JobResult,
  Page,
  PublicConfig,
  SessionPayload,
  Source,
  SystemSetting,
  TargetFormat,
  Usage,
  User,
  UserSession,
} from './types';

/** Typed endpoints — paths live here so a contract change is one edit (§31). */

type Opts = Pick<RequestOptions, 'anon' | 'signal'>;

export function analyzeUrl(url: string, opts: Opts = {}): Promise<AnalyzeResult> {
  return apiFetch<AnalyzeResult>('/downloads/analyze', {
    ...opts,
    method: 'POST',
    body: { url },
  });
}

export function createJob(
  input: { url: string; format?: string | undefined; container?: string | undefined },
  opts: Opts = {},
): Promise<Job> {
  return apiFetch<Job>('/downloads', { ...opts, method: 'POST', body: input });
}

export function getJob(id: string, opts: Opts = {}): Promise<Job> {
  return apiFetch<Job>(`/downloads/${id}`, opts);
}

export function listJobs(limit = 20, opts: Opts = {}): Promise<{ data: Job[] }> {
  return apiFetch<{ data: Job[] }>(`/downloads?limit=${limit}`, opts);
}

export function cancelJob(id: string, opts: Opts = {}): Promise<Job> {
  return apiFetch<Job>(`/downloads/${id}/cancel`, { ...opts, method: 'POST' });
}

export function startJob(
  id: string,
  input: { format: string; container?: string | undefined },
  opts: Opts = {},
): Promise<Job> {
  return apiFetch<Job>(`/downloads/${id}/start`, { ...opts, method: 'POST', body: input });
}

export function getJobResult(id: string, opts: Opts = {}): Promise<JobResult> {
  return apiFetch<JobResult>(`/downloads/${id}/result`, opts);
}

export function getSources(opts: Opts = {}): Promise<{ data: Source[] }> {
  return apiFetch<{ data: Source[] }>('/sources', opts);
}

export function getTargetFormats(opts: Opts = {}): Promise<{ data: TargetFormat[] }> {
  return apiFetch<{ data: TargetFormat[] }>('/formats', opts);
}

export function getPublicConfig(opts: Opts = {}): Promise<PublicConfig> {
  return apiFetch<PublicConfig>('/config/public', opts);
}

// --- auth (cookie session; CSRF header added by apiFetch) -------------------

export function register(input: {
  email: string;
  password: string;
  displayName?: string;
  turnstileToken?: string;
}): Promise<SessionPayload> {
  return apiFetch<SessionPayload>('/auth/register', { method: 'POST', body: input });
}

export function login(input: { email: string; password: string }): Promise<SessionPayload> {
  return apiFetch<SessionPayload>('/auth/login', { method: 'POST', body: input });
}

export function logout(): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>('/auth/logout', { method: 'POST' });
}

export function me(opts: Opts = {}): Promise<User> {
  return apiFetch<User>('/me', opts);
}

export function updateProfile(input: { displayName: string }): Promise<User> {
  return apiFetch<User>('/me', { method: 'PATCH', body: input });
}

export function forgotPassword(input: {
  email: string;
  turnstileToken?: string;
}): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>('/auth/forgot-password', { method: 'POST', body: input });
}

export function resetPassword(input: { token: string; password: string }): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>('/auth/reset-password', { method: 'POST', body: input });
}

export function verifyEmail(input: { token: string }): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>('/auth/verify-email', { method: 'POST', body: input });
}

// --- account (Phase 6) -------------------------------------------------------

export function getUsage(days = 30, opts: Opts = {}): Promise<Usage> {
  return apiFetch<Usage>(`/me/usage?days=${days}`, opts);
}

export function listMySessions(opts: Opts = {}): Promise<{ data: UserSession[] }> {
  return apiFetch<{ data: UserSession[] }>('/me/sessions', opts);
}

export function revokeMySession(id: string, opts: Opts = {}): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>(`/me/sessions/${id}`, { ...opts, method: 'DELETE' });
}

// --- admin (Phase 6) ---------------------------------------------------------

export function adminLogin(input: {
  email: string;
  password: string;
  code?: string;
}): Promise<AdminLoginResult> {
  return apiFetch<AdminLoginResult>('/admin/auth/login', { method: 'POST', body: input });
}

export function adminLogout(): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>('/admin/auth/logout', { method: 'POST' });
}

export function adminMe(
  opts: Opts = {},
): Promise<{ admin: AdminLoginResult['admin']; mfaOk: boolean }> {
  return apiFetch<{ admin: AdminLoginResult['admin']; mfaOk: boolean }>('/admin/auth/me', opts);
}

export function adminMfaSetup(): Promise<{ secret: string; otpauthUrl: string }> {
  return apiFetch<{ secret: string; otpauthUrl: string }>('/admin/auth/mfa/setup', {
    method: 'POST',
  });
}

export function adminMfaComplete(code: string): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>('/admin/auth/mfa/complete', {
    method: 'POST',
    body: { code },
  });
}

export function getAdminOverview(opts: Opts = {}): Promise<AdminOverview> {
  return apiFetch<AdminOverview>('/admin/overview', opts);
}

export function listAdminJobs(
  query: { status?: string; cursor?: string; limit?: number } = {},
  opts: Opts = {},
): Promise<Page<AdminJob>> {
  const params = new URLSearchParams();
  if (query.status) params.set('status', query.status);
  if (query.cursor) params.set('cursor', query.cursor);
  if (query.limit) params.set('limit', String(query.limit));
  const qs = params.toString();
  return apiFetch<Page<AdminJob>>(`/admin/jobs${qs ? `?${qs}` : ''}`, opts);
}

export function getAdminJob(id: string, opts: Opts = {}): Promise<AdminJob> {
  return apiFetch<AdminJob>(`/admin/jobs/${id}`, opts);
}

export function adminCancelJob(id: string): Promise<AdminJob> {
  return apiFetch<AdminJob>(`/admin/jobs/${id}/cancel`, { method: 'POST' });
}

export function adminRetryJob(id: string): Promise<AdminJob> {
  return apiFetch<AdminJob>(`/admin/jobs/${id}/retry`, { method: 'POST' });
}

export function listAdminSources(opts: Opts = {}): Promise<{ data: AdminSource[] }> {
  return apiFetch<{ data: AdminSource[] }>('/admin/sources', opts);
}

export function getAdminSource(id: string, opts: Opts = {}): Promise<AdminSource> {
  return apiFetch<AdminSource>(`/admin/sources/${id}`, opts);
}

export function updateAdminSource(id: string, patch: AdminSourcePatch): Promise<AdminSource> {
  return apiFetch<AdminSource>(`/admin/sources/${id}`, { method: 'PATCH', body: patch });
}

export function listAdminUsers(
  query: { cursor?: string; limit?: number } = {},
  opts: Opts = {},
): Promise<Page<AdminUser>> {
  const params = new URLSearchParams();
  if (query.cursor) params.set('cursor', query.cursor);
  if (query.limit) params.set('limit', String(query.limit));
  const qs = params.toString();
  return apiFetch<Page<AdminUser>>(`/admin/users${qs ? `?${qs}` : ''}`, opts);
}

export function updateAdminUser(
  id: string,
  input: { status: 'active' | 'suspended' },
): Promise<AdminUser> {
  return apiFetch<AdminUser>(`/admin/users/${id}`, { method: 'PATCH', body: input });
}

export function listAdminAuditLogs(
  query: { resource?: string; action?: string; cursor?: string; limit?: number } = {},
  opts: Opts = {},
): Promise<Page<AuditEntry>> {
  const params = new URLSearchParams();
  if (query.resource) params.set('resource', query.resource);
  if (query.action) params.set('action', query.action);
  if (query.cursor) params.set('cursor', query.cursor);
  if (query.limit) params.set('limit', String(query.limit));
  const qs = params.toString();
  return apiFetch<Page<AuditEntry>>(`/admin/audit-logs${qs ? `?${qs}` : ''}`, opts);
}

export function listAdminFlags(opts: Opts = {}): Promise<{ data: FeatureFlag[] }> {
  return apiFetch<{ data: FeatureFlag[] }>('/admin/flags', opts);
}

export function updateAdminFlag(
  key: string,
  patch: { enabled?: boolean; rollout?: number },
): Promise<FeatureFlag> {
  return apiFetch<FeatureFlag>(`/admin/flags/${key}`, { method: 'PATCH', body: patch });
}

export function listAdminSettings(opts: Opts = {}): Promise<{ data: SystemSetting[] }> {
  return apiFetch<{ data: SystemSetting[] }>('/admin/settings', opts);
}

export function updateAdminSetting(key: string, value: unknown): Promise<SystemSetting> {
  return apiFetch<SystemSetting>(`/admin/settings/${key}`, { method: 'PATCH', body: { value } });
}
