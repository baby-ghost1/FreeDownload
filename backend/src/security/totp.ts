import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * TOTP (RFC 6238) over HOTP (RFC 4226) — implemented on `node:crypto` so the
 * admin MFA path adds no dependency. SHA-1 stays the default algorithm: it is
 * what every authenticator app expects (§75).
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;

/** RFC 4648 base32 without padding — the otpauth URI form. */
export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const cleaned = input.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of cleaned) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error('Invalid base32 character.');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** 160-bit secret (RFC 4226 §4), base32-encoded for authenticator apps. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

function hotp(secret: Buffer, counter: number, digits: number): string {
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));

  const digest = createHmac('sha1', secret).update(counterBuf).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);

  return String(binary % 10 ** digits).padStart(digits, '0');
}

function codeAt(secretBase32: string, timeMs: number, digits: number, stepSec: number): string {
  const counter = Math.floor(timeMs / 1000 / stepSec);
  return hotp(base32Decode(secretBase32), counter, digits);
}

/** Current code for a base32 secret. `digits` is exposed for RFC test vectors. */
export function totp(
  secretBase32: string,
  options: { at?: number; digits?: number; stepSec?: number } = {},
): string {
  return codeAt(
    secretBase32,
    options.at ?? Date.now(),
    options.digits ?? 6,
    options.stepSec ?? STEP_SECONDS,
  );
}

/**
 * Verifies a code against the previous/current/next step (±1 window ≈ 30s of
 * clock skew). Comparison is constant-time; malformed codes just fail.
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  options: { at?: number; window?: number; digits?: number; stepSec?: number } = {},
): boolean {
  const digits = options.digits ?? 6;
  const stepSec = options.stepSec ?? STEP_SECONDS;
  const window = options.window ?? 1;
  if (!new RegExp(`^\\d{${digits}}$`).test(code)) return false;

  const at = options.at ?? Date.now();
  const provided = Buffer.from(code);

  for (let offset = -window; offset <= window; offset += 1) {
    const candidate = Buffer.from(
      codeAt(secretBase32, at + offset * stepSec * 1000, digits, stepSec),
    );
    if (candidate.length === provided.length && timingSafeEqual(candidate, provided)) {
      return true;
    }
  }
  return false;
}

/** Provisioning URI for QR codes (key=value per the otpauth spec). */
export function otpauthUri(input: { account: string; issuer: string; secret: string }): string {
  const label = `${encodeURIComponent(input.issuer)}:${encodeURIComponent(input.account)}`;
  const params = new URLSearchParams({
    secret: input.secret,
    issuer: input.issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
