'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CreditCard, KeyRound, Monitor, ShieldCheck } from 'lucide-react';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonClasses } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldError, Input, Label } from '@/components/ui/input';
import { Spinner } from '@/components/ui/progress';
import { ApiError } from '@/lib/api/client';
import {
  cancelSubscription,
  createApiKey,
  downgradeToFree,
  getApiKeyUsage,
  getCurrentSubscription,
  getUsage,
  listApiKeys,
  listMySessions,
  listPlans,
  revokeApiKey,
  revokeMySession,
  startCheckout,
  updateProfile,
} from '@/lib/api/endpoints';
import type {
  ApiKeyInfo,
  ApiKeyUsage,
  PlanInfo,
  Subscription,
  Usage,
  UserSession,
} from '@/lib/api/types';
import { useSession } from '@/lib/session';

function price(cents: number, currency: string): string {
  const value = cents / 100;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(value);
}

function limitsText(sub: Subscription): string {
  const limits = sub.plan.limits;
  if (!limits) return 'Standard plan limits';
  const parts: string[] = [];
  if (limits.jobsPerDay !== undefined) parts.push(`${limits.jobsPerDay} downloads/day`);
  if (limits.concurrentJobs !== undefined) parts.push(`${limits.concurrentJobs} at a time`);
  if (limits.maxFileSizeMb !== undefined) parts.push(`up to ${limits.maxFileSizeMb} MB`);
  return parts.join(' · ');
}

