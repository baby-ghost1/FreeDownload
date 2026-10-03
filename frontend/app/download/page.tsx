'use client';

import Image from 'next/image';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Download, FileAudio, FileVideo, Link2 } from 'lucide-react';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { Spinner } from '@/components/ui/progress';
import { ApiError } from '@/lib/api/client';
import { analyzeUrl, createJob } from '@/lib/api/endpoints';
import type { AnalyzeFormat, AnalyzeResult } from '@/lib/api/types';
import { formatBytes, formatDuration } from '@/lib/format';

type Phase = 'idle' | 'analyzing' | 'analyzed' | 'creating';

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function FormatOption({
  format,
  onSelect,
  busy,
}: {
  format: AnalyzeFormat;
  onSelect: (f: AnalyzeFormat) => void;
  busy: boolean;
}) {
  const size = formatBytes(format.filesizeBytes);
  const video = format.kind === 'video';
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => onSelect(format)}
      data-testid={`format-${format.key}`}
      className="group flex w-full items-center gap-3 rounded-md border border-border bg-surface px-3.5 py-3 text-left transition-colors hover:border-primary/60 hover:bg-primary/5 disabled:opacity-60"
    >
      {video ? (
        <FileVideo className="size-4 shrink-0 text-primary" aria-hidden="true" />
      ) : (
        <FileAudio className="size-4 shrink-0 text-info" aria-hidden="true" />
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{format.label}</span>
          {format.isDefault && <Badge tone="default">Recommended</Badge>}
        </span>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {format.container.toUpperCase()}
          {format.height ? ` · ${format.height}p` : ''}
          {format.fps ? ` · ${format.fps}fps` : ''}
          {size ? ` · ${size}` : ''}
        </span>
      </span>
      <Download
        className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary"
        aria-hidden="true"
      />
    </button>
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
  const autoRan = useRef(false);

  const runAnalyze = useCallback(async (target: string) => {
    const trimmed = target.trim();
    if (!isValidHttpUrl(trimmed)) {
      setError('Enter a valid http(s) link, for example https://example.com/video.');
      return;
    }
    setPhase('analyzing');
    setError(null);
    setAnalysis(null);
    try {
      const result = await analyzeUrl(trimmed);
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
      // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-time analysis: the "Analyzing…" state must render immediately
      void runAnalyze(initialUrl);
    }
  }, [initialUrl, runAnalyze]);

  const selectFormat = useCallback(
    async (format: AnalyzeFormat) => {
      setPhase('creating');
      setError(null);
      try {
        const job = await createJob({
          url: url.trim(),
          format: format.key,
          container: format.container,
        });
        router.push(`/downloads/${job.id}`);
      } catch (err) {
        setPhase('analyzed');
        setError(err instanceof ApiError ? err.message : 'Could not start the download.');
      }
    },
    [url, router],
  );

  const videoFormats = analysis?.formats.filter((f) => f.kind === 'video') ?? [];
  const audioFormats = analysis?.formats.filter((f) => f.kind === 'audio') ?? [];
  const duration = formatDuration(analysis?.durationSec);

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">New download</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Paste a link, pick a format, and we&apos;ll handle the rest.
      </p>

      <form
        className="mt-6 flex flex-col gap-3 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          void runAnalyze(url);
        }}
      >
        <div className="flex-1">
          <Label htmlFor="media-url">Media link</Label>
          <Input
            id="media-url"
            name="url"
            type="url"
            inputMode="url"
            placeholder="https://example.com/video"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={phase === 'analyzing' || phase === 'creating'}
            autoComplete="off"
            autoFocus
          />
        </div>
        <div className="flex items-end">
          <Button
            type="submit"
            loading={phase === 'analyzing'}
            disabled={phase === 'creating'}
            className="w-full sm:w-auto"
            data-testid="analyze"
          >
            {phase === 'analyzing' ? 'Analyzing…' : 'Analyze'}
          </Button>
        </div>
      </form>

      {error && (
        <Alert tone="error" className="mt-4">
          {error}
        </Alert>
      )}

      {phase === 'analyzing' && (
        <Card className="mt-6">
          <CardContent className="flex items-center gap-3 py-8 text-sm text-muted-foreground">
            <Spinner />
            Fetching available formats — this usually takes a few seconds…
          </CardContent>
        </Card>
      )}

      {phase !== 'analyzing' && analysis && (
        <Card className="mt-6" data-testid="analysis-card">
          <CardHeader>
            <div className="flex items-start gap-4">
              {analysis.thumbnailUrl && (
                <Image
                  src={analysis.thumbnailUrl}
                  alt=""
                  width={160}
                  height={90}
                  unoptimized
                  className="h-20 w-36 shrink-0 rounded-md border border-border object-cover"
                />
              )}
              <div className="min-w-0">
                <CardTitle className="line-clamp-2" data-testid="analysis-title">
                  {analysis.title ?? analysis.url}
                </CardTitle>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {analysis.uploader && <span>{analysis.uploader}</span>}
                  {duration && <span>· {duration}</span>}
                  <span>· {analysis.url}</span>
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5 pt-4">
            <section>
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
                <Link2 className="size-4 text-muted-foreground" aria-hidden="true" />
                Video
              </h3>
              <div className="space-y-2">
                {videoFormats.length > 0 ? (
                  videoFormats.map((f) => (
                    <FormatOption
                      key={f.key}
                      format={f}
                      busy={phase === 'creating'}
                      onSelect={(fmt) => void selectFormat(fmt)}
                    />
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">No video formats found.</p>
                )}
              </div>
            </section>

            <section>
              <h3 className="mb-2 text-sm font-semibold text-foreground">Audio only</h3>
              <div className="space-y-2">
                {audioFormats.length > 0 ? (
                  audioFormats.map((f) => (
                    <FormatOption
                      key={f.key}
                      format={f}
                      busy={phase === 'creating'}
                      onSelect={(fmt) => void selectFormat(fmt)}
                    />
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">No audio-only formats found.</p>
                )}
              </div>
            </section>

            {phase === 'creating' && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner className="size-4" /> Preparing your download…
              </p>
            )}
          </CardContent>
        </Card>
      )}
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
