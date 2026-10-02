import { describe, expect, it } from 'vitest';
import { cn } from '@/lib/utils/cn';
import { SITE_CONFIG } from '@/lib/constants/site';

describe('cn', () => {
  it('merges class names and resolves tailwind conflicts', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
    expect(cn('text-sm', 'text-lg', 'font-medium')).toBe('text-lg font-medium');
  });

  it('handles conditional values', () => {
    expect(cn('base', false && 'hidden', undefined, null)).toBe('base');
  });
});

describe('SITE_CONFIG', () => {
  it('exposes a name, tagline and api base url', () => {
    expect(SITE_CONFIG.name).toBe('FreeDownload');
    expect(SITE_CONFIG.tagline.length).toBeGreaterThan(0);
    expect(SITE_CONFIG.api.baseUrl).toMatch(/^https?:\/\//);
  });
});
