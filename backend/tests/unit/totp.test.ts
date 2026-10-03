import { describe, expect, it } from 'vitest';

import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  otpauthUri,
  totp,
  verifyTotp,
} from '../../src/security/totp.js';

const RFC_SECRET_ASCII = '12345678901234567890';
const RFC_SECRET_B32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('base32', () => {
  it('round-trips arbitrary bytes', () => {
    for (const input of ['', 'a', 'ab', 'abc', 'abcd', 'abcde', 'hello world']) {
      const buf = Buffer.from(input);
      expect(base32Decode(base32Encode(buf)).equals(buf)).toBe(true);
    }
  });

  it('rejects invalid characters', () => {
    expect(() => base32Decode('ABC1')).toThrow(/base32/i);
  });
});

describe('TOTP (RFC 6238 test vectors, SHA-1)', () => {
  // The RFC publishes 8-digit vectors for the shared ASCII secret; the same
  // HOTP machinery produces our 6-digit app codes.
  const vectors: Array<[number, string]> = [
    [59, '94287082'],
    [1_111_111_109, '07081804'],
    [1_111_111_111, '14050471'],
    [1_234_567_890, '89005924'],
    [2_000_000_000, '69279037'],
    [20_000_000_000, '65353130'],
  ];

  it('encodes the RFC secret as expected', () => {
    expect(base32Encode(Buffer.from(RFC_SECRET_ASCII))).toBe(RFC_SECRET_B32);
  });

  for (const [seconds, expected] of vectors) {
    it(`matches the vector at T=${seconds}`, () => {
      expect(totp(RFC_SECRET_B32, { at: seconds * 1000, digits: 8 })).toBe(expected);
    });
  }
});

describe('verifyTotp', () => {
  it('accepts the current code and rejects neighbours in time', () => {
    const secret = generateTotpSecret();
    const at = 1_700_000_000_000;

    const code = totp(secret, { at });
    expect(verifyTotp(secret, code, { at })).toBe(true);
    // Still valid within ±1 step of drift.
    expect(verifyTotp(secret, totp(secret, { at: at - 30_000 }), { at })).toBe(true);
    expect(verifyTotp(secret, totp(secret, { at: at + 30_000 }), { at })).toBe(true);
    // Two steps away is outside the window.
    expect(verifyTotp(secret, totp(secret, { at: at - 60_000 }), { at })).toBe(false);
  });

  it('rejects malformed and wrong codes', () => {
    const secret = generateTotpSecret();
    const at = 1_700_000_000_000;
    expect(verifyTotp(secret, '12345', { at })).toBe(false);
    expect(verifyTotp(secret, 'abcdef', { at })).toBe(false);
    expect(verifyTotp(secret, '000000', { at })).toBe(false);
  });

  it('produces different secrets each time', () => {
    expect(generateTotpSecret()).not.toBe(generateTotpSecret());
  });
});

describe('otpauthUri', () => {
  it('builds a scannable provisioning URI', () => {
    const uri = otpauthUri({
      account: 'owner@example.com',
      issuer: 'FreeDownload',
      secret: RFC_SECRET_B32,
    });
    expect(uri.startsWith('otpauth://totp/FreeDownload:owner%40example.com?')).toBe(true);
    expect(uri).toContain(`secret=${RFC_SECRET_B32}`);
    expect(uri).toContain('issuer=FreeDownload');
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
  });
});
