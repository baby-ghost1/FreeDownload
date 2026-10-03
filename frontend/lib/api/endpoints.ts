import { apiFetch, type RequestOptions } from './client';
import type {
  AnalyzeResult,
  Job,
  JobResult,
  PublicConfig,
  SessionPayload,
  Source,
  TargetFormat,
  User,
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
