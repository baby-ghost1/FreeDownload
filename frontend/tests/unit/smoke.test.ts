import { describe, expect, it } from 'vitest';
import { cn } from '@/lib/utils/cn';
import { firstUrl, SITE_CONFIG } from '@/lib/constants/site';

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

  it('never publishes a comma-joined or malformed site url', () => {
    expect(SITE_CONFIG.url).not.toContain(',');
    expect(() => new URL(SITE_CONFIG.url)).not.toThrow();
  });
});

describe('firstUrl', () => {
  it('keeps a single valid origin', () => {
    expect(firstUrl('https://freedownloadapp.vercel.app', 'x')).toBe(
      'https://freedownloadapp.vercel.app/',
    );
  });

  it('takes the first entry of a comma-joined env paste', () => {
    expect(
      firstUrl('https://freedownloadapp.vercel.app/,https://freedownloadapp.vercel.app', 'x'),
    ).toBe('https://freedownloadapp.vercel.app/');
  });

  it('falls back when the value is missing or not a url', () => {
    expect(firstUrl(undefined, 'http://localhost:3000')).toBe('http://localhost:3000');
    expect(firstUrl('', 'http://localhost:3000')).toBe('http://localhost:3000');
    expect(firstUrl('not-a-url,https://a.example', 'http://localhost:3000')).toBe(
      'http://localhost:3000',
    );
  });
});
