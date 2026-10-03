import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**'],
    // Read by config.ts at import time — keeps expected client-error logs out
    // of the test output.
    env: {
      LOG_LEVEL: 'silent',
      // Short lease so the crash-recovery test can watch it expire in
      // seconds instead of the production 30s.
      LEASE_TTL_MS: '3000',
      // Tests keep the Phase 3 placeholder runner by default; Phase 4
      // pipeline tests flip runnerControls.mode per test.
      WORKER_RUNNER: 'placeholder',
      // Pipeline tests hit a loopback fixture server (see ssrf.ts).
      SSRF_ALLOW_PRIVATE: 'true',
      // Phase 7: lets billing tests sign and verify webhook payloads.
      PAYMENT_WEBHOOK_SECRET: 'fd-test-webhook-secret',
      // Quota defaults are generous so Phase 1–6 tests that create many jobs
      // per actor keep passing; billing tests tighten limits via plan rows.
      ANONYMOUS_DAILY_LIMIT: '1000',
      ANON_CONCURRENCY: '100',
      FREE_DAILY_LIMIT: '1000',
      PRO_DAILY_LIMIT: '1000',
      USER_CONCURRENCY: '100',
    },
    // Integration tests need docker compose services; they skip locally when
    // the containers are down and always run in CI.
    testTimeout: 15_000,
    // Files share one Postgres/Redis and the download queue; a worker in one
    // file must not steal jobs another file is still asserting on.
    fileParallelism: false,
  },
});
