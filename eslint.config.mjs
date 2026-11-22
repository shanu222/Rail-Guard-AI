import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/public/sw.js',
      '**/next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // API payloads and DB rows are typed at the boundary with Zod; local `any` in UI glue is accepted.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['**/*.config.{js,cjs,mjs,ts}', 'apps/web/postcss.config.mjs'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
);
