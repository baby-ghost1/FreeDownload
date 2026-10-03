'use client';

import { useCallback, useEffect, useState } from 'react';
import { Flag, History, LayoutDashboard, ListChecks, ScrollText, Users } from 'lucide-react';

import { Alert } from '@/components/ui/alert';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldError, Input, Label } from '@/components/ui/input';
import { Spinner } from '@/components/ui/progress';
import { ApiError } from '@/lib/api/client';
import {
  adminCancelJob,
  adminLogin,
  adminLogout,
  adminMe,
  adminMfaComplete,
  adminMfaSetup,
  adminRetryJob,
  getAdminOverview,
  listAdminAuditLogs,
  listAdminFlags,
  listAdminJobs,
  listAdminSources,
  listAdminUsers,
  updateAdminFlag,
  updateAdminSource,
  updateAdminUser,
} from '@/lib/api/endpoints';
import type {
  Admin,
  AdminJob,
  AdminOverview,
  AdminSource,
  AdminUser,
  AuditEntry,
  FeatureFlag,
} from '@/lib/api/types';
import { cn } from '@/lib/utils/cn';

type View = 'loading' | 'login' | 'setup' | 'app';
type Tab = 'overview' | 'sources' | 'jobs' | 'users' | 'audit' | 'flags';

const TABS: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
  { id: 'overview', label: 'Overview', icon: <LayoutDashboard className="size-4" /> },
  { id: 'sources', label: 'Sources', icon: <ListChecks className="size-4" /> },
  { id: 'jobs', label: 'Jobs', icon: <History className="size-4" /> },
  { id: 'users', label: 'Users', icon: <Users className="size-4" /> },
  { id: 'audit', label: 'Audit log', icon: <ScrollText className="size-4" /> },
  { id: 'flags', label: 'Flags', icon: <Flag className="size-4" /> },
];

const STATUS_TONE: Record<string, BadgeTone> = {
  completed: 'success',
  failed: 'danger',
  dead_letter: 'danger',
  policy_restricted: 'danger',
  cancelled: 'muted',
  expired: 'muted',
  retrying: 'warning',
};

const RETRYABLE = new Set(['failed', 'dead_letter', 'policy_restricted', 'retrying']);
const CANCELLABLE = new Set([
  'created',
  'validating',
  'queued',
  'analyzing',
  'ready',
  'processing',
  'uploading',
  'failed',
  'retrying',
  'policy_restricted',
]);

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

