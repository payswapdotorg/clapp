// CLAPP-071 — the frozen-contract import discipline test (this package's
// fresh mirror of the CLAPP-050 pattern, per the work order).
//
// src/** may import @clapp/core + @clapp/observe at RUNTIME (the declared
// dependency set) and nothing else — no other workspace package, no
// non-workspace package; relative intra-package imports are the module's
// own files, and node: builtins are runtime-provided, not packages.
// test/fixtures/** may import @clapp packages for TYPES ONLY (relative
// imports allowed — fixtures are plain data builders). The src file list
// is asserted EXACT: audit.ts, authorization.ts, index.ts, isolation.ts,
// redaction.ts.

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** The complete runtime dependency set. */
const RUNTIME_ALLOWED = new Set(['@clapp/core', '@clapp/observe']);

const PACKAGE_ROOT = dirname(import.meta.dir); // packages/security (one level above test/)
const SRC_ROOT = join(PACKAGE_ROOT, 'src');
const FIXTURES_ROOT = join(PACKAGE_ROOT, 'test', 'fixtures');

function listTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listTsFiles(full));
    } else if (entry.name.endsWith('.ts')) {
      files.push(full);
    }
  }
  return files;
}

/** Named import/export-from statements: (clause, specifier) pairs. */
const FROM_RE = /^[ \t]*(?:import|export)\s+([^'";]*?)\s*from\s*['"]([^'"]+)['"]/gm;

/** Bare side-effect imports: `import '…'`. */
const BARE_RE = /^[ \t]*import\s*['"]([^'"]+)['"]/gm;

/** Dynamic imports: `import('…')`. */
const DYNAMIC_RE = /import\(\s*['"]([^'"]+)['"]\s*\)/g;

function sourceImports(source: string): Array<{ clause: string; specifier: string }> {
  const found: Array<{ clause: string; specifier: string }> = [];
  for (const match of source.matchAll(FROM_RE)) {
    found.push({ clause: (match[1] ?? '').trim(), specifier: match[2] ?? '' });
  }
  return found;
}

describe('the frozen-contract import discipline', () => {
  test('src imports only @clapp/core and @clapp/observe at runtime — the src file list is exact, fixtures are type-only', () => {
    // ---- 1. the exact src file list (the delivered surface) ----
    const files = listTsFiles(SRC_ROOT).sort();
    expect(files.map((file) => file.slice(PACKAGE_ROOT.length + 1))).toEqual([
      'src/audit.ts',
      'src/authorization.ts',
      'src/index.ts',
      'src/isolation.ts',
      'src/readiness.ts',
      'src/redaction.ts',
    ]);

    const violations: string[] = [];

    // ---- 2. src/** — the runtime dependency set is exactly the two packages ----
    for (const file of files) {
      const display = file.slice(PACKAGE_ROOT.length + 1);
      const source = readFileSync(file, 'utf8');

      for (const { specifier } of sourceImports(source)) {
        if (specifier.startsWith('@clapp/')) {
          if (!RUNTIME_ALLOWED.has(specifier)) {
            violations.push(
              `${display}: undeclared workspace dependency ${JSON.stringify(specifier)} — the runtime dependency set is exactly @clapp/core + @clapp/observe`,
            );
          }
          continue;
        }
        if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:')) {
          continue; // relative module or a runtime-provided builtin — not a package
        }
        violations.push(`${display}: non-workspace package import ${JSON.stringify(specifier)}`);
      }

      for (const match of source.matchAll(BARE_RE)) {
        violations.push(`${display}: bare side-effect import ${JSON.stringify(match[1] ?? '')}`);
      }
      for (const match of source.matchAll(DYNAMIC_RE)) {
        const specifier = match[1] ?? '';
        if (!specifier.startsWith('.') && !specifier.startsWith('node:')) {
          violations.push(`${display}: dynamic import ${JSON.stringify(specifier)}`);
        }
      }
    }

    // ---- 3. test/fixtures/** — @clapp imports are TYPE-ONLY, relative allowed ----
    for (const file of listTsFiles(FIXTURES_ROOT).sort()) {
      const display = file.slice(PACKAGE_ROOT.length + 1);
      const source = readFileSync(file, 'utf8');

      for (const { clause, specifier } of sourceImports(source)) {
        if (specifier.startsWith('@clapp/')) {
          if (!clause.startsWith('type')) {
            violations.push(
              `${display}: RUNTIME import of ${JSON.stringify(specifier)} — fixtures import @clapp packages for types only`,
            );
          }
          continue;
        }
        if (specifier.startsWith('.') || specifier.startsWith('/')) {
          continue; // relative module — the fixtures' own files
        }
        violations.push(
          `${display}: non-relative fixture import ${JSON.stringify(specifier)} — fixtures are plain data builders`,
        );
      }

      for (const match of source.matchAll(BARE_RE)) {
        violations.push(`${display}: bare side-effect import ${JSON.stringify(match[1] ?? '')}`);
      }
      for (const match of source.matchAll(DYNAMIC_RE)) {
        const specifier = match[1] ?? '';
        if (!specifier.startsWith('.') && !specifier.startsWith('node:')) {
          violations.push(`${display}: dynamic import ${JSON.stringify(specifier)}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
