import type { MetadataRoute } from 'next';

import { SITE_CONFIG } from '@/lib/constants/site';

/** Public, unauthenticated routes only - auth and private history stay out. */
const ROUTES = ['/', '/download', '/register', '/login', '/privacy', '/terms'] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return ROUTES.map((route) => ({
    url: `${SITE_CONFIG.url}${route}`,
    lastModified: now,
    changeFrequency: route === '/' ? ('weekly' as const) : ('monthly' as const),
    priority: route === '/' ? 1 : 0.6,
  }));
}
