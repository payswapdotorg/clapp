// CLAPP-050 — the frozen-contract import discipline test.
//
// src/** may import @clapp/core + @clapp/observe at RUNTIME (the declared
// dependencies) and the frozen P3/P4 contract owners (@clapp/plan,
// @clapp/codegen, @clapp/diff, @clapp/repair) for TYPES ONLY — the
// extractor consumes contract-shaped DATA, never the implementations'
// behavior. No import may name any non-workspace package, and no import
// may name a workspace package outside the declared dependency set.

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** The frozen contract owners: import-type ONLY. */
const CONTRACT_PACKAGES = ['@clapp/diff', '@clapp/repair', '@clapp/plan', '@clapp/codegen'] as const;

/** The complete runtime dependency set. */
const RUNTIME_ALLOWED = new Set(['@clapp/core', '@clapp/observe']);

const PACKAGE_ROOT = dirname(import.meta.dir); // packages/library (one level above test/)
const SRC_ROOT = join(PACKAGE_ROOT, 'src');

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
  test('the package imports only frozen contracts — no cross-implementation import', () => {
    const files = listTsFiles(SRC_ROOT).sort();
    // the nine modules of the delivered surface
    expect(files.map((file) => file.slice(PACKAGE_ROOT.length + 1))).toEqual([
      'src/compat-graph.ts',
      'src/extract.ts',
      'src/index.ts',
      'src/package-contract.ts',
      'src/promotion.ts',
      'src/record.ts',
      'src/registry.ts',
      'src/replay-benchmark.ts',
      'src/retrieval.ts',
    ]);

    const violations: string[] = [];
    for (const file of files) {
      const display = file.slice(PACKAGE_ROOT.length + 1);
      const source = readFileSync(file, 'utf8');

      for (const { clause, specifier } of sourceImports(source)) {
        const contractPackage = CONTRACT_PACKAGES.find(
          (pkg) => specifier === pkg || specifier.startsWith(`${pkg}/`),
        );
        if (contractPackage !== undefined) {
          if (!clause.startsWith('type')) {
            violations.push(
              `${display}: RUNTIME import of ${contractPackage} (${JSON.stringify(specifier)}) — the contract owners are import-type ONLY`,
            );
          }
          continue;
        }
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
        violations.push(`${display}: bare side-effect import ${JSON.stringify(match[1])}`);
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
