import { Rate } from 'k6/metrics';

/** Target API base. Override per run: `k6 run -e BASE_URL=https://api.example.com load/catalog.js`. */
export const BASE_URL = __ENV.BASE_URL || 'http://localhost:4000';

/**
 * 5xx responses and 429 rate-limit responses are tracked as rates so every
 * script can threshold them independently of `http_req_failed` (which counts
 * every 4xx and would fight the "429s are expected under load" policy).
 */
export const serverErrors = new Rate('server_errors');
export const rateLimited = new Rate('rate_limited');

/** Call once per response before running checks. */
export function record(res) {
  serverErrors.add(res.status >= 500);
  rateLimited.add(res.status === 429);
}

/**
 * Shared threshold policy. Call with overrides for script-specific latency
 * budgets; every script enforces near-zero server errors, bounded rate
 * limiting and a >99% check pass rate.
 */
export function thresholds(overrides = {}) {
  return {
    http_req_duration: ['p(95)<600', 'p(99)<1500'],
    server_errors: ['rate<0.01'],
    rate_limited: ['rate<0.05'],
    checks: ['rate>0.99'],
    ...overrides,
  };
}

/** Standard JSON POST headers. */
export const jsonHeaders = { 'Content-Type': 'application/json' };
