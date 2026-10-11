import type { MetadataRoute } from 'next';

import { SITE_CONFIG } from '@/lib/constants/site';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        // The landing pages hydrate with two anonymous XHRs - the public
        // config blob and the session probe. Googlebot renders JS and fetches
        // them as page resources; leaving them under the blanket /api/ ban
        // makes Search Console report "blocked by robots.txt". Both are safe
        // to crawl: /config/public is unauthenticated by design and /me
        // answers 401 without a session cookie.
        allow: ['/', '/api/v1/config/public', '/api/v1/me'],
        // Private/auth surfaces: session-gated history, the control plane and
        // the admin console. /download (singular) stays crawlable - it is the
        // public paste page.
        disallow: ['/api/', '/admin/', '/account/', '/downloads/'],
      },
    ],
    sitemap: `${SITE_CONFIG.url}/sitemap.xml`,
  };
}
