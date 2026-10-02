import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** SHA-256 hex digest — for tokens and URLs we never need to reverse. */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** URL-safe random token (default 32 bytes → 43 chars). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Constant-time comparison for equal-length ASCII secrets. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Normalise an email for storage and lookup (lowercase, trimmed). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
