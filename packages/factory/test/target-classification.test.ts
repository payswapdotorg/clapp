// CLAPP-085 — the target classifier tests (the P9 opener — Worker 1,
// the factory lane's owner).
//
// Fixtures: test/fixtures/target-fixtures.ts (full frozen v0.1
// learn-classification shapes consumed as DATA + the request builders
// over them). The eight named tests cover the packet's axes: the
// fail-closed request validator (every malformation named with its
// observed value, including the honest-agreement law), the derived
// primary archetype (the canonical first match, MEASURED matchCount),
// the honest unclassified verdict (never a guessed archetype), the
// content-addressed deterministic 'tcls_' ids (recomputed independently
// here from the same core hash + canonical serializer; a changed tier
// moves the id), the frozen budget-tier vocabulary, the five-platform
// P8 binding (a sixth named), the caller-injected clock (excluded from
// the id), and the import-discipline pin (the no-fork law over the
// exact src file list: @clapp/core + @clapp/observe at RUNTIME,
// @clapp/learn TYPE-ONLY, no other packages).

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { sha256Hex } from '@clapp/core';
import { canonicalJson } from '@clapp/observe';

import {
  ARCHETYPE_BINDING_VERSION,
  BUDGET_TIERS,
  TARGET_CLASS_VERSION,
  TARGET_PLATFORMS,
  classifyTarget,
} from '../src/target-classification';
import type { TargetClassification } from '../src/target-classification';

import {
  CLASSIFIED_AT_A,
  CLASSIFIED_AT_B,
  TWO_MATCH_CLASSIFICATION,
  UNCLASSIFIED_CLASSIFICATION,
  VALID_REQUEST,
  malformedRequest,
  targetRequest,
} from './fixtures/target-fixtures';

/** Classify and be loud about it — a fixture failure must not pass silently. */
async function classify(
  request: unknown,
  classifiedAt: string = CLASSIFIED_AT_A,
): Promise<TargetClassification> {
  const result = await classifyTarget(request, classifiedAt);
  if (!result.ok) {
    throw new Error(`classification failed: ${result.errors.join('; ')}`);
  }
  return result.classification;
}

// ---- the import-discipline test's machinery (module level, like the siblings') ------

/** Recursively lists every .ts file under dir (the house imports-test helper). */
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

