import type { Metadata } from 'next';
import { SITE_CONFIG } from '@/lib/constants/site';
import { Providers } from '@/components/providers';
import { HomeFooter } from '@/components/home-footer';
import { SiteNavbar } from '@/components/site-navbar';
import { DonateCoffeeFloat } from '@/components/donate-coffee';
import './globals.css';

/** SERP/tab title - keyword front-loaded; SITE_CONFIG.tagline stays the visible copy. */
const SEARCH_TITLE = `${SITE_CONFIG.name} - Facebook, Instagram, YouTube Video Downloader`;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_CONFIG.url),
  title: {
    default: SEARCH_TITLE,
    template: `%s · ${SITE_CONFIG.name}`,
  },
  description: SITE_CONFIG.description,
  applicationName: SITE_CONFIG.name,
  keywords: [
    'video downloader',
    'facebook video downloader',
    'instagram video downloader',
    'youtube video downloader',
    'tiktok video downloader',
    'snapchat video downloader',
    'twitter video downloader',
    'video to mp3',
    'media downloader',
  ],
  openGraph: {
    type: 'website',
    siteName: SITE_CONFIG.name,
    title: SEARCH_TITLE,
    description: SITE_CONFIG.description,
    url: SITE_CONFIG.url,
  },
  twitter: {
    card: 'summary_large_image',
    title: SEARCH_TITLE,
    description: SITE_CONFIG.description,
  },
  verification: { google: 'RTQnvXeWUDsDzdZ7pE-cvlbAsnX2nEJj63rs3Ed_UsE' },
  robots: { index: true, follow: true },
  alternates: { canonical: '/' },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>
          <div className="flex min-h-dvh flex-col">
            <SiteNavbar />
            <main className="flex-1">{children}</main>
            <HomeFooter />
            <DonateCoffeeFloat />
          </div>
        </Providers>
      </body>
    </html>
  );
}
