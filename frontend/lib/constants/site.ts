/**
 * Single source of truth for brand-facing strings (contract §31: no fake claims).
 * Rename here to rebrand the whole frontend.
 */
export const SITE_CONFIG = {
  name: 'FreeDownload',
  tagline: 'Download media. Fast. Simple. Yours.',
  description:
    'Paste a link and get your authorized media in the format you need. ' +
    'Fast processing, privacy-conscious, no software required.',
  url: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
  api: {
    baseUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1',
  },
  env: process.env.NEXT_PUBLIC_ENV ?? 'development',
} as const;
