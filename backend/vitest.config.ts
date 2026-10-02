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
    },
    // Integration tests need docker compose services; they skip locally when
    // the containers are down and always run in CI.
    testTimeout: 15_000,
    // Files share one Postgres/Redis and the download queue; a worker in one
    // file must not steal jobs another file is still asserting on.
    fileParallelism: false,
  },
});
