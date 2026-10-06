'use client';

import { motion } from 'motion/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Download,
  FileVideo,
  HardDrive,
  History,
  Hourglass,
  Layers,
  Timer,
  XCircle,
} from 'lucide-react';

import { Alert } from '@/components/ui/alert';
import { Button, buttonClasses } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Spinner } from '@/components/ui/progress';
import { Enter } from '@/components/motion/reveal';
import { SoftBackdrop } from '@/components/soft-backdrop';
import { ApiError } from '@/lib/api/client';
import { cancelJob } from '@/lib/api/endpoints';
import { formatBytes, isTerminalStatus, stageLabel } from '@/lib/format';
import { detectPlatform } from '@/lib/platform';
import { useJob } from '@/lib/use-job';
import { cn } from '@/lib/utils/cn';

const STEPS = [
  { key: 'analyzing', label: 'Analyze' },
  { key: 'processing', label: 'Download' },
  { key: 'uploading', label: 'Finish' },
  { key: 'completed', label: 'Ready' },
];

function stepIndex(status: string): number {
  if (status === 'completed') return STEPS.length;
  if (['created', 'validating', 'queued', 'analyzing', 'ready'].includes(status)) return 0;
  if (status === 'processing') return 1;
  if (status === 'uploading') return 2;
  return -1;
}

function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(t);
  }, [intervalMs]);
  return now;
}

