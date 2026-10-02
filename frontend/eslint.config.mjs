import tseslint from 'typescript-eslint';
import nextPlugin from '@next/eslint-plugin-next';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * Flat config, ESLint 10.
 *
 * `eslint-config-next` is intentionally NOT used: it pulls in
 * eslint-plugin-react / eslint-plugin-jsx-a11y / eslint-plugin-import, none of
 * which support ESLint 10 yet (peers cap at ^9). We compose the same coverage
 * from the plugins that do: @next/eslint-plugin-next, eslint-plugin-react-hooks
 * and typescript-eslint. A11y is additionally enforced with axe in E2E (Phase 8).
 */
const nextConfig = nextPlugin.configs['core-web-vitals'];
const hooksConfig = reactHooks.configs.flat['recommended-latest'];

export default tseslint.config(
  {
    ignores: ['.next/**', 'node_modules/**', 'dist/**', 'coverage/**', 'next-env.d.ts'],
  },
  ...tseslint.configs.recommended,
  {
    ...nextConfig,
    files: ['**/*.{js,mjs,jsx,ts,tsx}'],
  },
  {
    ...hooksConfig,
    files: ['**/*.{js,mjs,jsx,ts,tsx}'],
  },
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      // Contract §81: `any` only when genuinely unavoidable.
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
);
