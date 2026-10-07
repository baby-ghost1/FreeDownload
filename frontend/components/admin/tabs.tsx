'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  Ban,
  CheckCircle2,
  Clock3,
  Database,
  Download,
  Filter,
  Gauge,
  Globe,
  Inbox,
  KeyRound,
  ListChecks,
  MonitorSmartphone,
  Play,
  Receipt,
  ScrollText,
  ShieldAlert,
  Tag,
  UserCheck,
  UserRound,
  Users,
} from 'lucide-react';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { Spinner } from '@/components/ui/progress';
import { useToast } from '@/components/ui/toast';
import {
  approveUpgradeRequest,
  bulkDeleteAdminUsers,
  changeAdminPassword,
  createAdminCoupon,
  deleteAdminUser,
  getAdminOverview,
  listAdminCoupons,
  listAdminFlags,
  listAdminSessions,
  listAdminSettings,
  listAdminSources,
  listAdminUpgradeRequests,
  listAdminUsers,
  rejectUpgradeRequest,
  revokeAdminSession,
  setAdminUserPlan,
  updateAdminCoupon,
  updateAdminFlag,
  updateAdminSetting,
  updateAdminSource,
  updateAdminUser,
} from '@/lib/api/endpoints';
import type {
  AdminOverview,
  AdminSessionInfo,
  AdminSource,
  AdminUpgradeRequest,
  AdminUser,
  Coupon,
  FeatureFlag,
  SystemSetting,
} from '@/lib/api/types';

import { message, useAdminConsole, useTabData } from './shared';

const SOURCE_MODES = ['active', 'maintenance', 'restricted', 'disabled'] as const;

const PAGE_SIZE = 20;

type Paged<T> = { data: T[]; nextCursor: string | null };

/**
 * Cursor pagination - one page at a time inside a single card.
 * Keeps a stack of cursors so Prev works with keyset pagination.
 */
