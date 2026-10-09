'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Eye,
  EyeOff,
  History,
  ListChecks,
  LockKeyhole,
  Mail,
  ScrollText,
  ShieldCheck,
  Users,
} from 'lucide-react';

import { AuthLink } from '@/components/auth/auth-shell';
import { SoftBackdrop } from '@/components/soft-backdrop';
import { Enter } from '@/components/motion/reveal';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { adminLogin, adminMe } from '@/lib/api/endpoints';
import { SITE_CONFIG } from '@/lib/constants/site';
import { message } from '@/components/admin/shared';

const HIGHLIGHTS: Array<{ icon: React.ReactNode; title: string; body: string }> = [
  {
    icon: <ListChecks className="size-4" />,
    title: 'Runtime source control',
    body: 'Enable, disable or put platforms in maintenance without a deploy.',
  },
  {
    icon: <History className="size-4" />,
    title: 'Job oversight',
    body: 'Filter, inspect, retry or cancel any download in flight.',
  },
  {
    icon: <Users className="size-4" />,
    title: 'User management',
    body: 'Review sign-ups, suspend abuse, audit activity.',
  },
  {
    icon: <ScrollText className="size-4" />,
    title: 'Complete audit trail',
    body: 'Every mutation is recorded with actor, IP and diff.',
  },
];

const inputShell =
  'h-12 rounded-xl bg-background pl-10 pr-3 text-[15px] shadow-1 transition-all duration-200 hover:border-border-strong hover:shadow-2 focus-visible:border-primary focus-visible:shadow-2 focus-visible:outline-2 focus-visible:outline-focus-ring placeholder:text-muted-foreground/60';

