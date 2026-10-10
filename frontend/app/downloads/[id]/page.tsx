'use client';

import { motion } from 'motion/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useEffect, useRef, useState } from 'react';
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
  Play,
  Timer,
  X,
  XCircle,
} from 'lucide-react';

import { Alert } from '@/components/ui/alert';
import { Button, buttonClasses } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Spinner } from '@/components/ui/progress';
import { DonateModal } from '@/components/donate-coffee';
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

/** Small metric tile: icon + value only (self-explanatory), label kept
 *  for screen readers via aria-label. */
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
    <div
      aria-label={`${label}: ${value}`}
      title={`${label}: ${value}`}
      className="flex min-w-0 items-center justify-center gap-1.5 rounded-xl border border-border/70 bg-surface/60 px-2 py-2"
    >
      <Icon className="size-4 shrink-0 text-primary" aria-hidden="true" />
      <p className="truncate text-sm font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );
}

export default function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { job, result, error, loading, poll } = useJob(id);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [confirmAgain, setConfirmAgain] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const mediaRef = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  // Elapsed clock freezes the moment the job completes (100% + button).
  const [frozenElapsed, setFrozenElapsed] = useState<string | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot latch: freezes the elapsed clock on the first completed poll
    setFrozenElapsed((prev) => {
      if (job?.status !== 'completed') return null;
      return prev ?? formatElapsed(Date.now() - new Date(job?.createdAt ?? Date.now()).getTime());
    });
  }, [job?.status, job?.id, job?.createdAt]);
  useEffect(() => {
    if (!previewOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreviewOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [previewOpen]);
  useEffect(() => {
    // Autoplay with sound needs user activation; the play click usually
    // grants it. If the browser still refuses, the center play overlay
    // stays visible for an explicit tap (play() resolves async, so every
    // set-state below lands in a microtask, never synchronously).
    if (!previewOpen) return;
    mediaRef.current
      ?.play()
      .then(() => setPlaying(true))
      .catch(() => setPlaying(false));
  }, [previewOpen]);
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
              className="neon-edge bg-gradient-to-r from-primary via-info to-primary bg-[length:220%_100%] animate-gradient-pan"
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
  // Single source of truth for the saved name: the backend names the stored
  // object, signs it into the URL (R2) / Content-Disposition (local), and
  // echoes it here for display + the download attribute.
  const fileName = result?.fileName ?? null;

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
        <div className="relative mt-8 space-y-7" data-testid="job-progress">
          {(active || done) && (
            <div className="text-center">
              <p
                className="text-4xl font-bold tabular-nums tracking-tight text-foreground sm:text-5xl"
                role="progressbar"
                aria-label="Download progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={done ? 100 : Math.round(job.progress)}
              >
                {done ? 100 : Math.round(job.progress)}%
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {done ? 'ready to save to your device' : stageLabel(job.status)}
              </p>
            </div>
          )}

          {(active || done) && (
            <div className="mx-auto grid max-w-md grid-cols-3 gap-2">
              <StatTile icon={Hourglass} label="Elapsed" value={frozenElapsed ?? elapsed} />
              <StatTile icon={Layers} label="Format" value={job.requestedFormat ?? '…'} />
              <StatTile icon={HardDrive} label="Size" value={size ?? '…'} />
            </div>
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
              <ol
                className="relative flex items-start justify-between gap-1"
                aria-label="Download steps"
              >
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
                            ? 'text-white'
                            : current
                              ? 'border-primary bg-primary text-primary-foreground shadow-[0_0_0_4px_color-mix(in_oklch,var(--primary)_15%,transparent)]'
                              : 'border-border-strong bg-surface',
                        )}
                        style={
                          reached
                            ? {
                                backgroundColor: platform.accent,
                                borderColor: platform.accent,
                                boxShadow: `0 0 10px -3px ${platform.accent}`,
                              }
                            : {}
                        }
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
                    <p className="truncate text-sm font-semibold text-foreground">{fileName}</p>
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
                  <div className="flex w-full shrink-0 items-center gap-3 sm:w-auto">
                    <motion.button
                      type="button"
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => {
                        setPlaying(false);
                        setPreviewOpen(true);
                      }}
                      aria-label="Play video"
                      data-testid="play-preview"
                      className={cn(
                        buttonClasses({ variant: 'outline', size: 'sm' }),
                        'h-9 w-9 shrink-0 rounded-full p-0 text-primary',
                      )}
                    >
                      <Play className="size-4 fill-current" aria-hidden="true" />
                    </motion.button>
                    <motion.a
                      whileHover={{ scale: 1.03 }}
                      whileTap={{ scale: 0.96 }}
                      href={result.downloadUrl || result.url}
                      download={fileName ?? undefined}
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
                        buttonClasses({ size: 'sm' }),
                        'btn-shine h-9 flex-1 shrink-0 px-4 sm:w-auto',
                      )}
                    >
                      {alreadyDownloaded ? (
                        <Check className="size-4" aria-hidden="true" />
                      ) : (
                        <Download className="size-4" aria-hidden="true" />
                      )}
                      {alreadyDownloaded ? 'Downloaded' : 'Download file'}
                    </motion.a>
                  </div>
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
                      href={result.downloadUrl || result.url}
                      download={fileName ?? undefined}
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

          <div className="text-center">
            <p className="text-sm text-muted-foreground">
              FreeDownload is free because people help - enjoying it?{' '}
              <button
                type="button"
                onClick={() => setSupportOpen(true)}
                className="link-underline font-semibold text-primary underline-offset-2"
              >
                Tap here to support us
              </button>
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              FreeDownload muft hai kyunki log madad karte hain - achha laga to Help Us button
              dabakar support karo.
            </p>
            <DonateModal open={supportOpen} onClose={() => setSupportOpen(false)} />
            {previewOpen && result && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                onClick={(e) => {
                  if (e.target === e.currentTarget) setPreviewOpen(false);
                }}
                className="fixed inset-0 z-[70] flex items-center justify-center bg-background/80 p-4 backdrop-blur-md"
                data-testid="video-preview"
              >
                <motion.div
                  initial={{ opacity: 0, y: 16, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                  className="relative w-full max-w-3xl overflow-hidden rounded-2xl border border-border bg-black shadow-3"
                >
                  <button
                    type="button"
                    onClick={() => setPreviewOpen(false)}
                    aria-label="Close preview"
                    data-testid="video-preview-close"
                    className="absolute right-2 top-2 z-10 flex size-8 items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/80"
                  >
                    <X className="size-4" aria-hidden="true" />
                  </button>
                  {/\.(mp3|m4a|aac|ogg|opus|wav|flac)$/i.test(fileName ?? '') ? (
                    <audio
                      src={result.url}
                      controls
                      autoPlay
                      className="w-full bg-black p-10"
                      data-testid="audio-preview"
                    />
                  ) : (
                    <>
                      <video
                        ref={mediaRef}
                        src={result.url}
                        controls
                        autoPlay
                        playsInline
                        preload="metadata"
                        onPlay={() => setPlaying(true)}
                        onPause={() => setPlaying(false)}
                        className="max-h-[70vh] w-full bg-black"
                        data-testid="video-player"
                      />
                      {!playing && (
                        <button
                          type="button"
                          aria-label="Play"
                          data-testid="video-play-fallback"
                          onClick={() => {
                            mediaRef.current
                              ?.play()
                              .then(() => setPlaying(true))
                              .catch(() => {});
                          }}
                          className="absolute inset-x-0 bottom-12 top-0 z-[5] flex items-center justify-center bg-black/40 transition-colors hover:bg-black/55"
                        >
                          <span className="flex size-16 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-3">
                            <Play className="size-7 fill-current" aria-hidden="true" />
                          </span>
                        </button>
                      )}
                    </>
                  )}
                </motion.div>
              </motion.div>
            )}
          </div>

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
