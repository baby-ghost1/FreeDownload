'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';

import { AuthLink, AuthShell } from '@/components/auth/auth-shell';
import { Alert } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/progress';
import { ApiError } from '@/lib/api/client';
import { verifyEmail } from '@/lib/api/endpoints';

type State = 'verifying' | 'ok' | 'error' | 'missing';

function VerifyInner() {
  const token = useSearchParams().get('token');
  const [state, setState] = useState<State>(token ? 'verifying' : 'missing');
  const [message, setMessage] = useState('');
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    verifyEmail({ token })
      .then(() => setState('ok'))
      .catch((err: unknown) => {
        setState('error');
        setMessage(
          err instanceof ApiError
            ? err.message
            : 'This verification link is invalid or has expired.',
        );
      });
  }, [token]);

  return (
    <AuthShell
      title="Verify your email"
      description="One moment while we confirm your address."
      testId="verify-page"
      footer={<AuthLink href="/login">Back to sign in</AuthLink>}
    >
      {state === 'verifying' && (
        <p className="flex items-center gap-3 py-4 text-sm text-muted-foreground">
          <Spinner className="size-5" /> Verifying…
        </p>
      )}
      {state === 'ok' && (
        <Alert tone="success" data-testid="verify-ok">
          Email verified - you can now sign in.
        </Alert>
      )}
      {state === 'error' && <Alert tone="error">{message}</Alert>}
      {state === 'missing' && (
        <Alert tone="error">
          This verification link is missing its token.{' '}
          <AuthLink href="/forgot-password">Request a new email</AuthLink>.
        </Alert>
      )}
    </AuthShell>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyInner />
    </Suspense>
  );
}
