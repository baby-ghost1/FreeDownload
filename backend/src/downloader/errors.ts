/**
 * Source failures are not job failures — the class decides how the pipeline
 * routes the error (security layer: a failing source degrades only its own
 * jobs).
 */

/** Policy/SSRF violation: terminal `policy_restricted`, never retried. */
export class SourcePolicyError extends Error {
  readonly code = 'SOURCE_POLICY';
  constructor(message: string) {
    super(message);
    this.name = 'SourcePolicyError';
  }
}

/** Transient source trouble (timeout, 5xx, extractor hiccup): retried. */
export class SourceError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'SourceError';
    this.code = code;
  }
}

export const SOURCE_ERROR_CODES = [
  'SOURCE_TIMEOUT',
  'SOURCE_UNAVAILABLE',
  'SOURCE_EXTRACT_FAILED',
  'SOURCE_TOO_LARGE',
  'SOURCE_INTEGRITY',
] as const;
