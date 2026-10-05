import http from 'k6/http';
import { check, sleep } from 'k6';

import { BASE_URL, record, thresholds } from './lib/common.js';

/**
 * Public catalog reads: health, enabled sources, target formats and the
 * client bootstrap config. Unauthenticated, database-backed, cache-friendly -
 * this is the read path every landing/browse page depends on.
 *
 * Default run is a 1-VU smoke (well under the 300/min global limiter).
 * Scale on staging with raised RATE_LIMIT_MAX, e.g.:
 *   k6 run --vus 25 --duration 2m load/catalog.js
 */
export const options = {
  vus: 1,
  duration: '20s',
  thresholds: thresholds({
    http_req_duration: ['p(95)<300', 'p(99)<800'],
  }),
};

const ENDPOINTS = ['/health', '/api/v1/sources', '/api/v1/formats', '/api/v1/config/public'];

export default function () {
  const path = ENDPOINTS[__ITER % ENDPOINTS.length];
  const res = http.get(`${BASE_URL}${path}`, { tags: { name: 'catalog' } });
  record(res);
  check(res, {
    'catalog: 2xx': (r) => r.status >= 200 && r.status < 300,
    'catalog: json body': (r) => (r.headers['Content-Type'] || '').includes('application/json'),
  });
  sleep(1);
}