export default function AdminPage() {
  const [view, setView] = useState<View>('loading');
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [pageError, setPageError] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [codeRequired, setCodeRequired] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);

  const [setupInfo, setSetupInfo] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [mfaEnrolled, setMfaEnrolled] = useState(false);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [mfaBusy, setMfaBusy] = useState(false);

  useEffect(() => {
    adminMe()
      .then((r) => {
        setAdmin(r.admin);
        setView(r.mfaOk ? 'app' : 'setup');
      })
      .catch(() => setView('login'));
  }, []);

  const submitLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthBusy(true);
    setAuthError(null);
    try {
      const payload: { email: string; password: string; code?: string } = {
        email: email.trim(),
        password,
      };
      if (codeRequired && code.trim()) payload.code = code.trim();
      const res = await adminLogin(payload);
      setAdmin(res.admin);
      setCode('');
      if (res.mfaOk) {
        setView('app');
      } else {
        setMfaEnrolled(false);
        setSetupInfo(null);
        setView('setup');
      }
    } catch (err) {
      if (err instanceof ApiError && err.details?.mfaRequired === true) {
        setCodeRequired(true);
        setAuthError('Enter the 6-digit code from your authenticator app.');
      } else {
        setAuthError(message(err, 'Could not sign in right now.'));
      }
    } finally {
      setAuthBusy(false);
    }
  };

  const startSetup = async () => {
    setMfaBusy(true);
    setMfaError(null);
    try {
      setSetupInfo(await adminMfaSetup());
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setMfaEnrolled(true);
      } else {
        setMfaError(message(err, 'Could not start MFA setup.'));
      }
    } finally {
      setMfaBusy(false);
    }
  };

  const completeSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setMfaBusy(true);
    setMfaError(null);
    try {
      await adminMfaComplete(mfaCode.trim());
      const probe = await adminMe();
      setAdmin(probe.admin);
      setMfaCode('');
      setView('app');
    } catch (err) {
      setMfaError(message(err, 'That code did not work. Try again.'));
    } finally {
      setMfaBusy(false);
    }
  };

  const signOut = useCallback(async () => {
    try {
      await adminLogout();
    } finally {
      setAdmin(null);
      setView('login');
      setCodeRequired(false);
      setPassword('');
      setCode('');
    }
  }, []);

  if (view === 'loading') {
    return (
      <div className="flex justify-center py-24">
        <Spinner className="size-7" />
      </div>
    );
  }

  if (view === 'login') {
    return (
      <div className="mx-auto w-full max-w-md px-4 py-16 sm:px-6">
        <Card data-testid="admin-login">
          <CardHeader>
            <CardTitle>Admin sign in</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(e) => void submitLogin(e)}
              className="space-y-4"
              data-testid="admin-login-form"
            >
              <div>
                <Label htmlFor="admin-email">Email</Label>
                <Input
                  id="admin-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@example.com"
                />
              </div>
              <div>
                <Label htmlFor="admin-password">Password</Label>
                <Input
                  id="admin-password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              {codeRequired && (
                <div>
                  <Label htmlFor="admin-code">Authenticator code</Label>
                  <Input
                    id="admin-code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="\d{6}"
                    required
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="123456"
                  />
                </div>
              )}
              {authError && <FieldError id="admin-login-error">{authError}</FieldError>}
              <Button
                type="submit"
                loading={authBusy}
                className="w-full"
                data-testid="admin-login-submit"
              >
                Sign in
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (view === 'setup') {
    return (
      <div className="mx-auto w-full max-w-md px-4 py-16 sm:px-6">
        <Card data-testid="admin-mfa">
          <CardHeader>
            <CardTitle>Two-factor authentication</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!mfaEnrolled && setupInfo === null && (
              <>
                <p className="text-sm text-muted-foreground">
                  Protect the admin console with an authenticator app. Setup must be completed
                  before any admin data is shown.
                </p>
                <Button
                  onClick={() => void startSetup()}
                  loading={mfaBusy}
                  data-testid="mfa-setup-start"
                  className="w-full"
                >
                  Set up authenticator app
                </Button>
              </>
            )}

            {setupInfo && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Add this secret to your authenticator app, then confirm with the 6-digit code.
                </p>
                <div className="rounded-md border border-border bg-background/50 px-3 py-2">
                  <code className="break-all text-xs" data-testid="mfa-secret">
                    {setupInfo.secret}
                  </code>
                </div>
                <a
                  href={setupInfo.otpauthUrl}
                  className="block break-all text-xs text-primary underline"
                  data-testid="mfa-otpauth"
                >
                  Open in authenticator
                </a>
              </div>
            )}

            {(setupInfo || mfaEnrolled) && (
              <form onSubmit={(e) => void completeSetup(e)} className="space-y-3">
                <div>
                  <Label htmlFor="mfa-code">6-digit code</Label>
                  <Input
                    id="mfa-code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="\d{6}"
                    required
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value)}
                    placeholder="123456"
                  />
                </div>
                {mfaError && <FieldError id="mfa-error">{mfaError}</FieldError>}
                <Button
                  type="submit"
                  loading={mfaBusy}
                  className="w-full"
                  data-testid="mfa-setup-submit"
                >
                  Confirm and continue
                </Button>
              </form>
            )}

            {mfaError && !setupInfo && !mfaEnrolled && (
              <FieldError id="mfa-error">{mfaError}</FieldError>
            )}

            <button
              type="button"
              className="block w-full text-center text-sm text-muted-foreground underline"
              onClick={() => void signOut()}
            >
              Use a different account
            </button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6" data-testid="admin-app">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Admin console</h1>
          <p className="text-sm text-muted-foreground">
            {admin?.email} · <Badge tone="info">{admin?.role}</Badge>
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void signOut()}
          data-testid="admin-sign-out"
        >
          Sign out
        </Button>
      </div>

      <nav className="mt-6 flex flex-wrap gap-1 border-b border-border pb-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            data-testid={`admin-tab-${t.id}`}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors',
              tab === t.id
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-surface hover:text-foreground',
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </nav>

      {pageError && (
        <Alert tone="error" className="mt-5">
          {pageError}
        </Alert>
      )}

      <div className="mt-6">
        {tab === 'overview' && <OverviewTab onError={setPageError} />}
        {tab === 'sources' && <SourcesTab onError={setPageError} />}
        {tab === 'jobs' && <JobsTab onError={setPageError} />}
        {tab === 'users' && <UsersTab onError={setPageError} />}
        {tab === 'audit' && <AuditTab onError={setPageError} />}
        {tab === 'flags' && <FlagsTab onError={setPageError} />}
      </div>
    </div>
  );
}