function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`;
}

/** Live "expires in 14:32" chip for the signed download link. */
function ExpiryCountdown({ expiresAt }: { expiresAt: string }) {
  const now = useNow();
  const diff = new Date(expiresAt).getTime() - now;
  if (!Number.isFinite(diff) || diff <= 0) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full border border-destructive/30 bg-destructive/8 px-2 py-0.5 text-[11px] font-medium text-destructive"
        title={`Expired ${new Date(expiresAt).toLocaleString()}`}
      >
        <Timer className="size-3" aria-hidden="true" />
        Link expired - start a new download
      </span>
    );
  }
  const totalSec = Math.floor(diff / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const clock =
    h > 0
      ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      : `${m}:${String(s).padStart(2, '0')}`;
  const urgent = diff < 5 * 60000;
  return (
    <span
      title={`Expires ${new Date(expiresAt).toLocaleString()}`}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium',
        urgent
          ? 'border-warning/40 bg-warning/12 text-warning'
          : 'border-border bg-surface/80 text-muted-foreground',
      )}
    >
      <Timer className={cn('size-3', urgent && 'animate-pulse')} aria-hidden="true" />
      <span className="tabular-nums">expires in {clock}</span>
    </span>
  );
}

/** Small metric tile used inside the live progress console. */
function StatTile({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Hourglass;
  label: string;
  value: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-xl border border-border/70 bg-surface/60 px-2.5 py-2">
      <Icon className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
      <div className="min-w-0">
        <p className="truncate text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <p className="truncate text-sm font-semibold tabular-nums text-foreground">{value}</p>
      </div>
    </div>
  );
}

export default function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { job, result, error, loading, poll } = useJob(id);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [confirmAgain, setConfirmAgain] = useState(false);
  const [canGoForward, setCanGoForward] = useState(() => {
    try {
      return sessionStorage.getItem('fd_can_forward') === '1';
    } catch {
      // Private mode / SSR - Next simply stays hidden.
      return false;
    }
  });
  const router = useRouter();
  const now = useNow();

  // Generic history back (no refresh, no fixed target). Remembers that we
  // stepped back so the Next button can appear - consumed on use, and
  // cleared by every fresh in-app push below so it never goes stale.
  const goBack = () => {
    try {
      sessionStorage.setItem('fd_can_forward', '1');
    } catch {
      // ignore
    }
    setCanGoForward(true);
    router.back();
  };

  const clearForward = () => {
    try {
      sessionStorage.removeItem('fd_can_forward');
    } catch {
      // ignore
    }
    setCanGoForward(false);
  };

  const goForward = () => {
    clearForward();
    router.forward();
  };

  const storageKey = `fd_downloaded_${id}`;
  const alreadyDownloaded = (() => {
    try {
      return typeof localStorage !== 'undefined' && localStorage.getItem(storageKey) === '1';
    } catch {
      return false;
    }
  })();
  const markDownloaded = () => {
    try {
      localStorage.setItem(storageKey, '1');
    } catch {
      // Private mode - the confirm step still guards re-downloads this visit.
    }
    setConfirmAgain(false);
  };

  if (loading && !job) {
    return (
      <div className="relative mx-auto w-full max-w-2xl px-4 py-24 sm:px-6">
        <SoftBackdrop />
        <div className="relative mx-auto max-w-md text-center">
          <div className="shimmer-line mx-auto h-4 w-28 rounded-full border border-border bg-surface" />
          <div className="shimmer-line mx-auto mt-4 h-9 w-56 rounded-lg border border-border bg-surface" />
          <div className="shimmer-line mx-auto mt-3 h-4 w-72 max-w-full rounded-md border border-border bg-surface" />
          <Card className="mt-8 overflow-hidden">
            <div
              aria-hidden="true"
              className="h-1 bg-gradient-to-r from-primary via-info to-primary bg-[length:220%_100%] animate-gradient-pan"
            />
            <CardContent className="space-y-3 py-8">
              <div className="shimmer-line h-10 w-32 rounded-xl border border-border bg-surface-sunken/60" />
              <div className="shimmer-line h-2.5 w-full rounded-full border border-border bg-surface-sunken/60" />
              <div className="shimmer-line h-16 w-full rounded-xl border border-border bg-surface-sunken/60" />
            </CardContent>
          </Card>
          <div className="mt-6 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Spinner className="size-5" />
            Loading your download...
          </div>
        </div>
      </div>
    );
  }

  if (error && !job) {
    return (
      <div className="relative mx-auto w-full max-w-2xl px-4 py-16 sm:px-6">
        <SoftBackdrop />
        <Enter className="relative mx-auto max-w-md">
          <Card className="overflow-hidden">
            <div
              aria-hidden="true"
              className="h-1 bg-gradient-to-r from-destructive/50 via-destructive to-destructive/50"
            />
            <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
              <span className="flex size-12 items-center justify-center rounded-xl bg-destructive/12 text-destructive ring-1 ring-destructive/20">
                <XCircle className="size-6" aria-hidden="true" />
              </span>
              <p className="text-base font-semibold text-foreground">
                {error.status === 404 ? 'Download not found' : 'Could not load this download'}
              </p>
              <p className="max-w-xs text-sm text-muted-foreground">
                {error.status === 404
                  ? 'This download does not exist (or is not yours).'
                  : error.message}
              </p>
              <Button
                variant="outline"
                className="mt-1"
                onClick={() => window.location.assign('/')}
              >
                Start a new download
              </Button>
            </CardContent>
          </Card>
        </Enter>
      </div>
    );
  }

  if (!job) return null;

  const active = !isTerminalStatus(job.status);
  const step = stepIndex(job.status);
  const size = formatBytes(result?.sizeBytes);
  const done = job.status === 'completed';
  const failed = job.status === 'failed' || job.status === 'dead_letter';
  const blocked = job.status === 'policy_restricted';
  const platform = detectPlatform(job.url);
  const elapsed = formatElapsed(now - new Date(job.createdAt).getTime());

  const onCancel = async () => {
    setCancelling(true);
    setCancelError(null);
    try {
      await cancelJob(job.id);
      await poll();
    } catch (err) {
      setCancelError(err instanceof ApiError ? err.message : 'Could not cancel this download.');
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div
      data-platform={platform.id}
      className="relative mx-auto w-full max-w-2xl px-4 pb-16 pt-10 sm:px-6"
    >
      {/* Home-style hero wash */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,color-mix(in_oklch,var(--primary)_9%,transparent),transparent_70%)]" />
        <div className="animate-drift-a absolute -top-32 left-1/2 h-96 w-[42rem] -translate-x-[70%] rounded-full bg-primary/10 blur-3xl" />
        <div className="animate-drift-b absolute -top-24 left-1/2 h-80 w-[36rem] -translate-x-[20%] rounded-full bg-info/10 blur-3xl" />
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      </div>
      <SoftBackdrop />

      <div className="relative mb-6 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={goBack}
          className="group inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft
            className="size-4 transition-transform duration-200 group-hover:-translate-x-0.5"
            aria-hidden="true"
          />
          Back
        </button>
        {canGoForward && (
          <button
            type="button"
            onClick={goForward}
            className="group inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            Next
            <ArrowRight
              className="size-4 transition-transform duration-200 group-hover:translate-x-0.5"
              aria-hidden="true"
            />
          </button>
        )}
      </div>

      <span data-testid="job-status" className="sr-only">
        {stageLabel(job.status)}
      </span>

      <Enter delay={0.08}>
        <div className="relative mt-8 space-y-6" data-testid="job-progress">
          {active && (
            <div className="grid grid-cols-3 gap-2">
              <StatTile icon={Hourglass} label="Elapsed" value={elapsed} />
              <StatTile icon={Layers} label="Format" value={job.requestedFormat ?? '-'} />
              <StatTile icon={HardDrive} label="Size" value={size ?? '-'} />
            </div>
          )}

            {done && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                className="glass relative overflow-hidden rounded-2xl border border-border bg-surface/80 p-3.5 text-left shadow-3"
              >
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute -right-8 -top-10 size-32 rounded-full bg-primary/10 blur-2xl"
                />
                <div
                  aria-hidden="true"
                  className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-primary via-info to-primary bg-[length:220%_100%] animate-gradient-pan"
                />
                <div className="relative flex items-center gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-info text-white shadow-2">
                    <Check className="size-5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold leading-snug text-foreground">
                      Video downloaded - ready to save to your device
                    </p>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                      Your signed link is time-limited - grab the file below.
                    </p>
                  </div>
                </div>
              </motion.div>
            )}

            <div className="relative">
              <div className="relative mx-auto max-w-md">
                <span
                  aria-hidden="true"
                  className="absolute left-[12.5%] right-[12.5%] top-3 h-0.5 rounded-full bg-border"
                />
                <motion.span
                  aria-hidden="true"
                  className="absolute left-[12.5%] top-3 h-0.5 rounded-full bg-gradient-to-r from-primary to-info"
                  initial={false}
                  animate={{
                    width: `${Math.max(0, Math.min(100, (step / (STEPS.length - 1)) * 100)) * 0.75}%`,
                  }}
                  transition={{ type: 'spring', stiffness: 70, damping: 22 }}
                />
                <ol className="relative flex items-start justify-between gap-1" aria-label="Download steps">
                  {STEPS.map((s, i) => {
                    const reached = i < step;
                    const current = i === step;
                    return (
                      <li
                        key={s.key}
                        className={cn(
                          'flex flex-1 flex-col items-center gap-1.5 text-center transition-colors duration-300',
                          i <= step ? 'text-foreground' : 'text-muted-foreground',
                        )}
                        data-testid={`step-${s.key}`}
                      >
                        <motion.span
                          layout
                          animate={current ? { scale: [1, 1.15, 1] } : { scale: 1 }}
                          transition={
                            current
                              ? { duration: 1.6, repeat: Infinity, ease: 'easeInOut' }
                              : { type: 'spring', stiffness: 400, damping: 22 }
                          }
                          className={cn(
                            'relative z-10 flex size-6 items-center justify-center rounded-full border text-[11px] font-semibold',
                            reached
                              ? 'border-success bg-success text-white shadow-[0_0_10px_-3px_var(--color-success)]'
                              : current
                                ? 'border-primary bg-primary text-primary-foreground shadow-[0_0_0_4px_color-mix(in_oklch,var(--primary)_15%,transparent)]'
                                : 'border-border-strong bg-surface',
                          )}
                        >
                          <motion.span
                            key={reached ? 'tick' : 'num'}
                            initial={{ opacity: 0, scale: 0.6 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ duration: 0.25 }}
                            className="flex"
                          >
                            {reached ? <Check className="size-3.5" aria-hidden="true" /> : i + 1}
                          </motion.span>
                        </motion.span>
                        <span className="text-[11px] font-medium leading-tight">{s.label}</span>
                      </li>
                    );
                  })}
                </ol>
              </div>
            </div>

            {active && (
              <div className="flex justify-center pt-1">
                <Button
                  variant="outline"
                  loading={cancelling}
                  onClick={() => void onCancel()}
                  data-testid="cancel-job"
                  className="rounded-full px-8 shadow-1"
                >
                  <XCircle className="size-4" aria-hidden="true" />
                  Cancel download
                </Button>
              </div>
            )}

            {job.status === 'failed' && job.errorMessage && (
              <Alert tone="error">
                {job.errorMessage}
                {job.retryCount > 0 && ` (attempt ${job.retryCount + 1})`}
              </Alert>
            )}
            {blocked && (
              <Alert tone="error">
                {job.errorMessage ?? 'This source does not allow downloads right now.'}
              </Alert>
            )}
            {cancelError && <Alert tone="error">{cancelError}</Alert>}

            {failed && (
              <Alert tone="error">
                {job.errorMessage ?? 'This download failed.'}{' '}
                <Link
                  href="/download"
                  onClick={clearForward}
                  className="link-underline font-medium text-primary underline-offset-2"
                >
                  Try another link →
                </Link>
              </Alert>
            )}

            {done && !result && !loading && (
              <Alert tone="error" data-testid="result-expired">
                This link has expired - start a new download to get a fresh one.{' '}
                <Link
                  href="/download"
                  onClick={clearForward}
                  className="link-underline font-medium text-primary underline-offset-2"
                >
                  New download →
                </Link>
              </Alert>
            )}

            {job.status === 'completed' && result && (
              <motion.div
                initial={{ opacity: 0, y: 12, scale: 0.99 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                className="glass relative mt-2 overflow-hidden rounded-2xl border border-border bg-surface/80 p-4 shadow-3"
                data-testid="result-card"
              >
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute -left-10 -top-12 size-40 rounded-full bg-primary/10 blur-3xl"
                />
                <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-info text-white shadow-2 ring-1 ring-white/10">
                      <FileVideo className="size-5" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 text-left">
                      <p className="truncate text-sm font-semibold text-foreground">
                        media.{result.container ?? 'mp4'}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {size && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface/80 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                            <HardDrive className="size-3" aria-hidden="true" />
                            {size}
                          </span>
                        )}
                        <ExpiryCountdown expiresAt={result.expiresAt} />
                      </div>
                    </div>
                  </div>
                  {!confirmAgain && (
                    <motion.a
                      whileHover={{ scale: 1.03 }}
                      whileTap={{ scale: 0.96 }}
                      href={result.url}
                      download
                      data-testid="download-link"
                      onClick={(e) => {
                        if (alreadyDownloaded && !confirmAgain) {
                          // Second+ click - stop and ask first (warning below).
                          e.preventDefault();
                          setConfirmAgain(true);
                          return;
                        }
                        markDownloaded();
                      }}
                      className={cn(
                        buttonClasses({ size: 'lg' }),
                        'btn-shine h-12 w-full shrink-0 px-6 sm:w-auto',
                      )}
                    >
                      {alreadyDownloaded ? (
                        <Check className="size-4" aria-hidden="true" />
                      ) : (
                        <Download className="size-4" aria-hidden="true" />
                      )}
                      {alreadyDownloaded ? 'Downloaded' : 'Download file'}
                    </motion.a>
                  )}
                </div>
                {confirmAgain && (
                  <div
                    role="alert"
                    data-testid="redownload-confirm"
                    className="relative mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm"
                  >
                    <span className="min-w-0 flex-1 text-foreground">
                      Already downloaded - download this file again?
                    </span>
                    <span className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setConfirmAgain(false)}
                        data-testid="redownload-cancel"
                      >
                        Cancel
                      </Button>
                      <motion.a
                        whileTap={{ scale: 0.96 }}
                        href={result.url}
                        download
                        onClick={markDownloaded}
                        data-testid="redownload-yes"
                        className={cn(buttonClasses({ size: 'sm' }), 'btn-shine')}
                      >
                        <Download className="size-4" aria-hidden="true" />
                        Yes, download
                      </motion.a>
                    </span>
                  </div>
                )}
              </motion.div>
            )}

            <nav
              aria-label="More downloads"
              className="flex items-center justify-between gap-3 rounded-2xl border border-border/70 bg-surface/60 px-4 py-3"
            >
              <Link
                href="/download"
                onClick={clearForward}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-2 transition-colors hover:text-foreground"
              >
                <Download className="size-4" aria-hidden="true" />
                New download
              </Link>
              <span aria-hidden="true" className="h-4 w-px bg-border" />
              <Link
                href="/downloads"
                onClick={clearForward}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground underline-offset-2 transition-colors hover:text-primary"
              >
                <History className="size-4" aria-hidden="true" />
                My downloads
              </Link>
            </nav>
          </div>
      </Enter>
    </div>
  );
}
