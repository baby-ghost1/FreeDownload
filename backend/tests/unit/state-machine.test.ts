import { describe, expect, it } from 'vitest';

import {
  JOB_STATUSES,
  TRANSITIONS,
  TERMINAL_STATUSES,
  canTransition,
  isTerminal,
  transitionJob,
} from '../../src/modules/downloads/state-machine.js';

describe('job state machine', () => {
  it('exposes exactly the statuses the column allows', () => {
    expect(JOB_STATUSES).toHaveLength(Object.keys(TRANSITIONS).length);
    for (const status of JOB_STATUSES) {
      expect(Array.isArray(TRANSITIONS[status])).toBe(true);
    }
  });

  it('walks the contract path created → … → completed → expired', () => {
    const happyPath = [
      'created',
      'validating',
      'queued',
      'analyzing',
      'ready',
      'processing',
      'uploading',
      'completed',
      'expired',
    ] as const;

    for (let i = 0; i < happyPath.length - 1; i += 1) {
      expect(canTransition(happyPath[i]!, happyPath[i + 1]!)).toBe(true);
    }
  });

  it('lets every pre-completion state cancel', () => {
    for (const status of JOB_STATUSES) {
      if (TERMINAL_STATUSES.includes(status)) continue;
      if (status === 'completed') continue;
      expect(canTransition(status, 'cancelled')).toBe(true);
    }
  });

  it('locks finished states shut', () => {
    for (const status of ['cancelled', 'expired'] as const) {
      expect(isTerminal(status)).toBe(true);
      expect(TRANSITIONS[status]).toHaveLength(0);
      for (const target of JOB_STATUSES) {
        expect(canTransition(status, target)).toBe(false);
      }
    }

    // `completed` is terminal for the user, but the retention sweep may
    // still move it to `expired` - and nothing else.
    expect(isTerminal('completed')).toBe(true);
    expect(TRANSITIONS.completed).toEqual(['expired']);
    expect(canTransition('completed', 'cancelled')).toBe(false);
    expect(canTransition('completed', 'queued')).toBe(false);

    // Dead-lettered jobs stay terminal for workers, but an admin may requeue
    // them after investigation (the only legal way out).
    expect(isTerminal('dead_letter')).toBe(true);
    expect(TRANSITIONS.dead_letter).toEqual(['queued']);
    expect(canTransition('dead_letter', 'cancelled')).toBe(false);
    expect(canTransition('dead_letter', 'completed')).toBe(false);

    // Policy-restricted jobs can be dismissed - or revived once the admin
    // re-enables the source (Phase 6).
    expect(isTerminal('policy_restricted')).toBe(true);
    expect(TRANSITIONS.policy_restricted).toEqual(['cancelled', 'queued']);
    expect(canTransition('policy_restricted', 'completed')).toBe(false);
  });

  it('rejects illegal transitions before touching the database', async () => {
    const db = {
      update: () => {
        throw new Error('database must not be reached');
      },
    } as never;

    await expect(
      transitionJob(db, { jobId: 'nope', from: ['completed'], to: 'cancelled', soft: true }),
    ).rejects.toThrow(/illegal transition/);

    await expect(
      transitionJob(db, { jobId: 'nope', from: ['queued'], to: 'completed', soft: true }),
    ).rejects.toThrow(/illegal transition/);
  });
});
