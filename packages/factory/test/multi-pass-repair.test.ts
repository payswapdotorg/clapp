// CLAPP-088 — the multi-pass repair scheduler tests (the P9 fourth lane
// — Worker 1, the factory lane's owner).
//
// Fixtures: test/fixtures/repair-passes.ts (the frozen v0.1 CLAPP-085
// TargetClassification shapes carrying REAL tcls_ ids, one per frozen
// tier + the round-facts builders + the SCRIPTED fake round runners —
// the duck-typed seam faked as DATA; the fakes never report a derived
// outcome). The eight named tests cover the packet's axes: the
// fail-closed scheduler (every malformation named with its observed
// value), the frozen tier→pass-cap table (all three tiers resolve their
// exact caps; the cap is a law — a runner offering more rounds is
// stopped at the cap), the DERIVED pass outcomes (from the round facts
// by comparison — the first vs initialFindings, never reported by the
// seam), the terminal convergence stop, the honest budget exhaustion
// (convergence never inferred from a zero remaining count), the honest
// regression stop (never spend on a diverging candidate), the honest
// provenance and measured record (classificationId/initialFindings
// verbatim, content-addressed deterministic 'mpass_' ids with
// scheduledAt excluded from the minting body, a changed tier moves the
// id), and the import-discipline pin (the no-fork law over the exact
// five-file src list: @clapp/core + @clapp/observe at RUNTIME,
// @clapp/learn TYPE-ONLY, no other packages — the repair lane NOT
// imported, the loop scheduled through the duck-typed seam).

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import {
  MULTI_PASS_REPAIR_VERSION,
  TIER_PASS_CAPS,
  scheduleMultiPassRepair,
} from '../src/multi-pass-repair';
import type { MultiPassSchedule } from '../src/multi-pass-repair';

import {
  EXTENDED_CLASSIFICATION,
  MINIMAL_CLASSIFICATION,
  SCHEDULED_AT_A,
  SCHEDULED_AT_B,
  STANDARD_CLASSIFICATION,
  VALID_CLASSIFICATION,
  malformedClassification,
  roundFacts,
  scriptedRunner,
} from './fixtures/repair-passes';

