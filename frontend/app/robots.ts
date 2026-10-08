import type { MetadataRoute } from 'next';

import { SITE_CONFIG } from '@/lib/constants/site';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // Private/auth surfaces: session-gated history, the control plane and
        // the admin console. /download (singular) stays crawlable - it is the
        // public paste page.
        disallow: ['/api/', '/admin/', '/account/', '/downloads/'],
      },
    ],
    sitemap: `${SITE_CONFIG.url}/sitemap.xml`,
  };
}
