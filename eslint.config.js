// CLAPP-001 — lean ESLint 9 flat config.
// Recommended rules only; no stylistic bikeshedding (per monorepo contract).
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // Never lint dependencies or build output.
  { ignores: ['**/node_modules/', '**/dist/'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
);
