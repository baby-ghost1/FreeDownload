import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import { AppError } from '../errors/app-error.js';
import { config } from '../server/config.js';

/**
 * SSRF protection (security layer 3): user URLs are never handed to a
 * network client until the host resolves to public addresses only.
 *
 * yt-dlp resolves DNS itself, so we additionally validate every URL it
 * reports back (final page URL, media URLs) before any bytes are stored —
 * `assertSafeAnalysisUrls`. First-party HTTP clients must call
 * `assertSafeUrl` per hop, re-validating after every redirect (max 5).
 */

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'instance-data', // AWS/GCP instance metadata aliases
]);

const BLOCKED_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.intranet',
  '.lan',
  '.home',
  '.corp',
  '.localdomain',
  '.onion',
];

/** Only the standard web ports; everything else must be explicitly allowed. */
const ALLOWED_PORTS = new Set(['80', '443', '']);

function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
  const [a, b, c] = parts as [number, number, number, number];

  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // 192.0.0.0/24 + 192.0.2.0/24
  if (a === 192 && b === 168) return true; // private
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
}

function isBlockedIpv6(ip: string): boolean {
  const addr = ip.toLowerCase();
  if (addr === '::' || addr === '::1') return true;

  // IPv4-mapped (:ffff:1.2.3.4 / :ffff:0102:0304) — judge the embedded v4.
  const mapped =
    /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(addr) ??
    /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(addr);
  if (mapped) {
    const v4 =
      mapped.length === 2
        ? mapped[1]!
        : `${parseInt(mapped[1]!, 16) >> 8}.${parseInt(mapped[1]!, 16) & 0xff}.${parseInt(mapped[2]!, 16) >> 8}.${parseInt(mapped[2]!, 16) & 0xff}`;
    return isBlockedIpv4(v4);
  }

  if (addr.startsWith('fc') || addr.startsWith('fd')) return true; // fc00::/7 ULA
  if (
    addr.startsWith('fe8') ||
    addr.startsWith('fe9') ||
    addr.startsWith('fea') ||
    addr.startsWith('feb')
  )
    return true; // fe80::/10 link-local
  if (addr.startsWith('ff')) return true; // multicast
  if (addr.startsWith('2001:db8:')) return true; // documentation range
  return false;
}

/** True when the IP literal must never be contacted (used by tests too). */
export function isBlockedIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isBlockedIpv4(ip);
  if (version === 6) return isBlockedIpv6(ip);
  return true; // not an IP at all — callers only pass resolved addresses
}

function assertHostnameSafe(url: URL, allowPrivate: boolean): void {
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (allowPrivate) return; // tests only — never production

  if (BLOCKED_HOSTNAMES.has(host)) {
    throw new AppError('VALIDATION_ERROR', 'That URL points to a private or internal address.');
  }
  for (const suffix of BLOCKED_SUFFIXES) {
    if (host.endsWith(suffix)) {
      throw new AppError('VALIDATION_ERROR', 'That URL points to a private or internal address.');
    }
  }
  if (!ALLOWED_PORTS.has(url.port)) {
    throw new AppError('VALIDATION_ERROR', 'That URL uses a port that is not allowed.');
  }
  // A literal IP still has to pass the range checks below.
}

// Positive DNS answers are cached briefly: job creation and analyze both
// re-validate the same hosts, and lookups are the slowest part of the check.
const dnsCache = new Map<string, { addrs: string[]; expires: number }>();
const DNS_CACHE_TTL_MS = 60_000;

export async function resolveAddresses(hostname: string): Promise<string[]> {
  const cached = dnsCache.get(hostname);
  if (cached && cached.expires > Date.now()) return cached.addrs;

  let addrs: string[];
  if (isIP(hostname) !== 0) {
    addrs = [hostname];
  } else {
    try {
      const answers = await lookup(hostname, { all: true, verbatim: true });
      addrs = answers.map((a) => a.address);
    } catch {
      throw new AppError('VALIDATION_ERROR', 'That host could not be resolved.');
    }
    if (addrs.length === 0) {
      throw new AppError('VALIDATION_ERROR', 'That host could not be resolved.');
    }
  }

  dnsCache.set(hostname, { addrs, expires: Date.now() + DNS_CACHE_TTL_MS });
  return addrs;
}

export interface SafeUrlOptions {
  /** Defaults to `SSRF_ALLOW_PRIVATE` (true only under Vitest). */
  allowPrivate?: boolean;
}

/**
 * Full entry check: scheme, userinfo, port, hostname suffixes and — after
 * DNS resolution — every answer must be a public address. Throws
 * `VALIDATION_ERROR` when the URL must not be fetched.
 */
export async function assertSafeUrl(raw: string | URL, opts: SafeUrlOptions = {}): Promise<void> {
  const allowPrivate = opts.allowPrivate ?? config.source.allowPrivate;
  const url = typeof raw === 'string' ? new URL(raw) : raw;

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AppError('VALIDATION_ERROR', 'Only http(s) URLs are supported.');
  }
  if (url.username || url.password) {
    throw new AppError('VALIDATION_ERROR', 'URLs with embedded credentials are not allowed.');
  }
  assertHostnameSafe(url, allowPrivate);

  if (allowPrivate) return; // tests only — never production

  const addrs = await resolveAddresses(url.hostname.replace(/^\[|\]$/g, ''));
  const bad = addrs.find((ip) => isBlockedIp(ip));
  if (bad) {
    throw new AppError('VALIDATION_ERROR', 'That URL points to a private or internal address.');
  }
}

/**
 * Post-analysis guard: every URL the extractor reported (final page URL,
 * media/manifest/thumbnail URLs) is re-checked before anything downloads.
 * Catches redirects and cross-host hops the entry check never saw.
 */
export async function assertSafeAnalysisUrls(
  urls: ReadonlyArray<string | null | undefined>,
  opts: SafeUrlOptions = {},
) {
  const checked = new Set<string>();
  for (const candidate of urls) {
    if (!candidate) continue;
    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      continue; // relative or extractor junk — not fetchable as-is
    }
    const key = url.hostname.toLowerCase();
    if (checked.has(key)) continue;
    checked.add(key);
    await assertSafeUrl(url, opts);
  }
}
