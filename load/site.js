import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate } from 'k6/metrics';

/**
 * Public marketing/frontend load test against the deployed Vercel site.
 *
 * The existing scenarios in this folder target the Fastify API on :4000; this
 * one targets the Next.js edge deployment (static/prerendered routes) so we can
 * measure what real visitors actually hit.
 *
 * Everything is driven from the environment so one script covers every rung of
 * a ramp:
 *
 *   k6 run -e VUS=1 -e ITERATIONS=100 load/site.js
 *
 * TLS_VERSION matters a lot here. Vercel's system mitigation fingerprints the
 * TLS handshake (JA3/JA4), and Go's default TLS 1.3 handshake from this client
 * is challenged (`403 X-Vercel-Mitigated: challenge`) while the identical run
 * over TLS 1.2 passes. The default is therefore `tls1.2`; override with
 * `-e TLS_VERSION=tls1.3` if you want to reproduce the block.
 *
 * RPS caps the aggregate request rate and THINK adds per-request think time in
 * seconds. Omit both for an unpaced, closed-loop saturation run.
 */
export const options = {
  vus: Number(__ENV.VUS || 1),
  iterations: Number(__ENV.ITERATIONS || 100),
  tlsVersion: __ENV.TLS_VERSION || 'tls1.2',
  ...(Number(__ENV.RPS || 0) > 0 ? { rps: Number(__ENV.RPS) } : {}),
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<2000'],
  },
};

const THINK = Number(__ENV.THINK || 0);

const BASE_URL = __ENV.BASE_URL || 'https://freedownloadapp.vercel.app';

/** Weighted: the landing page is the vast majority of real traffic. */
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
for (const route of ROUTES) {
  for (let i = 0; i < route.weight; i += 1) POOL.push(route.path);
}

const status2xx = new Rate('site_status_2xx');
const status429 = new Rate('site_status_429');
const status403 = new Rate('site_status_403');
const status4xx = new Rate('site_status_4xx_other');
const status5xx = new Rate('site_status_5xx');
const statusErr = new Rate('site_status_err');
const cacheHit = new Rate('site_cache_hit');
const bytes = new Counter('site_bytes');
const reqCount = new Counter('site_requests');

export default function () {
  const path = POOL[__ITER % POOL.length];
  const res = http.get(`${BASE_URL}${path}`, {
    tags: { name: path, page: path },
    headers: { 'accept-encoding': 'gzip, br' },
    timeout: '30s',
  });

  reqCount.add(1);
  bytes.add(res.body ? res.body.length : 0);

  const s = res.status;
  status2xx.add(s >= 200 && s < 300);
  status429.add(s === 429);
  status403.add(s === 403);
  status4xx.add(s >= 400 && s < 500 && s !== 429 && s !== 403);
  status5xx.add(s >= 500);
  statusErr.add(s < 100);

  const cache = res.headers['X-Vercel-Cache'];
  cacheHit.add(cache === 'HIT' || cache === 'STALE' || cache === 'PRERENDER');

  check(res, {
    'site: 200': (r) => r.status === 200,
    'site: html': (r) => (r.headers['Content-Type'] || '').includes('text/html'),
    'site: has shell': (r) => typeof r.body === 'string' && r.body.includes('FreeDownload'),
    'site: not rate limited': (r) => r.status !== 429,
  });

  if (THINK > 0) sleep(THINK);
}

export function handleSummary(data) {
  const path = __ENV.SUMMARY_FILE;
  const m = data.metrics;

  const pick = (name, keys) => {
    const metric = m[name];
    if (!metric) return {};
    const out = {};
    for (const k of keys) {
      if (metric.values && metric.values[k] !== undefined) out[k] = metric.values[k];
    }
    return out;
  };

  const summary = {
    stage: __ENV.STAGE || 'unnamed',
    vus: Number(__ENV.VUS || 1),
    target_iterations: Number(__ENV.ITERATIONS || 0),
    endpoint: BASE_URL,
    requests: pick('http_reqs', ['count', 'rate']),
    duration_s: data.state?.testRunDurationMs ? data.state.testRunDurationMs / 1000 : null,
    latency_ms: pick('http_req_duration', ['avg', 'med', 'min', 'p(90)', 'p(95)', 'p(99)', 'max']),
    ttfb_ms: pick('http_req_waiting', ['avg', 'med', 'p(95)', 'p(99)']),
    dns_ms: pick('dns_lookup', ['avg', 'p(95)']),
    tls_ms: pick('tls_handshaking', ['avg', 'p(95)']),
    connect_ms: pick('tcp_connect', ['avg', 'p(95)']),
    failed_rate: pick('http_req_failed', ['rate']),
    checks_rate: pick('checks', ['rate', 'passes', 'fails']),
    status_2xx: pick('site_status_2xx', ['rate']),
    status_429: pick('site_status_429', ['rate']),
    status_403: pick('site_status_403', ['rate']),
    status_4xx: pick('site_status_4xx_other', ['rate']),
    status_5xx: pick('site_status_5xx', ['rate']),
    status_transport_err: pick('site_status_err', ['rate']),
    cache_hit_rate: pick('site_cache_hit', ['rate']),
    bytes_total: pick('site_bytes', ['count']),
    data_received: pick('data_received', ['count', 'rate']),
    data_sent: pick('data_sent', ['count', 'rate']),
    iterations: pick('iterations', ['count']),
    thresholds: Object.fromEntries(
      Object.entries(m)
        .filter(([k, v]) => v.thresholds)
        .map(([k, v]) => [k, v.thresholds]),
    ),
  };

  const json = path ? JSON.stringify(summary, null, 2) : null;
  return {
    ...(json ? { [path]: json } : {}),
    stdout: JSON.stringify(summary, null, 2),
  };
}
