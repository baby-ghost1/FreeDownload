import { describe, expect, it } from 'vitest';

import { presignRequest } from '../../src/storage/r2.js';
import { downloadFileName, jobObjectKey } from '../../src/storage/types.js';

describe('downloadFileName', () => {
  it('builds the dated unique name', () => {
    expect(
      downloadFileName(
        '01a0fc73-13a1-7d58-9974-48b3e537fd69',
        new Date('2026-10-07T20:07:56'),
        'mp4',
      ),
    ).toBe('FreeDownload_07-10-2026_Wed_200756_fd69.mp4');
  });

  it('stays inside the key/disposition charset and length budget', () => {
    const name = downloadFileName('!!!', new Date('2026-01-02T03:04:05'), '???');
    expect(name).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(name.length).toBeLessThan(120);
    expect(name).toContain('.mp4');
  });

  it('object keys carry the unique name, not media.ext', () => {
    expect(jobObjectKey('abc', 'webm')).toMatch(/^jobs\/abc\/FreeDownload_.*\.webm$/);
  });
});

describe('presignRequest response disposition', () => {
  const base = {
    method: 'GET' as const,
    url: new URL('https://acct.r2.cloudflarestorage.com/bucket/jobs/abc/f.mp4'),
    accessKeyId: 'AKIAFDFREE00000000',
    secretAccessKey: 'secret-key-for-tests',
    now: new Date('2026-10-02T12:00:00.000Z'),
  };
  const expiresAt = new Date('2026-10-02T12:05:00.000Z');

  it('signs response-content-disposition only when asked', () => {
    const plain = presignRequest({ ...base, expiresAt });
    expect(plain).not.toContain('response-content-disposition');
    const sig = (u: string) => /X-Amz-Signature=([a-f0-9]+)/.exec(u)?.[1];
    const withDisposition = presignRequest({
      ...base,
      expiresAt,
      responseParams: { 'response-content-disposition': 'attachment; filename="f.mp4"' },
    });
    expect(withDisposition).toContain('response-content-disposition=');
    expect(sig(withDisposition)).not.toBe(sig(plain));
  });
});