/** Schedule and be loud about it — a fixture failure must not pass silently. */
async function schedule(
  classification: unknown,
  runner: unknown,
  initialFindings: number,
  scheduledAt: string = SCHEDULED_AT_A,
): Promise<MultiPassSchedule> {
  const result = await scheduleMultiPassRepair(classification, runner, initialFindings, scheduledAt);
  if (!result.ok) {
    throw new Error(`scheduling failed: ${result.errors.join('; ')}`);
  }
  return result.schedule;
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

describe('CLAPP-088 — multi-pass repair (the P9 factory fourth lane)', () => {
  test('the pass scheduler is fail-closed with named errors for every malformation', async () => {
    const runner = scriptedRunner([roundFacts(0, true)]);

    // The valid fixture passes — and the fixture's classification
    // really binds the frozen classification contract this lane consumes.
    const valid = await scheduleMultiPassRepair(
      VALID_CLASSIFICATION,
      runner,
      5,
      SCHEDULED_AT_A,
    );
    expect(valid.ok).toBe(true);
    expect(VALID_CLASSIFICATION.targetVersion).toBe('0.1');

    // A non-object classification is named (the admission shape itself).
    const notAnObject = await scheduleMultiPassRepair('not-a-classification', runner, 5, SCHEDULED_AT_A);
    expect(notAnObject.ok).toBe(false);
    if (!notAnObject.ok) {
      expect(notAnObject.errors.some((error) => error.startsWith('classification:'))).toBe(true);
    }

    // A wrong targetVersion is named with the observed value.
    const wrongVersion = await scheduleMultiPassRepair(
      malformedClassification({ targetVersion: '9.9' }),
      runner,
      5,
      SCHEDULED_AT_A,
    );
    expect(wrongVersion.ok).toBe(false);
    if (!wrongVersion.ok) {
      expect(wrongVersion.errors.some((error) => error.startsWith('classification.targetVersion:'))).toBe(true);
      expect(wrongVersion.errors.some((error) => error.includes('"9.9"'))).toBe(true);
    }

    // An unknown budgetTier is named WITH THE OBSERVED VALUE.
    const unknownTier = await scheduleMultiPassRepair(
      malformedClassification({ budgetTier: 'deluxe' }),
      runner,
      5,
      SCHEDULED_AT_A,
    );
    expect(unknownTier.ok).toBe(false);
    if (!unknownTier.ok) {
      expect(unknownTier.errors.some((error) => error.startsWith('classification.budgetTier:'))).toBe(true);
      expect(unknownTier.errors.some((error) => error.includes('"deluxe"'))).toBe(true);
    }

    // A runner without a callable runRound is named (the duck-typed seam).
    const notARunner = await scheduleMultiPassRepair(
      VALID_CLASSIFICATION,
      { runRound: 'not-callable' },
      5,
      SCHEDULED_AT_A,
    );
    expect(notARunner.ok).toBe(false);
    if (!notARunner.ok) {
      expect(notARunner.errors.some((error) => error.startsWith('runner:'))).toBe(true);
      expect(notARunner.errors.some((error) => error.includes('runRound'))).toBe(true);
    }

    // A negative initialFindings is named with the observed value.
    const negative = await scheduleMultiPassRepair(VALID_CLASSIFICATION, runner, -3, SCHEDULED_AT_A);
    expect(negative.ok).toBe(false);
    if (!negative.ok) {
      expect(negative.errors.some((error) => error.startsWith('initialFindings:'))).toBe(true);
      expect(negative.errors.some((error) => error.includes('-3'))).toBe(true);
    }

    // An empty scheduledAt is named (the caller-injected clock).
    const emptyAt = await scheduleMultiPassRepair(VALID_CLASSIFICATION, runner, 5, '');
    expect(emptyAt.ok).toBe(false);
    if (!emptyAt.ok) {
      expect(emptyAt.errors.some((error) => error.startsWith('scheduledAt:'))).toBe(true);
    }

    // A malformed classification AND a malformed runner collect BOTH
    // errors — ALL of them, never just the first.
    const combined = await scheduleMultiPassRepair(
      malformedClassification({ budgetTier: 'deluxe' }),
      { runRound: 'not-callable' },
      -3,
      '',
    );
    expect(combined.ok).toBe(false);
    if (!combined.ok) {
      expect(combined.errors.length).toBeGreaterThanOrEqual(4);
    }
  });

  test('the frozen tier→pass-cap table governs — all three tiers resolve their exact caps', async () => {
    // The frozen v0.1 table itself — a quiet edit is a contract break.
    expect(TIER_PASS_CAPS).toEqual({ minimal: 2, standard: 4, extended: 8 });

    // Each tier resolves its exact cap, and a never-converging,
    // never-regressing (stalled) runner exhausts it honestly: exactly
    // cap passes, MEASURED, never a synthetic convergence.
    const perTier: Array<{ classification: unknown; tier: string; cap: number }> = [
      { classification: MINIMAL_CLASSIFICATION, tier: 'minimal', cap: 2 },
      { classification: STANDARD_CLASSIFICATION, tier: 'standard', cap: 4 },
      { classification: EXTENDED_CLASSIFICATION, tier: 'extended', cap: 8 },
    ];
    for (const { classification, tier, cap } of perTier) {
      const stalled = scriptedRunner([roundFacts(4)]); // 4 === 4 forever: stalled, never converged
      const result = await schedule(classification, stalled, 4, SCHEDULED_AT_A);
      expect(result.budgetTier).toBe(tier);
      expect(result.maxPasses).toBe(cap);
      expect(result.totalRounds).toBe(cap); // MEASURED — the cap is the only stop
      expect(result.passes.length).toBe(cap);
      expect(result.converged).toBe(false);
    }

    // The cap is a LAW: a runner offering FIVE rounds (converging on
    // the fifth) under the minimal cap is stopped AT the cap — rounds
    // 3, 4, 5 are never asked for.
    const fiveRoundRunner = scriptedRunner([
      roundFacts(4),
      roundFacts(3),
      roundFacts(2),
      roundFacts(1),
      roundFacts(0, true),
    ]);
    const minimal = await schedule(MINIMAL_CLASSIFICATION, fiveRoundRunner, 5, SCHEDULED_AT_A);
    expect(minimal.maxPasses).toBe(2);
    expect(minimal.totalRounds).toBe(2); // MEASURED
    expect(fiveRoundRunner.calls).toEqual([1, 2]); // the cap refused rounds 3-5
    expect(minimal.converged).toBe(false); // honest — budget exhaustion, never a guessed convergence
  });

  test('pass outcomes are derived from the round facts — never reported by the seam', async () => {
    // The scripted fact sequence 5 → 3 → 3 → 6 (the round's OWN facts,
    // consumed as DATA), converging on the 5th round in the script. The
    // FIRST pass derives vs initialFindings (10): 5 < 10 → 'improved'.
    // The regressed 4th pass is an honest stop — the script's converging
    // 5th round is never asked for.
    const runner = scriptedRunner([
      roundFacts(5), // 5 < 10 (the first vs initialFindings) → improved
      roundFacts(3), // 3 < 5 → improved
      roundFacts(3), // 3 === 3 → stalled
      roundFacts(6), // 6 > 3 → regressed → the honest stop
      roundFacts(0, true), // never reached — the runner is never asked
    ]);
    const result = await schedule(EXTENDED_CLASSIFICATION, runner, 10, SCHEDULED_AT_A);

    // The outcomes are the SCHEDULER's derivation, by comparison — the
    // seam never reported one (the fake only produces facts).
    expect(result.passes.map((pass) => pass.outcome)).toEqual([
      'improved',
      'improved',
      'stalled',
      'regressed',
    ]);

    // The facts carried VERBATIM — the derivation's measured inputs.
    expect(result.passes.map((pass) => pass.facts.remainingFindings)).toEqual([5, 3, 3, 6]);
    expect(result.passes.map((pass) => pass.facts.converged)).toEqual([false, false, false, false]);
    expect(result.passes.map((pass) => pass.passNumber)).toEqual([1, 2, 3, 4]);

    // The first pass's comparison basis is the schedule's OWN baseline.
    expect(result.initialFindings).toBe(10);
    expect(result.passes[0]?.facts.remainingFindings).toBeLessThan(result.initialFindings);

    // The 5th (converging) round was never spent; the record is honest.
    expect(runner.calls).toEqual([1, 2, 3, 4]);
    expect(result.totalRounds).toBe(4); // MEASURED
    expect(result.converged).toBe(false);
  });

  test('convergence is terminal — the schedule stops at the converged pass', async () => {
    // Converges on pass 2 of the 4-cap standard schedule.
    const runner = scriptedRunner([
      roundFacts(3), // 3 < 5 → improved
      roundFacts(0, true), // the round's own honest convergence flag
      roundFacts(0, true), // never asked — convergence is terminal
    ]);
    const result = await schedule(STANDARD_CLASSIFICATION, runner, 5, SCHEDULED_AT_A);

    expect(result.maxPasses).toBe(4);
    expect(result.passes.length).toBe(2); // exactly 2 passes
    expect(result.totalRounds).toBe(2); // MEASURED
    expect(result.converged).toBe(true); // ONLY because a pass reported it
    expect(result.passes[1]?.outcome).toBe('converged'); // DERIVED from facts.converged
    expect(result.passes[1]?.facts.converged).toBe(true);
    expect(result.passes[0]?.outcome).toBe('improved');
    expect(runner.calls).toEqual([1, 2]); // passes 3 and 4 never spent
  });

  test('budget exhaustion is honest — no convergence ever inferred', async () => {
    // remainingFindings reaches ZERO without any round ever reporting
    // convergence: the minimal cap exhausts, and the schedule NEVER
    // infers convergence from the count.
    const runner = scriptedRunner([roundFacts(1), roundFacts(0)]);
    const result = await schedule(MINIMAL_CLASSIFICATION, runner, 4, SCHEDULED_AT_A);

    expect(result.maxPasses).toBe(2);
    expect(result.totalRounds).toBe(2); // exactly the cap — MEASURED
    expect(result.passes.length).toBe(2);
    expect(result.converged).toBe(false); // never inferred from remainingFindings === 0
    expect(result.passes[1]?.facts.remainingFindings).toBe(0);
    expect(result.passes.map((pass) => pass.outcome)).toEqual(['improved', 'improved']);
    for (const pass of result.passes) {
      expect(pass.facts.converged).toBe(false); // never a synthetic converged pass
      expect(pass.outcome).not.toBe('converged');
    }
  });

  test('a regression is an honest stop — never spend on a diverging candidate', async () => {
    // Facts 5 → 8 under the standard 4-cap: pass 1 stalls (5 === 5),
    // pass 2 regresses (8 > 5) — the schedule stops after 2 passes with
    // the regressed record CARRIED, and the script's converging third
    // round is never asked for (never spend on a diverging candidate).
    const runner = scriptedRunner([
      roundFacts(5), // 5 === 5 → stalled
      roundFacts(8), // 8 > 5 → regressed → the honest stop
      roundFacts(0, true), // never reached
    ]);
    const result = await schedule(STANDARD_CLASSIFICATION, runner, 5, SCHEDULED_AT_A);

    expect(result.maxPasses).toBe(4); // the standard cap
    expect(result.totalRounds).toBe(2); // stopped after 2 passes
    expect(result.passes.length).toBe(2);
    expect(result.passes[0]?.outcome).toBe('stalled');
    expect(result.passes[1]?.outcome).toBe('regressed'); // the regressed record carried
    expect(result.passes[1]?.facts.remainingFindings).toBe(8); // the divergence, measured
    expect(result.converged).toBe(false);
    expect(runner.calls).toEqual([1, 2]); // 2 passes of budget left unspent
  });

  test('the provenance and the measured record are honest', async () => {
    const script = [roundFacts(2), roundFacts(0, true)];

    // The provenance carried VERBATIM; the record measured, never guessed.
    const first = await schedule(STANDARD_CLASSIFICATION, scriptedRunner(script), 7, SCHEDULED_AT_A);
    expect(first.classificationId).toBe(STANDARD_CLASSIFICATION.id); // the tcls_ identity, verbatim
    expect(first.budgetTier).toBe('standard');
    expect(first.maxPasses).toBe(4);
    expect(first.initialFindings).toBe(7); // the caller's baseline, verbatim
    expect(first.multiPassVersion).toBe(MULTI_PASS_REPAIR_VERSION);
    expect(first.totalRounds).toBe(2); // MEASURED
    expect(first.converged).toBe(true);
    expect(first.scheduledAt).toBe(SCHEDULED_AT_A);

    // The content-addressed identity: 'mpass_' + the sha256 hex digest.
    expect(first.id.startsWith('mpass_')).toBe(true);
    expect(first.id.length).toBe(6 + 64); // 'mpass_' + 64 lowercase hex chars

    // Deterministic: the same inputs twice → deep-equal schedules.
    const second = await schedule(STANDARD_CLASSIFICATION, scriptedRunner(script), 7, SCHEDULED_AT_A);
    expect(second).toEqual(first);

    // scheduledAt is EXCLUDED from the minting body: a different caller
    // clock never moves the id (the 085 tcls_ discipline).
    const later = await schedule(STANDARD_CLASSIFICATION, scriptedRunner(script), 7, SCHEDULED_AT_B);
    expect(later.id).toBe(first.id);
    expect(later.scheduledAt).toBe(SCHEDULED_AT_B);
    expect({ ...later, scheduledAt: first.scheduledAt }).toEqual(first);

    // A changed tier → a different id (isolated: both schedules converge
    // on pass 1, so only the tier and its cap differ).
    const convergeScript = [roundFacts(0, true)];
    const standard = await schedule(STANDARD_CLASSIFICATION, scriptedRunner(convergeScript), 7, SCHEDULED_AT_A);
    const minimal = await schedule(MINIMAL_CLASSIFICATION, scriptedRunner(convergeScript), 7, SCHEDULED_AT_A);
    expect(standard.totalRounds).toBe(1);
    expect(minimal.totalRounds).toBe(1);
    expect(minimal.budgetTier).toBe('minimal');
    expect(minimal.maxPasses).toBe(2);
    expect(minimal.id).not.toBe(standard.id); // the tier moved the identity
    expect(minimal.classificationId).not.toBe(standard.classificationId); // and the provenance (a different tcls_)
  });

  test('the package imports only frozen contracts — the no-fork law is pinned', () => {
    const packageRoot = dirname(import.meta.dir); // packages/factory (one level above test/)

    // ---- 1. the exact src file list (the delivered surface) ----
    // CLAPP-088 grew the surface to five files (multi-pass-repair is
    // this package's fourth component); the pin stays exact — the living
    // list, per the security imports.test.ts precedent.
    const srcFiles = listTsFiles(join(packageRoot, 'src')).sort();
    expect(srcFiles.map((file) => file.slice(packageRoot.length + 1))).toEqual([
      'src/exploration-budgets.ts',
      'src/index.ts',
      'src/multi-pass-repair.ts',
      'src/package-graph.ts',
      'src/target-classification.ts',
    ]);

    const runtimeAllowed = new Set(['@clapp/core', '@clapp/observe']);
    const typeOnlyAllowed = new Set(['@clapp/learn']);
    const violations: string[] = [];

    // ---- 2. src/** — @clapp/core + @clapp/observe at RUNTIME;
    //         @clapp/learn TYPE-ONLY; no other packages; the repair
    //         lane NOT imported (the loop is SCHEDULED through the
    //         duck-typed seam, never imported, never re-implemented —
    //         naming the frozen surface in documentation is legal, an
    //         import clause of it never is) ----
    for (const file of srcFiles) {
      const display = file.slice(packageRoot.length + 1);
      const source = readFileSync(file, 'utf8');

      for (const { clause, specifier } of sourceImports(source)) {
        if (specifier.startsWith('@clapp/')) {
          if (specifier === '@clapp/repair' || specifier.startsWith('@clapp/repair/')) {
            violations.push(
              `${display}: imports the repair lane ${JSON.stringify(specifier)} — the no-fork law: the repair loop is SCHEDULED through the duck-typed runner seam, never imported (not even type-only)`,
            );
            continue;
          }
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
        const specifier = match[1] ?? '';
        if (specifier === '@clapp/repair' || specifier.startsWith('@clapp/repair/')) {
          violations.push(
            `${display}: bare import of the repair lane ${JSON.stringify(specifier)} — the loop is scheduled through the duck-typed runner seam, never imported`,
          );
          continue;
        }
        violations.push(`${display}: bare side-effect import ${JSON.stringify(specifier)}`);
      }
      for (const match of source.matchAll(DYNAMIC_RE)) {
        const specifier = match[1] ?? '';
        if (specifier === '@clapp/repair' || specifier.startsWith('@clapp/repair/')) {
          violations.push(
            `${display}: dynamic import of the repair lane ${JSON.stringify(specifier)} — the loop is scheduled through the duck-typed runner seam, never imported`,
          );
          continue;
        }
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
