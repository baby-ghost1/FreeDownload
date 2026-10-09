'use client';

import { AnimatePresence, motion } from 'motion/react';
import Image from 'next/image';
import Link from 'next/link';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AudioLines,
  Clapperboard,
  Download,
  FileAudio,
  FileVideo,
  Link2,
  Music4,
  Timer,
} from 'lucide-react';

import { Alert } from '@/components/ui/alert';
import { BackButton } from '@/components/back-button';
import { ClipboardToggle } from '@/components/clipboard-toggle';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { Spinner } from '@/components/ui/progress';
import { Enter } from '@/components/motion/reveal';
import { SoftBackdrop } from '@/components/soft-backdrop';
import { ApiError } from '@/lib/api/client';
import { analyzeUrl, createJob } from '@/lib/api/endpoints';
import { detectPlatform } from '@/lib/platform';
import type { AnalyzeFormat, AnalyzeResult } from '@/lib/api/types';
import { formatBytes, formatDuration } from '@/lib/format';

type Phase = 'idle' | 'analyzing' | 'analyzed' | 'creating';

const FLOW_STEPS = ['Paste link', 'Analyze', 'Pick a format'];

const IDLE_TIPS = [
  { icon: Link2, text: 'youtube.com/... works too - https gets added for you' },
  { icon: AudioLines, text: 'Video up to source quality, or audio-only MP3' },
  { icon: Timer, text: 'Your file link auto-expires after delivery' },
];

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Promote scheme-less pastes ("youtube.com/...") to https:// before validation. */
function normalizeUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || /^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/** Short row title: resolution for video, plain kind for audio.
 *  Container + size live in the meta line below, never repeated here. */
function shortLabel(format: AnalyzeFormat): string {
  if (format.kind === 'video' && format.height) return `${format.height}p`;
  if (format.kind === 'audio') return 'Audio only';
  return format.label;
}

function FormatOption({
  format,
  onSelect,
  busy,
  spinning,
  index = 0,
}: {
  format: AnalyzeFormat;
  onSelect: (f: AnalyzeFormat) => void;
  busy: boolean;
  spinning: boolean;
  index?: number;
}) {
  const size = formatBytes(format.filesizeBytes);
  const video = format.kind === 'video';
  return (
    <motion.button
      type="button"
      disabled={busy}
      onClick={() => onSelect(format)}
      data-testid={`format-${format.key}`}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.99 }}
      className="group flex w-full items-center gap-3 rounded-xl border border-border bg-surface px-3.5 py-3 text-left shadow-1 transition-colors duration-200 hover:border-primary/60 hover:bg-primary/5 hover:shadow-2 disabled:opacity-60"
    >
      <span
        className={
          video
            ? 'flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary ring-1 ring-primary/20 transition-transform duration-300 group-hover:scale-110'
            : 'flex size-9 shrink-0 items-center justify-center rounded-lg bg-info/12 text-info ring-1 ring-info/20 transition-transform duration-300 group-hover:scale-110'
        }
      >
        {video ? (
          <FileVideo className="size-4" aria-hidden="true" />
        ) : (
          <FileAudio className="size-4" aria-hidden="true" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">
            {shortLabel(format)}
          </span>
          {format.isDefault && !busy && <Badge tone="default">Recommended</Badge>}
        </span>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {format.container.toUpperCase()}
          {format.fps ? ` · ${format.fps}fps` : ''}
          {size ? (
            <>
              {' · '}
              <span className="font-semibold text-foreground">{size}</span>
            </>
          ) : (
            ''
          )}
        </span>
      </span>
      {spinning ? (
        <Spinner className="size-4 shrink-0" aria-hidden="true" />
      ) : (
        <Download
          className="size-4 shrink-0 text-muted-foreground transition-all duration-300 group-hover:translate-y-0.5 group-hover:text-primary"
          aria-hidden="true"
        />
      )}
    </motion.button>
  );
}

