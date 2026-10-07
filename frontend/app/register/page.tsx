'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Route } from 'next';
import { Suspense, useState } from 'react';

import { AuthLink, AuthShell } from '@/components/auth/auth-shell';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FieldError, Input, Label, PasswordInput } from '@/components/ui/input';
import { ApiError } from '@/lib/api/client';
import { register } from '@/lib/api/endpoints';
import { useSession } from '@/lib/session';

function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { applySession, user } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const next = (() => {
    const raw = searchParams.get('next');
    // Same-origin path only - blocks open redirects.
    if (raw && raw.startsWith('/') && !raw.startsWith('//')) return raw;
    return '/';
  })();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const session = await register({
        email: email.trim(),
        password,
        ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
      });
      applySession(session);
      router.push(next as Route);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the account.');
      setBusy(false);
    }
  };

  if (user) {
    return (
      <Alert tone="success">
        You&apos;re already signed in as {user.email}.{' '}
        <Link href={next as Route} className="underline">
          Continue
        </Link>
      </Alert>
    );
  }

  return (
    <>
      <form onSubmit={(e) => void submit(e)} className="space-y-4" data-testid="register-form">
        <div>
          <Label htmlFor="reg-email">Email</Label>
          <Input
            id="reg-email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </div>
        <div>
          <Label htmlFor="reg-name">Display name (optional)</Label>
          <Input
            id="reg-name"
            type="text"
            autoComplete="name"
            maxLength={80}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Ada"
          />
        </div>
        <div>
          <Label htmlFor="reg-password">Password</Label>
          <PasswordInput
            id="reg-password"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            aria-describedby="reg-password-hint"
          />
          <p id="reg-password-hint" className="mt-1.5 text-xs text-muted-foreground">
            At least 8 characters.
          </p>
        </div>
        {error && <FieldError id="register-error">{error}</FieldError>}
      <Button type="submit" loading={busy} className="w-full" data-testid="register-submit">
        Create account
      </Button>
      </form>
    </>
  );
}

export default function RegisterPage() {
  return (
    <AuthShell
      title="Create your account"
      description="Track downloads and manage your links - free to start."
      testId="register-page"
      perks={[
        'History across all your devices',
        'Higher daily limits + parallel downloads',
        'API keys for automation',
      ]}
      footer={
        <>
          Already registered? <AuthLink href="/login">Sign in</AuthLink>
        </>
      }
    >
      <Suspense fallback={null}>
        <RegisterForm />
      </Suspense>
    </AuthShell>
  );
}
