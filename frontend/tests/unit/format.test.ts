import { describe, expect, it } from 'vitest';

import { timeAgo } from '@/lib/format';

describe('timeAgo', () => {
  it('says "just now" for recent or invalid dates', () => {
    expect(timeAgo(new Date().toISOString())).toBe('just now');
    expect(timeAgo('not-a-date')).toBe('just now');
  });

  it('formats minutes, hours, days and beyond', () => {
    const now = Date.now();
    expect(timeAgo(new Date(now - 5 * 60000).toISOString())).toBe('5m ago');
    expect(timeAgo(new Date(now - 3 * 3600000).toISOString())).toBe('3h ago');
    expect(timeAgo(new Date(now - 2 * 86400000).toISOString())).toBe('2d ago');
    expect(timeAgo(new Date(now - 90 * 86400000).toISOString())).toBe('3mo ago');
  });
});
