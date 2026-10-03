'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

import { AuthLink, AuthShell } from '@/components/auth/auth-shell';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FieldError, Input, Label } from '@/components/ui/input';
import { ApiError } from '@/lib/api/client';
import { resetPassword } from '@/lib/api/endpoints';

function ResetForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await resetPassword({ token, password });
      setDone(true);
      setTimeout(() => router.push('/login'), 1_500);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'This reset link is invalid or has expired. Request a new one.',
      );
      setBusy(false);
    }
  };

  if (!token) {
    return (
      <Alert tone="error">
        This reset link is missing its token.{' '}
        <AuthLink href="/forgot-password">Request a new link</AuthLink>.
      </Alert>
    );
  }

  if (done) {
    return (
      <Alert tone="success" data-testid="reset-done">
        Password updated — all sessions were signed out. Redirecting to sign in…
      </Alert>
    );
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4" data-testid="reset-form">
      <div>
        <Label htmlFor="reset-password">New password</Label>
        <Input
          id="reset-password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="At least 8 characters"
        />
      </div>
      <div>
        <Label htmlFor="reset-confirm">Confirm new password</Label>
        <Input
          id="reset-confirm"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Repeat it"
        />
      </div>
      {error && <FieldError id="reset-error">{error}</FieldError>}
      <Button type="submit" loading={busy} className="w-full" data-testid="reset-submit">
        Set new password
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <AuthShell
        title="Choose a new password"
        description="Your other sessions will be signed out after the change."
        testId="reset-page"
        footer={<AuthLink href="/login">Back to sign in</AuthLink>}
      >
        <ResetForm />
      </AuthShell>
    </Suspense>
  );
}