/** Named import/export-from statements: (clause, specifier) pairs (the house helper). */
const FROM_RE = /^[ \t]*(?:import|export)\s+([^'";]*?)\s*from\s*['"]([^'"]+)['"]/gm;

/** Bare side-effect imports: `import '…'` (the house helper). */
const BARE_RE = /^[ \t]*import\s*['"]([^'"]+)['"]/gm;

/** Dynamic imports: `import('…')` (the house helper). */
const DYNAMIC_RE = /import\(\s*['"]([^'"]+)['"]\s*\)/g;

function sourceImports(source: string): Array<{ clause: string; specifier: string }> {
  const found: Array<{ clause: string; specifier: string }> = [];
  for (const match of source.matchAll(FROM_RE)) {
    found.push({ clause: (match[1] ?? '').trim(), specifier: match[2] ?? '' });
  }
  return found;
}

describe('CLAPP-085 — target classification (the P9 factory opener)', () => {
  test('the target request validator is fail-closed with named errors for every malformation', async () => {
    // The valid fixture passes — and the fixture's classification really
    // binds the frozen learn contract version this classifier consumes.
    const valid = await classifyTarget(VALID_REQUEST, CLASSIFIED_AT_A);
    expect(valid.ok).toBe(true);
    expect(TWO_MATCH_CLASSIFICATION.archetypeVersion).toBe(ARCHETYPE_BINDING_VERSION);
    if (valid.ok) {
      expect(valid.classification.targetVersion).toBe(TARGET_CLASS_VERSION);
      expect(valid.classification.platform).toBe('linux');
      expect(valid.classification.primaryArchetype).toBe('api-backed-app');
      expect(valid.classification.budgetTier).toBe('standard');
      expect(valid.classification.classifiedAt).toBe(CLASSIFIED_AT_A);
    }

    // A non-object request is named (the admission shape itself).
    const notAnObject = await classifyTarget('not-a-request', CLASSIFIED_AT_A);
    expect(notAnObject.ok).toBe(false);
    if (!notAnObject.ok) {
      expect(notAnObject.errors.some((error) => error.startsWith('request:'))).toBe(true);
    }

    // Every field malformation refuses, naming its field AND the observed value.
    const cases: Array<{ request: unknown; names: string[] }> = [
      {
        request: malformedRequest({ platform: 'web' }),
        names: ['request.platform', '"web"'],
      },
      {
        request: malformedRequest({ budgetTier: 'xl' }),
        names: ['request.budgetTier', '"xl"'],
      },
      {
        request: malformedRequest({ classification: 'not-a-classification' }),
        names: ['request.classification'],
      },
      {
        request: malformedRequest({
          classification: { ...TWO_MATCH_CLASSIFICATION, archetypeVersion: '0.9' },
        }),
        names: ['request.classification.archetypeVersion', '"0.9"'],
      },
      {
        request: malformedRequest({
          classification: { ...TWO_MATCH_CLASSIFICATION, outcome: 'maybe' },
        }),
        names: ['request.classification.outcome', '"maybe"'],
      },
      {
        request: malformedRequest({
          classification: {
            ...TWO_MATCH_CLASSIFICATION,
            matches: [{ name: 'api-backed-app' }, 'form-driven-app'],
          },
        }),
        names: ['request.classification.matches', 'form-driven-app'],
      },
      {
        request: malformedRequest({
          classification: { ...TWO_MATCH_CLASSIFICATION, matches: [{ name: 42 }] },
        }),
        names: ['request.classification.matches[0].name', '42'],
      },
      {
        request: malformedRequest({
          classification: { ...TWO_MATCH_CLASSIFICATION, matches: [] },
        }),
        names: ['request.classification', 'MUST AGREE'],
      },
      {
        request: malformedRequest({
          classification: {
            ...UNCLASSIFIED_CLASSIFICATION,
            matches: TWO_MATCH_CLASSIFICATION.matches,
          },
        }),
        names: ['request.classification', 'MUST AGREE'],
      },
    ];

    for (const { request, names } of cases) {
      const result = await classifyTarget(request, CLASSIFIED_AT_A);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.length).toBeGreaterThan(0);
        for (const name of names) {
          expect(result.errors.some((error) => error.includes(name))).toBe(true);
        }
      }
    }

    // An empty classifiedAt (the caller-injected clock parameter) is named.
    const emptyTime = await classifyTarget(VALID_REQUEST, '');
    expect(emptyTime.ok).toBe(false);
    if (!emptyTime.ok) {
      expect(emptyTime.errors.some((error) => error.startsWith('classifiedAt:'))).toBe(true);
    }

    // Two bad fields at once — EVERY error is collected, never just the first.
    const twoBad = await classifyTarget(malformedRequest({ platform: 'web', budgetTier: 'xl' }), '');
    expect(twoBad.ok).toBe(false);
    if (!twoBad.ok) {
      expect(twoBad.errors.some((error) => error.includes('request.platform'))).toBe(true);
      expect(twoBad.errors.some((error) => error.includes('request.budgetTier'))).toBe(true);
      expect(twoBad.errors.some((error) => error.startsWith('classifiedAt:'))).toBe(true);
    }

    // Fail closed, proven: every call above RESOLVED (never threw) and
    // returned { ok: false } — the awaits resolving are themselves the
    // no-exceptions evidence.
  });

  test('the primary archetype is the canonical first match — derived, never guessed', async () => {
    const classification = await classify(targetRequest());

    // The fixture's two matches are in the learn table's canonical order
    // (rule 1 'api-backed-app', then rule 2 'form-driven-app'): the
    // primary archetype is the FIRST, derived positionally.
    expect(classification.primaryArchetype).toBe('api-backed-app');

    // matchCount is MEASURED — the fixture's own matches array length,
    // never asserted from the input's shape.
    expect(classification.matchCount).toBe(2);
    expect(classification.matchCount).toBe(TWO_MATCH_CLASSIFICATION.matches.length);

    // The outcome is carried VERBATIM from the learn classification.
    expect(classification.outcome).toBe('classified');
    expect(classification.outcome).toBe(TWO_MATCH_CLASSIFICATION.outcome);
  });

  test('unclassified requests stay unclassified — never a guessed archetype', async () => {
    const classification = await classify(targetRequest({ classification: UNCLASSIFIED_CLASSIFICATION }));

    // Zero matches → the honest 'unclassified' primary archetype —
    // never a guessed, defaulted, or invented one.
    expect(classification.primaryArchetype).toBe('unclassified');
    expect(classification.matchCount).toBe(0);
    expect(classification.matchCount).toBe(UNCLASSIFIED_CLASSIFICATION.matches.length);
    expect(classification.outcome).toBe('unclassified');
    expect(classification.outcome).toBe(UNCLASSIFIED_CLASSIFICATION.outcome);
  });

  test('ids are content-addressed and deterministic — same request, same id; a changed tier, a different id', async () => {
    const first = await classify(VALID_REQUEST, CLASSIFIED_AT_A);
    const second = await classify(VALID_REQUEST, CLASSIFIED_AT_A);

    // The same request classifies deep-equal, with the 'tcls_' prefix.
    expect(second).toEqual(first);
    expect(first.id).toMatch(/^tcls_[0-9a-f]{64}$/);

    // The id is RECOMPUTED independently here — the same core hash over
    // the same canonical serialization of the classification body (every
    // field except id and classifiedAt) — and must equal the minted one.
    const expectedId = `tcls_${await sha256Hex(
      canonicalJson({
        targetVersion: first.targetVersion,
        platform: first.platform,
        primaryArchetype: first.primaryArchetype,
        matchCount: first.matchCount,
        budgetTier: first.budgetTier,
        outcome: first.outcome,
      }),
    )}`;
    expect(first.id).toBe(expectedId);

    // A changed tier moves the id — the tier rides inside the
    // content-addressed identity.
    const extended = await classify(targetRequest({ budgetTier: 'extended' }), CLASSIFIED_AT_A);
    expect(extended.id).not.toBe(first.id);
    expect(extended.budgetTier).toBe('extended');
  });

  test('the frozen budget-tier vocabulary is enforced', async () => {
    // The exported vocabulary IS the frozen tier list (pinned literally,
    // never trusted from the export).
    expect(BUDGET_TIERS).toEqual(['minimal', 'standard', 'extended']);

    // Each frozen tier passes and rides verbatim.
    for (const tier of ['minimal', 'standard', 'extended']) {
      const result = await classifyTarget(targetRequest({ budgetTier: tier }), CLASSIFIED_AT_A);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.classification.budgetTier).toBe(tier);
      }
    }

    // An unknown tier refuses, naming the observed value — never a guess.
    const unknown = await classifyTarget(targetRequest({ budgetTier: 'xl' }), CLASSIFIED_AT_A);
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) {
      expect(unknown.errors.some((error) => error.includes('request.budgetTier'))).toBe(true);
      expect(unknown.errors.some((error) => error.includes('"xl"'))).toBe(true);
    }
  });

  test('all five frozen platforms are accepted — the P8 binding', async () => {
    // The exported vocabulary IS the five frozen P8 platform literals
    // (pinned literally, never trusted from the export).
    expect(TARGET_PLATFORMS).toEqual(['android', 'linux', 'windows', 'macos', 'ios']);

    // Each of the five platform literals classifies, carried verbatim.
    for (const platform of ['android', 'linux', 'windows', 'macos', 'ios']) {
      const result = await classifyTarget(targetRequest({ platform }), CLASSIFIED_AT_A);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.classification.platform).toBe(platform);
      }
    }

    // A sixth platform refuses, naming the observed value — the binding
    // is the five, never a guess.
    const sixth = await classifyTarget(targetRequest({ platform: 'web' }), CLASSIFIED_AT_A);
    expect(sixth.ok).toBe(false);
    if (!sixth.ok) {
      expect(sixth.errors.some((error) => error.includes('request.platform'))).toBe(true);
      expect(sixth.errors.some((error) => error.includes('"web"'))).toBe(true);
    }
  });

  test('the classifier never reads a clock — classifiedAt is caller-injected and excluded from the id', async () => {
    const first = await classify(VALID_REQUEST, CLASSIFIED_AT_A);
    const second = await classify(VALID_REQUEST, CLASSIFIED_AT_B);

    // Identical ids — the caller clock is EXCLUDED from the minting body.
    expect(second.id).toBe(first.id);

    // Different classifiedAt values, carried verbatim from each caller.
    expect(first.classifiedAt).toBe(CLASSIFIED_AT_A);
    expect(second.classifiedAt).toBe(CLASSIFIED_AT_B);
    expect(second.classifiedAt).not.toBe(first.classifiedAt);

    // The two classifications are otherwise deep-equal: rewriting the
    // second's clock onto the first makes them identical.
    expect({ ...second, classifiedAt: first.classifiedAt }).toEqual(first);
  });

  test('the package imports only frozen contracts — the no-fork law is pinned', () => {
    const packageRoot = dirname(import.meta.dir); // packages/factory (one level above test/)

    // ---- 1. the exact src file list (the delivered surface) ----
    // CLAPP-086 grew the surface to three files (exploration-budgets is
    // this package's second component); the pin stays exact — the living
    // list, per the security imports.test.ts precedent.
    const srcFiles = listTsFiles(join(packageRoot, 'src')).sort();
    expect(srcFiles.map((file) => file.slice(packageRoot.length + 1))).toEqual([
      'src/exploration-budgets.ts',
      'src/index.ts',
      'src/target-classification.ts',
    ]);

    const runtimeAllowed = new Set(['@clapp/core', '@clapp/observe']);
    const typeOnlyAllowed = new Set(['@clapp/learn']);
    const violations: string[] = [];

    // ---- 2. src/** — @clapp/core + @clapp/observe at RUNTIME;
    //         @clapp/learn TYPE-ONLY; no other packages ----
    for (const file of srcFiles) {
      const display = file.slice(packageRoot.length + 1);
      const source = readFileSync(file, 'utf8');

      for (const { clause, specifier } of sourceImports(source)) {
        if (specifier.startsWith('@clapp/')) {
          if (runtimeAllowed.has(specifier)) {
            continue; // a declared runtime dependency — the frozen contracts in force
          }
          if (typeOnlyAllowed.has(specifier)) {
            if (!clause.startsWith('type')) {
              violations.push(
                `${display}: RUNTIME import of ${JSON.stringify(specifier)} — the no-fork law allows TYPE-ONLY imports of it`,
              );
            }
            continue;
          }
          violations.push(
            `${display}: undeclared workspace dependency ${JSON.stringify(specifier)} — the dependency set is @clapp/core + @clapp/observe (runtime) and @clapp/learn (type-only)`,
          );
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
    for (const file of listTsFiles(join(packageRoot, 'test', 'fixtures')).sort()) {
      const display = file.slice(packageRoot.length + 1);
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