function useCursorPage<T>(
  fetchPage: (cursor?: string) => Promise<Paged<T>>,
  onError: (msg: string | null) => void,
  resetKey: string,
): {
  items: T[];
  page: number;
  hasNext: boolean;
  hasPrev: boolean;
  loading: boolean;
  paging: boolean;
  next: () => void;
  prev: () => void;
  reload: () => void;
} {
  const [items, setItems] = useState<T[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [paging, setPaging] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let live = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- page reset must show spinner + pagination stack
    setLoading(true);
    setCursors([undefined]);
    setPage(0);
    fetchPage(undefined)
      .then((r) => {
        if (!live) return;
        setItems(r.data);
        setNextCursor(r.nextCursor ?? null);
        onError(null);
      })
      .catch((err: unknown) => {
        if (live) onError(message(err, 'Could not load this panel.'));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resetKey + nonce drive refetch
  }, [resetKey, nonce]);

  const goTo = useCallback(
    async (target: number, cursor: string | undefined) => {
      setPaging(true);
      try {
        const r = await fetchPage(cursor);
        setItems(r.data);
        setNextCursor(r.nextCursor ?? null);
        setPage(target);
        setCursors((prev) => {
          const next = prev.slice(0, target + 1);
          next[target] = cursor;
          return next;
        });
        onError(null);
      } catch (err) {
        onError(message(err, 'Could not load this page.'));
      } finally {
        setPaging(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchPage identity changes per render
    [],
  );

  return {
    items,
    page,
    hasNext: nextCursor !== null,
    hasPrev: page > 0,
    loading,
    paging,
    next: () => {
      if (nextCursor) void goTo(page + 1, nextCursor);
    },
    prev: () => {
      if (page > 0) void goTo(page - 1, cursors[page - 1]);
    },
    reload: () => setNonce((n) => n + 1),
  };
}

function PaginationBar({
  page,
  hasPrev,
  hasNext,
  paging,
  onPrev,
  onNext,
  idPrefix,
}: {
  page: number;
  hasPrev: boolean;
  hasNext: boolean;
  paging: boolean;
  onPrev: () => void;
  onNext: () => void;
  idPrefix: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2 border-t border-border bg-muted/30 px-4 py-3">
      <Button
        size="sm"
        variant="outline"
        disabled={!hasPrev || paging}
        onClick={onPrev}
        data-testid={`${idPrefix}-prev`}
        className="rounded-xl"
      >
        ← Prev
      </Button>
      <span
        className="text-xs font-medium text-muted-foreground tabular-nums"
        data-testid={`${idPrefix}-page`}
      >
        Page {page + 1}
      </span>
      <Button
        size="sm"
        variant="outline"
        disabled={!hasNext || paging}
        loading={paging}
        onClick={onNext}
        data-testid={`${idPrefix}-next`}
        className="rounded-xl"
      >
        Next →
      </Button>
    </div>
  );
}

function SectionHeader({
  icon,
  title,
  sub,
  right,
}: {
  icon: React.ReactNode;
  title: string;
  sub?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-2xl border border-border bg-surface text-primary shadow-2">
          {icon}
        </span>
        <span>
          <span className="block text-[15px] font-semibold tracking-tight">{title}</span>
          {sub && <span className="block text-xs text-muted-foreground">{sub}</span>}
        </span>
      </div>
      {right}
    </div>
  );
}

function EmptyState({ icon, text }: { icon?: React.ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-surface/60 px-4 py-10 text-center">
      <span className="flex size-10 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        {icon ?? <Inbox className="size-5" />}
      </span>
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

function LoadingBlock() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12">
      <Spinner className="size-7" />
      <p className="text-xs text-muted-foreground">Loading…</p>
    </div>
  );
}

export function OverviewTab({ onError }: { onError: (msg: string | null) => void }) {
  const { data } = useTabData<AdminOverview>(() => getAdminOverview(), onError);

  if (!data) return <LoadingBlock />;

  const cards: Array<{
    label: string;
    value: number | string;
    testid: string;
    icon: React.ReactNode;
    tint: string;
  }> = [
    {
      label: 'Jobs (all time)',
      value: data.jobs.total,
      testid: 'admin-total-jobs',
      icon: <Database className="size-5" />,
      tint: 'from-primary/15 to-info/10 text-primary',
    },
    {
      label: 'Jobs (24h)',
      value: data.jobs.last24h,
      testid: 'admin-jobs-24h',
      icon: <Clock3 className="size-5" />,
      tint: 'from-info/15 to-primary/10 text-info',
    },
    {
      label: 'Sources enabled',
      value: `${data.sources.enabled}/${data.sources.total}`,
      testid: 'admin-enabled-sources',
      icon: <ListChecks className="size-5" />,
      tint: 'from-success/15 to-success/5 text-success',
    },
    {
      label: 'Active users',
      value: data.users.active,
      testid: 'admin-active-users',
      icon: <UserCheck className="size-5" />,
      tint: 'from-success/15 to-info/10 text-success',
    },
    {
      label: 'Suspended users',
      value: data.users.suspended,
      testid: 'admin-suspended-users',
      icon: <ShieldAlert className="size-5" />,
      tint: 'from-destructive/15 to-destructive/5 text-destructive',
    },
    {
      label: 'Audits (24h)',
      value: data.auditsLast24h,
      testid: 'admin-audits-24h',
      icon: <ScrollText className="size-5" />,
      tint: 'from-warning/15 to-warning/5 text-warning',
    },
  ];

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<Activity className="size-5" />}
        title="Platform pulse"
        sub="Live counts across jobs, sources, users and audits"
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {cards.map((c) => (
          <div
            key={c.label}
            data-testid={c.testid}
            className="group relative flex items-center gap-3 overflow-hidden rounded-2xl border border-border bg-surface p-4 shadow-2 transition-all duration-300 hover:-translate-y-1 hover:border-primary/30 hover:shadow-3"
          >
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -right-8 -top-8 size-24 rounded-full bg-primary/5 blur-2xl transition-opacity group-hover:bg-primary/10"
            />
            <span
              className={`flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${c.tint}`}
            >
              {c.icon}
            </span>
            <span className="relative min-w-0">
              <span className="block text-[26px] font-semibold leading-none tracking-tight">
                {c.value}
              </span>
              <span className="mt-1.5 block truncate text-xs font-medium text-muted-foreground">
                {c.label}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SourcesTab({ onError }: { onError: (msg: string | null) => void }) {
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

  const changeMode = async (source: AdminSource, mode: AdminSource['mode']) => {
    if (mode === source.mode) return;
    setBusyId(source.id);
    setActionError(null);
    try {
      await updateAdminSource(source.id, { mode });
      reload();
    } catch (err) {
      setActionError(message(err, 'Could not change source mode.'));
    } finally {
      setBusyId(null);
    }
  };

  if (!data) return <LoadingBlock />;

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<ListChecks className="size-5" />}
        title="Download sources"
        sub="Toggle availability or change policy mode - applies instantly"
        right={
          <Badge tone={data.data.some((s) => s.enabled) ? 'success' : 'muted'}>
            {data.data.filter((s) => s.enabled).length}/{data.data.length} enabled
          </Badge>
        }
      />
      {actionError && (
        <Alert tone="error" role="alert" className="rounded-2xl">
          {actionError}
        </Alert>
      )}
      <div className="space-y-2.5">
        {data.data.map((source) => (
          <div
            key={source.id}
            data-testid={`source-row-${source.slug}`}
            className="group flex flex-wrap items-center gap-4 rounded-2xl border border-border bg-surface p-4 shadow-2 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-3"
          >
            <span
              aria-hidden="true"
              className={`size-2.5 shrink-0 rounded-full ${source.enabled ? 'bg-success shadow-[0_0_12px_var(--color-success)]' : 'bg-muted-foreground/40'}`}
            />
            <div className="min-w-0 flex-1 basis-52">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold tracking-tight">{source.name}</span>
                <code className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                  {source.slug}
                </code>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Badge tone={source.enabled ? 'success' : 'muted'}>
                  {source.enabled ? 'Enabled' : 'Disabled'}
                </Badge>
                <Badge tone={source.mode === 'active' ? 'info' : 'warning'}>{source.mode}</Badge>
                <Badge tone="default">{source.healthStatus}</Badge>
                {source.requiresAuth && <Badge tone="warning">auth required</Badge>}
                {source.maxFileSizeMb != null && (
                  <Badge tone="muted">≤ {source.maxFileSizeMb} MB</Badge>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor={`mode-${source.slug}`}>
                Mode for {source.slug}
              </label>
              <select
                id={`mode-${source.slug}`}
                value={source.mode}
                disabled={busyId === source.id}
                onChange={(e) =>
                  void changeMode(source, e.target.value as AdminSource['mode'])
                }
                data-testid={`source-mode-${source.slug}`}
                className="h-10 rounded-xl border border-border bg-background px-2.5 text-[13px] font-medium shadow-1 transition-colors hover:border-border-strong focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-focus-ring disabled:opacity-50"
              >
                {SOURCE_MODES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                variant={source.enabled ? 'outline' : 'primary'}
                loading={busyId === source.id}
                onClick={() => void toggle(source)}
                data-testid={`source-toggle-${source.slug}`}
                className="rounded-xl px-4"
              >
                {source.enabled ? 'Disable' : 'Enable'}
              </Button>
            </div>
          </div>
        ))}
      </div>
      {data.data.length === 0 && <EmptyState text="No sources configured." />}
    </div>
  );
}

export function UsersTab({ onError }: { onError: (msg: string | null) => void }) {
  const { items, page, hasNext, hasPrev, loading, paging, next, prev, reload } =
    useCursorPage<AdminUser>(
      (cursor) => listAdminUsers({ limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) }),
      onError,
      'users',
    );
  const toast = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);
  const [deletePassword, setDeletePassword] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [multiMode, setMultiMode] = useState(false);

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

  const setPlan = async (user: AdminUser, planCode: 'free' | 'pro' | 'business') => {
    setBusyId(user.id);
    setActionError(null);
    try {
      await setAdminUserPlan(user.id, planCode);
      toast('Plan updated', 'success');
      reload();
    } catch (err) {
      setActionError(message(err, 'Could not change that plan.'));
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget || !deletePassword) return;
    setBusyId(deleteTarget.id);
    setActionError(null);
    try {
      await deleteAdminUser(deleteTarget.id, deletePassword);
      toast('User deleted', 'success');
      setDeleteTarget(null);
      setDeletePassword('');
      reload();
    } catch (err) {
      setActionError(message(err, 'Could not delete that user.'));
    } finally {
      setBusyId(null);
    }
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Page changes invalidate the selection (ids belong to the old page).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- selection reset on page navigation
    setSelected(new Set());
    setBulkOpen(false);
  }, [page]);

  const confirmBulkDelete = async () => {
    if (selected.size === 0 || !deletePassword) return;
    setBulkBusy(true);
    setActionError(null);
    try {
      const r = await bulkDeleteAdminUsers([...selected], deletePassword);
      toast(`Deleted ${r.deleted} of ${r.requested} users`, 'success');
      setSelected(new Set());
      setBulkOpen(false);
      setDeletePassword('');
      reload();
    } catch (err) {
      setActionError(message(err, 'Could not delete those users.'));
    } finally {
      setBulkBusy(false);
    }
  };

  if (loading) return <LoadingBlock />;

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<Users className="size-5" />}
        title="Users"
        sub="Suspend abuse, reactivate genuine accounts"
        right={
          <span className="flex items-center gap-2">
            <Button
              size="sm"
              variant={multiMode ? 'primary' : 'outline'}
              disabled={loading || items.length === 0}
              onClick={() => {
                if (multiMode) {
                  setMultiMode(false);
                  setSelected(new Set());
                  setBulkOpen(false);
                } else {
                  setMultiMode(true);
                  setSelected(new Set(items.map((u) => u.id)));
                }
              }}
              data-testid="users-multi-delete"
              className="rounded-full px-3 py-1 text-xs"
            >
              Delete Multiple
            </Button>
            <span
              className="rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-muted-foreground shadow-1"
              data-testid="users-count"
            >
              {loading ? '…' : `${items.length} on page ${page + 1}`}
            </span>
          </span>
        }
      />
      {actionError && (
        <Alert tone="error" role="alert" className="rounded-2xl">
          {actionError}
        </Alert>
      )}
      {selected.size > 0 && (
        <div
          className="flex flex-wrap items-center gap-2 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3"
          data-testid="users-bulk-bar"
        >
          <span className="text-sm font-medium">{selected.size} selected</span>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => {
              setBulkOpen(true);
              setDeletePassword('');
            }}
            data-testid="users-bulk-delete"
            className="ml-auto rounded-xl"
          >
            Delete selected
          </Button>
        </div>
      )}
      {bulkOpen && selected.size > 0 && (
        <div
          role="alertdialog"
          aria-label={`Delete ${selected.size} users`}
          className="flex flex-wrap items-center gap-2 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3.5"
          data-testid="users-bulk-confirm"
        >
          <p className="min-w-0 flex-1 text-sm">
            Delete <strong>{selected.size} users</strong> forever? Enter{' '}
            <strong>your admin password</strong> once to confirm.
          </p>
          <Input
            type="password"
            autoComplete="current-password"
            placeholder="Admin password"
            value={deletePassword}
            onChange={(e) => setDeletePassword(e.target.value)}
            data-testid="users-bulk-password"
            className="h-9 max-w-52 rounded-xl"
          />
          <Button
            size="sm"
            variant="destructive"
            loading={bulkBusy}
            disabled={!deletePassword}
            onClick={() => void confirmBulkDelete()}
            data-testid="users-bulk-confirm-btn"
            className="rounded-xl"
          >
            Confirm delete
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setBulkOpen(false);
              setDeletePassword('');
            }}
            className="rounded-xl"
          >
            Cancel
          </Button>
        </div>
      )}
      {items.length === 0 && !loading ? (
        <EmptyState text="No users yet." />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-2">
          <ul className="divide-y divide-border">
          {items.map((user) => (
            <li
              key={user.id}
              data-testid="admin-user-row"
              onClick={() => {
                if (multiMode) toggleSelect(user.id);
              }}
              className={
                'flex flex-wrap items-center gap-3 px-4 py-3.5 transition-colors hover:bg-muted/40 ' +
                (multiMode ? 'cursor-pointer' : '') +
                (multiMode && selected.has(user.id)
                  ? ' bg-destructive/5 ring-1 ring-inset ring-destructive/30'
                  : '')
              }
              >
              <span
                className={`flex size-10 shrink-0 items-center justify-center rounded-xl font-semibold ${
                  user.status === 'suspended'
                    ? 'bg-destructive/10 text-destructive'
                    : 'bg-gradient-to-br from-primary/15 to-info/10 text-primary'
                }`}
              >
                {user.email.slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{user.email}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  joined {new Date(user.createdAt).toLocaleDateString()}
                  {user.lastLoginAt
                    ? ` · last login ${new Date(user.lastLoginAt).toLocaleDateString()}`
                    : ' · never logged in'}
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
                  variant={user.status === 'suspended' ? 'primary' : 'ghost'}
                  loading={busyId === user.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    void toggle(user);
                  }}
                  data-testid="user-toggle"
                  className="rounded-xl"
                >
                  {user.status === 'suspended' ? (
                    <>
                      <CheckCircle2 className="size-3.5" /> Activate
                    </>
                  ) : (
                    <>
                      <Ban className="size-3.5" /> Suspend
                    </>
                  )}
                </Button>
              )}
              <label className="sr-only" htmlFor={`plan-${user.id}`}>
                Plan for {user.email}
              </label>
              <select
                id={`plan-${user.id}`}
                defaultValue=""
                disabled={busyId === user.id}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  const v = e.target.value as 'free' | 'pro' | 'business';
                  e.target.value = '';
                  if (v) void setPlan(user, v);
                }}
                data-testid="user-plan"
                title="Set plan (no payment)"
                className="h-9 rounded-xl border border-border bg-background px-2 text-xs font-medium"
              >
                <option value="">Set plan…</option>
                <option value="free">Free</option>
                <option value="pro">Pro</option>
                <option value="business">Business</option>
              </select>
              <Button
                size="sm"
                variant="ghost"
                loading={busyId === user.id}
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteTarget(user);
                  setDeletePassword('');
                }}
                data-testid="user-delete"
                className="rounded-xl text-destructive hover:text-destructive"
              >
                Delete
              </Button>
            </li>
          ))}
          </ul>
          {deleteTarget && (
            <div
              role="alertdialog"
              aria-label={`Delete ${deleteTarget.email}`}
              className="flex flex-wrap items-center gap-2 border-t border-border bg-destructive/5 px-4 py-3.5"
              data-testid="user-delete-confirm"
            >
              <p className="min-w-0 flex-1 text-sm">
                Delete <strong>{deleteTarget.email}</strong> forever? Enter{' '}
                <strong>your admin password</strong> to confirm.
              </p>
              <Input
                type="password"
                autoComplete="current-password"
                placeholder="Admin password"
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
                data-testid="user-delete-password"
                className="h-9 max-w-52 rounded-xl"
              />
              <Button
                size="sm"
                variant="destructive"
                loading={busyId === deleteTarget.id}
                disabled={!deletePassword}
                onClick={() => void confirmDelete()}
                data-testid="user-delete-confirm-btn"
                className="rounded-xl"
              >
                Confirm delete
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setDeleteTarget(null);
                  setDeletePassword('');
                }}
                className="rounded-xl"
              >
                Cancel
              </Button>
            </div>
          )}
          <PaginationBar
            page={page}
            hasPrev={hasPrev}
            hasNext={hasNext}
            paging={paging}
            onPrev={prev}
            onNext={next}
            idPrefix="users"
          />
        </div>
      )}
    </div>
  );
}

