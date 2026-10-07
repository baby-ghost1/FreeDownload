/**
 * Single source of truth for brand-facing strings (contract §31: no fake claims).
 * Rename here to rebrand the whole frontend.
 */

/**
 * Env pastes are hand-maintained and occasionally contain a comma-joined list
 * ("https://a,https://b") - only the first entry is a real origin. A bad value
 * here would leak into canonical/og:url metadata and every absolute link.
 */
export function firstUrl(value: string | undefined, fallback: string): string {
  const candidate = value?.split(',')[0]?.trim();
  if (!candidate) return fallback;
  try {
    return new URL(candidate).toString();
  } catch {
    return fallback;
  }
}

/**
 * How the browser reaches the API.
 *
 * Production is same-origin (`/api/v1`) and `next.config.ts` proxies it to the
 * real backend. Going through our own origin is what keeps `fd_session` and
 * `fd_csrf` first-party cookies: a cross-origin API stores them on the API
 * host, where JS cannot read `fd_csrf` (double-submit then fails with
 * "Invalid or missing CSRF token") and where browsers increasingly refuse to
 * keep third-party session cookies at all.
 *
 * Dev/test keep the direct absolute URL so Playwright's route mocks on
 * `http://localhost:4000/**` and the unit suite keep matching.
 */
function apiBaseUrl(): string {
  if (process.env.NODE_ENV === 'production') return '/api/v1';
  return process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
}

export const SITE_CONFIG = {
  name: 'FreeDownload',
  tagline: 'Download media. Fast. Simple. Yours.',
  description:
    'Paste a link and get your authorized media in the format you need. ' +
    'Fast processing, privacy-conscious, no software required.',
  url: firstUrl(process.env.NEXT_PUBLIC_APP_URL, 'http://localhost:3000'),
  api: {
    baseUrl: apiBaseUrl(),
  },
  env: process.env.NEXT_PUBLIC_ENV ?? 'development',
} as const;
