/**
 * Storage hides the byte store behind two implementations: R2 (production)
 * and a local directory (development/tests). Media bytes never pass through
 * the API in R2 mode - the browser fetches a short-lived signed URL
 * directly (contract invariant 5).
 */

export interface StoredObject {
  key: string;
  sizeBytes: number;
  sha256: string;
}

export interface Storage {
  readonly driver: 'local' | 'r2';
  /** Uploads a worker-local file under a worker-generated key. */
  put(localPath: string, key: string, mimeType: string): Promise<StoredObject>;
  /** Short-lived URL; TTL comes from SIGNED_URL_TTL_SEC by default. */
  signedUrl(key: string, ttlSec?: number): Promise<string>;
  remove(key: string): Promise<void>;
}

/** Object keys are server-generated - remote filenames are never trusted. */
export function jobObjectKey(jobId: string, container: string): string {
  return `jobs/${jobId}/media.${container}`;
}
