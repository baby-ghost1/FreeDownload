'use client';

import { useState } from 'react';

import { AuthLink, AuthShell } from '@/components/auth/auth-shell';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FieldError, Input, Label } from '@/components/ui/input';
import { ApiError } from '@/lib/api/client';
import { forgotPassword } from '@/lib/api/endpoints';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await forgotPassword({ email: email.trim() });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send the request. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Reset your password"
      description="We'll email you a single-use link to set a new password."
      testId="forgot-page"
      footer={<AuthLink href="/login">Back to sign in</AuthLink>}
    >
      {sent ? (
        <Alert tone="success" role="status" data-testid="forgot-sent">
          If that address has an account, a reset link is on its way. Check your inbox - the link
          expires shortly.
        </Alert>
      ) : (
        <form onSubmit={(e) => void submit(e)} className="space-y-4" data-testid="forgot-form">
          <div>
            <Label htmlFor="forgot-email">Email</Label>
            <Input
              id="forgot-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>
          {error && <FieldError id="forgot-error">{error}</FieldError>}
          <Button type="submit" loading={busy} className="w-full" data-testid="forgot-submit">
            Send reset link
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
