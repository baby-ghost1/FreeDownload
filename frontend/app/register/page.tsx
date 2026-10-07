'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { AuthLink, AuthShell } from '@/components/auth/auth-shell';
import { Button } from '@/components/ui/button';
import { FieldError, Input, Label, PasswordInput } from '@/components/ui/input';
import { ApiError } from '@/lib/api/client';
import { register } from '@/lib/api/endpoints';
import { useSession } from '@/lib/session';

export default function RegisterPage() {
  const router = useRouter();
  const { applySession } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
      router.push('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the account.');
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Create your account"
      description="Track downloads and manage your links - free to start."
      testId="register-page"
      footer={
        <>
          Already registered? <AuthLink href="/login">Sign in</AuthLink>
        </>
      }
    >
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
    </AuthShell>
  );
}
