'use client';

import { usePathname } from 'next/navigation';

import { SiteFooter } from './site-footer';

/** The footer lives only on the landing page - every other route stays chrome-free. */
export function HomeFooter() {
  const pathname = usePathname();
  if (pathname !== '/') return null;
  return <SiteFooter />;
}
