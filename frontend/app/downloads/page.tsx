'use client';

import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Download, ListX, RotateCw, Search, SearchX } from 'lucide-react';

import { Alert } from '@/components/ui/alert';
import { BackButton } from '@/components/back-button';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button, buttonClasses } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/progress';
import { Enter } from '@/components/motion/reveal';
import { SoftBackdrop } from '@/components/soft-backdrop';
import { ApiError } from '@/lib/api/client';
import { listJobs } from '@/lib/api/endpoints';
import type { Job } from '@/lib/api/types';
import { isTerminalStatus, stageLabel, timeAgo } from '@/lib/format';
import { detectPlatform } from '@/lib/platform';
import { cn } from '@/lib/utils/cn';

const TONE: Record<string, BadgeTone> = {
  completed: 'success',
  failed: 'danger',
  dead_letter: 'danger',
  policy_restricted: 'danger',
  cancelled: 'muted',
  expired: 'muted',
  retrying: 'warning',
};

type Filter = 'all' | 'active' | 'ready' | 'failed';

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'In progress' },
  { id: 'ready', label: 'Ready' },
  { id: 'failed', label: 'Failed' },
];

function matches(job: Job, filter: Filter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'active':
      return !isTerminalStatus(job.status);
    case 'ready':
      return job.status === 'completed';
    case 'failed':
      return ['failed', 'dead_letter', 'policy_restricted'].includes(job.status);
  }
}

const PAGE_SIZE = 50;
const POLL_MS = 5000;

