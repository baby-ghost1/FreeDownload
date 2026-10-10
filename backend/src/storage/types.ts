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
  signedUrl(
    key: string,
    ttlSec?: number,
    options?: { filename?: string; download?: boolean },
  ): Promise<string>;
  remove(key: string): Promise<void>;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Unique on-device filename: FreeDownload_07-10-2026_Wed_200756_8e6d.mp4.
 * Date + time come from the upload moment; the trailing job-id slice stands
 * in for a day-serial and guarantees no two platform downloads share a name,
 * so phones stop warning "download again" on first-time saves. Output stays
 * inside [A-Za-z0-9._-] so storage keys and Content-Disposition stay valid.
 */
export function downloadFileName(jobId: string, when: Date, container: string): string {
  const p2 = (n: number) => String(n).padStart(2, '0');
  const date = `${p2(when.getDate())}-${p2(when.getMonth() + 1)}-${when.getFullYear()}`;
  const day = WEEKDAYS[when.getDay()] ?? '';
  const time = `${p2(when.getHours())}${p2(when.getMinutes())}${p2(when.getSeconds())}`;
  const serial = (jobId.replace(/[^a-zA-Z0-9]/g, '').slice(-4) || '0000').toLowerCase();
  const ext = (container || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4';
  return `FreeDownload_${date}_${day}_${time}_${serial}.${ext}`;
}

/** Object keys are server-generated - remote filenames are never trusted. */
export function jobObjectKey(jobId: string, container: string, when: Date = new Date()): string {
  return `jobs/${jobId}/${downloadFileName(jobId, when, container)}`;
}