export default function AccountPage() {
  const { user, loading, refresh } = useSession();

  const [displayName, setDisplayName] = useState('');
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSaved, setProfileSaved] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);

  const [usage, setUsage] = useState<Usage | null>(null);
  const [sessions, setSessions] = useState<UserSession[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [availablePlans, setAvailablePlans] = useState<PlanInfo[]>([]);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [billingBusy, setBillingBusy] = useState(false);

  const [apiKeys, setApiKeys] = useState<ApiKeyInfo[] | null>(null);
  const [keyName, setKeyName] = useState('');
  const [rawKey, setRawKey] = useState<string | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [keyBusy, setKeyBusy] = useState(false);
  const [usageByKey, setUsageByKey] = useState<Record<string, ApiKeyUsage>>({});

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
    getCurrentSubscription()
      .then(setSubscription)
      .catch(() => setSubscription(null));
    listPlans()
      .then((r) => setAvailablePlans(r.data))
      .catch(() => setAvailablePlans([]));
    listApiKeys()
      .then((r) => setApiKeys(r.data))
      .catch((err: unknown) =>
        setKeyError(err instanceof ApiError ? err.message : 'Could not load your API keys.'),
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

  const upgrade = async (planCode: string) => {
    setBillingBusy(true);
    setBillingError(null);
    try {
      const checkout = await startCheckout(planCode);
      window.location.assign(checkout.url);
    } catch (err) {
      setBillingError(err instanceof ApiError ? err.message : 'Could not start checkout.');
      setBillingBusy(false);
    }
  };

  const applySubscription = async (action: () => Promise<Subscription>) => {
    setBillingBusy(true);
    setBillingError(null);
    try {
      setSubscription(await action());
    } catch (err) {
      setBillingError(err instanceof ApiError ? err.message : 'Could not update your plan.');
    } finally {
      setBillingBusy(false);
    }
  };

  const createKey = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = keyName.trim();
    if (!name) return;
    setKeyBusy(true);
    setKeyError(null);
    setRawKey(null);
    try {
      const created = await createApiKey(name);
      setRawKey(created.rawKey);
      setKeyName('');
      setApiKeys((await listApiKeys()).data);
    } catch (err) {
      setKeyError(err instanceof ApiError ? err.message : 'Could not create the key.');
    } finally {
      setKeyBusy(false);
    }
  };

  const revokeKey = async (id: string) => {
    try {
      await revokeApiKey(id);
      setApiKeys((await listApiKeys()).data);
    } catch (err) {
      setKeyError(err instanceof ApiError ? err.message : 'Could not revoke that key.');
    }
  };

  const loadKeyUsage = async (id: string) => {
    try {
      const u = await getApiKeyUsage(id);
      setUsageByKey((prev) => ({ ...prev, [id]: u }));
    } catch (err) {
      setKeyError(err instanceof ApiError ? err.message : 'Could not load key usage.');
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
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="size-4 text-muted-foreground" aria-hidden="true" />
            Plan &amp; billing
          </CardTitle>
          <CardDescription>Your current plan, limits and upgrades.</CardDescription>
        </CardHeader>
        <CardContent>
          {subscription === null ? (
            <Spinner className="size-5" />
          ) : (
            <div className="space-y-4">
              <div
                className="flex flex-wrap items-center justify-between gap-3"
                data-testid="billing-plan"
              >
                <div className="flex items-center gap-2">
                  <span className="text-lg font-semibold">{subscription.plan.name}</span>
                  <Badge
                    tone={
                      subscription.status === 'active' || subscription.status === 'trialing'
                        ? 'success'
                        : subscription.status === 'canceled'
                          ? 'muted'
                          : 'warning'
                    }
                    data-testid="billing-status"
                  >
                    {subscription.status}
                  </Badge>
                  {subscription.provider === 'stripe' && (
                    <span className="text-xs text-muted-foreground">via Stripe</span>
                  )}
                </div>
                <span className="text-sm text-muted-foreground" data-testid="billing-limits">
                  {limitsText(subscription)}
                </span>
              </div>

              {subscription.cancelAtPeriodEnd && subscription.currentPeriodEnd && (
                <Alert tone="info">
                  Cancels at the end of the period (
                  {new Date(subscription.currentPeriodEnd).toLocaleDateString()}).
                </Alert>
              )}
              {billingError && <FieldError id="billing-error">{billingError}</FieldError>}

              <div className="flex flex-wrap gap-2">
                {subscription.plan.code === 'free' ? (
                  availablePlans
                    .filter((p) => p.priceCents > 0)
                    .map((p) => (
                      <Button
                        key={p.code}
                        size="sm"
                        loading={billingBusy}
                        onClick={() => void upgrade(p.code)}
                        data-testid={`billing-upgrade-${p.code}`}
                      >
                        Upgrade to {p.name} — {price(p.priceCents, p.currency)}/{p.interval}
                      </Button>
                    ))
                ) : (
                  <>
                    {subscription.provider === 'none' && (
                      <Button
                        variant="outline"
                        size="sm"
                        loading={billingBusy}
                        onClick={() => void applySubscription(downgradeToFree)}
                        data-testid="billing-downgrade"
                      >
                        Downgrade to Free
                      </Button>
                    )}
                    {subscription.status !== 'canceled' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={billingBusy}
                        onClick={() => void applySubscription(cancelSubscription)}
                        data-testid="billing-cancel"
                      >
                        {subscription.provider === 'none' ? 'Cancel plan' : 'Cancel at period end'}
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
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
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-4 text-muted-foreground" aria-hidden="true" />
            API keys
          </CardTitle>
          <CardDescription>
            Programmatic access: send the key as Authorization: Bearer.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {keyError && <FieldError id="api-key-error">{keyError}</FieldError>}
          {rawKey && (
            <Alert tone="info" className="mb-3" data-testid="api-key-raw">
              Copy it now — the key is shown only once: <code className="break-all">{rawKey}</code>
            </Alert>
          )}
          <form
            onSubmit={(e) => void createKey(e)}
            className="flex flex-wrap gap-2"
            data-testid="api-key-form"
          >
            <Input
              value={keyName}
              onChange={(e) => setKeyName(e.target.value)}
              maxLength={64}
              placeholder="Key name (e.g. ci)"
              className="max-w-56 flex-1"
              data-testid="api-key-name"
            />
            <Button type="submit" loading={keyBusy} data-testid="api-key-create">
              Create key
            </Button>
          </form>

          <ul className="mt-4 space-y-2">
            {apiKeys === null ? (
              <Spinner className="size-5" />
            ) : apiKeys.length === 0 ? (
              <li className="text-sm text-muted-foreground">No API keys yet.</li>
            ) : (
              apiKeys.map((k) => {
                const kUsage = usageByKey[k.id];
                return (
                  <li
                    key={k.id}
                    className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-background/50 px-3.5 py-2.5"
                    data-testid="api-key-item"
                  >
                    <code className="text-sm font-medium">{k.prefix}…</code>
                    <span className="min-w-0 flex-1 truncate text-sm">{k.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {k.lastUsedAt
                        ? `last used ${new Date(k.lastUsedAt).toLocaleString()}`
                        : 'never used'}
                    </span>
                    {kUsage && (
                      <span className="text-xs text-muted-foreground" data-testid="api-key-usage">
                        {kUsage.totalRequests} requests · {kUsage.totalErrors} errors
                      </span>
                    )}
                    {k.revokedAt ? (
                      <Badge tone="muted">Revoked</Badge>
                    ) : (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void loadKeyUsage(k.id)}
                          data-testid="api-key-usage-load"
                        >
                          Usage
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void revokeKey(k.id)}
                          data-testid="api-key-revoke"
                        >
                          Revoke
                        </Button>
                      </>
                    )}
                  </li>
                );
              })
            )}
          </ul>
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
