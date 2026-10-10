/**
 * Wire types mirroring the API contract (docs/api.md). Dates arrive as ISO
 * strings - they stay strings on the client; only formatting layers parse.
 */

export type JobStatus =
  | 'created'
  | 'validating'
  | 'queued'
  | 'analyzing'
  | 'ready'
  | 'processing'
  | 'uploading'
  | 'completed'
  | 'failed'
  | 'retrying'
  | 'cancelled'
  | 'expired'
  | 'dead_letter'
  | 'policy_restricted';

export interface Job {
  id: string;
  status: JobStatus;
  progress: number;
  url: string | null;
  title: string | null;
  requestedFormat: string | null;
  targetContainer: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  completedAt: string | null;
}

export interface AnalyzeFormat {
  key: string;
  label: string;
  kind: 'video' | 'audio' | 'other';
  container: string;
  width: number | null;
  height: number | null;
  fps: number | null;
  filesizeBytes: number | null;
  isDefault: boolean;
}

export interface AnalyzeResult {
  url: string;
  title: string | null;
  durationSec: number | null;
  thumbnailUrl: string | null;
  uploader: string | null;
  description: string | null;
  formats: AnalyzeFormat[];
  cachedAt: string;
}

export interface JobResult {
  url: string;
  downloadUrl: string;
  fileName: string;
  expiresAt: string;
  sizeBytes: number | null;
  container: string | null;
  mimeType: string | null;
}

export interface TargetFormat {
  key: string;
  label: string;
  kind: 'video' | 'audio';
  container: string;
}

export interface Source {
  slug: string;
  name: string;
  mode: 'active' | 'maintenance' | 'restricted' | 'disabled';
  allowedFormats: string[];
  maxFileSizeMb: number | null;
  requiresAuth: boolean;
}

export interface PublicConfig {
  turnstile: { enabled: boolean; siteKey: string | null };
  limits: {
    maxFileSizeMb: number;
    analyzeCacheTtlSec: number;
    signedUrlTtlSec: number;
  };
  flags: Record<string, boolean>;
  navbar: {
    visible: boolean;
    links: { home: boolean; download: boolean; downloads: boolean; auth: boolean };
  };
  plans: Array<{
    code: string;
    name: string;
    tier: number;
    priceCents: number;
    currency: string;
    interval: string;
    limits?: unknown;
    features?: unknown;
  }>;
}

export interface User {
  id: string;
  email: string;
  displayName: string | null;
  status: 'pending' | 'active' | 'suspended' | 'deleted';
  emailVerifiedAt: string | null;
  createdAt: string;
}

export interface SessionPayload {
  user: User;
  csrfToken: string;
}

// --- account (Phase 6) -------------------------------------------------------

export interface UsageDay {
  day: string;
  count: number;
  completed: number;
  failed: number;
}

export interface Usage {
  days: number;
  total: number;
  completed: number;
  failed: number;
  byDay: UsageDay[];
}

export interface UserSession {
  id: string;
  ip: string | null;
  userAgent: string | null;
  current: boolean;
  lastSeenAt: string;
  expiresAt: string;
  createdAt: string;
}

// --- billing + API keys (Phase 7) --------------------------------------------

export interface PlanInfo {
  code: string;
  name: string;
  tier: number;
  priceCents: number;
  currency: string;
  interval: 'month' | 'year';
  limits: {
    jobsPerDay?: number;
    concurrentJobs?: number;
    maxFileSizeMb?: number;
    apiPerHour?: number;
  } | null;
  features: Record<string, boolean> | null;
  sortOrder: number;
}

export interface Subscription {
  status: 'trialing' | 'active' | 'past_due' | 'canceled' | 'incomplete';
  provider: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  canceledAt: string | null;
  plan: PlanInfo;
}

export interface UpgradeRequest {
  id: string;
  planCode: 'pro' | 'business';
  amountCents: number;
  currency: string;
  couponCode: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'canceled';
  reviewedAt: string | null;
  createdAt: string;
}

export interface AdminUpgradeRequest extends UpgradeRequest {
  userId: string;
  userEmail: string | null;
  reviewedBy: string | null;
}

export interface Coupon {
  id: string;
  code: string;
  percentOff: number;
  maxUses: number | null;
  usedCount: number;
  expiresAt: string | null;
  active: boolean;
  createdAt: string;
}

export interface ApiKeyInfo {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  rateTier: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface CreatedApiKey extends ApiKeyInfo {
  /** Shown exactly once, at creation - never retrievable again. */
  rawKey: string;
}

export interface ApiKeyUsage {
  totalRequests: number;
  totalErrors: number;
  buckets: Array<{ bucketStart: string; requests: number; errors: number; bytes: number }>;
}

// --- admin (Phase 6) ---------------------------------------------------------

export type AdminRole = 'owner' | 'admin' | 'support' | 'viewer';

export interface Admin {
  id: string;
  email: string;
  role: AdminRole;
  active: boolean;
}

export interface AdminLoginResult {
  admin: Admin;
  csrfToken: string;
  mfaEnrolled: boolean;
  mfaOk: boolean;
}

export interface AdminSessionInfo {
  id: string;
  ip: string | null;
  userAgent: string | null;
  current: boolean;
  lastSeenAt: string;
  expiresAt: string;
  createdAt: string;
}

export interface AdminOverview {
  jobs: { total: number; last24h: number; byStatus: Record<string, number> };
  users: { total: number; active: number; suspended: number };
  sources: { total: number; enabled: number };
  auditsLast24h: number;
}

export interface AdminJob {
  id: string;
  status: JobStatus;
  progress: number;
  url: string;
  requestedFormat: string | null;
  targetContainer: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  retryCount: number;
  userId: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  completedAt: string | null;
}

export interface AdminSource {
  id: string;
  slug: string;
  name: string;
  adapterKey: string;
  enabled: boolean;
  mode: 'active' | 'maintenance' | 'restricted' | 'disabled';
  allowedFormats: unknown;
  maxFileSizeMb: number | null;
  requiresAuth: boolean;
  priority: number;
  healthStatus: 'unknown' | 'healthy' | 'degraded' | 'down';
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminSourcePatch {
  enabled?: boolean;
  mode?: AdminSource['mode'];
  allowedFormats?: string[];
  maxFileSizeMb?: number | null;
  requiresAuth?: boolean;
  notes?: string | null;
}

export interface AdminUser {
  id: string;
  email: string;
  displayName: string | null;
  status: 'pending' | 'active' | 'suspended' | 'deleted';
  emailVerifiedAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface AuditEntry {
  id: string;
  adminId: string | null;
  action: string;
  resource: string | null;
  resourceId: string | null;
  ip: string | null;
  metadata: unknown;
  createdAt: string;
}

export interface FeatureFlag {
  key: string;
  enabled: boolean;
  rollout: number;
  updatedAt: string | null;
}

export interface SystemSetting {
  key: string;
  value: unknown;
  updatedAt: string | null;
}

export interface Page<T> {
  data: T[];
  nextCursor: string | null;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: Record<string, unknown>;
  };
}
