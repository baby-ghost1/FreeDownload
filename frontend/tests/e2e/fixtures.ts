import type {
  AnalyzeResult,
  ApiKeyInfo,
  Job,
  JobResult,
  PlanInfo,
  PublicConfig,
  SessionPayload,
  Subscription,
  TargetFormat,
  Usage,
  User,
  UserSession,
} from '@/lib/api/types';

/** Wire fixtures mirroring docs/api.md - used by the Playwright route mocks. */

const NOW = '2026-10-03T12:00:00.000Z';

export const publicConfig: PublicConfig = {
  turnstile: { enabled: false, siteKey: null },
  limits: { maxFileSizeMb: 2048, analyzeCacheTtlSec: 3600, signedUrlTtlSec: 900 },
  flags: {},
  navbar: {
    visible: true,
    links: { home: true, download: true, downloads: true, auth: true },
  },
  plans: [
    {
      code: 'free',
      name: 'Free',
      tier: 0,
      priceCents: 0,
      currency: 'usd',
      interval: 'month',
      limits: { jobsPerDay: 25, concurrentJobs: 2, maxFileSizeMb: 512, apiPerHour: 60 },
      features: { priorityQueue: false },
    },
    {
      code: 'pro',
      name: 'Pro',
      tier: 0,
      priceCents: 49900,
      currency: 'inr',
      interval: 'month',
      limits: { jobsPerDay: 100, concurrentJobs: 3, maxFileSizeMb: 4096, apiPerHour: 600 },
      features: { priorityQueue: true },
    },
    {
      code: 'business',
      name: 'Business',
      tier: 0,
      priceCents: 99900,
      currency: 'inr',
      interval: 'month',
      limits: { jobsPerDay: 1000, concurrentJobs: 10, maxFileSizeMb: 16384, apiPerHour: 3600 },
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
    title: 'Big Buck Bunny',
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
  downloadUrl: 'https://cdn.test/files/job-1.mp4?dl=1&sig=test',
  fileName: 'FreeDownload_03-10-2026_Fri_120000_job1.mp4',
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

// --- billing + API keys (Phase 7) --------------------------------------------

export const planList: PlanInfo[] = publicConfig.plans.map((p, i) => ({
  ...p,
  interval: p.interval as 'month' | 'year',
  limits: (p.limits ?? null) as PlanInfo['limits'],
  features: (p.features ?? null) as Record<string, boolean> | null,
  sortOrder: i + 1,
}));

export const freeSubscription: Subscription = {
  status: 'active',
  provider: 'none',
  cancelAtPeriodEnd: false,
  currentPeriodStart: null,
  currentPeriodEnd: null,
  canceledAt: null,
  plan: planList[0]!,
};

export const proSubscription: Subscription = {
  status: 'active',
  provider: 'stripe',
  cancelAtPeriodEnd: false,
  currentPeriodStart: NOW,
  currentPeriodEnd: '2026-11-03T12:00:00.000Z',
  canceledAt: null,
  plan: planList[1]!,
};

/** A paid plan granted outside Stripe (provider `none`) - downgrades directly. */
export const businessSubscription: Subscription = {
  status: 'active',
  provider: 'none',
  cancelAtPeriodEnd: false,
  currentPeriodStart: NOW,
  currentPeriodEnd: null,
  canceledAt: null,
  plan: planList[2]!,
};

export const apiKey: ApiKeyInfo = {
  id: 'key-1',
  name: 'ci',
  prefix: 'fd_live_a1b2',
  scopes: [],
  rateTier: 'free',
  lastUsedAt: NOW,
  expiresAt: null,
  revokedAt: null,
  createdAt: NOW,
};

export const createdApiKey = {
  ...apiKey,
  rawKey: 'fd_live_abcdefghijklmnopqrstuvwxyz0123456789_-',
};

export const apiKeyUsage = {
  totalRequests: 42,
  totalErrors: 1,
  buckets: [{ bucketStart: NOW, requests: 42, errors: 1, bytes: 0 }],
};

export const usageFixture: Usage = {
  days: 30,
  total: 7,
  completed: 5,
  failed: 2,
  byDay: [{ day: '2026-10-01', count: 7, completed: 5, failed: 2 }],
};

export const sessionsFixture: UserSession[] = [
  {
    id: 'sess-1',
    ip: '127.0.0.1',
    userAgent: 'Playwright',
    current: true,
    lastSeenAt: NOW,
    expiresAt: '2026-10-10T12:00:00.000Z',
    createdAt: NOW,
  },
];
