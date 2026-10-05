import { config } from '../server/config.js';
import { AppError } from '../errors/app-error.js';
import { logger } from '../logging/logger.js';

/**
 * Cloudflare Turnstile verification (contract §15).
 *
 * Enforced in production for: registration, password recovery, anonymous job
 * creation past a threshold. Without a secret key in development the check is
 * skipped - but in production a missing key is a hard failure, never a silent
 * bypass.
 */
export async function verifyTurnstile(token: string | undefined, remoteIp?: string): Promise<void> {
  if (!config.turnstile.secretKey) {
    if (config.turnstile.required) {
      throw new AppError(
        'SERVICE_UNAVAILABLE',
        'Security challenge is not configured on this server.',
      );
    }
    return;
  }

  if (!token) {
    throw new AppError('VALIDATION_ERROR', 'Security challenge is required.');
  }

  try {
    const body = new URLSearchParams({
      secret: config.turnstile.secretKey,
      response: token,
      ...(remoteIp ? { remoteip: remoteIp } : {}),
    });

    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(5_000),
    });

    if (!res.ok) {
      throw new Error(`siteverify responded ${res.status}`);
    }

    const data = (await res.json()) as { success?: boolean };
    if (data.success !== true) {
      throw new AppError('VALIDATION_ERROR', 'Security challenge verification failed.');
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    logger.warn({ err: { message: (err as Error).message } }, 'turnstile verification error');
    // Fail closed - an unverifiable challenge must not be treated as passed.
    throw new AppError('SERVICE_UNAVAILABLE', 'Could not verify the security challenge.');
  }
}
