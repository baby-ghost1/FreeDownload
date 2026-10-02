import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**'],
    // Integration tests touching docker services are added in Phase 2 and
    // gated by file naming so `npm test` stays green without infra.
    testTimeout: 15_000,
  },
});
