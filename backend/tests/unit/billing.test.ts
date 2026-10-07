import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { priorityForTier, ANON_PRIORITY } from '../../src/limits/engine.js';
import { isFlagEnabled, rolloutBucket } from '../../src/flags/flags.js';
import { parseStripeEvent, verifyStripeSignature } from '../../src/payments/webhook.js';

const SECRET = 'fd-test-webhook-secret';

function sign(raw: string, t: number, secret = SECRET): string {
  const mac = createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
  return `t=${t},v1=${mac}`;
}

describe('queue priority by plan tier', () => {
  it('maps free/pro/business tiers to 50/30/10', () => {
    expect(priorityForTier(0)).toBe(50);
    expect(priorityForTier(10)).toBe(30);
    expect(priorityForTier(20)).toBe(10);
  });

  it('clamps into [10, 50] for out-of-range tiers', () => {
    expect(priorityForTier(-5)).toBe(50);
    expect(priorityForTier(99)).toBe(10);
  });

  it('keeps anonymous jobs above every paid tier', () => {
    expect(ANON_PRIORITY).toBe(60);
    expect(ANON_PRIORITY).toBeGreaterThan(priorityForTier(0));
  });
});

describe('feature flag rollout', () => {
  it('honours disabled flags regardless of rollout', () => {
    expect(isFlagEnabled({ enabled: false, rollout: 100 }, 'user-1')).toBe(false);
    expect(isFlagEnabled({ enabled: false, rollout: 0 }, undefined)).toBe(false);
  });

  it('treats rollout 0 and 100 as every audience', () => {
    expect(isFlagEnabled({ enabled: true, rollout: 0 }, undefined)).toBe(true);
    expect(isFlagEnabled({ enabled: true, rollout: 0 }, 'user-1')).toBe(true);
    expect(isFlagEnabled({ enabled: true, rollout: 100 }, 'user-1')).toBe(true);
    expect(isFlagEnabled({ enabled: true, rollout: 100 }, undefined)).toBe(true);
  });

  it('requires a subject for partial rollouts', () => {
    expect(isFlagEnabled({ enabled: true, rollout: 50 }, undefined)).toBe(false);
  });

  it('buckets subjects deterministically into 0-99', () => {
    const a = rolloutBucket('user-aaaaaaaaaaaaaaaa');
    expect(a).toBe(rolloutBucket('user-aaaaaaaaaaaaaaaa'));
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(100);
    // Different subjects spread - a full slice of the id space stays covered.
    const buckets = new Set(Array.from({ length: 200 }, (_, i) => rolloutBucket(`subject-${i}`)));
    expect(buckets.size).toBeGreaterThan(50);
  });
});

describe('Stripe webhook signatures', () => {
  const raw = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed' });

  it('accepts a correctly signed payload', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(verifyStripeSignature(raw, sign(raw, now), SECRET)).toBe(true);
  });

  it('rejects a wrong secret, a tampered body and a stale timestamp', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(verifyStripeSignature(raw, sign(raw, now, 'whsec_other'), SECRET)).toBe(false);
    expect(verifyStripeSignature(raw + ' ', sign(raw, now), SECRET)).toBe(false);
    expect(verifyStripeSignature(raw, sign(raw, now - 3_600), SECRET)).toBe(false);
  });

  it('rejects missing or malformed headers', () => {
    expect(verifyStripeSignature(raw, undefined, SECRET)).toBe(false);
    expect(verifyStripeSignature(raw, 'garbage', SECRET)).toBe(false);
    expect(verifyStripeSignature(raw, 't=abc,v1=zz', SECRET)).toBe(false);
    expect(verifyStripeSignature(raw, sign(raw, Math.floor(Date.now() / 1000)), '')).toBe(false);
  });

  it('accepts when any v1 signature in a rotated header matches', () => {
    const now = Math.floor(Date.now() / 1000);
    const good = sign(raw, now);
    const header = `t=${now},v1=deadbeef,${good.slice(2)}`;
    expect(verifyStripeSignature(raw, header, SECRET)).toBe(true);
  });
});

describe('parseStripeEvent', () => {
  it('parses a well-formed event', () => {
    const event = parseStripeEvent('{"id":"evt_1","type":"checkout.session.completed"}');
    expect(event.id).toBe('evt_1');
    expect(event.type).toBe('checkout.session.completed');
  });

  it('rejects non-JSON and events without id/type', () => {
    expect(() => parseStripeEvent('{oops')).toThrow(/payload/i);
    expect(() => parseStripeEvent('{"id":"evt_1"}')).toThrow(/payload/i);
    expect(() => parseStripeEvent('[]')).toThrow(/payload/i);
  });
});
