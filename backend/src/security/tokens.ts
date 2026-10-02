import { config } from '../server/config.js';
import { AppError } from '../errors/app-error.js';
import { randomToken, sha256 } from '../utils/crypto.js';

export interface IssuedToken {
  /** Plaintext value — returned to the user exactly once (emailed link). */
  token: string;
  /** SHA-256 digest stored in the database. */
  tokenHash: string;
  expiresAt: Date;
}

/**
 * Single-use, short-lived tokens for email verification and password reset.
 * Only the hash is persisted; the plaintext never touches the database.
 */
export function issueVerificationToken(): IssuedToken {
  const token = randomToken(32);
  return {
    token,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + config.tokens.verifyTtlHours * 3_600_000),
  };
}

export function issuePasswordResetToken(): IssuedToken {
  const token = randomToken(32);
  return {
    token,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + config.tokens.resetTtlMinutes * 60_000),
  };
}

export function hashToken(token: string): string {
  return sha256(token);
}

export function isTokenUsable(row: { expiresAt: Date; consumedAt: Date | null }): boolean {
  if (row.consumedAt) return false;
  return row.expiresAt.getTime() > Date.now();
}

export function assertUsable(row: { expiresAt: Date; consumedAt: Date | null }): void {
  if (!isTokenUsable(row)) {
    throw new AppError('VALIDATION_ERROR', 'This link is invalid or has expired.');
  }
}
