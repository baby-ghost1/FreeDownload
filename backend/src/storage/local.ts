import { createHash, createHmac } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, rm, stat } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

import { config } from '../server/config.js';
import type { Storage, StoredObject } from './types.js';

/**
 * Local filesystem storage - development and tests only. Signed URLs point
 * back at the API (`GET /api/v1/files/...`) with an HMAC token carrying its
 * own expiry, mirroring R2's TTL behaviour. Production uses R2; the API
 * never serves bytes outside this driver.
 */

const root = (): string => resolve(process.cwd(), config.storage.localDir);

function signingSecret(): string {
  return config.session.secret || 'fd-local-storage-dev-secret';
}

export function signFileToken(key: string, expiresAtSec: number): string {
  return createHmac('sha256', signingSecret()).update(`${key}:${expiresAtSec}`).digest('base64url');
}

export function verifyFileToken(key: string, expiresAtSec: number, sig: string): boolean {
  if (!Number.isFinite(expiresAtSec) || expiresAtSec * 1000 < Date.now()) return false;
  const expected = signFileToken(key, expiresAtSec);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Small helper so the comparison stays branch-light.
function timingSafeEqual(a: Buffer, b: Buffer): boolean {
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

function resolveObjectPath(key: string): string {
  const full = resolve(root(), key);
  // Keys are server-generated, but never trust a key to stay in the root.
  if (!full.startsWith(root() + sep)) {
    throw new Error('object key escapes the storage root');
  }
  return full;
}

async function sha256File(path: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolvePromise(hash.digest('hex')))
      .on('error', reject);
  });
}

export const localStorage: Storage = {
  driver: 'local',

  async put(localPath, key): Promise<StoredObject> {
    const target = resolveObjectPath(key);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(localPath, target);
    const s = await stat(target);
    return { key, sizeBytes: s.size, sha256: await sha256File(target) };
  },

  async signedUrl(key, ttlSec): Promise<string> {
    // The /files route sets Content-Disposition from the key's last segment,
    // which already carries the unique download name - nothing to add here.
    const ttl = ttlSec ?? config.storage.signedUrlTtlSec;
    const exp = Math.floor(Date.now() / 1000) + ttl;
    const sig = signFileToken(key, exp);
    const url = new URL(`/api/v1/files/${encodeURI(key)}`, config.apiUrl);
    url.searchParams.set('exp', String(exp));
    url.searchParams.set('sig', sig);
    return url.toString();
  },

  async remove(key): Promise<void> {
    await rm(resolveObjectPath(key), { force: true });
  },
};

/** Path for the serving route; throws when the key escapes the root. */
export function localObjectPath(key: string): string {
  return resolveObjectPath(key);
}
