'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';

import { Alert } from '@/components/ui/alert';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button, buttonClasses } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Spinner } from '@/components/ui/progress';
import { ApiError } from '@/lib/api/client';
import { listJobs } from '@/lib/api/endpoints';
import type { Job } from '@/lib/api/types';
import { stageLabel } from '@/lib/format';

const TONE: Record<string, BadgeTone> = {
  completed: 'success',
  failed: 'danger',
  dead_letter: 'danger',
  policy_restricted: 'danger',
  cancelled: 'muted',
  expired: 'muted',
  retrying: 'warning',
};

export default function MyDownloadsPage() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listJobs(50)
      .then((r) => setJobs(r.data))
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.message : 'Could not load your downloads.'),
      );
  }, []);

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">My downloads</h1>
        <Link href="/download" className={buttonClasses({ size: 'sm' })}>
          New download
        </Link>
      </div>

      {error && (
        <Alert tone="error" className="mt-5">
          {error}
        </Alert>
      )}

      {jobs === null && !error && (
        <div className="flex justify-center py-16">
          <Spinner className="size-7" />
        </div>
      )}

      {jobs?.length === 0 && (
        <Card className="mt-6">
          <CardContent className="py-12 text-center">
            <Download className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
            <p className="mt-3 text-sm text-muted-foreground">
              No downloads yet — paste a link to get started.
            </p>
            <Button className="mt-5" onClick={() => window.location.assign('/download')}>
              Start a download
            </Button>
          </CardContent>
        </Card>
      )}

      {jobs && jobs.length > 0 && (
        <ul className="mt-6 space-y-3">
          {jobs.map((job) => (
            <li key={job.id}>
              <Link
                href={`/downloads/${job.id}`}
                className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 shadow-1 transition-colors hover:border-primary/50"
                data-testid="history-item"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {job.url ?? 'Expired link'}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {new Date(job.createdAt).toLocaleString()}
                    {job.requestedFormat ? ` · ${job.requestedFormat}` : ''}
                  </span>
                </span>
                <Badge tone={TONE[job.status] ?? 'default'}>{stageLabel(job.status)}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
