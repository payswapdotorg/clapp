// CLAPP-089 — the human release gate tests (the P9 fifth and final
// lane — Worker 1, the factory lane's owner; the roadmap's last line).
//
// Fixtures: test/fixtures/release-gates.ts (the frozen v0.1 CLAPP-088
// MultiPassSchedule shapes carrying REAL mpass_ ids minted by the
// actual scheduleMultiPassRepair over the 088 fixtures' tier
// classifications — one converging minimal-tier schedule, one
// never-converged extended-tier schedule — plus the caller-injected
// gate/release clocks and the malformed-schedule override builder; the
// verdicts themselves are CALLER-PRESENTED literals, exactly as they
// arrive at the seam — a verdict fixture would be a lie about where
// verdicts come from). The eight named tests cover the gate law's
// axes: the fail-closed gate open (every malformation named with its
// observed value), pending never releases (honest data, never an
// exception), one gate one verdict (the second applyVerdict is a named
// error; the first verdict stands — and the vocabulary is enforced
// BEFORE any state change), rejected never releases (honest data, no
// exception, the rejection permanent), approved releases honestly (the
// provenance chain tcls_+mpass_ and the measured schedule facts
// carried VERBATIM — asserted against the fixture schedule, never
// re-derived), rgate_ id determinism (the clock never moves the id;
// the verdict and the tier do), the provenance chain law (a non-mpass_
// scheduleId never opens a gate — the chain must be traceable to the
// 088 lane), and the import-discipline pin (the no-fork law over the
// exact six-file src list: @clapp/core + @clapp/observe at RUNTIME,
// @clapp/learn TYPE-ONLY, no other packages — the repair lane NOT
// imported, and the schedule's own module never imported by the gate:
// the CLAPP-088 schedule is frozen DATA on arrival, never forked).

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import {
  RELEASE_GATE_VERSION,
  applyVerdict,
  openReleaseGate,
  releaseFromGate,
} from '../src/release-gate';
import type { ReleaseGate } from '../src/release-gate';

import {
  EXTENDED_SCHEDULE,
  GATED_AT_A,
  GATED_AT_B,
  MINIMAL_SCHEDULE,
  RELEASED_AT_A,
  RELEASED_AT_B,
  malformedSchedule,
} from './fixtures/release-gates';

/** Open and be loud about it — a fixture failure must not pass silently. */
async function open(schedule: unknown, gatedAt: string = GATED_AT_A): Promise<ReleaseGate> {
  const result = await openReleaseGate(schedule, gatedAt);
  if (!result.ok) {
    throw new Error(`gate open failed: ${result.errors.join('; ')}`);
  }
  return result.gate;
}

/** Seal and be loud about it — a fixture failure must not pass silently. */
async function seal(gate: unknown, verdict: unknown): Promise<ReleaseGate> {
  const result = await applyVerdict(gate, verdict);
  if (!result.ok) {
    throw new Error(`verdict seal failed: ${result.errors.join('; ')}`);
  }
  return result.gate;
}

/**
 * Assert the release seam REFUSES with honest data — never an exception
 * (the gate law 4: the caller must be able to branch on refusal) — and
 * return the refusal's error list for the caller's own assertions.
 */
