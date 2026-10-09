import { logger } from '../../logging/logger.js';
import { SourceError } from '../errors.js';
import type { SourceAdapter } from '../types.js';

/**
 * Primary-first with a configured fallback (yt-dlp, then cobalt).
 * Only transient `SourceError` crosses over - policy/SSRF rejections
 * (`SourcePolicyError`) and programming bugs fail fast, never falling back,
 * so a block can never be bypassed by switching adapters.
 */
export function withFallback(
  primary: SourceAdapter,
  fallback: SourceAdapter | null,
): SourceAdapter {
  if (!fallback) return primary;
  const attempt = async <T>(
    label: 'analyze' | 'download',
    runPrimary: () => Promise<T>,
    runFallback: () => Promise<T>,
  ): Promise<T> => {
    try {
      return await runPrimary();
    } catch (err) {
      if (!(err instanceof SourceError)) throw err;
      logger.warn(
        { err, primary: primary.key, fallback: fallback.key },
        `primary ${label} failed; trying fallback adapter`,
      );
      return runFallback();
    }
  };
  return {
    key: primary.key,
    canHandle: (url: URL) => primary.canHandle(url),
    analyze: (url, opts) =>
      attempt(
        'analyze',
        () => primary.analyze(url, opts),
        () => fallback.analyze(url, opts),
      ),
    download: (url, opts) =>
      attempt(
        'download',
        () => primary.download(url, opts),
        () => fallback.download(url, opts),
      ),
  };
}