export default function MyDownloadsPage() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // mode: 'show' = first page with spinner state, 'quiet' = background
  // refresh that never flashes loading or error states, 'more' = append.
  const fetchJobs = useCallback(
    async (mode: 'show' | 'quiet' | 'more' = 'show') => {
      if (mode === 'show') setRefreshing(true);
      if (mode === 'more') setLoadingMore(true);
      try {
        const limit = mode === 'quiet' && jobs ? Math.max(PAGE_SIZE, jobs.length) : PAGE_SIZE;
        const cursor = mode === 'more' ? (nextCursor ?? undefined) : undefined;
        const r = await listJobs(limit, cursor);
        if (mode === 'more') {
          setJobs((prev) => [...(prev ?? []), ...r.data]);
        } else {
          setJobs(r.data);
        }
        setNextCursor(r.nextCursor ?? null);
        setError(null);
      } catch (err: unknown) {
        if (mode !== 'quiet') {
          setError(err instanceof ApiError ? err.message : 'Could not load your downloads.');
        }
      } finally {
        setRefreshing(false);
        setLoadingMore(false);
      }
    },
    [jobs, nextCursor],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-time load; all setState happens after the fetch settles
    void fetchJobs('show');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-time load only
  }, []);

  // Active jobs move on the worker - re-check quietly while any is unfinished.
  useEffect(() => {
    if (!jobs || !jobs.some((j) => !isTerminalStatus(j.status))) return;
    const tick = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      void fetchJobs('quiet');
    };
    const t = window.setInterval(tick, POLL_MS);
    const onFocus = () => void fetchJobs('quiet');
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(t);
      window.removeEventListener('focus', onFocus);
    };
  }, [jobs, fetchJobs]);

  const counts = useMemo(() => {
    const all = jobs ?? [];
    return {
      all: all.length,
      active: all.filter((j) => matches(j, 'active')).length,
      ready: all.filter((j) => matches(j, 'ready')).length,
      failed: all.filter((j) => matches(j, 'failed')).length,
    };
  }, [jobs]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (jobs ?? []).filter(
      (j) => matches(j, filter) && (!q || (j.url ?? '').toLowerCase().includes(q)),
    );
  }, [jobs, filter, query]);

  const hasFilters = query.trim() !== '' || filter !== 'all';

  return (
    <div className="relative mx-auto w-full max-w-2xl px-4 pb-10 pt-10 sm:px-6 sm:pt-12">
      <SoftBackdrop tone="info" />

      <div className="relative mb-5">
        <BackButton href="/" label="Back to home" />
      </div>

      <Enter className="relative">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">My downloads</h1>
            <p className="mt-1 text-sm text-muted-foreground" aria-live="polite">
              {jobs === null
                ? 'Every link you have queued - newest first.'
                : `${counts.all} shown · ${counts.active} in progress · ${counts.ready} ready`}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => void fetchJobs('show')}
              disabled={refreshing || jobs === null}
              title="Refresh list"
              aria-label="Refresh downloads list"
              className="flex size-9 items-center justify-center rounded-md border border-border bg-surface text-muted-foreground transition-all duration-200 hover:text-foreground active:scale-90 disabled:opacity-40"
            >
              <RotateCw
                className={cn('size-4', refreshing && 'animate-spin')}
                aria-hidden="true"
              />
            </button>
            <Link
              href="/download"
              className={cn(buttonClasses({ size: 'sm' }), 'btn-shine')}
            >
              New download
            </Link>
          </div>
        </div>
      </Enter>

      {error && (
        <Alert tone="error" className="mt-5">
          {error}
        </Alert>
      )}

      {jobs === null && !error && (
        <div className="mt-6 space-y-3" aria-label="Loading downloads">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="shimmer-line h-16 w-full rounded-xl border border-border bg-surface"
            />
          ))}
          <div className="flex justify-center py-4">
            <Spinner className="size-6" />
          </div>
        </div>
      )}

      {jobs?.length === 0 && (
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="mt-6 overflow-hidden">
            <div
              aria-hidden="true"
              className="h-1 bg-gradient-to-r from-primary to-info bg-[length:220%_100%] animate-gradient-pan"
            />
            <CardContent className="py-12 text-center">
              <motion.div
                animate={{ y: [0, -6, 0] }}
                transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
              >
                <Download
                  className="mx-auto size-8 text-muted-foreground"
                  aria-hidden="true"
                />
              </motion.div>
              <p className="mt-3 text-sm text-muted-foreground">
                No downloads yet - paste a link to get started.
              </p>
              <Link
                href="/download"
                className={cn(buttonClasses({}), 'btn-shine mt-5 inline-flex')}
              >
                Start a download
              </Link>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {jobs && jobs.length > 0 && (
        <div className="relative mt-6 space-y-4">
          {/* Search + filters */}
          <Enter delay={0.05} className="space-y-3">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                aria-label="Search downloads"
                placeholder="Search by link…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-11 bg-surface pl-10 transition-all focus:border-primary/60 focus:shadow-[0_0_0_4px_color-mix(in_oklch,var(--primary)_12%,transparent)]"
              />
            </div>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by status">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilter(f.id)}
                  aria-pressed={filter === f.id}
                  className={cn(
                    'relative min-h-11 rounded-full px-3.5 py-1.5 text-xs font-medium transition-all duration-200 active:scale-95',
                    filter === f.id
                      ? 'text-primary-foreground'
                      : 'border border-border bg-surface text-muted-foreground hover:border-border-strong hover:text-foreground',
                  )}
                >
                  {filter === f.id && (
                    <motion.span
                      layoutId="filter-pill"
                      className="absolute inset-0 rounded-full bg-primary shadow-1"
                      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                    />
                  )}
                  <span className="relative">
                    {f.label}
                    <span
                      className={cn(
                        'ml-1.5 tabular-nums',
                        filter === f.id ? 'opacity-80' : 'text-muted-foreground',
                      )}
                    >
                      {counts[f.id]}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </Enter>

          {/* List */}
          {visible.length > 0 && (
            <motion.ul layout className="space-y-3">
              <AnimatePresence mode="popLayout">
                {visible.map((job, i) => {
                  const active = !isTerminalStatus(job.status);
                  const platform = detectPlatform(job.url);
                  return (
                    <motion.li
                      key={job.id}
                      layout
                      initial={{ opacity: 0, y: 14 }}
                      animate={{
                        opacity: 1,
                        y: 0,
                        transition: { duration: 0.35, delay: Math.min(i * 0.04, 0.3) },
                      }}
                      exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.2 } }}
                    >
                      <Link
                        href={`/downloads/${job.id}`}
                        className="group block rounded-xl border border-border bg-surface px-4 py-3 shadow-1 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-2"
                        data-testid="history-item"
                      >
                        <span className="flex items-center gap-3">
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              <span
                                aria-hidden="true"
                                title={platform.label}
                                className="size-2 shrink-0 rounded-full"
                                style={{ background: platform.accent }}
                              />
                              <span
                                className="truncate text-sm font-medium text-foreground"
                                title={job.title ?? job.url ?? undefined}
                              >
                                {job.title ?? job.url ?? 'Expired link'}
                              </span>
                            </span>
                            <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                              <span className="shrink-0" title={new Date(job.createdAt).toLocaleString()}>
                                {timeAgo(job.createdAt)}
                              </span>
                              {job.requestedFormat && (
                                <span className="shrink-0 rounded-full border border-border bg-surface-sunken px-1.5 py-px font-medium">
                                  {job.requestedFormat}
                                </span>
                              )}
                              {job.url && (
                                <span className="min-w-0 flex-1 truncate" title={job.url}>
                                  · {job.url}
                                </span>
                              )}
                            </span>
                          </span>
                          <Badge tone={TONE[job.status] ?? 'default'}>
                            {stageLabel(job.status)}
                          </Badge>
                          <ArrowUpRight
                            className="size-4 shrink-0 text-muted-foreground opacity-0 transition-all duration-200 group-hover:translate-x-0.5 group-hover:opacity-100 group-hover:text-primary"
                            aria-hidden="true"
                          />
                        </span>
                        {active && job.progress > 0 && (
                          <span className="mt-2.5 block h-1 overflow-hidden rounded-full bg-surface-sunken">
                            <motion.span
                              className="block h-full rounded-full bg-gradient-to-r from-primary to-info"
                              initial={{ width: 0 }}
                              animate={{ width: `${Math.min(100, Math.max(0, job.progress))}%` }}
                              transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                            />
                          </span>
                        )}
                      </Link>
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </motion.ul>
          )}
          {visible.length > 0 && nextCursor && (
            <Button
              variant="outline"
              size="sm"
              loading={loadingMore}
              onClick={() => void fetchJobs('more')}
              data-testid="history-more"
              className="w-full rounded-2xl py-5"
            >
              Show older downloads
            </Button>
          )}
          {visible.length === 0 && (
            <motion.div
              key="no-match"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-xl border border-dashed border-border-strong bg-surface/60 px-4 py-10 text-center"
            >
              {hasFilters ? (
                <>
                  <SearchX className="mx-auto size-7 text-muted-foreground" aria-hidden="true" />
                  <p className="mt-3 text-sm text-muted-foreground">
                    Nothing matches - try a different search or filter.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-4"
                    onClick={() => {
                      setQuery('');
                      setFilter('all');
                    }}
                  >
                    <ListX className="size-4" aria-hidden="true" />
                    Clear filters
                  </Button>
                </>
              ) : null}
            </motion.div>
          )}
        </div>
      )}
    </div>
  );
}
