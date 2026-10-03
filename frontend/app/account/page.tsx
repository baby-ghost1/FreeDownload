'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Monitor, ShieldCheck } from 'lucide-react';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonClasses } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldError, Input, Label } from '@/components/ui/input';
import { Spinner } from '@/components/ui/progress';
import { ApiError } from '@/lib/api/client';
import { getUsage, listMySessions, revokeMySession, updateProfile } from '@/lib/api/endpoints';
import type { Usage, UserSession } from '@/lib/api/types';
import { useSession } from '@/lib/session';

export default function AccountPage() {
  const { user, loading, refresh } = useSession();

  const [displayName, setDisplayName] = useState('');
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSaved, setProfileSaved] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);

  const [usage, setUsage] = useState<Usage | null>(null);
  const [sessions, setSessions] = useState<UserSession[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- drafts the saved name once the session probe resolves
    if (user) setDisplayName(user.displayName ?? '');
  }, [user]);

  useEffect(() => {
    if (!user) return;
    getUsage(30)
      .then(setUsage)
      .catch(() => undefined);
    listMySessions()
      .then((r) => setSessions(r.data))
      .catch((err: unknown) =>
        setListError(err instanceof ApiError ? err.message : 'Could not load your sessions.'),
      );
  }, [user]);

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileBusy(true);
    setProfileError(null);
    setProfileSaved(false);
    try {
      await updateProfile({ displayName: displayName.trim() });
      setProfileSaved(true);
      await refresh();
    } catch (err) {
      setProfileError(err instanceof ApiError ? err.message : 'Could not save your profile.');
    } finally {
      setProfileBusy(false);
    }
  };

  const revoke = async (id: string) => {
    try {
      await revokeMySession(id);
      const r = await listMySessions();
      setSessions(r.data);
    } catch (err) {
      setListError(err instanceof ApiError ? err.message : 'Could not revoke that session.');
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Spinner className="size-7" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-16 sm:px-6">
        <Card data-testid="account-page">
          <CardContent className="py-12 text-center">
            <ShieldCheck className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
            <p className="mt-3 text-sm text-muted-foreground">
              Sign in to manage your profile, usage and sessions.
            </p>
            <Link
              href="/login?next=/account"
              className={`${buttonClasses({ size: 'sm' })} mt-5 inline-flex`}
            >
              Sign in
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-10 sm:px-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
        <Link
          href="/admin"
          className="text-sm text-muted-foreground underline hover:text-foreground"
        >
          Admin console
        </Link>
      </div>

      <Card data-testid="account-page">
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>{user.email}</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => void saveProfile(e)}
            className="space-y-4"
            data-testid="profile-form"
          >
            <div>
              <Label htmlFor="profile-name">Display name</Label>
              <Input
                id="profile-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={80}
                placeholder="How should we greet you?"
              />
            </div>
            {profileError && <FieldError id="profile-error">{profileError}</FieldError>}
            {profileSaved && <Alert tone="success">Profile saved.</Alert>}
            <Button type="submit" loading={profileBusy} data-testid="profile-submit">
              Save profile
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Usage — last 30 days</CardTitle>
          <CardDescription>Your download activity at a glance.</CardDescription>
        </CardHeader>
        <CardContent>
          {usage === null ? (
            <Spinner className="size-5" />
          ) : (
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-md border border-border bg-background/50 p-4">
                <div className="text-2xl font-semibold" data-testid="usage-total">
                  {usage.total}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">Total</div>
              </div>
              <div className="rounded-md border border-border bg-background/50 p-4">
                <div className="text-2xl font-semibold text-success" data-testid="usage-completed">
                  {usage.completed}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">Completed</div>
              </div>
              <div className="rounded-md border border-border bg-background/50 p-4">
                <div className="text-2xl font-semibold text-destructive" data-testid="usage-failed">
                  {usage.failed}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">Failed</div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Active sessions</CardTitle>
          <CardDescription>Devices currently signed in to your account.</CardDescription>
        </CardHeader>
        <CardContent>
          {listError && (
            <Alert tone="error" className="mb-3">
              {listError}
            </Alert>
          )}
          {sessions === null && !listError ? (
            <Spinner className="size-5" />
          ) : (
            <ul className="space-y-2">
              {sessions?.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center gap-3 rounded-md border border-border bg-background/50 px-3.5 py-2.5"
                  data-testid="session-item"
                >
                  <Monitor className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">
                      {s.userAgent ?? 'Unknown device'}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {s.ip ?? '—'} · last seen {new Date(s.lastSeenAt).toLocaleString()}
                    </span>
                  </span>
                  {s.current ? (
                    <Badge tone="success">This device</Badge>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void revoke(s.id)}
                      data-testid="session-revoke"
                    >
                      Revoke
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
