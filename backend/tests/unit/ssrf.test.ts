import { describe, expect, it } from 'vitest';

import { isBlockedIp, assertSafeUrl, assertSafeAnalysisUrls } from '../../src/security/ssrf.js';

const rejects = async (url: string, allowPrivate = false): Promise<void> => {
  await expect(assertSafeUrl(url, { allowPrivate })).rejects.toMatchObject({
    code: 'VALIDATION_ERROR',
  });
};

const allows = async (url: string, allowPrivate = false): Promise<void> => {
  await expect(assertSafeUrl(url, { allowPrivate })).resolves.toBeUndefined();
};

describe('ssrf: blocked IP ranges', () => {
  it.each([
    '127.0.0.1',
    '127.255.255.254',
    '0.0.0.0',
    '10.0.0.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254', // cloud metadata
    '100.64.0.1', // CGNAT
    '192.0.0.1',
    '198.18.0.1',
    '224.0.0.1', // multicast
    '255.255.255.255',
    '0.1.2.3',
  ])('blocks IPv4 %s', (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });

  it.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '192.0.1.1', '198.20.0.1', '100.63.255.255'])(
    'allows public IPv4 %s',
    (ip) => {
      expect(isBlockedIp(ip)).toBe(false);
    },
  );

  it.each([
    '::1',
    '::',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'ff02::1',
    '2001:db8::1',
    '::ffff:127.0.0.1', // v4-mapped loopback
    '::ffff:7f00:1', // hex-mapped loopback
    '::ffff:169.254.169.254',
  ])('blocks IPv6 %s', (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });

  it.each(['2606:4700:4700::1111', '::ffff:8.8.8.8', '::ffff:0101:0101'])(
    'allows public IPv6 %s',
    (ip) => {
      expect(isBlockedIp(ip)).toBe(false);
    },
  );

  it('treats non-IP input as blocked', () => {
    expect(isBlockedIp('not-an-ip')).toBe(true);
  });
});

describe('ssrf: URL entry checks', () => {
  it('rejects non-http schemes', async () => {
    await rejects('ftp://example.com/file');
    await rejects('file:///etc/passwd');
    await rejects('gopher://example.com/');
  });

  it('rejects embedded credentials', async () => {
    await rejects('https://user:pass@example.com/');
  });

  it('rejects disallowed ports before any DNS work', async () => {
    await rejects('https://example.com:8443/');
    await rejects('http://example.com:22/');
  });

  it('rejects localhost and internal suffixes', async () => {
    await rejects('http://localhost/admin');
    await rejects('http://api.internal/secrets');
    await rejects('http://printer.local/queue');
    await rejects('http://metadata.google.internal/computeMetadata/');
    await rejects('http://something.onion/');
  });

  it('rejects IP literals in private ranges', async () => {
    await rejects('http://127.0.0.1/');
    await rejects('http://169.254.169.254/latest/meta-data/');
    await rejects('http://192.168.0.10/router');
    await rejects('http://[fd00::1]/');
  });

  it('accepts public IP literals without DNS', async () => {
    await allows('http://8.8.8.8/');
    await allows('https://1.1.1.1/');
  });

  it('allowPrivate (tests only) skips hostname and range checks', async () => {
    await allows('http://localhost:39271/clip.mp4', true);
    await allows('http://127.0.0.1:39271/', true);
    await allows('http://fixture.test:8080/', true);
  });
});

describe('ssrf: post-analysis URL sweep', () => {
  it('rejects when any reported URL points at a private host', async () => {
    await expect(
      assertSafeAnalysisUrls(['https://cdn.example.com/v.mp4', 'http://127.0.0.1/x'], {
        allowPrivate: false,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('ignores relative and junk entries, dedupes hosts', async () => {
    await expect(
      assertSafeAnalysisUrls(['/relative.mp4', null, undefined, 'not a url'], {
        allowPrivate: false,
      }),
    ).resolves.toBeUndefined();
  });

  it('passes clean analysis output through', async () => {
    await expect(
      assertSafeAnalysisUrls(['https://example.com/watch?v=1', 'https://example.com/thumb.jpg'], {
        allowPrivate: false,
      }),
    ).resolves.toBeUndefined();
  });
});
