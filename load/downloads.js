import http from 'k6/http';
import { check, sleep } from 'k6';

import { BASE_URL, jsonHeaders, record, thresholds } from './lib/common.js';

/**
 * Anonymous download-job flow: create a job (URL parsing, quota check,
 * enqueue), list the caller's jobs, then fetch the created job.
 *
 * A fresh X-Anon-Key per iteration keeps every create outside the
 * ANONYMOUS_DAILY_LIMIT (5/day/key) and AN_CONCURRENCY (1 active job/key)
 * caps - the load target is the job pipeline, not the quota gate (which has
 * its own integration tests). POST /downloads is limited to
 * DOWNLOAD_RATE_LIMIT_MAX (default 60/min); the default pacing issues ~25
 * creates/min. No worker call is made at creation time, so no external
 * network egress happens from this script. Scale staging runs only after
 * raising RATE_LIMIT_MAX and DOWNLOAD_RATE_LIMIT_MAX - see README.
 *
 *   k6 run --vus 10 --duration 2m load/downloads.js
 */
export const options = {
  vus: 1,
  duration: '30s',
  thresholds: thresholds({
    http_req_duration: ['p(95)<800', 'p(99)<2000'],
  }),
};

export default function () {
  const anonKey = `load-${Date.now()}-${__VU}-${__ITER}`;
  const headers = { ...jsonHeaders, 'X-Anon-Key': anonKey };

  const create = http.post(
    `${BASE_URL}/api/v1/downloads`,
    JSON.stringify({ url: `https://example.com/watch?v=load-${__VU}-${__ITER}` }),
    { headers, tags: { name: 'create' } },
  );
  record(create);
  check(create, {
    'create: 201': (r) => r.status === 201,
    'create: job id returned': (r) => r.status === 201 && typeof r.json('id') === 'string',
  });

  const list = http.get(`${BASE_URL}/api/v1/downloads?limit=20`, {
    headers: { 'X-Anon-Key': anonKey },
    tags: { name: 'list' },
  });
  record(list);
  check(list, {
    'list: 200': (r) => r.status === 200,
    'list: array body': (r) => r.status === 200 && Array.isArray(r.json('data')),
  });

  if (create.status === 201) {
    const id = create.json('id');
    const get = http.get(`${BASE_URL}/api/v1/downloads/${id}`, {
      headers: { 'X-Anon-Key': anonKey },
      tags: { name: 'get' },
    });
    record(get);
    check(get, {
      'get: 200': (r) => r.status === 200,
      'get: same job id': (r) => r.status === 200 && r.json('id') === id,
    });
  }

  sleep(2);
}
