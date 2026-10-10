'use client';

import Link from 'next/link';
import { AnimatePresence, motion } from 'motion/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import {
  Check,
  Copy,
  CreditCard,
  KeyRound,
  LogOut,
  Monitor,
  ShieldCheck,
  Trash2,
} from 'lucide-react';

import { Alert } from '@/components/ui/alert';
import { BackButton } from '@/components/back-button';
import { useToast } from '@/components/ui/toast';
import { Badge } from '@/components/ui/badge';
import { SoftBackdrop } from '@/components/soft-backdrop';
import { Button, buttonClasses } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldError, Input, Label } from '@/components/ui/input';
import { Spinner } from '@/components/ui/progress';
import { Enter, Stagger, StaggerItem } from '@/components/motion/reveal';
import { ApiError } from '@/lib/api/client';
import {
  cancelSubscription,
  cancelUpgradeRequest,
  createApiKey,
  downgradeToFree,
  getApiKeyUsage,
  getCurrentSubscription,
  getUsage,
  listApiKeys,
  listMySessions,
  listMyUpgradeRequests,
  listPlans,
  revokeApiKey,
  revokeMySession,
  updateProfile,
} from '@/lib/api/endpoints';
import type {
  ApiKeyInfo,
  ApiKeyUsage,
  PlanInfo,
  Subscription,
  UpgradeRequest,
  Usage,
  UserSession,
} from '@/lib/api/types';
import { UpgradeModal } from '@/components/billing/upgrade-modal';
import { useSession } from '@/lib/session';
import { formatINR } from '@/lib/format';
import { SITE_CONFIG } from '@/lib/constants/site';

