'use client';

import Link from 'next/link';
import { use, useState } from 'react';
import { Download, XCircle } from 'lucide-react';

import { Alert } from '@/components/ui/alert';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button, buttonClasses } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress, Spinner } from '@/components/ui/progress';
import { ApiError } from '@/lib/api/client';
import { cancelJob } from '@/lib/api/endpoints';
import { formatBytes, isTerminalStatus, stageLabel } from '@/lib/format';
import { useJob } from '@/lib/use-job';

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

export default function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { job, result, error, loading, poll } = useJob(id);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  if (loading && !job) {
    return (
      <div className="flex justify-center py-24">
        <Spinner className="size-8" />
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
    <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Your download</h1>
          <p className="mt-1 max-w-md truncate text-sm text-muted-foreground">{job.url}</p>
        </div>
        <Badge tone={STATUS_TONE[job.status] ?? 'default'} data-testid="job-status">
          {stageLabel(job.status)}
        </Badge>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>{stageLabel(job.status)}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <Progress value={job.progress} label="Download progress" data-testid="job-progress" />

          <ol className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            {STEPS.map((s, i) => (
              <li
                key={s.key}
                className={`flex items-center gap-1.5 ${i <= step ? 'text-foreground' : ''}`}
                data-testid={`step-${s.key}`}
              >
                <span
                  className={`flex size-5 items-center justify-center rounded-full border text-[10px] font-semibold ${
                    i < step
                      ? 'border-success bg-success text-white'
                      : i === step
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border-strong'
                  }`}
                >
                  {i < step ? '✓' : i + 1}
                </span>
                <span className="hidden sm:inline">{s.label}</span>
              </li>
            ))}
          </ol>

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

          {job.status === 'completed' && result && (
            <div
              className="rounded-md border border-success/30 bg-success/8 p-4"
              data-testid="result-card"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    media.{result.container ?? 'mp4'}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {size && `${size} · `}
                    link expires {new Date(result.expiresAt).toLocaleString()}
                  </p>
                </div>
                <a
                  href={result.url}
                  download
                  data-testid="download-link"
                  className={buttonClasses({ size: 'sm', className: 'shrink-0' })}
                >
                  <Download className="size-4" aria-hidden="true" />
                  Download file
                </a>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between gap-3 pt-1">
            <Link href="/download" className="text-sm text-primary hover:underline">
              New download
            </Link>
            {active && (
              <Button
                variant="outline"
                size="sm"
                loading={cancelling}
                onClick={() => void onCancel()}
                data-testid="cancel-job"
              >
                <XCircle className="size-4" aria-hidden="true" />
                Cancel
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
