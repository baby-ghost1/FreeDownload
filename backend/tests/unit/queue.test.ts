import { describe, expect, it } from 'vitest';

import { backoffDelay } from '../../src/queue/queues.js';

describe('queue backoff', () => {
  it('grows 1s → 4s → 16s → 64s with jitter', () => {
    // Jitter is up to +25%, so assert the band rather than an exact value.
    const expectations: Array<[number, number, number]> = [
      [1, 1_000, 1_250],
      [2, 4_000, 5_000],
      [3, 16_000, 20_000],
      [4, 64_000, 80_000],
    ];

    for (const [attemptsMade, min, max] of expectations) {
      for (let run = 0; run < 25; run += 1) {
        const delay = backoffDelay(attemptsMade);
        expect(delay).toBeGreaterThanOrEqual(min);
        expect(delay).toBeLessThanOrEqual(max);
      }
    }
  });

  it('caps at five minutes no matter how many attempts came before', () => {
    for (let run = 0; run < 25; run += 1) {
      const delay = backoffDelay(12);
      expect(delay).toBeGreaterThanOrEqual(300_000);
      expect(delay).toBeLessThanOrEqual(375_000);
    }
  });
});