function price(cents: number): string {
  return formatINR(cents);
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

function UsageBar({ usage }: { usage: Usage }) {
  const total = Math.max(usage.total, 1);
  const done = Math.round((usage.completed / total) * 100);
  return (
    <div>
      <div
        className="h-2.5 overflow-hidden rounded-full bg-surface-sunken"
        role="img"
        aria-label={`${usage.completed} of ${usage.total} downloads completed, ${usage.failed} failed`}
      >
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-success to-success/60"
          initial={{ width: 0 }}
          animate={{ width: `${done}%` }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
      <div className="mt-1.5 flex justify-between text-xs text-muted-foreground">
        <span>
          {usage.completed} of {usage.total} completed
        </span>
        <span>{done}% success</span>
      </div>
    </div>
  );
}

export default function AccountPage() {
  const { user, loading, refresh, signOut } = useSession();
  const router = useRouter();
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

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
  const [upgradePlan, setUpgradePlan] = useState<PlanInfo | null>(null);
  const [upgradeRequests, setUpgradeRequests] = useState<UpgradeRequest[] | null>(null);

  const [apiKeys, setApiKeys] = useState<ApiKeyInfo[] | null>(null);
  const [keyName, setKeyName] = useState('');
  const [rawKey, setRawKey] = useState<string | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [keyBusy, setKeyBusy] = useState(false);
  const [needsUpgrade, setNeedsUpgrade] = useState(false);
  const [usageByKey, setUsageByKey] = useState<Record<string, ApiKeyUsage>>({});
  const [revokeConfirmId, setRevokeConfirmId] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- drafts the saved name once the session probe resolves
    if (user) setDisplayName(user.displayName ?? '');
  }, [user]);

  // Depend on the id, not the user object: the 30 s session heartbeat stores a
  // fresh object every tick, which would otherwise re-run all six loads.
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!userId) return;
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
    listMyUpgradeRequests()
      .then((r) => setUpgradeRequests(r.data))
      .catch(() => setUpgradeRequests([]));
    listPlans()
      .then((r) => setAvailablePlans(r.data))
      .catch(() => setAvailablePlans([]));
    listApiKeys()
      .then((r) => setApiKeys(r.data))
      .catch((err: unknown) =>
        setKeyError(err instanceof ApiError ? err.message : 'Could not load your API keys.'),
      );
  }, [userId]);

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

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      router.replace('/');
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

  const refreshBilling = async () => {
    try {
      setSubscription(await getCurrentSubscription());
    } catch {
      // Keep the last known plan on transient failures.
    }
    try {
      setUpgradeRequests((await listMyUpgradeRequests()).data);
    } catch {
      setUpgradeRequests([]);
    }
  };

  const cancelRequest = async (id: string) => {
    setBillingBusy(true);
    setBillingError(null);
    try {
      await cancelUpgradeRequest(id);
      await refreshBilling();
    } catch (err) {
      setBillingError(err instanceof ApiError ? err.message : 'Could not cancel the request.');
    } finally {
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
    setNeedsUpgrade(false);
    setRawKey(null);
    try {
      const created = await createApiKey(name);
      setRawKey(created.rawKey);
      setKeyName('');
      setApiKeys((await listApiKeys()).data);
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.code === 'FORBIDDEN' &&
        (err.details as { upgradeRequired?: boolean } | undefined)?.upgradeRequired === true
      ) {
        // Free plan: the section stays visible, creation points at an upgrade.
        setNeedsUpgrade(true);
        setKeyError(null);
      } else {
        setKeyError(err instanceof ApiError ? err.message : 'Could not create the key.');
      }
    } finally {
      setKeyBusy(false);
    }
  };

  const revokeKey = async (id: string): Promise<boolean> => {
    try {
      await revokeApiKey(id);
      setApiKeys((await listApiKeys()).data);
      return true;
    } catch (err) {
      setKeyError(err instanceof ApiError ? err.message : 'Could not revoke that key.');
      return false;
    }
  };

  const confirmRevoke = async (id: string) => {
    if (await revokeKey(id)) setRevokeConfirmId(null);
  };

  const copyKey = async () => {
    if (!rawKey) return;
    try {
      await navigator.clipboard.writeText(rawKey);
      setCopied(true);
      toast('API key copied to clipboard', 'success');
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast('Could not copy - select the key manually', 'error');
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
    <div className="relative mx-auto w-full max-w-3xl space-y-6 px-4 pb-10 pt-10 sm:px-6 sm:pt-12">
      <SoftBackdrop />
      <div className="relative">
        <BackButton href="/" label="Back to home" />
      </div>
      <Enter className="relative">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">{user.email}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            loading={signingOut}
            onClick={() => void handleSignOut()}
            data-testid="account-sign-out"
            className="gap-1.5 rounded-xl"
          >
            <LogOut className="size-3.5" />
            Sign out
          </Button>
        </div>
      </Enter>

      <Stagger className="relative space-y-6">
        <StaggerItem>
          <Card id="billing-card" className="overflow-hidden scroll-mt-6">
            <div
              aria-hidden="true"
              className="neon-edge bg-gradient-to-r from-primary via-info to-primary bg-[length:220%_100%] animate-gradient-pan"
            />
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
                            onClick={() => setUpgradePlan(p)}
                            data-testid={`billing-upgrade-${p.code}`}
                          >
                            Upgrade to {p.name} - {price(p.priceCents)}/{p.interval}
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
                            {subscription.provider === 'none'
                              ? 'Cancel plan'
                              : 'Cancel at period end'}
                          </Button>
                        )}
                      </>
                    )}
                  </div>

                  {upgradeRequests && upgradeRequests.length > 0 && (
                    <div className="space-y-2" data-testid="upgrade-requests">
                      <p className="text-sm font-medium">Upgrade requests</p>
                      <ul className="space-y-2">
                        {upgradeRequests.map((r) => (
                          <li
                            key={r.id}
                            className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-background/50 px-3.5 py-2.5 text-sm"
                            data-testid="upgrade-request-item"
                          >
                            <span className="font-medium capitalize">{r.planCode}</span>
                            <span className="text-muted-foreground">
                              {price(r.amountCents)} {r.currency.toUpperCase()}
                              {r.couponCode ? ` · ${r.couponCode}` : ''}
                            </span>
                            <Badge
                              tone={
                                r.status === 'approved'
                                  ? 'success'
                                  : r.status === 'pending'
                                    ? 'warning'
                                    : 'muted'
                              }
                              data-testid="upgrade-request-status"
                            >
                              {r.status}
                            </Badge>
                            <span className="ml-auto text-xs text-muted-foreground">
                              {new Date(r.createdAt).toLocaleDateString()}
                            </span>
                            {r.status === 'pending' && (
                              <Button
                                variant="ghost"
                                size="sm"
                                loading={billingBusy}
                                onClick={() => void cancelRequest(r.id)}
                                data-testid="upgrade-request-cancel"
                              >
                                Cancel request
                              </Button>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </StaggerItem>

        <StaggerItem>
          <Card data-testid="account-page" className="overflow-hidden">
            <div aria-hidden="true" className="h-px bg-border/70" />
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
        </StaggerItem>

        <StaggerItem>
          <Card className="overflow-hidden">
            <div aria-hidden="true" className="h-px bg-border/70" />
            <CardHeader>
              <CardTitle>Usage - last 30 days</CardTitle>
              <CardDescription>Your download activity at a glance.</CardDescription>
            </CardHeader>
            <CardContent>
              {usage === null ? (
                <Spinner className="size-5" />
              ) : (
                <div className="space-y-4">
                  <UsageBar usage={usage} />
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div className="rounded-md border border-border bg-background/50 p-4">
                      <div className="text-2xl font-semibold" data-testid="usage-total">
                        {usage.total}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">Total</div>
                    </div>
                    <div className="rounded-md border border-border bg-background/50 p-4">
                      <div
                        className="text-2xl font-semibold text-success"
                        data-testid="usage-completed"
                      >
                        {usage.completed}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">Completed</div>
                    </div>
                    <div className="rounded-md border border-border bg-background/50 p-4">
                      <div
                        className="text-2xl font-semibold text-destructive"
                        data-testid="usage-failed"
                      >
                        {usage.failed}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">Failed</div>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </StaggerItem>

        <StaggerItem>
          <Card className="overflow-hidden">
            <div aria-hidden="true" className="h-px bg-border/70" />
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="size-4 text-muted-foreground" aria-hidden="true" />
                API keys
              </CardTitle>
              <CardDescription>
                Programmatic access: send the key as Authorization: Bearer.
                {subscription !== null &&
                  (subscription.plan.code === 'free' ? (
                    <>
                      {' '}
                      API keys unlock on Pro and Business - up to{' '}
                      {Math.max(
                        0,
                        ...availablePlans
                          .filter((p) => p.priceCents > 0)
                          .map((p) => p.limits?.apiPerHour ?? 0),
                      )}{' '}
                      API calls per hour.
                    </>
                  ) : (
                    subscription.plan.limits?.apiPerHour !== undefined && (
                      <>
                        {' '}
                        Your {subscription.plan.name} plan allows{' '}
                        {subscription.plan.limits.apiPerHour} API calls per hour.
                      </>
                    )
                  ))}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {keyError && <FieldError id="api-key-error">{keyError}</FieldError>}
              {needsUpgrade && (
                <Alert tone="info" className="mb-3" data-testid="api-key-upgrade">
                  API keys need a Pro or Business plan - your key quota starts the moment you
                  upgrade.{' '}
                  <button
                    type="button"
                    onClick={() =>
                      document
                        .getElementById('billing-card')
                        ?.scrollIntoView({ behavior: 'smooth' })
                    }
                    className="link-underline font-medium text-primary underline-offset-2"
                  >
                    View plans →
                  </button>
                </Alert>
              )}
              {rawKey && (
                <Alert tone="info" className="mb-3" data-testid="api-key-raw">
                  <span className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block font-medium">
                        New key created - copy it now, it is shown only once:
                      </span>
                      <code className="mt-1 block break-all rounded-lg bg-surface-sunken px-2 py-1.5">
                        {rawKey}
                      </code>
                    </span>
                    <button
                      type="button"
                      onClick={() => void copyKey()}
                      aria-label={copied ? 'Copied' : 'Copy API key'}
                      title={copied ? 'Copied' : 'Copy API key'}
                      className="flex size-8 shrink-0 items-center justify-center rounded-md border border-info/30 text-info transition-all duration-200 hover:bg-info/10 active:scale-90"
                    >
                      {copied ? (
                        <Check className="size-4" aria-hidden="true" />
                      ) : (
                        <Copy className="size-4" aria-hidden="true" />
                      )}
                    </button>
                  </span>
                </Alert>
              )}
              <details
                className="mb-3 rounded-xl border border-border bg-background/60 px-3.5 py-2.5"
                data-testid="api-key-howto"
              >
                <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                  How to use
                </summary>
                <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-surface-sunken p-3 font-mono text-xs leading-relaxed text-foreground">{`curl -X POST ${SITE_CONFIG.url}/api/v1/downloads \\
  -H "Authorization: Bearer fd_live_..." \\
  -H "content-type: application/json" \\
  -d '{"url":"<paste a link>"}'`}</pre>
              </details>
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
                  <li className="flex flex-col items-center gap-1.5 rounded-xl border border-dashed border-border px-4 py-6 text-center">
                    <KeyRound className="size-5 text-muted-foreground" aria-hidden="true" />
                    <p className="text-sm text-muted-foreground">
                      No API keys yet - create one above.
                    </p>
                  </li>
                ) : (
                  apiKeys.map((k) => {
                    const kUsage = usageByKey[k.id];
                    const confirming = revokeConfirmId === k.id;
                    return (
                      <li
                        key={k.id}
                        className="rounded-xl border border-border bg-background/50 px-3.5 py-3 transition-colors hover:border-border-strong"
                        data-testid="api-key-item"
                      >
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary/15 to-info/10 text-primary">
                            <KeyRound className="size-4" aria-hidden="true" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="truncate text-sm font-medium">{k.name}</span>
                              <code className="rounded-md bg-surface-sunken px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                                {k.prefix}…
                              </code>
                            </span>
                            <span className="mt-0.5 block text-xs text-muted-foreground">
                              created {new Date(k.createdAt).toLocaleDateString()} ·{' '}
                              {k.revokedAt
                                ? `revoked ${new Date(k.revokedAt).toLocaleString()}`
                                : k.lastUsedAt
                                  ? `last used ${new Date(k.lastUsedAt).toLocaleString()}`
                                  : 'never used'}
                            </span>
                          </span>
                          {kUsage && (
                            <span
                              className="text-xs text-muted-foreground"
                              data-testid="api-key-usage"
                            >
                              {kUsage.totalRequests} requests · {kUsage.totalErrors} errors
                            </span>
                          )}
                          {k.revokedAt ? (
                            <Badge tone="muted">Revoked</Badge>
                          ) : confirming ? (
                            <span className="flex items-center gap-1.5">
                              <span className="text-xs text-muted-foreground">Revoke?</span>
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => void confirmRevoke(k.id)}
                                data-testid="api-key-revoke-confirm"
                              >
                                Yes, revoke
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setRevokeConfirmId(null)}
                                data-testid="api-key-revoke-cancel"
                              >
                                Cancel
                              </Button>
                            </span>
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
                                onClick={() => setRevokeConfirmId(k.id)}
                                className="hover:text-destructive"
                                data-testid="api-key-revoke"
                              >
                                <Trash2 className="size-3.5" />
                                Revoke
                              </Button>
                            </>
                          )}
                        </div>
                      </li>
                    );
                  })
                )}
              </ul>
            </CardContent>
          </Card>
        </StaggerItem>

        <StaggerItem>
          <Card className="overflow-hidden">
            <div aria-hidden="true" className="h-px bg-border/70" />
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
                      className="flex items-center gap-3 rounded-md border border-border bg-background/50 px-3.5 py-2.5 transition-colors hover:border-border-strong"
                      data-testid="session-item"
                    >
                      <Monitor
                        className="size-4 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">
                          {s.userAgent ?? 'Unknown device'}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {s.ip ?? '-'} · last seen {new Date(s.lastSeenAt).toLocaleString()}
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
        </StaggerItem>
      </Stagger>

      <PlanQueryOpener plans={availablePlans} onPick={(p) => setUpgradePlan(p)} />
      <AnimatePresence>
        {upgradePlan && (
          <UpgradeModal
            plan={upgradePlan}
            onClose={() => setUpgradePlan(null)}
            onRequested={() => void refreshBilling()}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/** Opens the upgrade modal from `?plan=pro|business` (home page deep link). */
function PlanQueryOpener({ plans, onPick }: { plans: PlanInfo[]; onPick: (p: PlanInfo) => void }) {
  return (
    <Suspense fallback={null}>
      <PlanQueryOpenerInner plans={plans} onPick={onPick} />
    </Suspense>
  );
}

function PlanQueryOpenerInner({
  plans,
  onPick,
}: {
  plans: PlanInfo[];
  onPick: (p: PlanInfo) => void;
}) {
  const searchParams = useSearchParams();
  const wanted = searchParams.get('plan');
  useEffect(() => {
    if (!wanted || plans.length === 0) return;
    const match = plans.find((p) => p.code === wanted && p.priceCents > 0);
    if (match) onPick(match);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot deep link
  }, [wanted, plans.length]);
  return null;
}