export function FlagsTab({ onError }: { onError: (msg: string | null) => void }) {
  const { data, reload } = useTabData<{ data: FeatureFlag[] }>(() => listAdminFlags(), onError);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [rolloutBusyKey, setRolloutBusyKey] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
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

  const saveRollout = async (flag: FeatureFlag) => {
    const raw = (drafts[flag.key] ?? String(flag.rollout)).trim();
    if (!/^\d+$/.test(raw) || Number(raw) < 0 || Number(raw) > 100) {
      setActionError(`Rollout for ${flag.key} must be a whole number 0-100.`);
      return;
    }
    setRolloutBusyKey(flag.key);
    setActionError(null);
    try {
      await updateAdminFlag(flag.key, { rollout: Number(raw) });
      reload();
    } catch (err) {
      setActionError(message(err, 'Could not save rollout.'));
    } finally {
      setRolloutBusyKey(null);
    }
  };

  if (!data) return <LoadingBlock />;

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<Filter className="size-5" />}
        title="Feature flags"
        sub="Kill-switches and gradual rollouts"
        right={<Badge tone="info">{data.data.filter((f) => f.enabled).length}/{data.data.length} on</Badge>}
      />
      {actionError && (
        <Alert tone="error" role="alert" className="rounded-2xl">
          {actionError}
        </Alert>
      )}
      {data.data.length === 0 ? (
        <EmptyState text="No feature flags yet." />
      ) : (
        <ul className="space-y-2.5">
          {data.data.map((flag) => (
            <li
              key={flag.key}
              data-testid="flag-row"
              className="rounded-2xl border border-border bg-surface p-4 shadow-2 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-3"
            >
              <div className="flex flex-wrap items-center gap-3">
                <span
                  aria-hidden="true"
                  className={`size-2.5 rounded-full ${flag.enabled ? 'bg-success shadow-[0_0_12px_var(--color-success)]' : 'bg-muted-foreground/30'}`}
                />
                <span className="min-w-0 flex-1 basis-40">
                  <span className="block truncate font-mono text-sm font-semibold">{flag.key}</span>
                  <span className="mt-0.5 block h-1.5 w-32 overflow-hidden rounded-full bg-muted">
                    <span
                      className="block h-full rounded-full bg-gradient-to-r from-primary to-info"
                      style={{ width: `${flag.rollout}%` }}
                    />
                  </span>
                </span>
                <Badge tone={flag.enabled ? 'success' : 'muted'}>
                  {flag.enabled ? 'On' : 'Off'}
                </Badge>
                <Button
                  size="sm"
                  variant="outline"
                  loading={busyKey === flag.key}
                  onClick={() => void toggle(flag)}
                  data-testid={`flag-toggle-${flag.key}`}
                  className="rounded-xl"
                >
                  {flag.enabled ? 'Disable' : 'Enable'}
                </Button>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
                <Label htmlFor={`rollout-${flag.key}`} className="mb-0 text-xs text-muted-foreground">
                  Rollout %
                </Label>
                <Input
                  id={`rollout-${flag.key}`}
                  inputMode="numeric"
                  value={drafts[flag.key] ?? String(flag.rollout)}
                  onChange={(e) => setDrafts((d) => ({ ...d, [flag.key]: e.target.value }))}
                  data-testid={`flag-rollout-${flag.key}`}
                  className="h-9 w-20 rounded-xl px-2 text-center font-semibold tabular-nums"
                />
                <Button
                  size="sm"
                  variant="ghost"
                  loading={rolloutBusyKey === flag.key}
                  onClick={() => void saveRollout(flag)}
                  data-testid={`flag-rollout-save-${flag.key}`}
                  className="rounded-xl"
                >
                  Save
                </Button>
                <span className="ml-auto text-[11px] text-muted-foreground">
                  0 = everyone when on · 100 = full rollout
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const ANON_LIMIT_KEY = 'anon_daily_limit';

export function LimitsTab({ onError }: { onError: (msg: string | null) => void }) {
  const { data, reload } = useTabData<{ data: SystemSetting[] }>(
    () => listAdminSettings(),
    onError,
  );
  const toast = useToast();
  const [unlimited, setUnlimited] = useState(true);
  const [amount, setAmount] = useState('25');
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    const raw = data.data.find((s) => s.key === ANON_LIMIT_KEY)?.value;
    const current = typeof raw === 'number' && raw > 0 ? Math.floor(raw) : 0;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- form drafts mirror the loaded setting
    setUnlimited(current === 0);
    setAmount(current === 0 ? '25' : String(current));
  }, [data]);

  if (!data) return <LoadingBlock />;

  const stored = data.data.find((s) => s.key === ANON_LIMIT_KEY)?.value;
  const storedNum = typeof stored === 'number' && stored > 0 ? Math.floor(stored) : 0;

  const save = async () => {
    setActionError(null);
    let value = 0;
    if (!unlimited) {
      if (!/^\d+$/.test(amount.trim()) || Number(amount) < 1 || Number(amount) > 100000) {
        setActionError('Enter a whole number between 1 and 100000, or switch on Unlimited.');
        return;
      }
      value = Number(amount);
    }
    setSaving(true);
    try {
      await updateAdminSetting(ANON_LIMIT_KEY, value);
      toast(
        value === 0
          ? 'Anonymous daily cap removed - downloads are unlimited'
          : `Anonymous cap set to ${value} downloads per day`,
        'success',
      );
      reload();
    } catch (err) {
      setActionError(message(err, 'Could not save that limit.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<Gauge className="size-5" />}
        title="Limits & quotas"
        sub="Guard abuse without hurting genuine users"
      />
      {actionError && (
        <Alert tone="error" role="alert" className="rounded-2xl">
          {actionError}
        </Alert>
      )}
      <Card className="overflow-hidden rounded-2xl">
        <div
          aria-hidden="true"
          className="h-1.5 bg-gradient-to-r from-primary via-info to-primary bg-[length:220%_100%] animate-gradient-pan"
        />
        <CardHeader className="flex flex-row items-center gap-2.5">
          <span className="flex size-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Download className="size-5" />
          </span>
          <div>
            <CardTitle>Anonymous downloads</CardTitle>
            <p className="text-xs text-muted-foreground">Daily cap for signed-out traffic</p>
          </div>
          <Badge
            tone={storedNum === 0 ? 'muted' : 'info'}
            data-testid="limits-current"
            className="ml-auto px-3 py-1 text-[13px]"
          >
            {storedNum === 0 ? 'Unlimited' : `${storedNum} / day`}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-border bg-background p-3.5 text-sm font-medium transition-colors hover:border-primary/30">
            <input
              type="checkbox"
              checked={unlimited}
              onChange={(e) => setUnlimited(e.target.checked)}
              data-testid="limits-anon-unlimited"
              className="size-5 accent-primary"
            />
            <span>
              Unlimited
              <span className="block text-xs font-normal text-muted-foreground">
                No daily cap for signed-out users
              </span>
            </span>
            <span
              className={`ml-auto size-2.5 rounded-full ${unlimited ? 'bg-success' : 'bg-muted-foreground/30'}`}
            />
          </label>

          <div>
            <Label htmlFor="limits-anon-input">Downloads per day</Label>
            <div className="mt-1.5 flex flex-wrap items-center gap-2.5">
              <Input
                id="limits-anon-input"
                inputMode="numeric"
                placeholder="25"
                value={amount}
                disabled={unlimited}
                onChange={(e) => setAmount(e.target.value)}
                data-testid="limits-anon-input"
                className="h-11 max-w-44 rounded-xl text-center text-lg font-semibold tabular-nums disabled:opacity-40"
              />
              <Button
                size="sm"
                loading={saving}
                onClick={() => void save()}
                data-testid="limits-save"
                className="h-11 rounded-xl bg-gradient-to-r from-primary to-info px-6 font-semibold text-white shadow-[0_8px_20px_-8px_var(--color-primary)] hover:brightness-110"
              >
                <Play className="size-3.5" />
                Save limit
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Signed-in plans keep their own limits. Changes apply within about 30 seconds.
            </p>
          </div>

          {data.data.length > 1 && (
            <details className="rounded-2xl border border-border bg-background p-3.5 text-xs">
              <summary className="cursor-pointer font-semibold">
                All settings ({data.data.length})
              </summary>
              <ul className="mt-2.5 space-y-1.5 text-muted-foreground">
                {data.data.map((s) => (
                  <li
                    key={s.key}
                    className="flex items-center justify-between gap-2 rounded-lg bg-muted/50 px-2.5 py-1.5"
                  >
                    <code className="font-mono">{s.key}</code>
                    <span className="max-w-48 truncate font-medium">{JSON.stringify(s.value)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

const NAVBAR_SETTING_KEY = 'navbar_config';

type NavbarLinks = { home: boolean; download: boolean; downloads: boolean; auth: boolean };

const DEFAULT_NAVBAR_LINKS: NavbarLinks = {
  home: true,
  download: true,
  downloads: true,
  auth: true,
};

const NAVBAR_LINK_META: Array<{ key: keyof NavbarLinks; label: string; hint: string }> = [
  { key: 'home', label: 'Home', hint: 'Landing link + logo shortcut' },
  { key: 'download', label: 'Download', hint: 'Paste-a-link page' },
  { key: 'downloads', label: 'My downloads', hint: 'History + queue page' },
  { key: 'auth', label: 'Sign in / Account', hint: 'Auth button or avatar' },
];

function normalizeNavbarLinks(raw: unknown): NavbarLinks {
  const record =
    typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const links =
    typeof record.links === 'object' && record.links !== null
      ? (record.links as Record<string, unknown>)
      : {};
  const pick = (v: unknown) => (typeof v === 'boolean' ? v : true);
  return {
    home: pick(links.home),
    download: pick(links.download),
    downloads: pick(links.downloads),
    auth: pick(links.auth),
  };
}

export function SiteTab({ onError }: { onError: (msg: string | null) => void }) {
  const { data, reload } = useTabData<{ data: SystemSetting[] }>(
    () => listAdminSettings(),
    onError,
  );
  const toast = useToast();
  const [visible, setVisible] = useState(true);
  const [links, setLinks] = useState<NavbarLinks>(DEFAULT_NAVBAR_LINKS);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    const raw = data.data.find((s) => s.key === NAVBAR_SETTING_KEY)?.value;
    const record =
      typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
    // eslint-disable-next-line react-hooks/set-state-in-effect -- form drafts mirror the loaded setting
    setVisible(typeof record.visible === 'boolean' ? record.visible : true);
    setLinks(normalizeNavbarLinks(raw));
  }, [data]);

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-12">
        <Spinner className="size-7" />
        <p className="text-xs text-muted-foreground">Loading…</p>
      </div>
    );
  }

  const save = async () => {
    setActionError(null);
    setSaving(true);
    try {
      await updateAdminSetting(NAVBAR_SETTING_KEY, { visible, links });
      toast('Navbar visibility updated - live within about a minute', 'success');
      reload();
    } catch (err) {
      setActionError(message(err, 'Could not save navbar settings.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<Globe className="size-5" />}
        title="Site chrome"
        sub="Floating navbar visibility for visitors"
        right={
          <Badge tone={visible ? 'success' : 'muted'} data-testid="site-navbar-state">
            {visible ? 'Visible' : 'Hidden'}
          </Badge>
        }
      />
      {actionError && (
        <Alert tone="error" role="alert" className="rounded-2xl">
          {actionError}
        </Alert>
      )}
      <Card className="overflow-hidden rounded-2xl">
        <div
          aria-hidden="true"
          className="h-1.5 bg-gradient-to-r from-primary via-info to-primary bg-[length:220%_100%] animate-gradient-pan"
        />
        <CardHeader>
          <CardTitle>Floating navbar</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-border bg-background p-3.5 text-sm font-medium transition-colors hover:border-primary/30">
            <input
              type="checkbox"
              checked={visible}
              onChange={(e) => setVisible(e.target.checked)}
              data-testid="site-navbar-visible"
              className="size-5 accent-primary"
            />
            <span>
              Show navbar
              <span className="block text-xs font-normal text-muted-foreground">
                Off hides the pill on every public page
              </span>
            </span>
            <span
              className={`ml-auto size-2.5 rounded-full ${visible ? 'bg-success' : 'bg-muted-foreground/30'}`}
            />
          </label>

          <div className={visible ? '' : 'pointer-events-none opacity-40'}>
            <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Visible items
            </p>
            <ul className="space-y-2">
              {NAVBAR_LINK_META.map((item) => (
                <li key={item.key}>
                  <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-border bg-background p-3 text-sm transition-colors hover:border-primary/30">
                    <input
                      type="checkbox"
                      checked={links[item.key]}
                      onChange={(e) => setLinks((l) => ({ ...l, [item.key]: e.target.checked }))}
                      data-testid={`site-navbar-link-${item.key}`}
                      className="size-4 accent-primary"
                    />
                    <span>
                      {item.label}
                      <span className="block text-xs font-normal text-muted-foreground">
                        {item.hint}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>

          <Button
            size="sm"
            loading={saving}
            onClick={() => void save()}
            data-testid="site-navbar-save"
            className="h-11 rounded-xl bg-gradient-to-r from-primary to-info px-6 font-semibold text-white shadow-[0_8px_20px_-8px_var(--color-primary)] hover:brightness-110"
          >
            Save navbar
          </Button>
          <p className="text-xs text-muted-foreground">
            Served through public config (cached ~60s) - visitors pick it up within about a
            minute, no deploy.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function money(cents: number, currency: string): string {
  return currency.toLowerCase() === 'inr'
    ? `₹${(cents / 100).toLocaleString('en-IN', { maximumFractionDigits: cents % 100 === 0 ? 0 : 2 })}`
    : `${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)} ${currency.toUpperCase()}`;
}

export function BillingTab({ onError }: { onError: (msg: string | null) => void }) {
  const [filter, setFilter] = useState<'pending' | 'all'>('pending');
  const { data, reload } = useTabData<{ data: AdminUpgradeRequest[] }>(
    () => listAdminUpgradeRequests(filter === 'pending' ? 'pending' : undefined),
    onError,
    [filter],
  );
  const { data: couponData, reload: reloadCoupons } = useTabData<{ data: Coupon[] }>(
    () => listAdminCoupons(),
    onError,
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [percentOff, setPercentOff] = useState('20');
  const [maxUses, setMaxUses] = useState('');
  const [creating, setCreating] = useState(false);

  const decide = async (id: string, approve: boolean) => {
    setBusyId(id);
    setActionError(null);
    try {
      if (approve) await approveUpgradeRequest(id);
      else await rejectUpgradeRequest(id);
      reload();
    } catch (err) {
      setActionError(message(err, 'Could not decide that request.'));
    } finally {
      setBusyId(null);
    }
  };

  const toggleCoupon = async (c: Coupon) => {
    setBusyId(c.id);
    setActionError(null);
    try {
      await updateAdminCoupon(c.code, { active: !c.active });
      reloadCoupons();
    } catch (err) {
      setActionError(message(err, 'Could not update that coupon.'));
    } finally {
      setBusyId(null);
    }
  };

  const createCoupon = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setActionError(null);
    try {
      await createAdminCoupon({
        code,
        percentOff: Number(percentOff),
        ...(maxUses.trim() ? { maxUses: Number(maxUses) } : {}),
      });
      setCode('');
      setPercentOff('20');
      setMaxUses('');
      reloadCoupons();
    } catch (err) {
      setActionError(message(err, 'Could not create that coupon.'));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<Receipt className="size-5" />}
        title="Manual billing"
        sub="Verify UPI payments, mint coupons, manage plans"
        right={
          <Badge tone="info" data-testid="billing-pending-count">
            {data?.data.filter((r) => r.status === 'pending').length ?? 0} pending
          </Badge>
        }
      />
      {actionError && (
        <Alert tone="error" role="alert" className="rounded-2xl">
          {actionError}
        </Alert>
      )}

      <Card className="overflow-hidden rounded-2xl">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Upgrade requests</CardTitle>
            <div className="flex gap-1.5">
              {(['pending', 'all'] as const).map((f) => (
                <Button
                  key={f}
                  size="sm"
                  variant={filter === f ? 'primary' : 'ghost'}
                  onClick={() => setFilter(f)}
                  data-testid={`billing-filter-${f}`}
                  className="rounded-xl capitalize"
                >
                  {f}
                </Button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {!data ? (
            <Spinner className="mx-auto block size-6" />
          ) : data.data.length === 0 ? (
            <EmptyState text="No upgrade requests." />
          ) : (
            <ul className="space-y-2">
              {data.data.map((r) => (
                <li
                  key={r.id}
                  data-testid="billing-request-row"
                  className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-background px-4 py-3"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      {r.userEmail ?? r.userId.slice(0, 8)}
                      <span className="ml-2 font-normal capitalize text-muted-foreground">
                        {r.planCode}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {money(r.amountCents, r.currency)}
                      {r.couponCode ? ` · ${r.couponCode}` : ''} ·{' '}
                      {new Date(r.createdAt).toLocaleString()}
                    </span>
                  </span>
                  <Badge
                    tone={
                      r.status === 'approved'
                        ? 'success'
                        : r.status === 'pending'
                          ? 'warning'
                          : 'muted'
                    }
                  >
                    {r.status}
                  </Badge>
                  {r.status === 'pending' && (
                    <span className="flex gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        loading={busyId === r.id}
                        onClick={() => void decide(r.id, false)}
                        data-testid="billing-request-reject"
                        className="rounded-xl"
                      >
                        Reject
                      </Button>
                      <Button
                        size="sm"
                        variant="primary"
                        loading={busyId === r.id}
                        onClick={() => void decide(r.id, true)}
                        data-testid="billing-request-approve"
                        className="rounded-xl"
                      >
                        Approve
                      </Button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="overflow-hidden rounded-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Tag className="size-4 text-muted-foreground" aria-hidden="true" />
            Coupons
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <form onSubmit={(e) => void createCoupon(e)} className="flex flex-wrap items-end gap-2">
            <div>
              <Label htmlFor="coupon-code">Code</Label>
              <Input
                id="coupon-code"
                placeholder="LAUNCH20"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                data-testid="coupon-code"
                className="mt-1.5 h-10 w-36 rounded-xl uppercase"
              />
            </div>
            <div>
              <Label htmlFor="coupon-off">% off</Label>
              <Input
                id="coupon-off"
                inputMode="numeric"
                value={percentOff}
                onChange={(e) => setPercentOff(e.target.value)}
                data-testid="coupon-off"
                className="mt-1.5 h-10 w-20 rounded-xl text-center"
              />
            </div>
            <div>
              <Label htmlFor="coupon-uses">Max uses</Label>
              <Input
                id="coupon-uses"
                inputMode="numeric"
                placeholder="∞"
                value={maxUses}
                onChange={(e) => setMaxUses(e.target.value)}
                data-testid="coupon-uses"
                className="mt-1.5 h-10 w-24 rounded-xl text-center"
              />
            </div>
            <Button
              size="sm"
              type="submit"
              loading={creating}
              data-testid="coupon-create"
              className="h-10 rounded-xl"
            >
              Generate
            </Button>
          </form>
          {!couponData ? (
            <Spinner className="mx-auto block size-6" />
          ) : couponData.data.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No coupons yet.</p>
          ) : (
            <ul className="space-y-2">
              {couponData.data.map((c) => (
                <li
                  key={c.id}
                  data-testid="coupon-row"
                  className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm"
                >
                  <code className="font-mono font-semibold">{c.code}</code>
                  <span className="text-muted-foreground">{c.percentOff}% off</span>
                  <span className="text-xs text-muted-foreground">
                    {c.usedCount}
                    {c.maxUses != null ? `/${c.maxUses}` : ''} used
                  </span>
                  <Badge tone={c.active ? 'success' : 'muted'}>{c.active ? 'On' : 'Off'}</Badge>
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={busyId === c.id}
                    onClick={() => void toggleCoupon(c)}
                    data-testid="coupon-toggle"
                    className="ml-auto rounded-xl"
                  >
                    {c.active ? 'Disable' : 'Enable'}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function SessionsTab({ onError }: { onError: (msg: string | null) => void }) {
  const { data, reload } = useTabData<{ data: AdminSessionInfo[] }>(
    () => listAdminSessions(),
    onError,
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const revoke = async (id: string) => {
    setBusyId(id);
    setActionError(null);
    try {
      await revokeAdminSession(id);
      reload();
    } catch (err) {
      setActionError(message(err, 'Could not sign out that device.'));
    } finally {
      setBusyId(null);
    }
  };

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-12">
        <Spinner className="size-7" />
        <p className="text-xs text-muted-foreground">Loading…</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<MonitorSmartphone className="size-5" />}
        title="Signed-in devices"
        sub="At most 50 live sessions - oldest beyond that are signed out automatically"
        right={
          <Badge tone="info" data-testid="sessions-count">
            {data.data.length} / 50
          </Badge>
        }
      />
      {actionError && (
        <Alert tone="error" role="alert" className="rounded-2xl">
          {actionError}
        </Alert>
      )}
      {data.data.length === 0 ? (
        <EmptyState text="No other sessions." />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-2">
          <ul className="divide-y divide-border">
            {data.data.map((s) => (
              <li
                key={s.id}
                data-testid="session-row"
                className="flex flex-wrap items-center gap-3 px-4 py-3.5 transition-colors hover:bg-muted/40"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/15 to-info/10 text-primary">
                  <MonitorSmartphone className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {s.userAgent ?? 'Unknown device'}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {s.ip ?? '-'} · last seen {new Date(s.lastSeenAt).toLocaleString()}
                  </span>
                </span>
                {s.current ? (
                  <Badge tone="success">This device</Badge>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={busyId === s.id}
                    onClick={() => void revoke(s.id)}
                    data-testid="session-revoke"
                    className="rounded-xl"
                  >
                    Sign out
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function ProfileTab({ onError }: { onError: (msg: string | null) => void }) {
  const { admin } = useAdminConsole();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSaved(false);
    if (next !== confirm) {
      setFormError('The new passwords do not match.');
      return;
    }
    if (next.length < 8) {
      setFormError('The new password must be at least 8 characters long.');
      return;
    }
    setSaving(true);
    try {
      await changeAdminPassword({ currentPassword: current, newPassword: next });
      setCurrent('');
      setNext('');
      setConfirm('');
      setSaved(true);
      onError(null);
      toast('Password changed - other devices were signed out', 'success');
    } catch (err) {
      setFormError(message(err, 'Could not change the password.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<UserRound className="size-5" />}
        title="Admin profile"
        sub="Your own account - sessions live here until you sign out, up to 30 days"
      />
      <Card className="overflow-hidden rounded-2xl">
        <div
          aria-hidden="true"
          className="h-1.5 bg-gradient-to-r from-primary via-info to-primary bg-[length:220%_100%] animate-gradient-pan"
        />
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p data-testid="profile-email">
            <span className="text-muted-foreground">Email: </span>
            <span className="font-medium">{admin?.email ?? '-'}</span>
          </p>
          <p>
            <span className="text-muted-foreground">Role: </span>
            <Badge tone="info">{admin?.role ?? '-'}</Badge>
          </p>
        </CardContent>
      </Card>

      <Card className="overflow-hidden rounded-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-4 text-muted-foreground" aria-hidden="true" />
            Change password
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void save(e)} className="space-y-4" data-testid="profile-form">
            <div>
              <Label htmlFor="profile-current">Current password</Label>
              <Input
                id="profile-current"
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                data-testid="profile-current"
                className="mt-1.5 h-11 rounded-xl"
              />
            </div>
            <div>
              <Label htmlFor="profile-new">New password</Label>
              <Input
                id="profile-new"
                type="password"
                autoComplete="new-password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                data-testid="profile-new"
                className="mt-1.5 h-11 rounded-xl"
              />
            </div>
            <div>
              <Label htmlFor="profile-confirm">Confirm new password</Label>
              <Input
                id="profile-confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                data-testid="profile-confirm"
                className="mt-1.5 h-11 rounded-xl"
              />
            </div>
            {formError && <Alert tone="error">{formError}</Alert>}
            {saved && <Alert tone="success">Password changed.</Alert>}
            <Button
              type="submit"
              size="sm"
              loading={saving}
              data-testid="profile-save"
              className="h-11 rounded-xl px-6 font-semibold"
            >
              Save password
            </Button>
            <p className="text-xs text-muted-foreground">
              Every other signed-in device is signed out - this one keeps working.
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
