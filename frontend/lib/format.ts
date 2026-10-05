/** Human-friendly formatting for job/analyzer payloads (client-side only). */

export function formatDuration(totalSeconds: number | null | undefined): string | null {
  if (totalSeconds === null || totalSeconds === undefined || !Number.isFinite(totalSeconds)) {
    return null;
  }
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export function formatBytes(bytes: number | null | undefined): string | null {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return null;
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 'B';
  for (const next of units) {
    if (value < 1024) break;
    value /= 1024;
    unit = next;
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${unit}`;
}

const STAGE_COPY: Record<string, string> = {
  created: 'Created',
  validating: 'Validating…',
  queued: 'Queued…',
  analyzing: 'Analyzing the link…',
  ready: 'Ready - pick a format',
  processing: 'Downloading…',
  uploading: 'Finishing up…',
  completed: 'Done',
  failed: 'Failed',
  retrying: 'Retrying…',
  cancelled: 'Cancelled',
  expired: 'Expired',
  dead_letter: 'Failed permanently',
  policy_restricted: 'Blocked by source policy',
};

export function stageLabel(status: string): string {
  return STAGE_COPY[status] ?? status;
}

export function isTerminalStatus(status: string): boolean {
  return ['completed', 'cancelled', 'expired', 'dead_letter', 'policy_restricted'].includes(status);
}

/** Short relative time ("just now", "5m ago", "3h ago", "2d ago"). */
export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  if (!Number.isFinite(diff) || diff < 0) return 'just now';
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}