export default function AdminLoginPage() {
  const router = useRouter();
  const [booted, setBooted] = useState(false);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [revealPassword, setRevealPassword] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);

  useEffect(() => {
    let live = true;
    adminMe()
      .then(() => {
        if (live) router.replace('/admin');
      })
      .catch(() => {
        if (live) setBooted(true);
      });
    return () => {
      live = false;
    };
  }, [router]);

  const submitLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthBusy(true);
    setAuthError(null);
    try {
      // MFA is intentionally out of scope here - ADMIN_MFA_REQUIRED is off,
      // so email+password opens the console directly.
      await adminLogin({ email: email.trim(), password });
      router.push('/admin');
    } catch (err) {
      setAuthError(message(err, 'Could not sign in right now.'));
    } finally {
      setAuthBusy(false);
    }
  };

  if (!booted) {
    return (
      <div
        className="flex min-h-[50vh] flex-col items-center justify-center gap-3 py-20"
        data-testid="admin-login-boot"
      >
        <span className="size-7 animate-spin rounded-full border-2 border-border border-t-primary" />
        <p className="text-xs text-muted-foreground">Checking admin session…</p>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-[calc(100vh-4rem)] w-full items-center justify-center px-4 py-8 sm:px-6">
      <SoftBackdrop />
      <Enter className="relative mx-auto w-full max-w-4xl">
        <div
          className="overflow-hidden rounded-2xl border border-border bg-surface/90 shadow-3 backdrop-blur-xl lg:grid lg:grid-cols-[0.95fr_1fr]"
          data-testid="admin-login-shell"
        >
          {/* Brand panel */}
          <aside
            aria-hidden="true"
            className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-[#0b1020] via-[#111a36] to-primary/40 p-6 text-white lg:flex"
          >
            <div className="pointer-events-none absolute -left-20 -top-20 size-56 rounded-full bg-primary/30 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-24 -right-16 size-64 rounded-full bg-info/20 blur-3xl" />
            <div
              className="pointer-events-none absolute inset-0 opacity-[0.15]"
              style={{
                backgroundImage:
                  'linear-gradient(to right, rgba(255,255,255,.25) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,.25) 1px, transparent 1px)',
                backgroundSize: '28px 28px',
                maskImage:
                  'radial-gradient(ellipse 80% 70% at 20% 10%, black 40%, transparent 100%)',
              }}
            />

            <div className="relative">
              <div className="flex items-center gap-2">
                <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-info text-base font-bold text-white shadow-2 ring-1 ring-white/20">
                  F
                </span>
                <span className="text-base font-semibold tracking-tight">{SITE_CONFIG.name}</span>
                <span className="inline-flex items-center gap-1 rounded-full border border-white/20 bg-white/10 px-2 py-0.5 text-[11px] font-medium text-white/90 backdrop-blur">
                  <ShieldCheck className="size-3" />
                  Admin
                </span>
              </div>
              <h2 className="mt-6 text-balance text-2xl font-semibold leading-[1.1] tracking-tight">
                The control room for the whole platform.
              </h2>
              <ul className="mt-5 grid gap-2">
                {HIGHLIGHTS.map((h) => (
                  <li
                    key={h.title}
                    className="flex gap-2.5 rounded-xl border border-white/10 bg-white/[0.06] p-2.5 backdrop-blur transition-colors hover:bg-white/[0.09]"
                  >
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-white/10 text-white ring-1 ring-white/10">
                      {h.icon}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13px] font-semibold text-white">{h.title}</span>
                      <span className="block text-xs leading-snug text-white/60">{h.body}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </aside>

          {/* Form panel */}
          <div className="relative flex flex-col justify-center bg-surface p-5 sm:p-7">
            <div className="pointer-events-none absolute inset-x-0 top-0 neon-edge bg-gradient-to-r from-primary via-info to-primary bg-[length:220%_100%] animate-gradient-pan" />
            <div className="mb-5 flex items-center gap-2 lg:hidden">
              <span className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-info text-sm font-bold text-white shadow-2">
                F
              </span>
              <span className="text-base font-semibold tracking-tight text-foreground">
                {SITE_CONFIG.name}
              </span>
              <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                Admin
              </span>
            </div>

            <div data-testid="admin-login">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                <LockKeyhole className="size-3.5" />
                Admin access
              </span>
              <h1 className="mt-3 text-balance text-[22px] font-semibold leading-tight tracking-tight">
                Welcome back, Admin
              </h1>

              <form
                onSubmit={(e) => void submitLogin(e)}
                className="mt-5 space-y-4"
                data-testid="admin-login-form"
              >
                <div>
                  <Label htmlFor="admin-email">Email</Label>
                  <div className="group relative mt-1.5">
                    <Mail className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" />
                    <Input
                      id="admin-email"
                      type="email"
                      required
                      autoFocus
                      autoComplete="username"
                      spellCheck={false}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@company.com"
                      className={inputShell}
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor="admin-password">Password</Label>
                  <div className="group relative mt-1.5">
                    <LockKeyhole className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" />
                    <Input
                      id="admin-password"
                      type={revealPassword ? 'text' : 'password'}
                      required
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter your password"
                      className={`${inputShell} pr-11`}
                    />
                    <button
                      type="button"
                      onClick={() => setRevealPassword((v) => !v)}
                      aria-label={revealPassword ? 'Hide password' : 'Show password'}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-focus-ring"
                    >
                      {revealPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </div>

                {authError && (
                  <Alert tone="error" role="alert" id="admin-login-error">
                    {authError}
                  </Alert>
                )}

                <Button
                  type="submit"
                  loading={authBusy}
                  className="group relative h-12 w-full overflow-hidden rounded-xl bg-gradient-to-r from-primary via-primary to-info text-[15px] font-semibold text-white shadow-[0_8px_24px_-8px_var(--color-primary)] transition-all duration-300 hover:shadow-[0_12px_32px_-8px_var(--color-primary)] hover:brightness-110 active:scale-[0.98] disabled:hover:brightness-100"
                  data-testid="admin-login-submit"
                >
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 group-hover:translate-x-full"
                  />
                  <span className="relative flex items-center justify-center gap-2">
                    {authBusy ? (
                      'Signing you in…'
                    ) : (
                      <>
                        <ShieldCheck className="size-4 opacity-90" />
                        Sign in
                        <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1" />
                      </>
                    )}
                  </span>
                </Button>
              </form>
            </div>

            <div className="mt-5 border-t border-border pt-3.5 text-center text-xs text-muted-foreground">
              <AuthLink href="/">← Back to {SITE_CONFIG.name}</AuthLink>
            </div>
          </div>
        </div>
      </Enter>
    </div>
  );
}