function useTabData<T>(
  loader: () => Promise<T>,
  onError: (msg: string | null) => void,
  deps: unknown[] = [],
): {
  data: T | null;
  reload: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let live = true;
    loader()
      .then((r) => {
        if (live) {
          setData(r);
          onError(null);
        }
      })
      .catch((err: unknown) => {
        if (live) onError(message(err, 'Could not load this panel.'));
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loader rebuilt per render; deps drives refetch
  }, [nonce, ...deps]);

  return { data, reload: () => setNonce((n) => n + 1) };
}

function OverviewTab({ onError }: { onError: (msg: string | null) => void }) {
  const { data } = useTabData<AdminOverview>(() => getAdminOverview(), onError);

  if (!data) return <Spinner className="mx-auto block size-6" />;

  const cards: Array<{ label: string; value: number | string; testid: string }> = [
    { label: 'Jobs (all time)', value: data.jobs.total, testid: 'admin-total-jobs' },
    { label: 'Jobs (24h)', value: data.jobs.last24h, testid: 'admin-jobs-24h' },
    {
      label: 'Sources enabled',
      value: `${data.sources.enabled}/${data.sources.total}`,
      testid: 'admin-enabled-sources',
    },
    { label: 'Active users', value: data.users.active, testid: 'admin-active-users' },
    { label: 'Audits (24h)', value: data.auditsLast24h, testid: 'admin-audits-24h' },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {cards.map((c) => (
          <div
            key={c.label}
            className="rounded-lg border border-border bg-surface p-4 text-center shadow-2"
            data-testid={c.testid}
          >
            <div className="text-2xl font-semibold">{c.value}</div>
            <div className="mt-1 text-xs text-muted-foreground">{c.label}</div>
          </div>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Jobs by status</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {Object.keys(data.jobs.byStatus).length === 0 && (
            <p className="text-sm text-muted-foreground">No jobs yet.</p>
          )}
          {Object.entries(data.jobs.byStatus).map(([status, n]) => (
            <Badge key={status} tone={STATUS_TONE[status] ?? 'default'}>
              {status}: {n}
            </Badge>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function SourcesTab({ onError }: { onError: (msg: string | null) => void }) {
  const { data, reload } = useTabData<{ data: AdminSource[] }>(() => listAdminSources(), onError);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const toggle = async (source: AdminSource) => {
    setBusyId(source.id);
    setActionError(null);
    try {
      await updateAdminSource(source.id, { enabled: !source.enabled });
      reload();
    } catch (err) {
      setActionError(message(err, 'Could not update that source.'));
    } finally {
      setBusyId(null);
    }
  };

  if (!data) return <Spinner className="mx-auto block size-6" />;

  return (
    <div className="space-y-3">
      {actionError && (
        <Alert tone="error" role="alert">
          {actionError}
        </Alert>
      )}
      {data.data.map((source) => (
        <div
          key={source.id}
          className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 shadow-2"
          data-testid={`source-row-${source.slug}`}
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-medium">{source.name}</span>
              <code className="text-xs text-muted-foreground">{source.slug}</code>
            </div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <Badge tone={source.enabled ? 'success' : 'muted'}>
                {source.enabled ? 'Enabled' : 'Disabled'}
              </Badge>
              <Badge tone={source.mode === 'active' ? 'info' : 'warning'}>{source.mode}</Badge>
              <Badge tone="default">{source.healthStatus}</Badge>
            </div>
          </div>
          <Button
            size="sm"
            variant={source.enabled ? 'outline' : 'primary'}
            loading={busyId === source.id}
            onClick={() => void toggle(source)}
            data-testid={`source-toggle-${source.slug}`}
          >
            {source.enabled ? 'Disable' : 'Enable'}
          </Button>
        </div>
      ))}
    </div>
  );
}

function JobsTab({ onError }: { onError: (msg: string | null) => void }) {
  const [status, setStatus] = useState('');
  const { data, reload } = useTabData<{ data: AdminJob[] }>(
    () => listAdminJobs({ limit: 50, ...(status ? { status } : {}) }),
    onError,
    [status],
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const act = async (job: AdminJob, action: 'cancel' | 'retry') => {
    setBusyId(job.id);
    setActionError(null);
    try {
      if (action === 'cancel') await adminCancelJob(job.id);
      else await adminRetryJob(job.id);
      reload();
    } catch (err) {
      setActionError(message(err, `Could not ${action} that job.`));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Label htmlFor="job-status" className="text-sm">
          Status
        </Label>
        <select
          id="job-status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
          data-testid="jobs-status-filter"
        >
          <option value="">All</option>
          {[
            'queued',
            'analyzing',
            'processing',
            'completed',
            'failed',
            'dead_letter',
            'policy_restricted',
            'cancelled',
          ].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {actionError && (
        <Alert tone="error" role="alert">
          {actionError}
        </Alert>
      )}

      {!data ? (
        <Spinner className="mx-auto block size-6" />
      ) : data.data.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No jobs match this filter.</p>
      ) : (
        <ul className="space-y-2">
          {data.data.map((job) => (
            <li
              key={job.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 shadow-2"
              data-testid="admin-job-row"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{job.url}</span>
                <span className="block text-xs text-muted-foreground">
                  {new Date(job.createdAt).toLocaleString()}
                  {job.errorCode ? ` · ${job.errorCode}` : ''}
                </span>
              </span>
              <Badge tone={STATUS_TONE[job.status] ?? 'default'}>{job.status}</Badge>
              <span className="flex gap-2">
                {CANCELLABLE.has(job.status) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={busyId === job.id}
                    onClick={() => void act(job, 'cancel')}
                    data-testid="job-cancel"
                  >
                    Cancel
                  </Button>
                )}
                {RETRYABLE.has(job.status) && (
                  <Button
                    size="sm"
                    variant="outline"
                    loading={busyId === job.id}
                    onClick={() => void act(job, 'retry')}
                    data-testid="job-retry"
                  >
                    Retry
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function UsersTab({ onError }: { onError: (msg: string | null) => void }) {
  const { data, reload } = useTabData<{ data: AdminUser[] }>(
    () => listAdminUsers({ limit: 50 }),
    onError,
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const toggle = async (user: AdminUser) => {
    setBusyId(user.id);
    setActionError(null);
    try {
      await updateAdminUser(user.id, {
        status: user.status === 'suspended' ? 'active' : 'suspended',
      });
      reload();
    } catch (err) {
      setActionError(message(err, 'Could not update that user.'));
    } finally {
      setBusyId(null);
    }
  };

  if (!data) return <Spinner className="mx-auto block size-6" />;

  return (
    <div className="space-y-3">
      {actionError && (
        <Alert tone="error" role="alert">
          {actionError}
        </Alert>
      )}
      <ul className="space-y-2">
        {data.data.map((user) => (
          <li
            key={user.id}
            className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 shadow-2"
            data-testid="admin-user-row"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{user.email}</span>
              <span className="block text-xs text-muted-foreground">
                joined {new Date(user.createdAt).toLocaleDateString()}
              </span>
            </span>
            <Badge
              tone={
                user.status === 'active'
                  ? 'success'
                  : user.status === 'suspended'
                    ? 'danger'
                    : 'muted'
              }
            >
              {user.status}
            </Badge>
            {(user.status === 'active' || user.status === 'suspended') && (
              <Button
                size="sm"
                variant={user.status === 'suspended' ? 'outline' : 'ghost'}
                loading={busyId === user.id}
                onClick={() => void toggle(user)}
                data-testid="user-toggle"
              >
                {user.status === 'suspended' ? 'Activate' : 'Suspend'}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function AuditTab({ onError }: { onError: (msg: string | null) => void }) {
  const { data } = useTabData<{ data: AuditEntry[] }>(
    () => listAdminAuditLogs({ limit: 50 }),
    onError,
  );

  if (!data) return <Spinner className="mx-auto block size-6" />;

  return (
    <ul className="space-y-2">
      {data.data.map((entry) => (
        <li
          key={entry.id}
          className="rounded-lg border border-border bg-surface px-4 py-3 shadow-2"
          data-testid="audit-row"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <code className="text-sm font-medium">{entry.action}</code>
            <span className="text-xs text-muted-foreground">
              {new Date(entry.createdAt).toLocaleString()}
            </span>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {entry.resource ?? '—'}
            {entry.resourceId ? ` · ${entry.resourceId}` : ''}
            {entry.ip ? ` · ${entry.ip}` : ''}
          </div>
        </li>
      ))}
      {data.data.length === 0 && (
        <li className="py-8 text-center text-sm text-muted-foreground">No audit entries yet.</li>
      )}
    </ul>
  );
}

function FlagsTab({ onError }: { onError: (msg: string | null) => void }) {
  const { data, reload } = useTabData<{ data: FeatureFlag[] }>(() => listAdminFlags(), onError);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const toggle = async (flag: FeatureFlag) => {
    setBusyKey(flag.key);
    setActionError(null);
    try {
      await updateAdminFlag(flag.key, { enabled: !flag.enabled });
      reload();
    } catch (err) {
      setActionError(message(err, 'Could not update that flag.'));
    } finally {
      setBusyKey(null);
    }
  };

  if (!data) return <Spinner className="mx-auto block size-6" />;

  return (
    <div className="space-y-3">
      {actionError && (
        <Alert tone="error" role="alert">
          {actionError}
        </Alert>
      )}
      <ul className="space-y-2">
        {data.data.map((flag) => (
          <li
            key={flag.key}
            className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 shadow-2"
            data-testid="flag-row"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{flag.key}</span>
              <span className="block text-xs text-muted-foreground">rollout {flag.rollout}%</span>
            </span>
            <Badge tone={flag.enabled ? 'success' : 'muted'}>{flag.enabled ? 'On' : 'Off'}</Badge>
            <Button
              size="sm"
              variant="outline"
              loading={busyKey === flag.key}
              onClick={() => void toggle(flag)}
              data-testid={`flag-toggle-${flag.key}`}
            >
              {flag.enabled ? 'Disable' : 'Enable'}
            </Button>
          </li>
        ))}
      </ul>
      {data.data.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">No feature flags yet.</p>
      )}
    </div>
  );
}
