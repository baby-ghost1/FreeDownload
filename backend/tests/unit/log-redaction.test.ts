import { pino } from 'pino';

import { describe, expect, it } from 'vitest';

import { REDACT_OPTIONS } from '../../src/logging/logger.js';

/**
 * The production logger's exact redaction config, replayed against an
 * in-memory stream - asserts that credentials, cookies and user URLs are
 * censored while ordinary fields survive untouched.
 */
function capture() {
  const lines: string[] = [];
  const logger = pino(
    { level: 'trace', redact: REDACT_OPTIONS },
    {
      write: (chunk: string) => {
        lines.push(chunk);
      },
    },
  );
  return { lines, logger };
}

describe('log redaction (contract §22, §51)', () => {
  it('censors every secret-bearing field at any nesting depth', () => {
    const { lines, logger } = capture();

    logger.trace(
      {
        password: 'hunter2',
        newPassword: 'hunter3',
        token: 'tok-123',
        tokenHash: 'deadbeef',
        apiKey: 'fd_live_supersecret',
        secret: 'shhh',
        authorization: 'Bearer abc.def',
        cookie: 'fd_session=xyz',
        sessionToken: 'sess-abc',
        url: 'https://example.com/watch?v=private',
        urlRedacted: 'https://example.com/watch',
        req: {
          headers: {
            authorization: 'Bearer abc.def',
            cookie: 'fd_session=xyz',
            'user-agent': 'vitest',
          },
        },
        nested: { password: 'deep', token: 'deep-token', apiKey: 'deep-key' },
        email: 'ada@example.com',
        requestId: 'req-01abcdef',
      },
      'sensitive payload',
    );

    const text = lines.join('');
    expect(text).toContain('[REDACTED]');

    for (const secret of [
      'hunter2',
      'hunter3',
      'tok-123',
      'deep-token',
      'fd_live_supersecret',
      'deep-key',
      'shhh',
      'Bearer abc.def',
      'fd_session=xyz',
      'sess-abc',
      'https://example.com/watch?v=private',
      'deep',
    ]) {
      expect(text).not.toContain(secret);
    }

    // Non-sensitive context must survive - redaction is surgical.
    expect(text).toContain('ada@example.com');
    expect(text).toContain('req-01abcdef');
    expect(text).toContain('vitest');
  });

  it('censors set-cookie headers on logged responses', () => {
    const { lines, logger } = capture();

    logger.info(
      {
        res: { headers: { 'set-cookie': 'fd_session=xyz; HttpOnly' } },
      },
      'response',
    );

    const text = lines.join('');
    expect(text).not.toContain('fd_session=xyz');
    expect(text).toContain('[REDACTED]');
  });
});
