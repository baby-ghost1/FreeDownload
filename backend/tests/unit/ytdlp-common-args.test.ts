import { describe, expect, it } from 'vitest';

import { buildCommonArgs } from '../../src/downloader/executors/ytdlp.js';

describe('buildCommonArgs', () => {
  it('always enables the node JS runtime', () => {
    expect(buildCommonArgs({})).toEqual(['--js-runtimes', 'node']);
  });

  it('adds extractor args, proxy and cookies when provided', () => {
    expect(
      buildCommonArgs({
        extractorArgs: 'youtube:player_client=tv_simply,web_safari,mweb',
        proxy: 'socks5://127.0.0.1:1080',
        cookiesPath: '/tmp/fd-cookies.txt',
      }),
    ).toEqual([
      '--js-runtimes',
      'node',
      '--extractor-args',
      'youtube:player_client=tv_simply,web_safari,mweb',
      '--proxy',
      'socks5://127.0.0.1:1080',
      '--cookies',
      '/tmp/fd-cookies.txt',
    ]);
  });

  it('skips unset or empty optional flags', () => {
    expect(buildCommonArgs({ extractorArgs: '', proxy: null, cookiesPath: undefined })).toEqual([
      '--js-runtimes',
      'node',
    ]);
  });
});
