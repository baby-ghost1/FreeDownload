import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

import { config } from '../../server/config.js';

/**
 * TOTP secrets are encrypted at rest (AES-256-GCM, key derived from
 * SESSION_SECRET). Production mandates SESSION_SECRET; dev/test fall back to
 * a fixed label — the local database itself is unprotected there.
 */
function boxKey(): Buffer {
  return scryptSync(config.session.secret || 'freedownload-dev-session-secret', 'fd-totp-v1', 32);
}

export function sealTotpSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', boxKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}

export function openTotpSecret(sealed: string): string {
  const buf = Buffer.from(sealed, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', boxKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