function DownloadFlow() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialUrl = searchParams.get('url');
  const [url, setUrl] = useState(initialUrl ?? '');
  const [phase, setPhase] = useState<Phase>('idle');
  const [analysis, setAnalysis] = useState<AnalyzeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [concurrentBlocked, setConcurrentBlocked] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const autoRan = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // The exact link string that was analyzed (backend returns a redacted URL,
  // so analysis.url can never be compared against the input).
  const [analyzedUrl, setAnalyzedUrl] = useState<string | null>(null);

  // Long links overflow the field - always show the START of the link.
  const scrollToStart = () => {
    requestAnimationFrame(() => {
      if (inputRef.current) inputRef.current.scrollLeft = 0;
    });
  };

  useEffect(() => {
    if (document.activeElement !== inputRef.current && inputRef.current) {
      inputRef.current.scrollLeft = 0;
    }
  }, [url]);

  const runAnalyze = useCallback(async (target: string) => {
    const trimmed = normalizeUrl(target);
    if (!isValidHttpUrl(trimmed)) {
      setError('Enter a valid link, for example https://example.com/video.');
      return;
    }
    setPhase('analyzing');
    setError(null);
    setConcurrentBlocked(false);
    setAnalysis(null);
    setAnalyzedUrl(null);
    try {
      const result = await analyzeUrl(trimmed);
      setAnalyzedUrl(trimmed);
      setAnalysis(result);
      setPhase('analyzed');
    } catch (err) {
      setPhase('idle');
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not reach the service. Check your connection and try again.',
      );
    }
  }, []);

  useEffect(() => {
    if (autoRan.current) return;
    autoRan.current = true;
    if (initialUrl) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-time analysis: the "Analyzing..." state must render immediately
      void runAnalyze(initialUrl);
    }
  }, [initialUrl, runAnalyze]);

  const selectFormat = useCallback(
    async (format: AnalyzeFormat) => {
      setPhase('creating');
      setError(null);
      setConcurrentBlocked(false);
      setSelectedKey(format.key);
      try {
        const job = await createJob({
          url: normalizeUrl(url),
          format: format.key,
          container: format.container,
        });
        router.push(`/downloads/${job.id}`);
      } catch (err) {
        setPhase('analyzed');
        setSelectedKey(null);
        if (
          err instanceof ApiError &&
          err.code === 'RATE_LIMITED' &&
          (err.details as { scope?: string } | undefined)?.scope === 'concurrent'
        ) {
          // A previous download is still occupying the anonymous slot -
          // analyzing alone never queues anything, so point at the live job.
          setConcurrentBlocked(true);
          setError(
            'You already have a download running. Finish or cancel it before starting another on the anonymous plan.',
          );
        } else {
          setError(err instanceof ApiError ? err.message : 'Could not start the download.');
        }
      }
    },
    [url, router],
  );

  const videoFormats = analysis?.formats.filter((f) => f.kind === 'video') ?? [];
  const audioFormats = analysis?.formats.filter((f) => f.kind === 'audio') ?? [];
  // One-tap pick: backend recommendation first, else highest video
  // resolution, else first audio. List below stays for manual choice.
  const bestFormat =
    analysis?.formats.find((f) => f.isDefault) ??
    videoFormats.reduce<AnalyzeFormat | null>(
      (best, f) => (!best || (f.height ?? 0) > (best.height ?? 0) ? f : best),
      null,
    ) ??
    audioFormats[0] ??
    null;
  const bestSize = bestFormat ? formatBytes(bestFormat.filesizeBytes) : '';
  const duration = formatDuration(analysis?.durationSec);
  const activeStep = phase === 'idle' ? 0 : phase === 'analyzing' ? 1 : 2;
  const busy = phase === 'analyzing' || phase === 'creating';
  const platform = detectPlatform(analysis?.url ?? url);
  // The input changed after analysis finished - shown formats belong to the
  // OLD link. Lock them until the user re-analyzes so a tap can never queue
  // the wrong URL (and burn the single anonymous concurrency slot).
  // Compared against the analyzed input string (analysis.url is redacted by
  // the backend and never equals the raw input).
  const stale =
    phase === 'analyzed' &&
    analysis !== null &&
    analyzedUrl !== null &&
    normalizeUrl(url) !== analyzedUrl;
  // Gentle pre-submit hint: non-empty but unparseable input can never
  // analyze, so say so under the field instead of after a failed roundtrip.
  const showInvalidHint = url.trim() !== '' && !isValidHttpUrl(normalizeUrl(url)) && !busy;

  return (
    <div
      data-platform={platform.id}
      className="relative mx-auto w-full max-w-2xl px-4 pb-10 pt-10 sm:px-6 sm:pt-12"
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,color-mix(in_oklch,var(--primary)_9%,transparent),transparent_70%)]" />
        <div className="animate-drift-a absolute -top-32 left-1/2 h-96 w-[42rem] -translate-x-[70%] rounded-full bg-primary/10 blur-3xl" />
        <div className="animate-drift-b absolute -top-24 left-1/2 h-80 w-[36rem] -translate-x-[20%] rounded-full bg-info/10 blur-3xl" />
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      </div>
      <SoftBackdrop />

      <div className="relative mb-5">
        <BackButton href="/" label="Back to home" />
      </div>

      <Enter className="relative text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          What are we downloading today?
        </h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          Paste a link, pick a format, and we&apos;ll handle the rest.
        </p>

        {/* Flow stepper - the pill glides as you move forward */}
        <ol
          aria-label="Download progress"
          className="mt-6 flex flex-wrap items-center justify-center gap-x-3 gap-y-2"
        >
          {FLOW_STEPS.map((label, i) => (
            <li
              key={label}
              aria-current={i === activeStep ? 'step' : undefined}
              className="relative rounded-full px-3 py-1 text-xs font-medium"
            >
              {i === activeStep && (
                <motion.span
                  layoutId="flow-pill"
                  className="absolute inset-0 rounded-full bg-primary/12 ring-1 ring-primary/30"
                  transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                />
              )}
              <span
                className={`relative transition-colors duration-300 ${
                  i < activeStep
                    ? 'text-primary'
                    : i === activeStep
                      ? 'text-foreground'
                      : 'text-muted-foreground'
                }`}
              >
                {i < activeStep ? '✓ ' : `${i + 1}. `}
                {label}
              </span>
            </li>
          ))}
        </ol>

        {/* Detected platform - the whole page tints to match it */}
        <AnimatePresence mode="wait">
          {platform.id !== 'default' && (
            <motion.span
              key={platform.id}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.3 }}
              className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-xs font-medium text-primary"
            >
              <span
                aria-hidden="true"
                className="size-2 rounded-full"
                style={{ background: platform.accent }}
              />
              {platform.label} link detected
            </motion.span>
          )}
        </AnimatePresence>
      </Enter>

      <Enter delay={0.08} className="relative">
        <form
          className="mt-6"
          onSubmit={(e) => {
            e.preventDefault();
            void runAnalyze(url);
          }}
        >
          <Label htmlFor="media-url" className="sr-only">
            Media link
          </Label>
          <div className="glass mt-1.5 flex gap-2 rounded-2xl border border-border bg-surface/80 p-2 shadow-3 transition-all duration-300 focus-within:border-primary/60 focus-within:shadow-[0_0_0_4px_color-mix(in_oklch,var(--primary)_14%,transparent),var(--shadow-3)] hover:border-border-strong">
            <div className="relative flex-1">
              <Input
                id="media-url"
                ref={inputRef}
                name="url"
                type="url"
                inputMode="url"
                placeholder="https://example.com/video"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onBlur={scrollToStart}
                onPaste={() => {
                  setTimeout(scrollToStart, 0);
                }}
                disabled={busy}
                autoComplete="off"
                autoFocus
                className="h-12 border-0 bg-transparent pr-11 text-left shadow-none focus-visible:outline-none"
                style={
                  url.trim()
                    ? {
                        maskImage:
                          'linear-gradient(to right, black calc(100% - 4.75rem), transparent calc(100% - 2.75rem))',
                        WebkitMaskImage:
                          'linear-gradient(to right, black calc(100% - 4.75rem), transparent calc(100% - 2.75rem))',
                      }
                    : undefined
                }
              />
              <ClipboardToggle
                value={url}
                onPaste={(v) => {
                  setUrl(v);
                  scrollToStart();
                }}
                onClear={() => setUrl('')}
                disabled={busy}
                className="absolute right-1.5 top-1/2 size-9 -translate-y-1/2 rounded-lg"
              />
            </div>
            <motion.div whileTap={{ scale: 0.96 }} className="shrink-0">
              <Button
                type="submit"
                loading={phase === 'analyzing'}
                disabled={phase === 'creating' || showInvalidHint}
                className="btn-shine h-12"
                data-testid="analyze"
              >
                {phase === 'analyzing' ? 'Analyzing...' : 'Analyze'}
              </Button>
            </motion.div>
          </div>
          <AnimatePresence>
            {showInvalidHint && (
              <motion.p
                key="invalid-hint"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.25 }}
                role="status"
                className="mt-2 text-center text-xs text-muted-foreground"
              >
                That doesn&apos;t look like a link - try https://… or youtube.com/…
              </motion.p>
            )}
          </AnimatePresence>
        </form>
      </Enter>

      <AnimatePresence mode="wait">
        {error && (
          <motion.div
            key="error"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <Alert tone="error" className="mt-4">
              {error}
              {concurrentBlocked && (
                <span className="mt-2 block">
                  <Link
                    href="/downloads"
                    className="link-underline font-medium text-primary underline-offset-2"
                  >
                    View my downloads →
                  </Link>{' '}
                  cancel the running one, then come back here.
                </span>
              )}
            </Alert>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {stale && (
          <motion.div
            key="stale"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
          >
            <Alert tone="info" className="mt-4">
              Link changed - press <strong>Analyze</strong> to get formats for the new link.
              The formats below belong to the previous link and are locked.
            </Alert>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Idle tips - home trust-row style, no cards */}
      <AnimatePresence>
        {phase === 'idle' && !analysis && !error && (
          <motion.div
            key="tips"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="relative mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-muted-foreground"
          >
            {IDLE_TIPS.map((tip, i) => (
              <motion.span
                key={tip.text}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 + i * 0.08, duration: 0.4 }}
                className="inline-flex items-center gap-1.5"
              >
                <tip.icon className="size-4 text-primary" aria-hidden="true" />
                {tip.text}
              </motion.span>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {phase === 'analyzing' && (
          <motion.div
            key="analyzing"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          >
            <Card className="mt-6 overflow-hidden">
              <CardContent className="space-y-4 py-6">
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <Spinner />
                  Fetching available formats - this usually takes a few seconds...
                </div>
                <div className="space-y-2.5" aria-hidden="true">
                  {[82, 64, 74].map((w) => (
                    <div
                      key={w}
                      className="shimmer-line h-12 rounded-xl border border-border bg-surface-sunken/60"
                      style={{ width: `${w}%` }}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {phase !== 'analyzing' && analysis && (
          <motion.div
            key="analysis"
            initial={{ opacity: 0, y: 20, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          >
            <Card className="mt-6 overflow-hidden" data-testid="analysis-card">
              <div
                aria-hidden="true"
                className="neon-edge h-1 bg-gradient-to-r from-primary via-info to-primary bg-[length:220%_100%] animate-gradient-pan"
              />
              <CardHeader>
                <div className="flex items-start gap-4">
                  {analysis.thumbnailUrl && (
                    <div className="group relative shrink-0 overflow-hidden rounded-xl border border-border">
                      <Image
                        src={analysis.thumbnailUrl}
                        alt=""
                        width={192}
                        height={112}
                        unoptimized
                        className="h-24 w-40 object-cover transition-transform duration-500 group-hover:scale-105 sm:h-28 sm:w-48"
                      />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <CardTitle className="line-clamp-2" data-testid="analysis-title">
                      {analysis.title ?? analysis.url}
                    </CardTitle>
                    <p className="mt-1 flex items-center gap-1.5 overflow-hidden whitespace-nowrap text-xs text-muted-foreground">
                      {analysis.uploader && (
                        <span className="shrink-0">{analysis.uploader}</span>
                      )}
                      {duration && <span className="shrink-0">· {duration}</span>}
                      <span className="min-w-0 flex-1 truncate">· {analysis.url}</span>
                    </p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-5 pt-5">
                {bestFormat && (
                  <div className="space-y-1.5">
                    <Button
                      type="button"
                      size="lg"
                      disabled={phase === 'creating' || stale}
                      loading={selectedKey === bestFormat.key}
                      onClick={() => void selectFormat(bestFormat)}
                      data-testid="format-best"
                      className="btn-shine h-12 w-full"
                    >
                      <Download className="size-4" aria-hidden="true" />
                      Download {shortLabel(bestFormat)}
                      {bestSize ? ` • ${bestSize}` : ''}
                    </Button>
                    <p className="text-center text-xs text-muted-foreground">
                      Best available - or pick another format below
                    </p>
                  </div>
                )}
                <section>
                  <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
                    <Clapperboard className="size-4 text-muted-foreground" aria-hidden="true" />
                    Video
                  </h3>
                  <div className="space-y-2">
                    {videoFormats.length > 0 ? (
                      videoFormats.map((f, i) => (
                        <FormatOption
                          key={f.key}
                          format={f}
                          index={i}
                          busy={phase === 'creating' || stale}
                          spinning={selectedKey === f.key}
                          onSelect={(fmt) => void selectFormat(fmt)}
                        />
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground">No video formats found.</p>
                    )}
                  </div>
                </section>

                <section>
                  <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
                    <Music4 className="size-4 text-muted-foreground" aria-hidden="true" />
                    Audio only
                  </h3>
                  <div className="space-y-2">
                    {audioFormats.length > 0 ? (
                      audioFormats.map((f, i) => (
                        <FormatOption
                          key={f.key}
                          format={f}
                          index={i}
                          busy={phase === 'creating' || stale}
                          spinning={selectedKey === f.key}
                          onSelect={(fmt) => void selectFormat(fmt)}
                        />
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground">No audio-only formats found.</p>
                    )}
                  </div>
                </section>

                {phase === 'creating' && (
                  <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex items-center gap-2 text-sm text-muted-foreground"
                  >
                    <Spinner className="size-4" /> Preparing your download...
                  </motion.p>
                )}
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function DownloadPage() {
  return (
    <Suspense fallback={null}>
      <DownloadFlow />
    </Suspense>
  );
}
