import { eq } from 'drizzle-orm';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/server/app.js';
import { closeDatabase, getDb } from '../../src/database/client.js';
import { closeRedis } from '../../src/redis/client.js';
import { closeQueues } from '../../src/queue/queues.js';
import { seed } from '../../src/database/seed.js';
import { downloadAttempts } from '../../src/database/schema/index.js';
import { QUEUE_NAMES, getQueue } from '../../src/queue/queues.js';
import { createDownloadWorker } from '../../src/workers/download-worker.js';
import { runnerControls } from '../../src/workers/runner.js';
import type { AppInstance } from '../../src/types/app.js';
import { infraAvailable, inCi } from '../helpers/infra.js';

const infraUp = await infraAvailable();
const describeInfra = describe.runIf(infraUp || inCi);

const ANON_KEY = 'worker-anon-key-1';

interface JobView {
  id: string;
  status: string;
  progress: number;
  completedAt: string | null;
}

describeInfra('download worker (integration)', () => {
  let app: AppInstance;
  let worker: ReturnType<typeof createDownloadWorker>;

  beforeAll(async () => {
    await seed();
    app = await buildApp({ rateLimit: false });
    await app.ready();

    // Leftovers from earlier runs (or other test files) must not occupy the
    // single worker slot or swallow the simulated crash.
    const queue = getQueue(QUEUE_NAMES.downloads);
    await queue.drain(true).catch(() => undefined);
    await queue.clean(0, 1000, 'failed').catch(() => undefined);

    worker = createDownloadWorker(1);
    await worker.waitUntilReady();
  });

  afterEach(() => {
    runnerControls.failNext = 0;
  });

  afterAll(async () => {
    await worker.close();
    await app.close();
    await closeQueues();
    await closeDatabase();
    await closeRedis();
  });

  async function createJob(path: string): Promise<JobView> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/downloads',
      headers: { 'x-anon-key': ANON_KEY },
      payload: { url: `https://example.com/${path}` },
    });
    expect(res.statusCode).toBe(201);
    return res.json() as JobView;
  }

  async function readJob(id: string): Promise<JobView> {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/downloads/${id}`,
      headers: { 'x-anon-key': ANON_KEY },
    });
    expect(res.statusCode).toBe(200);
    return res.json() as JobView;
  }

  async function waitForTerminal(id: string, timeoutMs: number): Promise<JobView> {
    const deadline = Date.now() + timeoutMs;
    let last: JobView | undefined;
    while (Date.now() < deadline) {
      last = await readJob(id);
      if (['completed', 'failed', 'dead_letter', 'cancelled', 'expired'].includes(last.status)) {
        return last;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`job ${id} never finished (last status: ${last?.status})`);
  }

  it('drives a job through every stage to completed', async () => {
    const created = await createJob('v/happy-path');
    const final = await waitForTerminal(created.id, 20_000);

    expect(final.status).toBe('completed');
    expect(final.progress).toBe(100);
    expect(final.completedAt).toBeTruthy();

    const attempts = await getDb()
      .select()
      .from(downloadAttempts)
      .where(eq(downloadAttempts.jobId, created.id));
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.status).toBe('succeeded');
    expect(attempts[0]!.durationMs).not.toBeNull();
  }, 30_000);

  it('recovers a crashed job once its lease expires', async () => {
    runnerControls.failNext = 1;
    const startedAt = Date.now();

    const created = await createJob('v/crash-recovery');
    const final = await waitForTerminal(created.id, 40_000);

    // Recovery is gated on the lease, not on the first retry: the dead
    // worker's lease had to lapse before another attempt could run.
    expect(final.status).toBe('completed');
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(3_000);

    const attempts = await getDb()
      .select()
      .from(downloadAttempts)
      .where(eq(downloadAttempts.jobId, created.id))
      .orderBy(downloadAttempts.attemptNo);

    expect(attempts.length).toBeGreaterThanOrEqual(2);
    // Attempt 1 never reported back — the reclaim pass closed it out.
    expect(attempts[0]!.attemptNo).toBe(1);
    expect(attempts[0]!.status).toBe('failed');
    expect(attempts[0]!.errorCode).toBe('LEASE_EXPIRED');
    // A later attempt picked the job up and finished it.
    expect(attempts.some((a) => a.status === 'succeeded')).toBe(true);
  }, 60_000);
});
