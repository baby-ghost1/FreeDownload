import type { Metadata } from 'next';
import { SITE_CONFIG } from '@/lib/constants/site';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_CONFIG.url),
  title: {
    default: `${SITE_CONFIG.name} — ${SITE_CONFIG.tagline}`,
    template: `%s · ${SITE_CONFIG.name}`,
  },
  description: SITE_CONFIG.description,
  applicationName: SITE_CONFIG.name,
  keywords: ['media downloader', 'video converter', 'audio extraction', 'media tools'],
  openGraph: {
    type: 'website',
    siteName: SITE_CONFIG.name,
    title: `${SITE_CONFIG.name} — ${SITE_CONFIG.tagline}`,
    description: SITE_CONFIG.description,
    url: SITE_CONFIG.url,
  },
  twitter: {
    card: 'summary_large_image',
    title: `${SITE_CONFIG.name} — ${SITE_CONFIG.tagline}`,
    description: SITE_CONFIG.description,
  },
  robots: { index: true, follow: true },
  alternates: { canonical: '/' },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
