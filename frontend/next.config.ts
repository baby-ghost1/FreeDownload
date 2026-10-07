import type { NextConfig } from 'next';

/**
 * Origin of the backend that `/api/v1/*` is proxied to. Production builds
 * resolve it from `NEXT_PUBLIC_API_URL` (already set on Vercel), so no new
 * dashboard variable is required; `API_ORIGIN` overrides it for a split deploy.
 */
const backendOrigin = (() => {
  for (const candidate of [process.env.API_ORIGIN, process.env.NEXT_PUBLIC_API_URL]) {
    if (!candidate) continue;
    const origin = candidate.replace(/\/api\/v1\/?$/, '').replace(/\/$/, '');
    if (/^https?:\/\//.test(origin)) return origin;
  }
  return 'http://localhost:4000';
})();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
  images: {
    formats: ['image/avif', 'image/webp'],
  },
  typedRoutes: true,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          },
        ],
      },
    ];
  },
  async rewrites() {
    // JSON control plane runs same-origin so auth/CSRF cookies stay first-party
    // (see lib/constants/site.ts). Media bytes never travel this path: the API
    // mints absolute `/api/v1/files/...` URLs on its own host, because piping
    // multi-hundred-MB downloads through a serverless proxy is not viable.
    return [{ source: '/api/v1/:path*', destination: `${backendOrigin}/api/v1/:path*` }];
  },
};

export default nextConfig;
