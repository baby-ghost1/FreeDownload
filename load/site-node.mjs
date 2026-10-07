import { performance } from 'node:perf_hooks';

const BASE = process.env.BASE_URL || 'https://freedownloadapp.vercel.app';
const ROUTES = [
  { path: '/', weight: 4 },
  { path: '/download', weight: 2 },
  { path: '/login', weight: 1 },
  { path: '/register', weight: 1 },
  { path: '/privacy', weight: 1 },
  { path: '/terms', weight: 1 },
  { path: '/downloads', weight: 1 },
];
const POOL = [];
for (const r of ROUTES) for (let i = 0; i < r.weight; i++) POOL.push(r.path);

const total = Number(process.env.TOTAL || 500);
const concurrency = Number(process.env.CONCURRENCY || 10);
const rpsCap = Number(process.env.RPS || 0);
const stage = process.env.STAGE || 'run';
const summaryFile = process.env.SUMMARY_FILE || '';

const counts = { 200: 0, 403: 0, 429: 0, '4xx': 0, '5xx': 0, err: 0 };
const cacheHit = { hit: 0, miss: 0 };
const latencies = [];
let bytes = 0;
// simple open-loop rate limiter
let nextSlot = 0;
function waitTurn() {
  if (!rpsCap) return Promise.resolve();
  const now = performance.now();
  const slot = nextSlot;
  nextSlot = Math.max(now, nextSlot) + 1000 / rpsCap;
  const delay = slot - now;
  return delay > 0 ? new Promise((r) => setTimeout(r, delay)) : Promise.resolve();
}

async function one(i) {
  const path = POOL[i % POOL.length];
  const t0 = performance.now();
  try {
    const res = await fetch(BASE + path, {
      headers: { 'accept-encoding': 'gzip, br' },
      signal: AbortSignal.timeout(30000),
    });
    const buf = await res.arrayBuffer();
    const dt = performance.now() - t0;
    latencies.push(dt);
    bytes += buf.byteLength;
    const s = res.status;
    if (s === 200) counts['200']++;
    else if (s === 403) counts['403']++;
    else if (s === 429) counts['429']++;
    else if (s >= 500) counts['5xx']++;
    else if (s >= 400) counts['4xx']++;
    else counts.err++;
    const c = res.headers.get('x-vercel-cache');
    if (c === 'HIT' || c === 'STALE' || c === 'PRERENDER') cacheHit.hit++;
    else cacheHit.miss++;
  } catch {
    counts.err++;
    latencies.push(performance.now() - t0);
  }
}

const t0 = performance.now();
await Promise.all(
  Array.from({ length: concurrency }, async (_, v) => {
    for (let i = v; i < total; i += concurrency) {
      await waitTurn();
      await one(i);
    }
  }),
);
const dur = (performance.now() - t0) / 1000;

latencies.sort((a, b) => a - b);
const q = (p) =>
  latencies.length
    ? Math.round(
        latencies[Math.min(latencies.length - 1, Math.floor((p / 100) * latencies.length))],
      )
    : 0;
const avg = latencies.length
  ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
  : 0;

const summary = {
  stage,
  endpoint: BASE,
  concurrency,
  rps_cap: rpsCap || null,
  requests: total,
  duration_s: +dur.toFixed(1),
  achieved_rps: +(total / dur).toFixed(1),
  status: counts,
  pct_2xx: +((counts['200'] / total) * 100).toFixed(2),
  pct_403: +((counts['403'] / total) * 100).toFixed(2),
  cache_hit_pct: +((cacheHit.hit / total) * 100).toFixed(1),
  latency_ms: {
    p50: q(50),
    p90: q(90),
    p95: q(95),
    p99: q(99),
    max: latencies.length ? Math.round(latencies[latencies.length - 1]) : 0,
    avg,
  },
  bytes_down: bytes,
};

const json = JSON.stringify(summary, null, 2);
if (summaryFile) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(summaryFile, json);
}
console.log(json);
