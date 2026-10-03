// CLAPP-086 — the adaptive exploration budgets tests (the P9 second
// lane — Worker 1, the factory lane's owner).
//
// Fixtures: test/fixtures/budgets.ts (full frozen v0.1 CLAPP-085
// classification shapes, one per frozen tier, each carrying a REAL
// content-addressed tcls_ id minted by the actual classifier over the
// 085 fixtures' VALID_REQUEST + the resolved-budget and spend-request
// builders over them). The eight named tests cover the packet's axes:
// the fail-closed resolver (every malformation named with its observed
// value), the frozen tier table (all three tiers to their exact caps,
// each resolution a FRESH copy), determinism + the verbatim tcls_
// provenance binding, the honest ledger start (zero spent, remaining
// MEASURED from the given caps — never asserted from the tier name —
// and sealed against handed-out aliases), the measured accounting
// (every accepted spend decrements the exact amount), the cap-as-law
// refusal (naming the axis, the request, the remaining), the
// never-consume + axis-independence law (a refused spend on one axis
// never touches the other; zero-remaining refuses positive; a zero
// spend at zero is a valid no-op), and the import-discipline pin (the
// no-fork law over the exact three-file src list: @clapp/core +
// @clapp/observe at RUNTIME, @clapp/learn TYPE-ONLY, no other packages).

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { BUDGET_TIERS, TARGET_CLASS_VERSION } from '../src/target-classification';

import {
  EXPLORATION_BUDGET_VERSION,
  TIER_CAPS,
  createBudgetLedger,
  resolveExplorationBudget,
} from '../src/exploration-budgets';
import type { BudgetLedger, ExplorationBudget } from '../src/exploration-budgets';

import {
  CUSTOM_CAPS_BUDGET,
  EXTENDED_CLASSIFICATION,
  MINIMAL_CLASSIFICATION,
  STANDARD_CLASSIFICATION,
  VALID_BUDGET,
  VALID_CLASSIFICATION,
  malformedBudget,
  malformedClassification,
  spendRequest,
} from './fixtures/budgets';

/** Resolve and be loud about it — a fixture failure must not pass silently. */
function resolveBudget(classification: unknown): ExplorationBudget {
  const result = resolveExplorationBudget(classification);
  if (!result.ok) {
    throw new Error(`resolution failed: ${result.errors.join('; ')}`);
  }
  return result.budget;
}

