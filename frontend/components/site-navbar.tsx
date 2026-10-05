'use client';

import { motion } from 'motion/react';
import Link from 'next/link';
import type { Route } from 'next';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Download, History, Home, User } from 'lucide-react';

import { SITE_CONFIG } from '@/lib/constants/site';
import { useSession } from '@/lib/session';
import { getPublicConfig } from '@/lib/api/endpoints';
import type { PublicConfig } from '@/lib/api/types';
import { ThemeToggle } from '@/components/theme-toggle';
import { cn } from '@/lib/utils/cn';

const DEFAULT_NAVBAR: PublicConfig['navbar'] = {
  visible: true,
  links: { home: true, download: true, downloads: true, auth: true },
};

const LINKS: Array<{ href: Route; label: string; icon: React.ReactNode; match: (p: string) => boolean }> = [
  { href: '/', label: 'Home', icon: <Home className="size-4" />, match: (p) => p === '/' },
  {
    href: '/download',
    label: 'Download',
    icon: <Download className="size-4" />,
    match: (p) => p === '/download',
  },
  {
    href: '/downloads',
    label: 'My downloads',
    icon: <History className="size-4" />,
    match: (p) => p === '/downloads' || p.startsWith('/downloads/'),
  },
];

/** Floating pill navbar - hidden inside the admin console (it has its own tabs). */
export function SiteNavbar() {
  const pathname = usePathname();
  const { user, loading } = useSession();
  const [hidden, setHidden] = useState(false);
  const [navbar, setNavbar] = useState<PublicConfig['navbar']>(DEFAULT_NAVBAR);

  // Admin-owned visibility (system_settings `navbar_config`, fail-open to
  // fully visible when the row or request is missing). The last known value
  // is cached locally so a hidden navbar never flashes on refresh or
  // back/forward navigation while the fresh config loads.
  useEffect(() => {
    try {
      const raw = localStorage.getItem('fd_navbar_config');
      if (raw) {
        const parsed = JSON.parse(raw) as PublicConfig['navbar'];
        if (typeof parsed?.visible === 'boolean' && parsed.links) {
          // eslint-disable-next-line react-hooks/set-state-in-effect -- paint cached chrome before network
          setNavbar(parsed);
        }
      }
    } catch {
      // Corrupt cache - fall through to the network value.
    }
    let live = true;
    void getPublicConfig()
      .then((c) => {
        if (!live || !c.navbar) return;
        setNavbar(c.navbar);
        try {
          localStorage.setItem('fd_navbar_config', JSON.stringify(c.navbar));
        } catch {
          // Private mode - every mount simply refetches.
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  // Hide while scrolling down, glide back the moment the user scrolls up
  // (or arrives back at the very top).
  useEffect(() => {
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      setHidden(y > last && y > 120);
      last = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  if (pathname.startsWith('/admin')) return null;
  if (!navbar.visible) return null;

  const showLinks = LINKS.filter((l) => {
    if (l.href === '/') return navbar.links.home;
    if (l.href === '/download') return navbar.links.download;
    return navbar.links.downloads;
  });

  return (
    <motion.header
      initial={false}
      animate={{ y: hidden ? '-130%' : '0%', opacity: hidden ? 0 : 1 }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      className="pointer-events-none fixed inset-x-0 top-0 z-50 px-4 pt-3"
    >
      <nav
        aria-label="Primary"
        className="glass pointer-events-auto mx-auto flex w-fit max-w-full items-center gap-1 overflow-x-auto rounded-full border border-border bg-surface/80 py-1.5 pl-2 pr-1.5 shadow-3"
      >
        <Link
          href="/"
          aria-label={`${SITE_CONFIG.name} home`}
          className="flex shrink-0 items-center gap-2 rounded-full py-1 pl-1 pr-2.5"
        >
          <span className="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-primary to-info text-sm font-bold text-white shadow-2">
            F
          </span>
          <span className="hidden text-sm font-semibold tracking-tight min-[420px]:inline">
            {SITE_CONFIG.name}
          </span>
        </Link>

        <span aria-hidden="true" className="h-5 w-px shrink-0 bg-border" />

        {showLinks.map((l) => {
          const isActive = l.match(pathname);
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'relative flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors duration-200',
                isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {isActive && (
                <motion.span
                  layoutId="site-nav-pill"
                  className="absolute inset-0 rounded-full bg-primary/10 ring-1 ring-inset ring-primary/25"
                  transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                />
              )}
              <span className="relative flex items-center gap-1.5">
                {l.icon}
                {l.label}
              </span>
            </Link>
          );
        })}

        <span aria-hidden="true" className="h-5 w-px shrink-0 bg-border" />

        <ThemeToggle className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" />

        {!navbar.links.auth ? null : loading ? (
          <span className="size-8 shrink-0 animate-pulse rounded-full bg-muted" aria-hidden="true" />
        ) : user ? (
          <Link
            href="/account"
            aria-label="Account"
            title={user.email}
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/20 to-info/15 text-primary ring-1 ring-primary/25 transition-transform duration-200 hover:scale-105"
          >
            <span className="text-xs font-bold">
              {user.email.slice(0, 1).toUpperCase()}
            </span>
          </Link>
        ) : (
          <Link
            href="/login"
            className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-gradient-to-r from-primary to-info px-3.5 py-1.5 text-[13px] font-semibold text-white shadow-2 transition-all duration-200 hover:brightness-110 active:scale-95"
          >
            <User className="size-3.5" />
            Sign in
          </Link>
        )}
      </nav>
    </motion.header>
  );
}
