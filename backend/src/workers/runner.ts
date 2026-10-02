import { config } from '../server/config.js';
import type { JobStatus } from '../modules/downloads/state-machine.js';

export interface RunnerContext {
  jobId: string;
  /** Aborted on timeout, lease loss or cancellation. */
  signal: AbortSignal;
  /**
   * Heartbeat + progress. When `transition` is given the job moves to the
   * next lifecycle stage atomically; a failed guard means someone else
   * changed the job (cancel/expire) and the run must stop.
   */
  report(progress: number, transition?: { from: JobStatus[]; to: JobStatus }): Promise<void>;
}

export interface JobRunner {
  run(ctx: RunnerContext): Promise<void>;
}

/** Thrown when the job is no longer ours to work on. */
export class JobAbortedError extends Error {
  constructor(message = 'job aborted') {
    super(message);
    this.name = 'JobAbortedError';
  }
}

/**
 * Emulates the worker process dying mid-job: the handler must leave the
 * lease, the attempt row and the status untouched, exactly as a kill -9
 * would. Recovery then depends on the lease expiring.
 */
export class SimulatedCrashError extends Error {
  constructor(message = 'simulated worker crash') {
    super(message);
    this.name = 'SimulatedCrashError';
  }
}

/**
 * Test seam: the next N runs die as if the worker process crashed. Used by
 * the crash-recovery test to prove leases expire and work is redelivered.
 */
export const runnerControls = { failNext: 0 };

export function abortError(signal: AbortSignal): JobAbortedError {
  return new JobAbortedError(signal.reason === 'timeout' ? 'job timed out' : 'job aborted');
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError(signal));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError(signal));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

const STAGES: ReadonlyArray<{
  from: JobStatus;
  to: JobStatus;
  progress: number;
  delayMs: number;
}> = [
  { from: 'analyzing', to: 'ready', progress: 30, delayMs: 40 },
  { from: 'ready', to: 'processing', progress: 60, delayMs: 40 },
  { from: 'processing', to: 'uploading', progress: 90, delayMs: 40 },
];

/**
 * Phase 3 placeholder for the real download pipeline.
 *
 * It exercises the *job system* end-to-end (stages, progress, heartbeat,
 * failure and recovery) without touching the network. Phase 4 replaces it
 * with the SourceAdapter + FFmpeg + R2 pipeline behind the same interface.
 */
export const placeholderRunner: JobRunner = {
  async run(ctx: RunnerContext): Promise<void> {
    if (runnerControls.failNext > 0) {
      runnerControls.failNext -= 1;
      throw new SimulatedCrashError();
    }

    // A four-stage run fits comfortably inside JOB_TIMEOUT_MS.
    void config.queue.jobTimeoutMs;

    await ctx.report(5);
    for (const stage of STAGES) {
      await sleep(stage.delayMs, ctx.signal);
      await ctx.report(stage.progress, { from: [stage.from], to: stage.to });
    }
  },
};
