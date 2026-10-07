import { SourcePolicyError } from './errors.js';
import { getCobaltAdapter } from './executors/cobalt.js';
import { withFallback } from './executors/fallback.js';
import { ytdlpAdapter } from './executors/ytdlp.js';
import type { SourceAdapter } from './types.js';

/**
 * Which adapter handles this URL. Order matters: more specific adapters
 * register before the generic yt-dlp one (contract invariant 6).
 */
const adapters: SourceAdapter[] = [ytdlpAdapter];

export function registerAdapter(adapter: SourceAdapter): void {
  const existing = adapters.findIndex((a) => a.key === adapter.key);
  if (existing >= 0) adapters.splice(existing, 1, adapter);
  else adapters.unshift(adapter);
}

export function getAdapterForUrl(url: URL): SourceAdapter {
  const adapter = adapters.find((a) => a.canHandle(url));
  if (!adapter) {
    throw new SourcePolicyError('No adapter can handle this URL.');
  }
  return adapter;
}

/**
 * Primary adapter with the cobalt fallback attached when COBALT_API_URL is
 * set. All analyze/download call sites go through here.
 */
export function getAdapterWithFallback(url: URL): SourceAdapter {
  return withFallback(getAdapterForUrl(url), getCobaltAdapter());
}

export function listAdapters(): ReadonlyArray<{ key: string }> {
  return adapters.map((a) => ({ key: a.key }));
}
