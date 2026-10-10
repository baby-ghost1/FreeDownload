import { createHash, createHmac } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';

import { config } from '../server/config.js';
import { logger } from '../logging/logger.js';
import type { Storage, StoredObject } from './types.js';

/**
 * R2 storage via S3-compatible SigV4 - no SDK dependency: presigned GETs
 * for the browser (TTL'd, contract invariant 5), presigned PUT for upload,
 * signed DELETE for purge.
 */

const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const REGION = 'auto';

interface Credentials {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  endpoint?: string | undefined;
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/** RFC3986 encoding - AWS rejects JavaScript's default `!'()*` leakage. */
export function uriEncode(value: string, encodeSlash = true): string {
  return encodeURIComponent(value)
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%2F/g, encodeSlash ? '%2F' : '/');
}

function endpointFor(creds: Credentials): string {
  return (
    creds.endpoint?.replace(/\/$/, '') ?? `https://${creds.accountId}.r2.cloudflarestorage.com`
  );
}

function objectUrl(creds: Credentials, key: string): URL {
  const encodedKey = key
    .split('/')
    .map((p) => uriEncode(p))
    .join('/');
  return new URL(`${endpointFor(creds)}/${uriEncode(creds.bucket)}/${encodedKey}`);
}

function signingKey(secret: string, dateStamp: string): Buffer {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, dateStamp), REGION), 's3'), 'aws4_request');
}

function canonicalQuery(params: URLSearchParams): string {
  return [...params.entries()]
    .map(([k, v]) => [uriEncode(k), uriEncode(v)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
}

export interface PresignInput {
  method: 'GET' | 'PUT';
  url: URL;
  accessKeyId: string;
  secretAccessKey: string;
  expiresAt: Date;
  now?: Date;
  /** Extra signed query params, e.g. S3 `response-content-disposition`. */
  responseParams?: Record<string, string>;
}

/**
 * Query-string-authenticated request URL. Pure and deterministic - the unit
 * test pins the signature for a fixed clock and key.
 */
export function presignRequest(input: PresignInput): string {
  const now = input.now ?? new Date();
  // 20261002T120000Z - ISO without dashes, colon and milliseconds.
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
  const date = stamp.slice(0, 8);
  const scope = `${date}/${REGION}/s3/aws4_request`;
  const expiresIn = Math.max(1, Math.floor((input.expiresAt.getTime() - now.getTime()) / 1000));

  const params = new URLSearchParams();
  if (input.responseParams) {
    for (const [k, v] of Object.entries(input.responseParams)) params.set(k, v);
  }
  params.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256');
  params.set('X-Amz-Credential', `${input.accessKeyId}/${scope}`);
  params.set('X-Amz-Date', stamp);
  params.set('X-Amz-Expires', String(expiresIn));
  params.set('X-Amz-SignedHeaders', 'host');

  const host = input.url.host;
  const canonicalRequest = [
    input.method,
    input.url.pathname,
    canonicalQuery(params),
    `host:${host}`,
    '',
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256Hex(canonicalRequest)].join('\n');

  const signature = createHmac('sha256', signingKey(input.secretAccessKey, date))
    .update(stringToSign, 'utf8')
    .digest('hex');

  params.set('X-Amz-Signature', signature);
  input.url.search = params.toString();
  return input.url.toString();
}

/** Header-authenticated request (DELETE) - used for purging objects. */
async function signedFetch(creds: Credentials, method: 'DELETE', key: string): Promise<Response> {
  const now = new Date();
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
  const date = stamp.slice(0, 8);
  const scope = `${date}/${REGION}/s3/aws4_request`;
  const url = objectUrl(creds, key);

  const headers: Record<string, string> = {
    host: url.host,
    'x-amz-content-sha256': EMPTY_SHA256,
    'x-amz-date': stamp,
  };
  const canonicalRequest = [
    method,
    url.pathname,
    '',
    `host:${headers.host}\nx-amz-content-sha256:${headers['x-amz-content-sha256']}\nx-amz-date:${stamp}`,
    '',
    'host;x-amz-content-sha256;x-amz-date',
    EMPTY_SHA256,
  ].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256Hex(canonicalRequest)].join('\n');
  const signature = createHmac('sha256', signingKey(creds.secretAccessKey, date))
    .update(stringToSign, 'utf8')
    .digest('hex');

  return fetch(url, {
    method,
    headers: {
      ...headers,
      authorization: `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${scope}, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=${signature}`,
    },
  });
}

function requireCreds(): Credentials {
  const r2 = config.storage.r2;
  if (!r2.accountId || !r2.accessKeyId || !r2.secretAccessKey || !r2.bucket) {
    throw new Error('R2 storage selected but R2_* configuration is incomplete');
  }
  return {
    accountId: r2.accountId,
    accessKeyId: r2.accessKeyId,
    secretAccessKey: r2.secretAccessKey,
    bucket: r2.bucket,
    endpoint: r2.endpoint,
  };
}

export const r2Storage: Storage = {
  driver: 'r2',

  async put(localPath, key, mimeType): Promise<StoredObject> {
    const creds = requireCreds();
    const s = await stat(localPath);
    const url = new URL(objectUrl(creds, key));
    const uploadUrl = presignRequest({
      method: 'PUT',
      url,
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
      expiresAt: new Date(Date.now() + 10 * 60_000),
    });

    const res = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': mimeType, 'content-length': String(s.size) },
      body: createReadStream(localPath),
      duplex: 'half',
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`R2 upload failed (${res.status}): ${text.slice(0, 200)}`);
    }

    // SHA-256 is computed locally so `files.checksum_sha256` stays trustworthy
    // even though R2 does not return it.
    const sha256 = await new Promise<string>((resolvePromise, reject) => {
      const hash = createHash('sha256');
      createReadStream(localPath)
        .on('data', (chunk) => hash.update(chunk))
        .on('end', () => resolvePromise(hash.digest('hex')))
        .on('error', reject);
    });
    return { key, sizeBytes: s.size, sha256 };
  },

  async signedUrl(key, ttlSec, options): Promise<string> {
    const creds = requireCreds();
    // Browsers save cross-origin links under the URL's last segment; the
    // signed disposition makes the on-device name deterministic instead.
    const filename = options?.filename ?? key.slice(key.lastIndexOf('/') + 1);
    return presignRequest({
      method: 'GET',
      url: objectUrl(creds, key),
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
      expiresAt: new Date(Date.now() + (ttlSec ?? config.storage.signedUrlTtlSec) * 1000),
      // Inline (playback) URLs omit the disposition entirely - an explicit
      // `download: false` is the only way to opt out of save-to-device.
      responseParams:
        options?.download === false
          ? undefined
          : { 'response-content-disposition': `attachment; filename="${filename}"` },
    });
  },

  async remove(key): Promise<void> {
    const creds = requireCreds();
    const res = await signedFetch(creds, 'DELETE', key).catch((err: unknown) => {
      logger.warn({ err, key }, 'R2 delete request failed');
      return null;
    });
    if (res && !res.ok && res.status !== 404) {
      logger.warn({ key, status: res.status }, 'R2 delete returned an error');
    }
  },
};
