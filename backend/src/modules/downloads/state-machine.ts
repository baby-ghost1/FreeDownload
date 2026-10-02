import { and, eq, inArray, type SQL } from 'drizzle-orm';

import { AppError } from '../../errors/app-error.js';
import type { Database } from '../../database/client.js';
import { downloadJobs, type DownloadJob } from '../../database/schema/index.js';

/** Statuses a job can hold — mirrors the `download_jobs.status` column. */
export type JobStatus = DownloadJob['status'];

/**
 * Legal transitions (contract §Job lifecycle). Anything not listed here is
 * rejected, so a buggy worker can never resurrect a terminal job.
 */
export const TRANSITIONS: Readonly<Record<JobStatus, readonly JobStatus[]>> = {
  created: ['validating', 'cancelled'],
  validating: ['queued', 'policy_restricted', 'failed', 'cancelled'],
  queued: ['analyzing', 'failed', 'cancelled'],
  // A source can also be policy-blocked mid-flight (admin disabled it, the
  // extractor resolved to a private address) — those must not retry.
  analyzing: ['ready', 'failed', 'retrying', 'policy_restricted', 'cancelled'],
  ready: ['processing', 'failed', 'policy_restricted', 'cancelled'],
  processing: ['uploading', 'failed', 'policy_restricted', 'cancelled'],
  uploading: ['completed', 'failed', 'cancelled'],
  completed: ['expired'],
  failed: ['retrying', 'dead_letter', 'cancelled'],
  retrying: ['queued', 'analyzing', 'dead_letter', 'cancelled'],
  policy_restricted: ['cancelled'],
  cancelled: [],
  expired: [],
  dead_letter: [],
};

export const JOB_STATUSES = Object.keys(TRANSITIONS) as JobStatus[];

export const TERMINAL_STATUSES: readonly JobStatus[] = [
  'completed',
  'expired',
  'cancelled',
  'dead_letter',
  'policy_restricted',
];

export function isTerminal(status: JobStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export interface TransitionInput {
  jobId: string;
  /** Allowed current statuses — the optimistic concurrency guard. */
  from: readonly JobStatus[];
  to: JobStatus;
  /** Extra columns written atomically with the status change. */
  patch?: Partial<DownloadJob>;
  /**
   * When set, the update only lands if this worker still holds the lease —
   * a worker that lost its lease can no longer mutate the job.
   */
  leaseToken?: string;
  /** Skip the error and return null when the guard fails. */
  soft?: boolean;
}

/**
 * Optimistic state transition: `UPDATE … WHERE status = ANY(from)`.
 * A zero-row update means someone else moved the job first — we abort rather
 * than clobbering (contract §Job lifecycle).
 */
export async function transitionJob(
  db: Database,
  input: TransitionInput,
): Promise<DownloadJob | null> {
  if (input.from.length > 0 && !input.from.every((s) => canTransition(s, input.to))) {
    // Each allowed source must be able to reach `to`; otherwise the caller
    // would silently bypass the state machine.
    const illegal = input.from.filter((s) => !canTransition(s, input.to));
    throw new Error(`illegal transition(s): ${illegal.join(', ')} → ${input.to}`);
  }

  const where: SQL[] = [
    eq(downloadJobs.id, input.jobId),
    inArray(downloadJobs.status, [...input.from]),
  ];
  if (input.leaseToken !== undefined) {
    where.push(eq(downloadJobs.leaseToken, input.leaseToken));
  }

  const rows = await db
    .update(downloadJobs)
    .set({ ...input.patch, status: input.to })
    .where(and(...where))
    .returning();

  const updated = rows[0];
  if (updated) return updated;

  if (input.soft) return null;

  const current = await db
    .select({ status: downloadJobs.status })
    .from(downloadJobs)
    .where(eq(downloadJobs.id, input.jobId))
    .limit(1);

  if (current.length === 0) {
    throw new AppError('NOT_FOUND', 'Download job not found.');
  }
  throw new AppError(
    'CONFLICT',
    `Job is ${current[0]!.status} — expected ${input.from.join(' or ')}.`,
  );
}
