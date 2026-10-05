import { describe, expect, it } from 'vitest';

import { SourceError, SourcePolicyError } from '../../src/downloader/errors.js';
import { AppError } from '../../src/errors/app-error.js';
import { getAdapterForUrl } from '../../src/downloader/detector.js';
import { isPermanentFailure } from '../../src/workers/download-worker.js';

describe('isPermanentFailure', () => {
  it('fails fast on doomed sources (no retry loop)', () => {
    for (const code of ['SOURCE_UNAVAILABLE', 'SOURCE_TOO_LARGE', 'SOURCE_EXTRACT_FAILED']) {
      expect(isPermanentFailure(new SourceError(code, 'nope'))).toBe(true);
    }
  });

  it('keeps retrying transient trouble', () => {
    for (const code of ['SOURCE_TIMEOUT', 'SOURCE_INTEGRITY', 'JOB_TIMEOUT', 'WORKER_ERROR']) {
      expect(isPermanentFailure(new SourceError(code, 'later'))).toBe(false);
    }
    expect(isPermanentFailure(new SourcePolicyError('blocked'))).toBe(false);
    expect(isPermanentFailure(new AppError('SERVICE_UNAVAILABLE', 'down'))).toBe(false);
    expect(isPermanentFailure(new Error('boom'))).toBe(false);
  });
});

describe('adapter coverage is platform-blind', () => {
  it('accepts any http(s) host without per-platform code', () => {
    for (const host of [
      'https://www.youtube.com/watch?v=abc',
      'https://vimeo.com/123',
      'https://example-blog.test/posts/ep1',
      'https://podcasts.test/feed/ep42.mp3',
      'https://unknown-site.test/watch/1',
    ]) {
      expect(() => getAdapterForUrl(new URL(host))).not.toThrow();
    }
  });
});
