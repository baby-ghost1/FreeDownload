'use client';

import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import type { Route } from 'next';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  Download,
  FileText,
  History,
  Home,
  Menu,
  ShieldCheck,
  User,
  UserRound,
  X,
} from 'lucide-react';

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

interface MenuLink {
  href: Route;
  label: string;
  icon: React.ReactNode;
  match: (p: string) => boolean;
}

const MENU_LINKS: MenuLink[] = [
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
  {
    href: '/account',
    label: 'Profile',
    icon: <UserRound className="size-4" />,
    match: (p) => p === '/account',
  },
  {
    href: '/privacy',
    label: 'Privacy policy',
    icon: <ShieldCheck className="size-4" />,
    match: (p) => p === '/privacy',
  },
  {
    href: '/terms',
    label: 'Terms',
    icon: <FileText className="size-4" />,
    match: (p) => p === '/terms',
  },
];

function linkVisible(href: Route, navbar: PublicConfig['navbar']): boolean {
  if (href === '/') return navbar.links.home;
  if (href === '/download') return navbar.links.download;
  if (href === '/downloads') return navbar.links.downloads;
  return true;
}

/** Floating pill navbar - logo left, everything else inside the menu. */
export function SiteNavbar() {
  const pathname = usePathname();
  const { user, loading } = useSession();
  const [hidden, setHidden] = useState(false);
  const [open, setOpen] = useState(false);
  const [navbar, setNavbar] = useState<PublicConfig['navbar']>(DEFAULT_NAVBAR);
  const navRef = useRef<HTMLElement>(null);

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

  // Close the menu on outside tap and Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open ]);

  if (pathname.startsWith('/admin')) return null;
  if (!navbar.visible) return null;

  const showAuth = navbar.links.auth;
  const items = MENU_LINKS.filter(
    (l) => linkVisible(l.href, navbar) && (l.href !== '/account' || showAuth),
  );

  return (
    <motion.header
      initial={false}
      animate={{ y: hidden ? '-130%' : '0%', opacity: hidden ? 0 : 1 }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-3"
    >
      <nav
        ref={navRef}
        aria-label="Primary"
        className="glass pointer-events-auto relative flex w-fit max-w-full items-center gap-1 rounded-full border border-border bg-surface/80 py-1.5 pl-2 pr-1.5 shadow-3"
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

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="site-nav-menu"
          aria-label={open ? 'Close menu' : 'Open menu'}
          className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <motion.span
            key={open ? 'x' : 'menu'}
            initial={{ opacity: 0, rotate: -60, scale: 0.8 }}
            animate={{ opacity: 1, rotate: 0, scale: 1 }}
            transition={{ duration: 0.25 }}
            className="flex"
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </motion.span>
        </button>

        <AnimatePresence>
          {open && (
            <motion.div
              id="site-nav-menu"
              role="menu"
              initial={{ opacity: 0, y: -8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.98 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="absolute right-0 top-[calc(100%+8px)] w-64 overflow-hidden rounded-2xl border border-border bg-surface/95 shadow-3 backdrop-blur-xl"
            >
              <ul className="max-h-[70vh] overflow-y-auto p-1.5">
                {items.map((l) => {
                  const isActive = l.match(pathname);
                  return (
                    <li key={l.href}>
                      <Link
                        href={l.href}
                        role="menuitem"
                        aria-current={isActive ? 'page' : undefined}
                        onClick={() => setOpen(false)}
                        className={cn(
                          'relative flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors duration-150',
                          isActive
                            ? 'text-foreground'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                        )}
                      >
                        {isActive && (
                          <motion.span
                            layoutId="site-nav-pill"
                            className="absolute inset-0 rounded-xl bg-primary/10 ring-1 ring-inset ring-primary/25"
                            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                          />
                        )}
                        <span className="relative flex items-center gap-2.5">
                          {l.icon}
                          {l.label}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
              <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2.5">
                {showAuth ? (
                  <>
                    {loading ? (
                      <span
                        className="h-8 flex-1 animate-pulse rounded-xl bg-muted"
                        aria-hidden="true"
                      />
                    ) : user ? (
                    <Link
                      href="/account"
                      onClick={() => setOpen(false)}
                      className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-1 py-1 text-sm"
                      title={user.email}
                    >
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/20 to-info/15 text-xs font-bold text-primary ring-1 ring-primary/25">
                        {user.email.slice(0, 1).toUpperCase()}
                      </span>
                      <span className="min-w-0 truncate font-medium">{user.email}</span>
                    </Link>
                  ) : (
                    <Link
                      href="/login"
                      onClick={() => setOpen(false)}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-primary to-info px-3 py-2 text-sm font-semibold text-white shadow-2 transition-all duration-200 hover:brightness-110 active:scale-95"
                    >
                      <User className="size-4" />
                      Sign in
                    </Link>
                    )}
                  </>
                ) : (
                  <span className="min-w-0 flex-1 truncate px-1 text-xs text-muted-foreground">
                    {SITE_CONFIG.name}
                  </span>
                )}
                <ThemeToggle className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </nav>
    </motion.header>
  );
}
