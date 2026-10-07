'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

import { AuthLink, AuthShell } from '@/components/auth/auth-shell';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FieldError, Input, Label, PasswordInput } from '@/components/ui/input';
import { ApiError } from '@/lib/api/client';
import { useSession } from '@/lib/session';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { signIn, user } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const next = (() => {
    const raw = searchParams.get('next');
    // Same-origin path only - blocks open redirects.
    if (raw && raw.startsWith('/') && !raw.startsWith('//')) return raw;
    return '/';
  })() as Route;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn({ email: email.trim(), password });
      router.push(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in right now. Try again.');
      setBusy(false);
    }
  };

  if (user) {
    return (
      <Alert tone="success">
        You&apos;re already signed in as {user.email}.{' '}
        <Link href={next} className="underline">
          Continue
        </Link>
      </Alert>
    );
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4" data-testid="login-form">
      <div>
        <Label htmlFor="login-email">Email</Label>
        <Input
          id="login-email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
        />
      </div>
      <div>
        <Label htmlFor="login-password">Password</Label>
        <PasswordInput
          id="login-password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
        />
      </div>
      {error && <FieldError id="login-error">{error}</FieldError>}
      <Button type="submit" loading={busy} className="w-full" data-testid="login-submit">
        Sign in
      </Button>
      <div className="flex items-center justify-between text-sm">
        <AuthLink href="/forgot-password">Forgot password?</AuthLink>
        <AuthLink href="/register">Create account</AuthLink>
      </div>
    </form>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <AuthShell
        title="Welcome back"
        description="Sign in to manage your downloads and account."
        testId="login-page"
        perks={[
          'History across all your devices',
          'Higher daily limits + parallel downloads',
          'API keys for automation',
        ]}
        footer={
          <>
            New here? <AuthLink href="/register">Create an account</AuthLink>
          </>
        }
      >
        <LoginForm />
      </AuthShell>
    </Suspense>
  );
}
