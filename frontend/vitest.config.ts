import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**', '.next/**'],
  },
});
