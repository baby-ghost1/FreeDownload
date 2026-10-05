import { describe, expect, it } from 'vitest';

import { detectPlatform } from '@/lib/platform';

describe('detectPlatform', () => {
  it('detects known platforms with and without scheme', () => {
    expect(detectPlatform('https://www.youtube.com/watch?v=abc').id).toBe('youtube');
    expect(detectPlatform('youtu.be/abc').id).toBe('youtube');
    expect(detectPlatform('https://instagram.com/reel/abc').id).toBe('instagram');
    expect(detectPlatform('https://x.com/user/status/1').id).toBe('x');
    expect(detectPlatform('https://twitter.com/user/status/1').id).toBe('x');
    expect(detectPlatform('https://www.facebook.com/video/1').id).toBe('facebook');
    expect(detectPlatform('https://www.tiktok.com/@a/video/1').id).toBe('tiktok');
    expect(detectPlatform('https://www.twitch.tv/videos/1').id).toBe('twitch');
    expect(detectPlatform('https://vimeo.com/123').id).toBe('vimeo');
    expect(detectPlatform('https://www.dailymotion.com/video/xabc2iw').id).toBe('dailymotion');
    expect(detectPlatform('https://www.snapchat.com/spotlight/abc').id).toBe('snapchat');
    expect(detectPlatform('https://www.reddit.com/r/a/comments/1/x/').id).toBe('reddit');
    expect(detectPlatform('https://v.redd.it/abc123').id).toBe('reddit');
    expect(detectPlatform('https://rumble.com/v123-test.html').id).toBe('rumble');
    expect(detectPlatform('https://odysee.com/@a:b/xyz:1').id).toBe('odysee');
    expect(detectPlatform('https://www.bitchute.com/video/abc/').id).toBe('bitchute');
    expect(detectPlatform('https://www.zedge.net/ringtones/abc-123').id).toBe('zedge');
  });

  it('falls back to default for unknown, empty or invalid urls', () => {
    expect(detectPlatform('https://media.test/watch?v=abc').id).toBe('default');
    expect(detectPlatform('').id).toBe('default');
    expect(detectPlatform(null).id).toBe('default');
    expect(detectPlatform('not a url at all ___').id).toBe('default');
    expect(detectPlatform('https://fakeyoutube.com/watch').id).toBe('default');
  });
});
