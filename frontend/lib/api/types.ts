/**
 * Wire types mirroring the API contract (docs/api.md). Dates arrive as ISO
 * strings — they stay strings on the client; only formatting layers parse.
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

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: Record<string, unknown>;
  };
}
