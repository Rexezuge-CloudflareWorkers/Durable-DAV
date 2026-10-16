import reactHooks from 'eslint-plugin-react-hooks';
import { defineRepoLintConfig } from '@rexezuge/tooling/eslint';

export default [
  ...defineRepoLintConfig({ scope: '@durable-dav' }),
  // --- React Hooks: rules of hooks for the SPA ---
  // The kit's factory is a zero-dependency package, so a consumer's extra plugin
  // is the consumer's line to append — the kit README's prescribed shape.
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs['recommended-latest'].rules,
  },
];
