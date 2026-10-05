import { hash, verify } from '@node-rs/argon2';

import { config } from '../server/config.js';
import { AppError } from '../errors/app-error.js';

/**
 * Password hashing - Argon2id (contract §26).
 *
 * `@node-rs/argon2` defaults to Argon2id and exports its `Algorithm` as an
 * ambient const enum (unreadable under `verbatimModuleSyntax`), so we rely on
 * the default and assert the produced PHC prefix instead of trusting it.
 * Parameters come from config so they can be raised over time without a code
 * change; existing hashes keep their own parameters.
 */
export async function hashPassword(password: string): Promise<string> {
  const encoded = await hash(password, {
    memoryCost: config.argon2.memoryKib,
    timeCost: config.argon2.timeCost,
    parallelism: config.argon2.parallelism,
  });

  if (!encoded.startsWith('$argon2id$')) {
    throw new Error(`unexpected password hash algorithm: ${encoded.slice(0, 10)}`);
  }
  return encoded;
}

export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  try {
    return await verify(storedHash, password);
  } catch {
    // Malformed/corrupt hash - treat as a failed verification, never a 500.
    return false;
  }
}

const COMMON_PASSWORDS = new Set([
  'password',
  'password1',
  '12345678',
  '123456789',
  'qwertyui',
  'letmein1',
  'iloveyou',
]);

/** Reject trivially weak passwords before we spend CPU hashing them. */
export function assertPasswordStrength(password: string): void {
  if (password.length < 8) {
    throw new AppError('VALIDATION_ERROR', 'Password must be at least 8 characters long.');
  }
  if (password.length > 256) {
    throw new AppError('VALIDATION_ERROR', 'Password must be at most 256 characters long.');
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    throw new AppError('VALIDATION_ERROR', 'That password is too common. Choose another.');
  }
}
