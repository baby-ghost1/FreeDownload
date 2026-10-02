import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';
import type { FastifyRequest } from 'fastify';

import {
  assertPasswordStrength,
  hashPassword,
  verifyPassword,
} from '../../src/security/passwords.js';
import { assertCsrf, issueCsrfToken } from '../../src/security/csrf.js';
import {
  hashToken,
  issuePasswordResetToken,
  issueVerificationToken,
  isTokenUsable,
} from '../../src/security/tokens.js';
import { randomToken, safeEqual, sha256, normalizeEmail } from '../../src/utils/crypto.js';
import { uuidv7 } from '../../src/utils/uuid.js';
import { AppError } from '../../src/errors/app-error.js';

describe('password hashing', () => {
  it('produces Argon2id hashes that verify', async () => {
    const hash = await hashPassword('correct-horse-battery');
    expect(hash.startsWith('$argon2id$')).toBe(true);

    await expect(verifyPassword(hash, 'correct-horse-battery')).resolves.toBe(true);
    await expect(verifyPassword(hash, 'wrong-password')).resolves.toBe(false);
  });

  it('never throws on a corrupt hash', async () => {
    await expect(verifyPassword('not-a-hash', 'anything')).resolves.toBe(false);
    await expect(verifyPassword('', 'anything')).resolves.toBe(false);
  });

  it('rejects weak passwords before hashing', () => {
    expect(() => assertPasswordStrength('short')).toThrow(AppError);
    expect(() => assertPasswordStrength('password')).toThrow(/common/i);
    expect(() => assertPasswordStrength('x'.repeat(257))).toThrow(AppError);
    expect(() => assertPasswordStrength('a-perfectly-fine-pass')).not.toThrow();
  });
});

describe('token helpers', () => {
  it('hashes deterministically and stores only digests', () => {
    const token = randomToken(32);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hashToken(token)).toBe(sha256(token));
    expect(hashToken(token)).toHaveLength(64);
  });

  it('issues single-use tokens with a future expiry', () => {
    const verify = issueVerificationToken();
    const reset = issuePasswordResetToken();

    expect(verify.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(reset.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(reset.expiresAt.getTime()).toBeLessThanOrEqual(verify.expiresAt.getTime());

    expect(isTokenUsable({ expiresAt: verify.expiresAt, consumedAt: null })).toBe(true);
    expect(isTokenUsable({ expiresAt: verify.expiresAt, consumedAt: new Date() })).toBe(false);
    expect(isTokenUsable({ expiresAt: new Date(Date.now() - 1), consumedAt: null })).toBe(false);
  });

  it('compares tokens without leaking length through early exits', () => {
    expect(safeEqual('abcd', 'abcd')).toBe(true);
    expect(safeEqual('abcd', 'abce')).toBe(false);
    expect(safeEqual('abcd', 'abcde')).toBe(false);
  });

  it('normalises emails', () => {
    expect(normalizeEmail('  Ada@Example.COM ')).toBe('ada@example.com');
  });
});

describe('CSRF double-submit check', () => {
  function fakeReq(overrides: Partial<Record<string, unknown>>): FastifyRequest {
    return {
      method: 'POST',
      cookies: {},
      headers: {},
      ...overrides,
    } as unknown as FastifyRequest;
  }

  it('ignores safe methods', () => {
    expect(() => assertCsrf(fakeReq({ method: 'GET', cookies: {}, headers: {} }))).not.toThrow();
  });

  it('ignores bearer-token clients', () => {
    expect(() =>
      assertCsrf(
        fakeReq({
          method: 'POST',
          cookies: {},
          headers: { authorization: 'Bearer abc' },
        }),
      ),
    ).not.toThrow();
  });

  it('rejects missing or mismatched tokens', () => {
    const token = issueCsrfToken();

    expect(() => assertCsrf(fakeReq({ cookies: {}, headers: {} }))).toThrow(AppError);
    expect(() =>
      assertCsrf(
        fakeReq({
          cookies: { fd_csrf: token },
          headers: { 'x-csrf-token': 'other' },
        }),
      ),
    ).toThrow(/csrf/i);

    expect(() =>
      assertCsrf(
        fakeReq({
          cookies: { fd_csrf: token },
          headers: { 'x-csrf-token': token },
        }),
      ),
    ).not.toThrow();
  });
});

describe('uuidv7', () => {
  it('matches the RFC 9562 format with version 7 and variant 10', () => {
    const id = uuidv7();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('sorts by timestamp across milliseconds', () => {
    // RFC 9562 only promises ordering by the embedded millisecond clock —
    // ids minted inside the same millisecond tie-break randomly by design.
    const ids = Array.from({ length: 500 }, () => uuidv7());
    const timestamps = ids.map((id) => BigInt(`0x${id.slice(0, 8)}${id.slice(9, 13)}`));
    for (let i = 1; i < timestamps.length; i += 1) {
      expect(timestamps[i]! >= timestamps[i - 1]!).toBe(true);
    }
  });

  it('is unique', () => {
    const ids = new Set(Array.from({ length: 1_000 }, () => uuidv7()));
    expect(ids.size).toBe(1_000);
    expect(randomUUID()).not.toBe(uuidv7());
  });
});
