import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**'],
    // Read by config.ts at import time — keeps expected client-error logs out
    // of the test output.
    env: { LOG_LEVEL: 'silent' },
    // Integration tests need docker compose services; they skip locally when
    // the containers are down and always run in CI.
    testTimeout: 15_000,
  },
});
