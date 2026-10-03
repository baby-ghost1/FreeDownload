import type {
  AnalyzeResult,
  Job,
  JobResult,
  PublicConfig,
  SessionPayload,
  TargetFormat,
  User,
} from '@/lib/api/types';

/** Wire fixtures mirroring docs/api.md — used by the Playwright route mocks. */

const NOW = '2026-10-03T12:00:00.000Z';

export const publicConfig: PublicConfig = {
  turnstile: { enabled: false, siteKey: null },
  limits: { maxFileSizeMb: 2048, analyzeCacheTtlSec: 3600, signedUrlTtlSec: 900 },
  flags: {},
  plans: [
    {
      code: 'free',
      name: 'Free',
      tier: 0,
      priceCents: 0,
      currency: 'usd',
      interval: 'month',
      limits: { jobsPerDay: 5, maxFileSizeMb: 200 },
      features: { priorityQueue: false },
    },
    {
      code: 'pro',
      name: 'Pro',
      tier: 1,
      priceCents: 999,
      currency: 'usd',
      interval: 'month',
      limits: { jobsPerDay: 100, maxFileSizeMb: 2048 },
      features: { priorityQueue: true },
    },
    {
      code: 'max',
      name: 'Max',
      tier: 2,
      priceCents: 2999,
      currency: 'usd',
      interval: 'month',
      limits: { jobsPerDay: 500, maxFileSizeMb: 4096 },
      features: { priorityQueue: true },
    },
  ],
};

export const targetFormats: TargetFormat[] = [
  { key: '1080p', label: '1080p MP4', kind: 'video', container: 'mp4' },
  { key: 'mp3', label: 'MP3', kind: 'audio', container: 'mp3' },
];

export const analyzeResult: AnalyzeResult = {
  url: 'https://media.test/watch?v=abc',
  title: 'Big Buck Bunny',
  durationSec: 596,
  thumbnailUrl: 'https://media.test/thumb.jpg',
  uploader: 'Blender Foundation',
  description: null,
  formats: [
    {
      key: '1080p',
      label: '1080p MP4',
      kind: 'video',
      container: 'mp4',
      width: 1920,
      height: 1080,
      fps: 30,
      filesizeBytes: 12_345_678,
      isDefault: true,
    },
    {
      key: '720p',
      label: '720p MP4',
      kind: 'video',
      container: 'mp4',
      width: 1280,
      height: 720,
      fps: 30,
      filesizeBytes: 6_172_839,
      isDefault: false,
    },
    {
      key: 'mp3',
      label: 'MP3 audio',
      kind: 'audio',
      container: 'mp3',
      width: null,
      height: null,
      fps: null,
      filesizeBytes: 4_718_592,
      isDefault: false,
    },
  ],
  cachedAt: NOW,
};

export function jobFixture(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job-1',
    status: 'queued',
    progress: 0,
    url: 'https://media.test/watch?v=abc',
    requestedFormat: null,
    targetContainer: null,
    errorCode: null,
    errorMessage: null,
    retryCount: 0,
    createdAt: NOW,
    updatedAt: NOW,
    expiresAt: null,
    completedAt: null,
    ...overrides,
  };
}

export const jobResult: JobResult = {
  url: 'https://cdn.test/files/job-1.mp4?sig=test',
  expiresAt: '2026-10-03T12:15:00.000Z',
  sizeBytes: 12_345_678,
  container: 'mp4',
  mimeType: 'video/mp4',
};

export const user: User = {
  id: 'user-1',
  email: 'ada@example.com',
  displayName: 'Ada',
  status: 'active',
  emailVerifiedAt: NOW,
  createdAt: NOW,
};

export const session: SessionPayload = { user, csrfToken: 'csrf-e2e' };

export const unauthorized = {
  error: { code: 'UNAUTHORIZED', message: 'Sign in required.', requestId: 'e2e' },
};

export function notFound(method: string, path: string) {
  return {
    error: { code: 'NOT_FOUND', message: `Unmocked ${method} ${path}`, requestId: 'e2e' },
  };
}
