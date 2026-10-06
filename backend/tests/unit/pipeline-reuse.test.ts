import { describe, expect, it, vi } from 'vitest';

const { events, fakeDownload } = vi.hoisted(() => ({
  events: [] as Array<string>,
  fakeDownload: vi.fn(),
}));

const JOB_ROW = {
  id: 'job-1',
  status: 'queued',
  url: 'https://x.test/v',
  sourceId: 'src-1',
  requestedFormat: 'best.mp4',
  targetContainer: 'mp4',
};

vi.mock('../../src/database/client.js', async (importOriginal: () => Promise<Record<string, unknown>>) => {
  const actual = await importOriginal();
  const schema = (await import('../../src/database/schema/index.js')) as unknown as {
    mediaFormats: object;
  };
  return {
    ...actual,
    getDb: () => ({
      select: () => ({
        from: (table: unknown) => ({
          where: () => ({
            limit: async () =>
            table === schema.mediaFormats
              ? [
                  {
                    id: 'fmt-1',
                    extKey: 'best.mp4',
                    label: 'Best available (MP4)',
                    container: 'mp4',
                    height: null,
                    kind: 'video',
                  },
                ]
              : [{ ...JOB_ROW }],
          }),
        }),
      }),
    }),
  };
});

vi.mock('../../src/downloader/policy.js', () => ({
  loadSourcePolicy: async () => ({ maxFileSizeMb: 512 }),
  assertSourceUsable: () => undefined,
}));

vi.mock('../../src/downloader/detector.js', () => ({
  getAdapterForUrl: () => ({
    key: 'fake',
    canHandle: () => true,
    analyze: async () => {
      throw new Error('must not re-analyze on the reuse path');
    },
    download: async (...args: unknown[]) => {
      events.push('download');
      return fakeDownload(...args);
    },
  }),
  registerAdapter: () => undefined,
  listAdapters: () => [{ key: 'fake' }],
}));

import { SourceError } from '../../src/downloader/errors.js';
import { runnerControls } from '../../src/workers/runner.js';
import { activeRunner } from '../../src/workers/pipeline.js';

describe('pipeline reuse path (regression)', () => {
  it('emits analyzing → ready before downloading on retry with saved formats', async () => {
    const originalMode = runnerControls.mode;
    runnerControls.mode = 'pipeline';
    events.length = 0;
    fakeDownload.mockRejectedValueOnce(
      new SourceError('SOURCE_INTEGRITY', 'The downloaded file is not recognized media.'),
    );

    const transitions: Array<{ from: string[]; to: string }> = [];
    const ctx = {
      jobId: 'job-1',
      signal: AbortSignal.timeout(10_000),
      report: async (_progress: number, transition?: { from: string[]; to: string }) => {
        events.push(`report:${transition ? `${transition.from.join('/')}>${transition.to}` : 'beat'}`);
        if (transition) transitions.push(transition);
      },
    };

    try {
      await expect(activeRunner().run(ctx)).rejects.toMatchObject({ name: 'SourceError' });
    } finally {
      runnerControls.mode = originalMode;
    }

    // The download must have been attempted (proves we reached downloadPhase).
    expect(events).toContain('download');
    // ...but only AFTER the analyzing → ready hop. Skipping it leaves the
    // row in `analyzing`, and every later `processing → ...` transition
    // aborts with "job left processing" on every single retry.
    const readyIdx = events.findIndex((e) => e === 'report:analyzing>ready');
    expect(readyIdx).toBeGreaterThanOrEqual(0);
    expect(readyIdx).toBeLessThan(events.indexOf('download'));
  });
});