/** Open a ledger and be loud about it — a fixture failure must not pass silently. */
function openLedger(budget: unknown): BudgetLedger {
  const result = createBudgetLedger(budget);
  if (!result.ok) {
    throw new Error(`ledger creation failed: ${result.errors.join('; ')}`);
  }
  return result.ledger;
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

describe('CLAPP-086 — adaptive exploration budgets (the P9 factory second lane)', () => {
  test('the budget resolver is fail-closed with named errors for every malformation', () => {
    // The valid fixture passes — and the fixture's classification really
    // binds the frozen CLAPP-085 contract version this lane consumes.
    const valid = resolveExplorationBudget(VALID_CLASSIFICATION);
    expect(valid.ok).toBe(true);
    expect(VALID_CLASSIFICATION.targetVersion).toBe(TARGET_CLASS_VERSION);
    if (valid.ok) {
      expect(valid.budget.budgetVersion).toBe(EXPLORATION_BUDGET_VERSION);
      expect(valid.budget.budgetTier).toBe('standard');
      expect(valid.budget.classificationId).toBe(VALID_CLASSIFICATION.id);
    }

    // A non-object classification is named (the admission shape itself).
    const notAnObject = resolveExplorationBudget('not-a-classification');
    expect(notAnObject.ok).toBe(false);
    if (!notAnObject.ok) {
      expect(notAnObject.errors.some((error) => error.startsWith('classification:'))).toBe(true);
    }

    // Every field malformation refuses, naming its field AND the observed value.
    const cases: Array<{ classification: unknown; names: string[] }> = [
      {
        classification: malformedClassification({ targetVersion: '0.9' }),
        names: ['classification.targetVersion', '"0.9"'],
      },
      {
        classification: malformedClassification({ budgetTier: 'xl' }),
        names: ['classification.budgetTier', '"xl"'],
      },
      {
        classification: malformedClassification({ id: '' }),
        names: ['classification.id', '""'],
      },
    ];

    for (const { classification, names } of cases) {
      const result = resolveExplorationBudget(classification);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.length).toBeGreaterThan(0);
        for (const name of names) {
          expect(result.errors.some((error) => error.includes(name))).toBe(true);
        }
      }
    }

    // Two bad fields at once — EVERY error is collected, never just the first.
    const twoBad = resolveExplorationBudget(
      malformedClassification({ targetVersion: '0.9', budgetTier: 'xl' }),
    );
    expect(twoBad.ok).toBe(false);
    if (!twoBad.ok) {
      expect(twoBad.errors.some((error) => error.includes('classification.targetVersion'))).toBe(true);
      expect(twoBad.errors.some((error) => error.includes('classification.budgetTier'))).toBe(true);
    }

    // Fail closed, proven: every call above RETURNED (never threw) and
    // produced { ok: false } — the returns are themselves the
    // no-exceptions evidence.
  });

  test('the frozen tier table resolves all three tiers to their exact caps', () => {
    // The table's keys ARE the three frozen tiers — and they ARE the
    // CLAPP-085 BUDGET_TIERS vocabulary (the two lanes' vocabularies
    // agree; the tiers 085 tags are exactly the tiers this table spends).
    expect(Object.keys(TIER_CAPS)).toEqual(['minimal', 'standard', 'extended']);
    expect(Object.keys(TIER_CAPS)).toEqual([...BUDGET_TIERS]);

    type ExpectedCaps = { maxSteps: number; maxScreens: number; maxActionsPerScreen: number };
    const expected: Record<'minimal' | 'standard' | 'extended', ExpectedCaps> = {
      minimal: { maxSteps: 40, maxScreens: 8, maxActionsPerScreen: 3 },
      standard: { maxSteps: 120, maxScreens: 20, maxActionsPerScreen: 5 },
      extended: { maxSteps: 400, maxScreens: 50, maxActionsPerScreen: 8 },
    };
    const tierClassifications = {
      minimal: MINIMAL_CLASSIFICATION,
      standard: STANDARD_CLASSIFICATION,
      extended: EXTENDED_CLASSIFICATION,
    };

    for (const tier of ['minimal', 'standard', 'extended'] as const) {
      // The table entry itself is pinned literally, never trusted from the export.
      expect(TIER_CAPS[tier]).toEqual(expected[tier]);

      // The resolution spends the tier's tag as exactly those caps.
      const budget = resolveBudget(tierClassifications[tier]);
      expect(budget.budgetTier).toBe(tier);
      expect(budget.caps).toEqual(expected[tier]);

      // A FRESH copy — never the table's own object.
      const entry = TIER_CAPS[tier];
      expect(entry).toBeDefined();
      if (entry !== undefined) {
        expect(budget.caps).not.toBe(entry);
      }
    }

    // Mutating a returned caps NEVER mutates the frozen table — and a
    // fresh resolution is unaffected by the earlier mutation.
    const mutated = resolveBudget(STANDARD_CLASSIFICATION);
    mutated.caps.maxSteps = 9999;
    expect(TIER_CAPS['standard']).toEqual(expected['standard']);
    expect(resolveBudget(STANDARD_CLASSIFICATION).caps).toEqual(expected['standard']);
  });

  test('resolution is deterministic and carries the source id verbatim', () => {
    const first = resolveBudget(VALID_CLASSIFICATION);
    const second = resolveBudget(VALID_CLASSIFICATION);

    // The same classification resolves deep-equal, every time.
    expect(second).toEqual(first);

    // The tcls_ provenance binding is carried VERBATIM — the source
    // classification's id, character for character, never recomputed.
    expect(first.classificationId).toBe(VALID_CLASSIFICATION.id);
    expect(first.classificationId).toBe(STANDARD_CLASSIFICATION.id);
    expect(first.classificationId).toMatch(/^tcls_[0-9a-f]{64}$/);

    // The tier and the budget version ride verbatim too.
    expect(first.budgetTier).toBe(VALID_CLASSIFICATION.budgetTier);
    expect(first.budgetVersion).toBe(EXPLORATION_BUDGET_VERSION);
  });

  test('the ledger starts honest — spent zero, remaining equal to the caps, measured', () => {
    // ---- fail closed first: the ledger's duck-check names every
    // malformation of a resolved-budget shape, with the observed value ----
    const cases: Array<{ budget: unknown; names: string[] }> = [
      { budget: 'not-a-budget', names: ['budget:'] },
      { budget: null, names: ['budget:'] },
      { budget: malformedBudget({ budgetVersion: '0.9' }), names: ['budget.budgetVersion', '"0.9"'] },
      { budget: malformedBudget({ budgetTier: 'xl' }), names: ['budget.budgetTier', '"xl"'] },
      { budget: malformedBudget({ caps: 'nope' }), names: ['budget.caps'] },
      {
        budget: malformedBudget({ caps: { ...VALID_BUDGET.caps, maxSteps: -1 } }),
        names: ['budget.caps.maxSteps', '-1'],
      },
      {
        budget: malformedBudget({ caps: { ...VALID_BUDGET.caps, maxScreens: 1.5 } }),
        names: ['budget.caps.maxScreens', '1.5'],
      },
      {
        budget: malformedBudget({ caps: { maxSteps: 120, maxScreens: 20 } }),
        names: ['budget.caps.maxActionsPerScreen'],
      },
      { budget: malformedBudget({ classificationId: '' }), names: ['budget.classificationId'] },
    ];

    for (const { budget, names } of cases) {
      const result = createBudgetLedger(budget);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.length).toBeGreaterThan(0);
        for (const name of names) {
          expect(result.errors.some((error) => error.includes(name))).toBe(true);
        }
      }
    }

    // ---- the honest start over the resolved chain (resolver → ledger) ----
    const resolved = resolveBudget(STANDARD_CLASSIFICATION);
    const ledger = openLedger(resolved);

    // Zero spent; remaining MEASURED from the caps it was given.
    expect(ledger.stepsSpent).toBe(0);
    expect(ledger.screensSpent).toBe(0);
    expect(ledger.stepsRemaining).toBe(120);
    expect(ledger.screensRemaining).toBe(20);

    // The budget the ledger accounts, carried verbatim (deep-equal).
    expect(ledger.budget).toEqual(resolved);

    // ---- MEASURED, never asserted from the tier name: a duck-valid
    // budget whose caps DIFFER from its tier's table entry starts at the
    // GIVEN caps (10/4), never at the minimal entry (40/8) ----
    const custom = openLedger(CUSTOM_CAPS_BUDGET);
    expect(custom.stepsRemaining).toBe(10);
    expect(custom.screensRemaining).toBe(4);
    expect(custom.stepsSpent).toBe(0);
    expect(custom.screensSpent).toBe(0);

    // ---- sealed (the 075 law): mutating the handed-out budget copy
    // never rewrites the ledger's law — the accounting reads the sealed
    // internal store ----
    const handed = custom.budget;
    handed.caps.maxSteps = 9999;
    expect(custom.stepsRemaining).toBe(10);
  });

  test('accounting is measured — every accepted spend decrements the exact amount', () => {
    const ledger = openLedger(resolveBudget(STANDARD_CLASSIFICATION));

    // Spend (1 step, 0 screens): accepted, spent +1 exactly, remaining
    // recomputed MEASURED — both in the result and on the ledger.
    const first = ledger.spend(spendRequest(1, 0));
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.stepsRemaining).toBe(119);
      expect(first.screensRemaining).toBe(20);
    }
    expect(ledger.stepsSpent).toBe(1);
    expect(ledger.screensSpent).toBe(0);
    expect(ledger.stepsRemaining).toBe(119);
    expect(ledger.screensRemaining).toBe(20);

    // Spend (2 steps, 1 screen): accepted, spent incremented by the
    // EXACT amounts — 3 steps, 1 screen total — remaining recomputed.
    const second = ledger.spend(spendRequest(2, 1));
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.stepsRemaining).toBe(117);
      expect(second.screensRemaining).toBe(19);
    }
    expect(ledger.stepsSpent).toBe(3);
    expect(ledger.screensSpent).toBe(1);
    expect(ledger.stepsRemaining).toBe(117);
    expect(ledger.screensRemaining).toBe(19);

    // A zero spend is a valid no-op mid-stream: accepted, nothing changes.
    const noOp = ledger.spend(spendRequest(0, 0));
    expect(noOp.ok).toBe(true);
    if (noOp.ok) {
      expect(noOp.stepsRemaining).toBe(117);
      expect(noOp.screensRemaining).toBe(19);
    }
    expect(ledger.stepsSpent).toBe(3);
    expect(ledger.screensSpent).toBe(1);
    expect(ledger.stepsRemaining).toBe(117);
    expect(ledger.screensRemaining).toBe(19);
  });

  test('the cap is a law — a spend beyond remaining refuses', () => {
    // The minimal tier's 40 steps: 39 admitted, then 2 refused.
    const ledger = openLedger(resolveBudget(MINIMAL_CLASSIFICATION));

    const accepted = ledger.spend(spendRequest(39, 0));
    expect(accepted.ok).toBe(true);
    if (accepted.ok) {
      expect(accepted.stepsRemaining).toBe(1);
    }
    expect(ledger.stepsSpent).toBe(39);
    expect(ledger.stepsRemaining).toBe(1);

    // The 2-step spend refuses, naming the axis, the request, and the remaining.
    const refused = ledger.spend(spendRequest(2, 0));
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.errors.some((error) => error.includes('spend.steps'))).toBe(true);
      expect(refused.errors.some((error) => error.includes('the request 2'))).toBe(true);
      expect(refused.errors.some((error) => error.includes('the remaining 1'))).toBe(true);
    }

    // The law held: remaining is unchanged (1) and NEVER negative.
    expect(ledger.stepsSpent).toBe(39);
    expect(ledger.stepsRemaining).toBe(1);
    expect(ledger.stepsRemaining).toBeGreaterThanOrEqual(0);
  });

  test('a refused spend never consumes — and the axes are independent', () => {
    const ledger = openLedger(resolveBudget(MINIMAL_CLASSIFICATION));

    // 39 steps spent → 1 remaining; 0 screens spent → 8 remaining.
    expect(ledger.spend(spendRequest(39, 0)).ok).toBe(true);

    // A refused STEPS spend (2 at 1 remaining): steps unchanged, and the
    // SCREENS axis is untouched by the steps refusal.
    const refusedSteps = ledger.spend(spendRequest(2, 0));
    expect(refusedSteps.ok).toBe(false);
    expect(ledger.stepsSpent).toBe(39);
    expect(ledger.stepsRemaining).toBe(1);
    expect(ledger.screensSpent).toBe(0);
    expect(ledger.screensRemaining).toBe(8);

    // Vice versa: a refused SCREENS spend (9 at 8 remaining) leaves the
    // steps axis untouched.
    const refusedScreens = ledger.spend(spendRequest(0, 9));
    expect(refusedScreens.ok).toBe(false);
    expect(ledger.screensSpent).toBe(0);
    expect(ledger.screensRemaining).toBe(8);
    expect(ledger.stepsSpent).toBe(39);
    expect(ledger.stepsRemaining).toBe(1);

    // A spend exceeding BOTH axes refuses naming BOTH — and consumes nothing.
    const refusedBoth = ledger.spend(spendRequest(2, 9));
    expect(refusedBoth.ok).toBe(false);
    if (!refusedBoth.ok) {
      expect(refusedBoth.errors.some((error) => error.includes('spend.steps'))).toBe(true);
      expect(refusedBoth.errors.some((error) => error.includes('spend.screens'))).toBe(true);
    }
    expect(ledger.stepsSpent).toBe(39);
    expect(ledger.screensSpent).toBe(0);
    expect(ledger.stepsRemaining).toBe(1);
    expect(ledger.screensRemaining).toBe(8);

    // Malformed spends refuse with named errors and consume nothing.
    const negative = ledger.spend({ steps: -1, screens: 0 });
    expect(negative.ok).toBe(false);
    if (!negative.ok) {
      expect(negative.errors.some((error) => error.includes('spend.steps'))).toBe(true);
    }
    const fractional = ledger.spend({ steps: 0, screens: 1.5 });
    expect(fractional.ok).toBe(false);
    if (!fractional.ok) {
      expect(fractional.errors.some((error) => error.includes('spend.screens'))).toBe(true);
    }
    const notAnObject = ledger.spend('nope');
    expect(notAnObject.ok).toBe(false);
    if (!notAnObject.ok) {
      expect(notAnObject.errors.some((error) => error.startsWith('spend:'))).toBe(true);
    }
    expect(ledger.stepsSpent).toBe(39);
    expect(ledger.screensSpent).toBe(0);
    expect(ledger.stepsRemaining).toBe(1);
    expect(ledger.screensRemaining).toBe(8);

    // A spend landing EXACTLY at the cap is allowed: screens 8/8 → 0 remaining.
    const exactScreens = ledger.spend(spendRequest(0, 8));
    expect(exactScreens.ok).toBe(true);
    expect(ledger.screensSpent).toBe(8);
    expect(ledger.screensRemaining).toBe(0);

    // Zero remaining refuses any positive spend — and the OTHER axis is
    // still untouched by the refusal.
    const refusedAtZero = ledger.spend(spendRequest(0, 1));
    expect(refusedAtZero.ok).toBe(false);
    expect(ledger.screensRemaining).toBe(0);
    expect(ledger.stepsSpent).toBe(39);
    expect(ledger.stepsRemaining).toBe(1);

    // Steps to exactly zero as well.
    const exactSteps = ledger.spend(spendRequest(1, 0));
    expect(exactSteps.ok).toBe(true);
    expect(ledger.stepsRemaining).toBe(0);
    expect(ledger.stepsSpent).toBe(40);

    // A zero spend at zero remaining is a VALID no-op: accepted, and
    // nothing changes on either axis.
    const zeroAtZero = ledger.spend(spendRequest(0, 0));
    expect(zeroAtZero.ok).toBe(true);
    if (zeroAtZero.ok) {
      expect(zeroAtZero.stepsRemaining).toBe(0);
      expect(zeroAtZero.screensRemaining).toBe(0);
    }
    expect(ledger.stepsSpent).toBe(40);
    expect(ledger.screensSpent).toBe(8);
    expect(ledger.stepsRemaining).toBe(0);
    expect(ledger.screensRemaining).toBe(0);

    // At zero on both axes, any positive spend refuses on both — never
    // consumes, and remaining NEVER goes negative.
    const refusedAtZeroBoth = ledger.spend(spendRequest(1, 1));
    expect(refusedAtZeroBoth.ok).toBe(false);
    expect(ledger.stepsRemaining).toBe(0);
    expect(ledger.screensRemaining).toBe(0);
    expect(ledger.stepsRemaining).toBeGreaterThanOrEqual(0);
    expect(ledger.screensRemaining).toBeGreaterThanOrEqual(0);
  });

  test('the package imports only frozen contracts — the no-fork law is pinned', () => {
    const packageRoot = dirname(import.meta.dir); // packages/factory (one level above test/)

    // ---- 1. the exact src file list (the delivered surface) ----
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
