import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from '../errors/app-error.js';

/**
 * Stripe webhook signature verification (Phase 7) - `t=<ts>,v1=<hmac>` where
 * `v1 = HMAC-SHA256(secret, "<ts>.<rawBody>")`. Verified with a 5-minute
 * tolerance against replay, comparing digests in constant time.
 */
export function verifyStripeSignature(
  rawBody: string,
  header: string | undefined,
  secret: string,
  nowSec: number = Math.floor(Date.now() / 1000),
  toleranceSec: number = 300,
): boolean {
  if (!secret || !header) return false;

  let timestamp: number | undefined;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === 't') timestamp = Number(value);
    else if (key === 'v1') signatures.push(value);
  }
  if (timestamp === undefined || !Number.isFinite(timestamp) || signatures.length === 0) {
    return false;
  }
  if (Math.abs(nowSec - timestamp) > toleranceSec) return false;

  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest();
  return signatures.some((candidate) => {
    const given = Buffer.from(candidate, 'hex');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

export interface StripeEvent {
  id: string;
  type: string;
  data?: { object?: Record<string, unknown> };
}

export function parseStripeEvent(rawBody: string): StripeEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new AppError('VALIDATION_ERROR', 'Malformed webhook payload.');
  }
  const event = parsed as Partial<StripeEvent>;
  if (typeof event.id !== 'string' || typeof event.type !== 'string') {
    throw new AppError('VALIDATION_ERROR', 'Malformed webhook payload.');
  }
  return event as StripeEvent;
}
