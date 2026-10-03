import http from 'k6/http';
import { check, sleep } from 'k6';

import { BASE_URL, jsonHeaders, record, thresholds } from './lib/common.js';

/**
 * Register + login pairs. Argon2 hashing makes this the CPU-heaviest auth
 * path; a fresh unique email per iteration avoids 409 conflicts.
 *
 * Auth routes are limited to AUTH_RATE_LIMIT_MAX (default 10) requests per
 * minute per IP, so the default pacing (~8 auth requests/min) stays inside
 * the limit. Full staging runs must raise AUTH_RATE_LIMIT_MAX first — see
 * README "Load testing".
 *
 *   k6 run --vus 5 --duration 3m load/auth.js   # staging, limits raised
 */
export const options = {
  vus: 1,
  duration: '45s',
  thresholds: thresholds({
    // argon2 (64 MiB, t=3) dominates: hashing alone runs 100-400ms.
    http_req_duration: ['p(95)<2000', 'p(99)<4000'],
  }),
};

const PASSWORD = 'LoadTest!2345';

export default function () {
  const email = `load-${Date.now()}-${__VU}-${__ITER}@example.com`;

  const reg = http.post(
    `${BASE_URL}/api/v1/auth/register`,
    JSON.stringify({ email, password: PASSWORD }),
    { headers: jsonHeaders, tags: { name: 'register' } },
  );
  record(reg);
  check(reg, {
    'register: 201': (r) => r.status === 201,
    'register: csrf token issued': (r) =>
      r.status === 201 && typeof r.json('csrfToken') === 'string',
  });

  // k6 persists cookies within an iteration, so the session minted by
  // register rides along on the login request — a cookie-authenticated
  // mutation must echo the double-submit token or it answers 403.
  const loginHeaders = { ...jsonHeaders };
  if (reg.status === 201) {
    const csrfToken = reg.json('csrfToken');
    if (typeof csrfToken === 'string') loginHeaders['X-CSRF-Token'] = csrfToken;
  }

  const login = http.post(
    `${BASE_URL}/api/v1/auth/login`,
    JSON.stringify({ email, password: PASSWORD }),
    { headers: loginHeaders, tags: { name: 'login' } },
  );
  record(login);
  check(login, {
    'login: 200': (r) => r.status === 200,
    'login: session body': (r) => r.status === 200 && r.json('user') !== undefined,
  });

  sleep(13);
}
