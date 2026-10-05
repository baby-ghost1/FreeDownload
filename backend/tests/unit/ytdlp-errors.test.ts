import { describe, expect, it } from 'vitest';

import {
  classifyExtractorFailure,
  pickVideoPayload,
} from '../../src/downloader/executors/ytdlp.js';

describe('classifyExtractorFailure', () => {
  it('maps timeouts to SOURCE_TIMEOUT', () => {
    expect(
      classifyExtractorFailure('ERROR: [TikTok] 123: Unable to download webpage: connection timed out'),
    ).toMatchObject({ code: 'SOURCE_TIMEOUT' });
    expect(classifyExtractorFailure('ERROR: something timed out after 15 seconds').code).toBe(
      'SOURCE_TIMEOUT',
    );
  });

  it('maps login walls to a login message', () => {
    const r = classifyExtractorFailure(
      'ERROR: [vimeo] 123: The web client only works when logged-in. Use --cookies to pass credentials',
    );
    expect(r.code).toBe('SOURCE_UNAVAILABLE');
    expect(r.message).toMatch(/login/i);
  });

  it('maps removed/private/geo videos to an unavailable message', () => {
    for (const stderr of [
      'ERROR: [youtube] abc: Private video',
      'ERROR: Video unavailable. This video has been removed',
      'ERROR: [twitter] 123: No video could be found in this tweet',
      'ERROR: HTTP Error 404: Not Found',
    ]) {
      const r = classifyExtractorFailure(stderr);
      expect(r.code).toBe('SOURCE_UNAVAILABLE');
      expect(r.message).toMatch(/unavailable/i);
    }
  });

  it('prefers the login message when a private video asks to sign in', () => {
    const r = classifyExtractorFailure(
      'ERROR: [youtube] abc: Private video. Sign in if you have access',
    );
    expect(r.code).toBe('SOURCE_UNAVAILABLE');
    expect(r.message).toMatch(/login/i);
  });

  it('maps bot blocks to a try-later message', () => {
    const r = classifyExtractorFailure(
      'ERROR: This request has been blocked due to its TLS fingerprint',
    );
    expect(r.code).toBe('SOURCE_UNAVAILABLE');
    expect(r.message).toMatch(/wait a few minutes/i);
  });

  it('falls back to a generic readable message', () => {
    const r = classifyExtractorFailure('ERROR: [facebook] 123: Cannot parse data');
    expect(r).toMatchObject({ code: 'SOURCE_EXTRACT_FAILED' });
    expect(r.message).not.toMatch(/\[facebook\]/);
  });
});

describe('pickVideoPayload', () => {
  it('passes single videos through untouched', () => {
    const raw = { id: 'abc', formats: [{ ext: 'mp4' }] };
    expect(pickVideoPayload(raw)).toBe(raw);
  });

  it('uses the first playable entry of a carousel playlist', () => {
    const playable = { id: 'second', formats: [{ ext: 'mp4', height: 720 }] };
    const out = pickVideoPayload({
      _type: 'playlist',
      entries: [{ id: 'first' }, playable],
    });
    expect(out).toBe(playable);
  });

  it('rejects collections with nothing playable', () => {
    expect(() => pickVideoPayload({ _type: 'playlist', entries: [{ id: 'a' }] })).toThrow(
      /not a single video/,
    );
    expect(() => pickVideoPayload({ _type: 'playlist', entries: [] })).toThrow(
      /not a single video/,
    );
  });
});
