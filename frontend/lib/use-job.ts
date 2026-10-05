'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError } from '@/lib/api/client';
import { getJob, getJobResult } from '@/lib/api/endpoints';
import type { Job, JobResult } from '@/lib/api/types';
import { isTerminalStatus } from '@/lib/format';

export interface JobWatch {
  job: Job | null;
  result: JobResult | null;
  error: ApiError | null;
  /** True while the first load has not settled. */
  loading: boolean;
  poll: () => Promise<void>;
  cancelWatch: () => void;
}

/**
 * Polls a job until it reaches a terminal state. Failed jobs keep polling -
 * the retry loop may lift them back to `queued`, and only `dead_letter`
 * (or a user cancel) actually stops the watch.
 */
export function useJob(id: string, intervalMs = 1_500): JobWatch {
  const [job, setJob] = useState<Job | null>(null);
  const [result, setResult] = useState<JobResult | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopped = useRef(false);
  // The backend re-signs the file URL on every /result call with a fresh
  // expiry - refetching would restart the countdown (and swap the link)
  // under the user. Pin the first good result; a page reload fetches fresh.
  const resultPinned = useRef(false);

  const poll = useCallback(async () => {
    try {
      const next = await getJob(id);
      if (stopped.current) return;
      setJob(next);
      setError(null);
      if (next.status === 'completed' && !resultPinned.current) {
        try {
          const fresh = await getJobResult(id);
          if (stopped.current) return;
          setResult(fresh);
          resultPinned.current = true;
        } catch (err) {
          // A 404 here means the file was purged - surfaced via `result===null`.
          if (err instanceof ApiError && err.status !== 404) throw err;
        }
      }
    } catch (err) {
      if (!stopped.current && err instanceof ApiError) setError(err);
    } finally {
      if (!stopped.current) setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    stopped.current = false;
    resultPinned.current = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-time poll; all setState happens after the fetch settles
    void poll();
    timer.current = setInterval(() => {
      void (async () => {
        // Skip a beat while the tab is hidden - catches up on focus.
        if (typeof document !== 'undefined' && document.hidden) return;
        await poll();
      })();
    }, intervalMs);

    const onFocus = () => void poll();
    window.addEventListener('focus', onFocus);

    return () => {
      stopped.current = true;
      if (timer.current) clearInterval(timer.current);
      window.removeEventListener('focus', onFocus);
    };
  }, [poll, intervalMs]);

  // Stop ticking once we know the outcome (poll itself still runs on demand).
  useEffect(() => {
    if (job && isTerminalStatus(job.status) && timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }, [job]);

  const cancelWatch = useCallback(() => {
    stopped.current = true;
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  }, []);

  return { job, result, error, loading, poll, cancelWatch };
}