async function refuse(gate: unknown, releasedAt: string): Promise<string[]> {
  let result: Awaited<ReturnType<typeof releaseFromGate>>;
  try {
    result = await releaseFromGate(gate, releasedAt);
  } catch (error) {
    throw new Error(
      `releaseFromGate threw (a law 4 violation — refusal must be honest data, never a thrown exception): ${String(error)}`,
    );
  }
  if (result.ok) {
    throw new Error(
      `releaseFromGate released a gate that must never release: ${JSON.stringify(result.release)}`,
    );
  }
  return result.errors;
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

describe('CLAPP-089 — the human release gate (the P9 factory fifth lane, the last)', () => {
  test('the gate open is fail-closed with named errors for every malformation', async () => {
    // The valid fixture opens — and the fixtures really bind the frozen
    // 088 schedule contract this gate consumes.
    const valid = await openReleaseGate(MINIMAL_SCHEDULE, GATED_AT_A);
    expect(valid.ok).toBe(true);
    expect(MINIMAL_SCHEDULE.multiPassVersion).toBe('0.1');

    // A non-object schedule is named (the admission shape itself).
    const notAnObject = await openReleaseGate('not-a-schedule', GATED_AT_A);
    expect(notAnObject.ok).toBe(false);
    if (!notAnObject.ok) {
      expect(notAnObject.errors.some((error) => error.startsWith('schedule:'))).toBe(true);
    }

    // A wrong multiPassVersion is named with the observed value.
    const wrongVersion = await openReleaseGate(
      malformedSchedule({ multiPassVersion: '9.9' }),
      GATED_AT_A,
    );
    expect(wrongVersion.ok).toBe(false);
    if (!wrongVersion.ok) {
      expect(wrongVersion.errors.some((error) => error.startsWith('schedule.multiPassVersion:'))).toBe(true);
      expect(wrongVersion.errors.some((error) => error.includes('"9.9"'))).toBe(true);
    }

    // An unknown budgetTier is named WITH THE OBSERVED VALUE.
    const unknownTier = await openReleaseGate(
      malformedSchedule({ budgetTier: 'deluxe' }),
      GATED_AT_A,
    );
    expect(unknownTier.ok).toBe(false);
    if (!unknownTier.ok) {
      expect(unknownTier.errors.some((error) => error.startsWith('schedule.budgetTier:'))).toBe(true);
      expect(unknownTier.errors.some((error) => error.includes('"deluxe"'))).toBe(true);
    }

    // A non-boolean converged is named with the observed value.
    const badConverged = await openReleaseGate(
      malformedSchedule({ converged: 'yes' }),
      GATED_AT_A,
    );
    expect(badConverged.ok).toBe(false);
    if (!badConverged.ok) {
      expect(badConverged.errors.some((error) => error.startsWith('schedule.converged:'))).toBe(true);
      expect(badConverged.errors.some((error) => error.includes('"yes"'))).toBe(true);
    }

    // An empty classificationId is named (the tcls_ provenance).
    const emptyClassId = await openReleaseGate(
      malformedSchedule({ classificationId: '' }),
      GATED_AT_A,
    );
    expect(emptyClassId.ok).toBe(false);
    if (!emptyClassId.ok) {
      expect(emptyClassId.errors.some((error) => error.startsWith('schedule.classificationId:'))).toBe(true);
    }

    // A malformed totalRounds is named with the observed value — the
    // schedule's MEASURED pass count, carried verbatim as the gate's
    // passCount, so its malformation is the gate's business too.
    const badCount = await openReleaseGate(
      malformedSchedule({ totalRounds: -1 }),
      GATED_AT_A,
    );
    expect(badCount.ok).toBe(false);
    if (!badCount.ok) {
      expect(badCount.errors.some((error) => error.startsWith('schedule.totalRounds:'))).toBe(true);
      expect(badCount.errors.some((error) => error.includes('-1'))).toBe(true);
    }

    // A non-mpass_ schedule id is named (the provenance chain law —
    // deep-dived in the dedicated test below).
    const wrongId = await openReleaseGate(
      malformedSchedule({ id: 'sched_not_an_mpass_id' }),
      GATED_AT_A,
    );
    expect(wrongId.ok).toBe(false);
    if (!wrongId.ok) {
      expect(wrongId.errors.some((error) => error.startsWith('schedule.id:'))).toBe(true);
    }

    // An empty gatedAt is named (the caller-injected clock).
    const emptyAt = await openReleaseGate(MINIMAL_SCHEDULE, '');
    expect(emptyAt.ok).toBe(false);
    if (!emptyAt.ok) {
      expect(emptyAt.errors.some((error) => error.startsWith('gatedAt:'))).toBe(true);
    }

    // A malformed schedule AND an empty clock collect ALL errors —
    // never just the first.
    const combined = await openReleaseGate(
      malformedSchedule({ budgetTier: 'deluxe', converged: 'yes' }),
      '',
    );
    expect(combined.ok).toBe(false);
    if (!combined.ok) {
      expect(combined.errors.length).toBeGreaterThanOrEqual(3);
    }
  });

  test('pending never releases — an open, unsealed gate refuses with honest data', async () => {
    const gate = await open(MINIMAL_SCHEDULE, GATED_AT_A);

    // The opened gate is PENDING — a STATE, never a verdict: the record
    // holds NO verdict key at all.
    expect(gate.state).toBe('pending');
    expect('verdict' in gate).toBe(false);

    // The refusal is honest DATA, never an exception (law 4 — the
    // caller must be able to branch on refusal).
    const errors = await refuse(gate, RELEASED_AT_A);
    expect(errors.some((error) => error.startsWith('gate:'))).toBe(true);
    expect(errors.some((error) => error.includes('pending'))).toBe(true);
    expect(errors.some((error) => error.includes('never releases'))).toBe(true);

    // A pending gate with a BAD clock collects the clock error too —
    // fail closed, ALL errors.
    const badClock = await refuse(gate, '');
    expect(badClock.some((error) => error.startsWith('releasedAt:'))).toBe(true);
    expect(badClock.some((error) => error.includes('pending'))).toBe(true);

    // A garbage gate is named, never an exception (the admission shape).
    const garbage = await refuse('not-a-gate', RELEASED_AT_A);
    expect(garbage.some((error) => error.startsWith('gate:'))).toBe(true);

    // The refusal never mutated the record: the pending gate still seals
    // afterwards (the module touches nothing but the data given).
    const sealed = await seal(gate, 'approved');
    expect(sealed.state).toBe('sealed');
    expect(sealed.verdict).toBe('approved');
  });

  test('one gate, one verdict — the second applyVerdict is a named error; the first stands', async () => {
    const pending = await open(MINIMAL_SCHEDULE, GATED_AT_A);

    // A verdict OUTSIDE the two-value vocabulary — even the word
    // 'pending' itself — is a named error at the seam, BEFORE any state
    // change (law 2): 'pending' is a STATE, never a verdict.
    const notAVerdict = await applyVerdict(pending, 'pending');
    expect(notAVerdict.ok).toBe(false);
    if (!notAVerdict.ok) {
      expect(notAVerdict.errors.some((error) => error.startsWith('verdict:'))).toBe(true);
      expect(notAVerdict.errors.some((error) => error.includes('"pending"'))).toBe(true);
    }

    // The refused attempt left NO trace (it was refused BEFORE any state
    // change): the pending record still holds no verdict, and the FIRST
    // VALID verdict still seals.
    expect('verdict' in pending).toBe(false);
    const first = await seal(pending, 'approved');
    expect(first.state).toBe('sealed');
    expect(first.verdict).toBe('approved');

    // The SECOND applyVerdict — even with a valid verdict, even with the
    // SAME verdict — is a named error (law 3: one gate, one verdict).
    const second = await applyVerdict(first, 'rejected');
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.errors.some((error) => error.startsWith('gate:'))).toBe(true);
      expect(second.errors.some((error) => error.includes('one gate, one verdict'))).toBe(true);
      expect(second.errors.some((error) => error.includes('no re-vote, no overwrite, no appeal'))).toBe(true);
    }

    // A malformed verdict on a sealed gate collects BOTH errors — ALL of
    // them, never just the first (the vocabulary law AND the one-verdict
    // law).
    const secondGarbage = await applyVerdict(first, 'maybe');
    expect(secondGarbage.ok).toBe(false);
    if (!secondGarbage.ok) {
      expect(secondGarbage.errors.some((error) => error.startsWith('verdict:'))).toBe(true);
      expect(secondGarbage.errors.some((error) => error.includes('one gate, one verdict'))).toBe(true);
    }

    // THE FIRST VERDICT STANDS: the sealed record is unchanged by the
    // refused attempts, and the release seam honors the first verdict —
    // the approved gate releases despite the rejected attempt.
    expect(first.verdict).toBe('approved');
    const release = await releaseFromGate(first, RELEASED_AT_A);
    expect(release.ok).toBe(true);
    if (release.ok) {
      expect(release.release.verdict).toBe('approved');
    }
  });

  test('rejected never releases — a sealed rejected gate refuses with honest data, no exception', async () => {
    const gate = await open(EXTENDED_SCHEDULE, GATED_AT_A);
    const sealed = await seal(gate, 'rejected');
    expect(sealed.state).toBe('sealed');
    expect(sealed.verdict).toBe('rejected');

    // The refusal is honest DATA, never an exception (law 4) — the
    // caller must be able to branch on refusal.
    const errors = await refuse(sealed, RELEASED_AT_A);
    expect(errors.some((error) => error.startsWith('gate:'))).toBe(true);
    expect(errors.some((error) => error.includes('rejected'))).toBe(true);
    expect(errors.some((error) => error.includes('never releases'))).toBe(true);

    // The rejection is PERMANENT (law 3): a re-vote to 'approved' is a
    // named error, and the release seam still refuses afterwards —
    // there is no appeal.
    const revote = await applyVerdict(sealed, 'approved');
    expect(revote.ok).toBe(false);
    if (!revote.ok) {
      expect(revote.errors.some((error) => error.includes('one gate, one verdict'))).toBe(true);
    }
    const stillRefused = await refuse(sealed, RELEASED_AT_B);
    expect(stillRefused.some((error) => error.includes('rejected'))).toBe(true);
  });

  test('approved releases honestly — the provenance chain and the measured facts carried verbatim', async () => {
    // The fixture's own honesty preamble: the schedule's totalRounds IS
    // its measured pass count (minted by the real 088 scheduler), so
    // asserting against it pins "no re-derivation" to the fixture.
    expect(EXTENDED_SCHEDULE.totalRounds).toBe(EXTENDED_SCHEDULE.passes.length);
    expect(EXTENDED_SCHEDULE.converged).toBe(false); // honest budget exhaustion — never converged

    // The GATE record carries the provenance chain and the measured
    // facts verbatim (asserted against the fixture schedule itself).
    const gate = await open(EXTENDED_SCHEDULE, GATED_AT_A);
    expect(gate.classificationId).toBe(EXTENDED_SCHEDULE.classificationId); // the tcls_ identity, verbatim
    expect(gate.scheduleId).toBe(EXTENDED_SCHEDULE.id); // the mpass_ identity, verbatim
    expect(gate.budgetTier).toBe(EXTENDED_SCHEDULE.budgetTier);
    expect(gate.passCount).toBe(EXTENDED_SCHEDULE.totalRounds); // MEASURED by 088, never re-derived here
    expect(gate.converged).toBe(EXTENDED_SCHEDULE.converged); // carried, never re-derived
    expect(gate.releaseGateVersion).toBe(RELEASE_GATE_VERSION);

    // The human's verdict — not the module — decides the release over a
    // NEVER-CONVERGED schedule (law 1 cuts both ways: never fabricate
    // approval, never fabricate refusal either; the module never derives
    // a verdict from the facts — it carries the facts for the record).
    const sealed = await seal(gate, 'approved');
    expect(sealed.verdict).toBe('approved');

    const result = await releaseFromGate(sealed, RELEASED_AT_A);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const release = result.release;

      // The provenance chain VERBATIM: tcls_ classificationId + mpass_
      // scheduleId, exactly the fixture's own values.
      expect(release.classificationId).toBe(EXTENDED_SCHEDULE.classificationId);
      expect(release.scheduleId).toBe(EXTENDED_SCHEDULE.id);

      // The measured schedule facts VERBATIM — no re-derivation: equality
      // against the FIXTURE SCHEDULE, not against anything this lane
      // computed. The honest fact rides along: never converged, released
      // anyway — the verdict was the human's.
      expect(release.passCount).toBe(EXTENDED_SCHEDULE.totalRounds);
      expect(release.converged).toBe(EXTENDED_SCHEDULE.converged);
      expect(release.converged).toBe(false);
      expect(release.budgetTier).toBe(EXTENDED_SCHEDULE.budgetTier);

      // The release traces to the sealed gate and the caller's clock.
      expect(release.verdict).toBe('approved');
      expect(release.gateId).toBe(sealed.id);
      expect(release.releasedAt).toBe(RELEASED_AT_A);
      expect(release.releaseGateVersion).toBe(RELEASE_GATE_VERSION);
    }
  });

  test('rgate_ id determinism — the clock never moves the id; the verdict and the tier do', async () => {
    // Same gate content, different gatedAt → the SAME id (the
    // determinism law: gatedAt is excluded from the minting body).
    const first = await open(MINIMAL_SCHEDULE, GATED_AT_A);
    const later = await open(MINIMAL_SCHEDULE, GATED_AT_B);
    expect(later.id).toBe(first.id);
    expect(later.gatedAt).toBe(GATED_AT_B);
    expect({ ...later, gatedAt: first.gatedAt }).toEqual(first);

    // The id shape: 'rgate_' + 64 lowercase hex chars.
    expect(first.id.startsWith('rgate_')).toBe(true);
    expect(first.id.length).toBe(6 + 64);
    expect(/rgate_[0-9a-f]{64}/.test(first.id)).toBe(true);

    // A different budgetTier → a different id (isolated: the override
    // changes ONLY the tier — the rest of the body is the minimal
    // fixture's own data, and the swapped tier is well-formed
    // schedule-shaped DATA the gate duck-validates against the frozen
    // vocabulary).
    const tierSwapped = await open(malformedSchedule({ budgetTier: 'extended' }), GATED_AT_A);
    expect(tierSwapped.budgetTier).toBe('extended');
    expect(tierSwapped.id).not.toBe(first.id); // the tier moved the identity

    // A different sealed verdict → a different id (the verdict is INSIDE
    // the minting body — a different verdict is a different gate
    // identity). Isolated: both seals start from the same gate content
    // (same pending id), differing only in the verdict.
    const approved = await seal(first, 'approved');
    const rejected = await seal(later, 'rejected');
    expect(approved.verdict).toBe('approved');
    expect(rejected.verdict).toBe('rejected');
    expect(approved.id).not.toBe(rejected.id);

    // And the sealed id differs from the pending id — sealing re-mints
    // with the verdict inside the body, so the identity moved.
    expect(approved.id).not.toBe(first.id);

    // Determinism of the seal: the same gate + the same verdict →
    // deep-equal sealed records with identical ids.
    const approvedAgain = await seal(first, 'approved');
    expect(approvedAgain).toEqual(approved);
    expect(approvedAgain.id).toBe(approved.id);
  });

  test('the provenance chain law — a non-mpass_ scheduleId never opens a gate', async () => {
    // A foreign-prefixed id (right shape, wrong prefix) is refused: the
    // chain must be traceable to the CLAPP-088 lane.
    const notMpass = await openReleaseGate(
      malformedSchedule({ id: 'sched_42a9f1155ac2267474323cbc5809d4404297d0108ef06374069c936ae096d4a2' }),
      GATED_AT_A,
    );
    expect(notMpass.ok).toBe(false);
    if (!notMpass.ok) {
      expect(notMpass.errors.some((error) => error.startsWith('schedule.id:'))).toBe(true);
      expect(notMpass.errors.some((error) => error.includes('mpass_'))).toBe(true);
      expect(notMpass.errors.some((error) => error.includes('traceable'))).toBe(true);
    }

    // Even a WELL-FORMED id from ANOTHER lane — the fixture's own tcls_
    // classification id sitting in the schedule slot — is refused: the
    // chain must be traceable to the 088 lane, not merely id-shaped.
    const wrongLane = await openReleaseGate(
      malformedSchedule({ id: MINIMAL_SCHEDULE.classificationId }),
      GATED_AT_A,
    );
    expect(wrongLane.ok).toBe(false);
    if (!wrongLane.ok) {
      expect(wrongLane.errors.some((error) => error.startsWith('schedule.id:'))).toBe(true);
    }

    // The honest fixture's mpass_ id opens, and the chain appears
    // VERBATIM in the gate record: tcls_ classificationId + mpass_
    // scheduleId — the 086→088 provenance, unbroken.
    const gate = await open(MINIMAL_SCHEDULE, GATED_AT_A);
    expect(gate.scheduleId).toBe(MINIMAL_SCHEDULE.id);
    expect(gate.scheduleId.startsWith('mpass_')).toBe(true);
    expect(gate.classificationId).toBe(MINIMAL_SCHEDULE.classificationId);
    expect(gate.classificationId.startsWith('tcls_')).toBe(true);
  });

  test('the package imports only frozen contracts — the no-fork law is pinned', () => {
    const packageRoot = dirname(import.meta.dir); // packages/factory (one level above test/)

    // ---- 1. the exact src file list (the delivered surface) ----
    // CLAPP-089 grew the surface to six files (release-gate is this
    // package's fifth and final component); the pin stays exact — the
    // living list, per the security imports.test.ts precedent.
    const srcFiles = listTsFiles(join(packageRoot, 'src')).sort();
    expect(srcFiles.map((file) => file.slice(packageRoot.length + 1))).toEqual([
      'src/exploration-budgets.ts',
      'src/index.ts',
      'src/multi-pass-repair.ts',
      'src/package-graph.ts',
      'src/release-gate.ts',
      'src/target-classification.ts',
    ]);

    const runtimeAllowed = new Set(['@clapp/core', '@clapp/observe']);
    const typeOnlyAllowed = new Set(['@clapp/learn']);
    const violations: string[] = [];

    // ---- 2. src/** — @clapp/core + @clapp/observe at RUNTIME;
    //         @clapp/learn TYPE-ONLY; no other packages; the repair
    //         lane NOT imported (the loop is SCHEDULED through the
    //         duck-typed runner seam, never imported, never
    //         re-implemented — naming the frozen surface in
    //         documentation is legal, an import clause of it never is);
    //         and THIS lane's own no-fork pin: release-gate.ts never
    //         imports the schedule's own module (./multi-pass-repair) —
    //         the CLAPP-088 schedule is frozen DATA on arrival,
    //         duck-validated field by field, never re-derived, never
    //         re-run, its module never reached for values or types ----
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
          // The no-fork law, THIS lane's own pin: the release gate never
          // imports the schedule's own module — the CLAPP-088
          // MultiPassSchedule is frozen DATA on arrival, its contract
          // version duck-validated against the pinned literal, its
          // mpass_ id carried verbatim; the schedule's module is never
          // reached, not even type-only.
          if (display === 'src/release-gate.ts' && specifier === './multi-pass-repair') {
            violations.push(
              `${display}: imports ${JSON.stringify(specifier)} — the no-fork law: the CLAPP-088 schedule is frozen DATA on arrival (duck-validated field by field, never re-derived, never re-run); the schedule's own module is never imported, not even type-only`,
            );
          }
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
