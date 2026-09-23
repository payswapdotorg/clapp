// CLAPP monorepo ESLint config (flat config).
//
// NOTE: shared scaffolding owned by Worker 1 (CLAPP-001); recreated locally by
// Worker 3 (CLAPP-003) so this workspace lints standalone. Identical copies are
// reconciled by the tech lead at harvest — do not fork behavior here.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // TypeScript's type system supersedes identifier-existence checking for
    // .ts files; the core rule misfires on ambient globals (Bun, process, ...).
    files: ['**/*.ts'],
    rules: {
      'no-undef': 'off',
    },
  },
  {
    // packages/core/src/contract.ts is the VERBATIM tech-lead-owned contract
    // (CLAPP-001 brief §4.1). Its `(string & {})` extensible-union idiom trips
    // @typescript-eslint/no-empty-object-type; the file must not be edited.
    files: ['packages/core/src/contract.ts'],
    rules: {
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },
);
