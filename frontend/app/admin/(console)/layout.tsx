'use client';

import { motion } from 'motion/react';
import Link from 'next/link';
import type { Route } from 'next';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Flag,
  Gauge,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Receipt,
  Settings,
  ShieldCheck,
  Users,
} from 'lucide-react';

import { Alert } from '@/components/ui/alert';
import { BackButton } from '@/components/back-button';
import { Badge } from '@/components/ui/badge';
import { Enter } from '@/components/motion/reveal';
import { SoftBackdrop } from '@/components/soft-backdrop';
import { Button, buttonClasses } from '@/components/ui/button';
import { Spinner } from '@/components/ui/progress';
import { AdminConsoleContext } from '@/components/admin/shared';
import { adminLogout, adminMe } from '@/lib/api/endpoints';
import type { Admin } from '@/lib/api/types';
import { cn } from '@/lib/utils/cn';

const TABS: Array<{ id: string; href: Route; label: string; icon: React.ReactNode }> = [
  {
    id: 'overview',
    href: '/admin',
    label: 'Overview',
    icon: <LayoutDashboard className="size-4" />,
  },
  {
    id: 'sources',
    href: '/admin/sources',
    label: 'Sources',
    icon: <ListChecks className="size-4" />,
  },
  { id: 'users', href: '/admin/users', label: 'Users', icon: <Users className="size-4" /> },
  { id: 'flags', href: '/admin/flags', label: 'Flags', icon: <Flag className="size-4" /> },
  { id: 'limits', href: '/admin/limits', label: 'Limits', icon: <Gauge className="size-4" /> },
  { id: 'billing', href: '/admin/billing', label: 'Billing', icon: <Receipt className="size-4" /> },
];

export default function AdminConsoleLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [ready, setReady] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    adminMe()
      .then((r) => {
        if (!live) return;
        setAdmin(r.admin);
        setReady(true);
      })
      .catch(() => {
        if (live) router.replace('/admin/login');
      });
    return () => {
      live = false;
    };
  }, [router]);

  const signOut = useCallback(async () => {
    setSigningOut(true);
    try {
      await adminLogout();
    } catch {
      // Best effort - the console guard redirects regardless.
    } finally {
      router.replace('/admin/login');
    }
  }, [router]);

  const value = useMemo(() => ({ admin, setPageError }), [admin]);

  if (!ready) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 py-24">
        <Spinner className="size-8" />
        <p className="text-xs text-muted-foreground">Loading console…</p>
      </div>
    );
  }

  return (
    <AdminConsoleContext.Provider value={value}>
      <div className="relative mx-auto w-full max-w-5xl px-4 py-8 sm:px-6" data-testid="admin-app">
        <SoftBackdrop />
        <div className="relative mb-4">
          <BackButton href="/" label="Back to home" />
        </div>
        <Enter className="relative">
          {/* Header card */}
          <div className="relative overflow-hidden rounded-2xl border border-border bg-surface/90 shadow-3 backdrop-blur-xl">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-0 neon-edge bg-gradient-to-r from-primary via-info to-primary bg-[length:220%_100%] animate-gradient-pan"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -right-20 -top-24 size-64 rounded-full bg-primary/10 blur-3xl"
            />
            <div className="relative flex flex-wrap items-center gap-4 p-5 sm:p-6">
              <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-info text-xl font-bold text-white shadow-2 ring-1 ring-primary/20">
                F
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                  <ShieldCheck className="size-3.5 text-success" />
                  Admin console
                </p>
                <h1 className="mt-0.5 flex flex-wrap items-center gap-2 text-xl font-semibold tracking-tight sm:text-2xl">
                  <span className="min-w-0 truncate">{admin?.email ?? 'Operator'}</span>
                  <Badge tone="info">{admin?.role}</Badge>
                </h1>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="size-1.5 animate-pulse rounded-full bg-success" />
                    Live session
                  </span>
                </p>
              </div>
              <div className="flex items-center gap-2.5">
                <Link
                  href="/admin/profile"
                  aria-label="Settings"
                  data-testid="admin-open-profile"
                  className={buttonClasses({
                    variant: 'outline',
                    size: 'sm',
                    className: 'rounded-xl px-3',
                  })}
                >
                  <Settings className="size-3.5" />
                </Link>
                <Button
                  variant="outline"
                  size="sm"
                  loading={signingOut}
                  onClick={() => void signOut()}
                  data-testid="admin-sign-out"
                  className="gap-1.5 rounded-xl"
                >
                  <LogOut className="size-3.5" />
                  Log out
                </Button>
              </div>
            </div>
          </div>
        </Enter>

        {/* Tab bar */}
        <nav
          aria-label="Admin sections"
          className="sticky top-2 z-10 mt-4 flex gap-1 overflow-x-auto rounded-2xl border border-border bg-surface/85 p-1.5 shadow-2 backdrop-blur-xl"
        >
          {TABS.map((t) => {
            const isActive = pathname === t.href;
            return (
              <Link
                key={t.id}
                href={t.href}
                data-testid={`admin-tab-${t.id}`}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'relative flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-2 py-2 text-[13px] font-medium transition-all duration-200',
                  isActive
                    ? 'text-white'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {isActive && (
                  <motion.span
                    layoutId="admin-tab-pill"
                    className="absolute inset-0 rounded-xl bg-gradient-to-r from-primary to-info shadow-[0_6px_16px_-6px_var(--color-primary)]"
                    transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                  />
                )}
                <span className="relative flex items-center gap-1.5">
                  {t.icon}
                  {t.label}
                </span>
              </Link>
            );
          })}
        </nav>

        {pageError && (
          <Alert tone="error" className="mt-4 rounded-xl">
            {pageError}
          </Alert>
        )}

        <motion.div
          key={pathname}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
          className="mt-4"
        >
          {children}
        </motion.div>
      </div>
    </AdminConsoleContext.Provider>
  );
}
