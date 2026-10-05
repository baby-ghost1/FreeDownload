'use client';

import { motion } from 'motion/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Download, Timer, XCircle } from 'lucide-react';

import { Alert } from '@/components/ui/alert';
import { Badge, type BadgeTone } from '@/components/ui/badge';
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

const STATUS_TONE: Record<string, BadgeTone> = {
  completed: 'success',
  failed: 'danger',
  dead_letter: 'danger',
  policy_restricted: 'danger',
  cancelled: 'muted',
  expired: 'muted',
  retrying: 'warning',
  ready: 'info',
  processing: 'info',
  uploading: 'info',
  analyzing: 'info',
  queued: 'default',
  created: 'default',
  validating: 'default',
};

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

const STAGE_HINT: Record<string, string> = {
  created: 'Reserving your slot...',
  validating: 'Checking the link...',
  queued: 'In queue - the worker picks it up in seconds.',
  analyzing: 'Reading available formats...',
  ready: 'Ready - starting the download engine...',
  processing: 'Downloading at source speed...',
  uploading: 'Finishing and minting your link...',
  retrying: 'Hit a bump - retrying automatically...',
};

/** Live "expires in 14:32" countdown for the signed download link. */
function ExpiryCountdown({ expiresAt, size }: { expiresAt: string; size: string | null }) {
  const now = useNow();
  const diff = new Date(expiresAt).getTime() - now;
  if (!Number.isFinite(diff) || diff <= 0) {
    return (
      <p className="mt-0.5 text-xs font-medium text-destructive">
        {size && `${size} · `}
        This link has expired - start a new download to get a fresh one.
      </p>
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
    <p
      className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground"
      title={`Expires ${new Date(expiresAt).toLocaleString()}`}
    >
      {size && `${size} · `}
      <Timer
        className={`size-3.5 ${urgent ? 'animate-pulse text-warning' : ''}`}
        aria-hidden="true"
      />
      <span className="tabular-nums">expires in {clock}</span>
    </p>
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
      <div className="mx-auto w-full max-w-2xl px-4 py-24 sm:px-6">
        <div className="shimmer-line h-8 w-48 rounded-lg border border-border bg-surface" />
        <div className="shimmer-line mt-4 h-40 rounded-xl border border-border bg-surface" />
        <div className="flex justify-center py-8">
          <Spinner className="size-8" />
        </div>
      </div>
    );
  }

  if (error && !job) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-16 sm:px-6">
        <Alert tone="error">
          {error.status === 404 ? 'This download does not exist (or is not yours).' : error.message}
        </Alert>
        <Button variant="outline" className="mt-4" onClick={() => window.location.assign('/')}>
          Start a new download
        </Button>
      </div>
    );
  }

  if (!job) return null;

  const active = !isTerminalStatus(job.status);
  const step = stepIndex(job.status);
  const size = formatBytes(result?.sizeBytes);
  const done = job.status === 'completed';
  const failed = job.status === 'failed' || job.status === 'dead_letter';
  const platform = detectPlatform(job.url);
  const elapsed = formatElapsed(now - new Date(job.createdAt).getTime());
  const pct = Math.min(100, Math.max(0, Math.round(job.progress)));

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
      className="relative mx-auto w-full max-w-2xl px-4 pb-10 pt-20 sm:px-6 sm:pt-28"
    >
      <SoftBackdrop />

      <div className="relative mb-5 flex items-center justify-between gap-2">
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

      <Enter delay={0.05}>
        <Card className="overflow-hidden">
          <div
            aria-hidden="true"
            className={cn(
              'h-1 bg-[length:220%_100%] transition-all duration-700',
              done
                ? 'bg-gradient-to-r from-success to-info animate-gradient-pan'
                : 'bg-gradient-to-r from-primary via-info to-primary animate-gradient-pan',
            )}
          />
          <CardContent className="space-y-7 px-4 pt-8 text-center sm:px-8">
            <motion.div
              key={job.status}
              initial={{ opacity: 0, scale: 0.9, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            >
              <Badge
                tone={STATUS_TONE[job.status] ?? 'default'}
                data-testid="job-status"
                className="px-3.5 py-1 text-[13px]"
              >
                {stageLabel(job.status)}
              </Badge>
              <p className="mt-2 flex flex-wrap items-center justify-center gap-1.5 text-xs text-muted-foreground">
                {platform.id !== 'default' && (
                  <span className="inline-flex items-center gap-1.5 font-medium text-primary">
                    <span
                      aria-hidden="true"
                      className="size-2 rounded-full"
                      style={{ background: platform.accent }}
                    />
                    via {platform.label}
                  </span>
                )}
                {job.requestedFormat && <span>· {job.requestedFormat}</span>}
              </p>
            </motion.div>

            {active && (
              <div data-testid="job-progress">
                <motion.p
                  key={pct}
                  initial={{ opacity: 0.5, scale: 0.97 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                  className="text-5xl font-semibold tracking-tight tabular-nums"
                >
                  {pct}
                  <span className="text-xl text-muted-foreground">%</span>
                </motion.p>
                <p className="mx-auto mt-2 max-w-xs text-sm text-muted-foreground">
                  {STAGE_HINT[job.status] ?? stageLabel(job.status)}
                </p>
                <p className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
                  <Timer className="size-3" aria-hidden="true" />
                  {elapsed} elapsed
                </p>
              </div>
            )}

            {done && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
              >
                <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-gradient-to-br from-[#38bdf8] to-[#34d399] text-white shadow-2">
                  <Check className="size-6" aria-hidden="true" />
                </span>
                <p className="mt-3 text-lg font-semibold tracking-tight">
                  Video downloaded - ready to save to your device
                </p>
              </motion.div>
            )}

            <div>
              <ol className="relative mx-auto flex max-w-md items-start justify-between gap-1 text-xs text-muted-foreground">
                <span
                  aria-hidden="true"
                  className="absolute left-8 right-8 top-2.5 h-px bg-border"
                />
                <motion.span
                  aria-hidden="true"
                  className="absolute left-8 top-2.5 h-px bg-gradient-to-r from-[#38bdf8] to-[#34d399]"
                  initial={false}
                  animate={{
                    right: `${100 - Math.min(100, (step / (STEPS.length - 1)) * 100)}%`,
                  }}
                  transition={{ type: 'spring', stiffness: 70, damping: 22 }}
                />
              {STEPS.map((s, i) => {
                const reached = i < step;
                const current = i === step;
                return (
                  <li
                    key={s.key}
                    className={cn(
                      'flex flex-1 flex-col items-center gap-1.5 text-center transition-colors duration-300',
                      i <= step ? 'text-foreground' : '',
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
                        'relative z-10 flex size-5 items-center justify-center rounded-full border text-[10px] font-semibold',
                        reached
                          ? 'border-success bg-success text-white shadow-[0_0_8px_-2px_var(--color-success)]'
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
                        {reached ? '✓' : i + 1}
                      </motion.span>
                    </motion.span>
                    <span className="text-[11px] font-medium leading-tight">{s.label}</span>
                  </li>
                );
              })}
              </ol>
            </div>

            {job.status === 'failed' && job.errorMessage && (
              <Alert tone="error">
                {job.errorMessage}
                {job.retryCount > 0 && ` (attempt ${job.retryCount + 1})`}
              </Alert>
            )}
            {job.status === 'policy_restricted' && (
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
                className="relative mt-4 overflow-hidden rounded-2xl border border-[#38bdf8]/30 bg-gradient-to-br from-[#38bdf8]/10 to-[#34d399]/10 p-3 shadow-2 sm:p-4"
                data-testid="result-card"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#38bdf8] to-[#34d399] text-white shadow-2">
                    <Check className="size-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">
                      media.{result.container ?? 'mp4'}
                    </p>
                    <ExpiryCountdown expiresAt={result.expiresAt} size={size} />
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
                        buttonClasses({ size: 'md' }),
                        'w-full border-transparent bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-[0_8px_20px_-8px_var(--color-warning)] hover:brightness-110 sm:w-auto',
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
                    className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-warning/30 bg-warning/8 p-3 text-sm"
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
                        className={cn(
                          buttonClasses({ size: 'sm' }),
                          'border-transparent bg-gradient-to-r from-orange-500 to-amber-500 text-white hover:brightness-110',
                        )}
                      >
                        <Download className="size-4" aria-hidden="true" />
                        Yes, download
                      </motion.a>
                    </span>
                  </div>
                )}
              </motion.div>
            )}

            <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
              <Link
                href="/download"
                onClick={clearForward}
                className="link-underline text-sm text-primary underline-offset-2"
              >
                New download
              </Link>
              <div className="flex items-center gap-2">
                {active && (
                  <Button
                    variant="outline"
                    size="sm"
                    loading={cancelling}
                    onClick={() => void onCancel()}
                    data-testid="cancel-job"
                    className="rounded-xl"
                  >
                    <XCircle className="size-4" aria-hidden="true" />
                    Cancel
                  </Button>
                )}
                <Link
                  href="/downloads"
                  onClick={clearForward}
                  className="link-underline text-sm text-muted-foreground underline-offset-2 transition-colors hover:text-primary"
                >
                  My downloads
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>
      </Enter>
    </div>
  );
}
