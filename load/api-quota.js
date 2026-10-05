import http from 'k6/http';
import { check, sleep } from 'k6';

import { BASE_URL, jsonHeaders, record, thresholds } from './lib/common.js';

/**
 * Bearer API-key traffic through the metered preHandler: key validation,
 * hourly quota gate and usage metering run on every request.
 *
 * setup() registers a user and mints an API key (session cookie +
 * double-submit CSRF), then every iteration calls GET /downloads with
 * `Authorization: Bearer`. A 200 with the job list or a typed
 * `RATE_LIMITED` 429 envelope are both valid outcomes: the free plan's
 * apiPerHour (60) is deliberately low, so sustained runs are expected to
 * exhaust the quota - that is the enforcement path being verified.
 *
 *   k6 run --vus 5 --duration 2m load/api-quota.js
 */
export const options = {
  vus: 1,
  duration: '25s',
  thresholds: thresholds({
    http_req_duration: ['p(95)<500', 'p(99)<1200'],
  }),
};

/** Join all Set-Cookie pairs from a response into one Cookie header. */
function cookieHeader(res) {
  const raw = res.headers['Set-Cookie'] || res.headers['set-cookie'] || '';
  const pairs = [];
  for (const line of raw.split('\n')) {
    // Values are random hex tokens, so a comma only ever separates headers.
    for (const chunk of line.split(/,(?=[A-Za-z0-9_-]+=)/)) {
      const eq = chunk.indexOf('=');
      if (eq <= 0) continue;
      const name = chunk.slice(0, eq).trim();
      const value = chunk
        .slice(eq + 1)
        .split(';')[0]
        .trim();
      if (name && value) pairs.push(`${name}=${value}`);
    }
  }
  return pairs.join('; ');
}

export function setup() {
  const email = `load-quota-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  const password = 'LoadTest!2345';

  const reg = http.post(`${BASE_URL}/api/v1/auth/register`, JSON.stringify({ email, password }), {
    headers: jsonHeaders,
    tags: { name: 'setup-register' },
  });
  if (reg.status !== 201) {
    throw new Error(`setup: register failed with ${reg.status}: ${reg.body}`);
  }

  const cookies = cookieHeader(reg);
  const csrfToken = reg.json('csrfToken');
  if (!cookies || typeof csrfToken !== 'string') {
    throw new Error('setup: register response missing session cookie or csrfToken');
  }

  const key = http.post(`${BASE_URL}/api/v1/api-keys`, JSON.stringify({ name: 'load-quota' }), {
    headers: {
      ...jsonHeaders,
      'X-CSRF-Token': csrfToken,
      Cookie: cookies,
    },
    tags: { name: 'setup-api-key' },
  });
  if (key.status !== 201) {
    throw new Error(`setup: api-key creation failed with ${key.status}: ${key.body}`);
  }

  return { rawKey: key.json('rawKey') };
}

export default function (data) {
  const res = http.get(`${BASE_URL}/api/v1/downloads?limit=20`, {
    headers: { Authorization: `Bearer ${data.rawKey}` },
    tags: { name: 'bearer-list' },
  });
  record(res);
  check(res, {
    'quota: 200 with data or typed 429': (r) => {
      if (r.status === 200) return Array.isArray(r.json('data'));
      if (r.status === 429) return r.json('error.code') === 'RATE_LIMITED';
      return false;
    },
  });
  sleep(1);
}
