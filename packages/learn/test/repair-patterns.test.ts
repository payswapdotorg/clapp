// CLAPP-061 — the repair-pattern miner tests (the W2 learning lane).
//
// Fixtures: test/fixtures/failure-fixtures.ts (the 060 conventions —
// diffFinding/failureEvent for REAL records admitted through a real
// createFailureMemory, plus the 061 failureRecord literals for precise
// control over the measured support and the deliberately malformed shapes).
// The eight named tests cover the packet's axes: input-order determinism
// (over REAL memory records — the 060→061 handoff), fail-closed validation
// with index+field errors, the singleton law, the anchored repair-pattern
// mint, the no-resolution candidate, the honest partial-resolution ratio,
// the signature grouping key (finding ids are anchors, not keys), and the
// content-addressed pattern identities over a legal empty input.

import { describe, expect, test } from 'bun:test';

import { createFailureMemory } from '../src/failure-memory';
import type { FailureMemory, FailureRecord } from '../src/failure-memory';
import { PATTERN_VERSION, mineRepairPatterns } from '../src/repair-patterns';
import type { RepairPattern } from '../src/repair-patterns';
import type { FailureEventInput } from './fixtures/failure-fixtures';
import {
  OBSERVED_AT_A,
  OBSERVED_AT_B,
  OBSERVED_AT_C,
  diffFinding,
  failureEvent,
  failureRecord,
  packageRef,
  repairFacts,
} from './fixtures/failure-fixtures';

/** The login-postcondition signature (the 3-event recurrence group). */
const LOGIN_SUMMARY = 'The candidate misses the login postcondition.';

/** The localStorage signature (the 2-event no-resolution group). */
const STORAGE_SUMMARY = 'A localStorage key diverges after login.';

/** Mine and be loud about it — a fixture failure must not pass silently. */
async function mine(events: unknown): Promise<RepairPattern[]> {
  const result = await mineRepairPatterns(events);
  if (!result.ok) {
    throw new Error(`mining failed: ${result.errors.join('; ')}`);
  }
  return result.patterns;
}

/** Record and be loud about it — the 060 admission helper, unchanged. */
async function admit(
  memory: FailureMemory,
  event: FailureEventInput,
  observedAt: string,
): Promise<FailureRecord> {
  const result = await memory.record(event, { observedAt });
  if (!result.ok) {
    throw new Error(`admission failed: ${result.errors.join('; ')}`);
  }
  return result.record;
}

/** Checked indexed access (the fixtures are built to known lengths). */
function entry<T>(items: T[], index: number): T {
  const value = items[index];
  if (value === undefined) {
    throw new Error(`expected an entry at index ${index}`);
  }
  return value;
}

/** The pattern covering a summary (the grouping key's human leg). */
function bySummary(patterns: RepairPattern[], summary: string): RepairPattern {
  const found = patterns.find((pattern) => pattern.signature.summary === summary);
  if (found === undefined) {
    throw new Error(`expected a pattern for summary ${JSON.stringify(summary)}`);
  }
  return found;
}

describe('the repair-pattern miner (CLAPP-061)', () => {
  test('mining is deterministic — identical events in any input order produce identical patterns', async () => {
    // REAL records — the 060→061 handoff: five events admitted through a
    // real failure memory, then mined from memory.list().
    const memory = createFailureMemory();
    await admit(
      memory,
      failureEvent({
        finding: diffFinding({
          id: 'diff_a1',
          dimension: 'semantic',
          severity: 'critical',
          summary: LOGIN_SUMMARY,
          expected: { status: 200 },
          actual: { status: 401 },
        }),
        packageRef: packageRef('a1'),
        target: 'bench/b01-static',
        context: 'paired replay of journey j01, step 2',
        generalized: true,
      }),
      OBSERVED_AT_A,
    );
    await admit(
      memory,
      failureEvent({
        finding: diffFinding({
          id: 'diff_a2',
          dimension: 'semantic',
          severity: 'critical',
          summary: LOGIN_SUMMARY,
          expected: { status: 200 },
          actual: { status: 403 },
        }),
        packageRef: packageRef('b2'),
        target: 'bench/b02-dashboard',
        context: 'paired replay of journey j02, step 1',
      }),
      OBSERVED_AT_B,
    );
    // The recurrence's third event: UNRESOLVED, carrying a partial fix id
    // that must never enter the resolved anchor union.
    await admit(
      memory,
      failureEvent({
        finding: diffFinding({
          id: 'diff_a3',
          dimension: 'semantic',
          severity: 'critical',
          summary: LOGIN_SUMMARY,
          expected: { status: 200 },
          actual: { status: 500 },
        }),
        repair: repairFacts({
          attempted: true,
          resolved: false,
          resolvedFindingIds: ['diff_a3_partial'],
          generalized: null,
        }),
        target: 'bench/b03-console',
        context: 'paired replay of journey j03, step 1',
      }),
      OBSERVED_AT_C,
    );
    await admit(
      memory,
      failureEvent({
        finding: diffFinding({
          id: 'diff_b1',
          dimension: 'state',
          severity: 'minor',
          summary: STORAGE_SUMMARY,
        }),
        repair: repairFacts({
          attempted: true,
          resolved: false,
          resolvedFindingIds: [],
          generalized: null,
        }),
        target: 'bench/b01-static',
        context: 'paired replay of journey j01, step 3',
      }),
      OBSERVED_AT_A,
    );
    await admit(
      memory,
      failureEvent({
        finding: diffFinding({
          id: 'diff_b2',
          dimension: 'state',
          severity: 'minor',
          summary: STORAGE_SUMMARY,
        }),
        repair: repairFacts({
          attempted: true,
          resolved: false,
          resolvedFindingIds: [],
          generalized: null,
        }),
        target: 'bench/b02-dashboard',
        context: 'paired replay of journey j02, step 3',
      }),
      OBSERVED_AT_B,
    );

    const events = memory.list(); // canonical (id) order — 5 records
    expect(events.length).toBe(5);
    const before = JSON.parse(JSON.stringify(events)) as FailureRecord[];

    // A non-identity permutation of the same event objects.
    const permuted = [
      entry(events, 4),
      entry(events, 1),
      entry(events, 3),
      entry(events, 0),
      entry(events, 2),
    ];

    const runOne = await mine(events);
    const runTwo = await mine(permuted);

    // Deep-equal patterns AND identical ids, in canonical signature order
    // (dimension, then severity, then summary: semantic before state).
    expect(runOne.length).toBe(2);
    expect(runTwo).toEqual(runOne);
    expect(runTwo.map((pattern) => pattern.id)).toEqual(runOne.map((pattern) => pattern.id));
    expect(runOne.map((pattern) => pattern.signature.dimension)).toEqual(['semantic', 'state']);

    // The measured verdicts over the real records: the login recurrence
    // (3 events, 2 resolved with anchors) mints a repair-pattern; the
    // storage recurrence (2 events, 0 resolved) stays a candidate.
    const login = bySummary(runOne, LOGIN_SUMMARY);
    expect(login.status).toBe('repair-pattern');
    expect(login.support).toEqual({ total: 3, resolved: 2, generalized: 1 });
    expect(login.anchors.resolvedFindingIds).toEqual(['diff_a1', 'diff_a2']);
    const storage = bySummary(runOne, STORAGE_SUMMARY);
    expect(storage.status).toBe('insufficient-evidence');
    expect(storage.anchors.resolvedFindingIds).toEqual([]);

    // The miner never mutates its inputs — the events are deep-equal to
    // their pre-mining snapshot after BOTH runs.
    expect(events).toEqual(before);
  });

  test('malformed event lists fail closed with named errors — never an exception', async () => {
    const valid = failureRecord({ idSeed: 'a1', findingId: 'diff_valid' });
    const fatalSeverity = failureRecord({ idSeed: 'a2', findingId: 'diff_fatal' });
    const rollover = failureRecord({ idSeed: 'a3', findingId: 'diff_rollover' });

    // A non-array input: named, never a throw.
    const nonArray = await mineRepairPatterns(null);
    expect(nonArray.ok).toBe(false);
    if (!nonArray.ok) {
      expect(
        nonArray.errors.some((error) => error.includes('events:') && error.includes('array')),
      ).toBe(true);
    }

    // An entry with a bad severity (outside the frozen vocabulary) — the
    // error names the index AND the field.
    const badSeverity = await mineRepairPatterns([
      valid,
      { ...fatalSeverity, signature: { ...fatalSeverity.signature, severity: 'fatal' } },
    ]);
    expect(badSeverity.ok).toBe(false);
    if (!badSeverity.ok) {
      expect(
        badSeverity.errors.some((error) => error.startsWith('events[1].signature.severity:')),
      ).toBe(true);
      // Fail closed: nothing is mined from partial data — the valid event
      // yields no pattern next to an invalid one.
      expect('patterns' in badSeverity).toBe(false);
    }

    // A non-RFC3339 observedAt — including the rollover date 2026-02-30,
    // which Date.parse silently accepts and the calendar-valid check
    // refuses.
    const badTime = await mineRepairPatterns([{ ...rollover, observedAt: '2026-02-30T00:00:00Z' }]);
    expect(badTime.ok).toBe(false);
    if (!badTime.ok) {
      expect(badTime.errors.some((error) => error.startsWith('events[0].observedAt:'))).toBe(true);
    }

    // A wrong failureVersion.
    const badVersion = await mineRepairPatterns([{ ...rollover, failureVersion: '9.9' }]);
    expect(badVersion.ok).toBe(false);
    if (!badVersion.ok) {
      expect(badVersion.errors.some((error) => error.startsWith('events[0].failureVersion:'))).toBe(
        true,
      );
    }

    // A non-'fail_' id (the prefix check only — the memory's own ids are
    // its business).
    const badId = await mineRepairPatterns([{ ...rollover, id: 'not-an-event-id' }]);
    expect(badId.ok).toBe(false);
    if (!badId.ok) {
      expect(badId.errors.some((error) => error.startsWith('events[0].id:'))).toBe(true);
    }

    // A non-object entry.
    const badEntry = await mineRepairPatterns([42]);
    expect(badEntry.ok).toBe(false);
    if (!badEntry.ok) {
      expect(badEntry.errors.some((error) => error.startsWith('events[0]:'))).toBe(true);
    }

    // EVERY error collected — never just the first: two bad entries, both
    // named.
    const twoBad = await mineRepairPatterns([
      { ...fatalSeverity, signature: { ...fatalSeverity.signature, severity: 'fatal' } },
      { ...rollover, observedAt: 'not-a-timestamp' },
    ]);
    expect(twoBad.ok).toBe(false);
    if (!twoBad.ok) {
      expect(
        twoBad.errors.some((error) => error.startsWith('events[0].signature.severity:')),
      ).toBe(true);
      expect(twoBad.errors.some((error) => error.startsWith('events[1].observedAt:'))).toBe(true);
    }

    // No call threw — every await above resolving is itself the
    // never-an-exception proof.
  });

  test('a single event never becomes a pattern — insufficient-evidence is minted honestly', async () => {
    // One event — WITH positive evidence and an anchor: recurrence is the
    // gate, not resolution, so even this mints no pattern.
    const solo = failureRecord({
      idSeed: 's1',
      findingId: 'diff_solo',
      repair: { resolved: true, resolvedFindingIds: ['diff_solo'], generalized: true },
    });

    const patterns = await mine([solo]);
    expect(patterns.length).toBe(1);
    const pattern = entry(patterns, 0);
    expect(pattern.patternVersion).toBe(PATTERN_VERSION);
    expect(pattern.status).toBe('insufficient-evidence');
    expect(pattern.support).toEqual({ total: 1, resolved: 1, generalized: 1 }); // measured
    // The anchors are the resolved union — status-independent, honest.
    expect(pattern.anchors.resolvedFindingIds).toEqual(['diff_solo']);
    expect(
      pattern.reasons.some((reason) => reason.includes('a single event never becomes a pattern')),
    ).toBe(true);
    expect(pattern.reasons.some((reason) => reason.includes('measured support: 1 event'))).toBe(
      true,
    );
  });

  test('recurrence with a resolved repair mints a repair-pattern with the anchor union', async () => {
    const summary = 'The mock API returns the wrong response shape.';
    const patterns = await mine([
      failureRecord({
        idSeed: 'a1',
        findingId: 'diff_x1',
        dimension: 'network',
        severity: 'major',
        summary,
        repair: { resolved: true, resolvedFindingIds: ['diff_x1', 'diff_shared'], generalized: true },
      }),
      failureRecord({
        idSeed: 'a2',
        findingId: 'diff_x2',
        dimension: 'network',
        severity: 'major',
        summary,
        repair: { resolved: true, resolvedFindingIds: ['diff_shared', 'diff_x3'], generalized: false },
      }),
      failureRecord({
        idSeed: 'a3',
        findingId: 'diff_x4',
        dimension: 'network',
        severity: 'major',
        summary,
        repair: { attempted: true, resolved: false, resolvedFindingIds: [], generalized: null },
      }),
    ]);

    expect(patterns.length).toBe(1);
    const pattern = entry(patterns, 0);
    expect(pattern.status).toBe('repair-pattern');
    // The measured support — total/resolved/generalized counted from the
    // three events given.
    expect(pattern.support).toEqual({ total: 3, resolved: 2, generalized: 1 });
    // The anchor union: sorted, deduped, over the RESOLVED events only —
    // overlapping (diff_shared) + distinct ids, exactly (lexicographic
    // order: 's' sorts before 'x').
    expect(pattern.anchors.resolvedFindingIds).toEqual(['diff_shared', 'diff_x1', 'diff_x3']);
    // The honest split is named in the reasons.
    expect(pattern.reasons.some((reason) => reason.includes('2 of 3'))).toBe(true);
    expect(pattern.reasons.some((reason) => reason.includes('3 resolvedFindingIds'))).toBe(true);
  });

  test('recurrence with no resolution anywhere is insufficient-evidence with empty anchors', async () => {
    const summary = 'A cosmetic layout divergence.';
    const unresolved = {
      attempted: true,
      resolved: false,
      resolvedFindingIds: [],
      generalized: null,
    };
    const patterns = await mine([
      failureRecord({
        idSeed: 'a1',
        findingId: 'diff_y1',
        dimension: 'visual',
        severity: 'minor',
        summary,
        repair: unresolved,
      }),
      failureRecord({
        idSeed: 'a2',
        findingId: 'diff_y2',
        dimension: 'visual',
        severity: 'minor',
        summary,
        repair: unresolved,
      }),
    ]);

    expect(patterns.length).toBe(1);
    const pattern = entry(patterns, 0);
    expect(pattern.status).toBe('insufficient-evidence');
    expect(pattern.support).toEqual({ total: 2, resolved: 0, generalized: 0 }); // measured
    expect(pattern.anchors.resolvedFindingIds).toEqual([]); // honest — nothing to anchor on
    expect(pattern.reasons.some((reason) => reason.includes('no event ever resolved'))).toBe(true);
    expect(
      pattern.reasons.some((reason) => reason.includes('no resolved repair to anchor a guard on')),
    ).toBe(true);
  });

  test('partial resolution is unresolved-dominant with the honest ratio named', async () => {
    const summary = 'The session cookie diverges after login.';
    const resolvedNoIds = { resolved: true, resolvedFindingIds: [], generalized: null };
    const unresolved = { attempted: true, resolved: false, resolvedFindingIds: [], generalized: null };
    const patterns = await mine([
      failureRecord({
        idSeed: 'a1',
        findingId: 'diff_z1',
        dimension: 'state',
        severity: 'critical',
        summary,
        repair: { ...resolvedNoIds, generalized: true },
      }),
      failureRecord({
        idSeed: 'a2',
        findingId: 'diff_z2',
        dimension: 'state',
        severity: 'critical',
        summary,
        repair: resolvedNoIds,
      }),
      failureRecord({
        idSeed: 'a3',
        findingId: 'diff_z3',
        dimension: 'state',
        severity: 'critical',
        summary,
        repair: resolvedNoIds,
      }),
      failureRecord({
        idSeed: 'a4',
        findingId: 'diff_z4',
        dimension: 'state',
        severity: 'critical',
        summary,
        repair: unresolved,
      }),
      failureRecord({
        idSeed: 'a5',
        findingId: 'diff_z5',
        dimension: 'state',
        severity: 'critical',
        summary,
        repair: unresolved,
      }),
    ]);

    expect(patterns.length).toBe(1);
    const pattern = entry(patterns, 0);
    expect(pattern.status).toBe('unresolved-dominant');
    expect(pattern.support).toEqual({ total: 5, resolved: 3, generalized: 1 }); // measured
    expect(pattern.anchors.resolvedFindingIds).toEqual([]); // nothing reusable recorded
    // The measured ratio appears verbatim in a reason.
    expect(pattern.reasons.some((reason) => reason.includes('3 of 5'))).toBe(true);
    expect(pattern.reasons.some((reason) => reason.includes('the repair sometimes works'))).toBe(
      true,
    );
  });

  test('the grouping key is the signature — finding ids are anchors, not keys', async () => {
    const summary = 'The heading text diverges from the observed original.';
    const patterns = await mine([
      failureRecord({
        idSeed: 'a1',
        findingId: 'diff_g1',
        dimension: 'semantic',
        severity: 'info',
        summary,
        repair: { resolved: true, resolvedFindingIds: ['diff_g1', 'diff_gu'], generalized: null },
      }),
      failureRecord({
        idSeed: 'a2',
        findingId: 'diff_g2',
        dimension: 'semantic',
        severity: 'info',
        summary,
        repair: { resolved: true, resolvedFindingIds: ['diff_g2'], generalized: null },
      }),
      // The third recurrence: UNRESOLVED, but carrying a partial fix id —
      // an anchor-shaped value that must NOT enter the resolved union.
      failureRecord({
        idSeed: 'a3',
        findingId: 'diff_g3',
        dimension: 'semantic',
        severity: 'info',
        summary,
        repair: { attempted: true, resolved: false, resolvedFindingIds: ['diff_g3'], generalized: null },
      }),
    ]);

    // ONE group of 3: the three DISTINCT finding ids share a signature —
    // the findingId is the per-event anchor, never a grouping key.
    expect(patterns.length).toBe(1);
    const pattern = entry(patterns, 0);
    expect(pattern.support).toEqual({ total: 3, resolved: 2, generalized: 0 }); // measured
    // The anchors union carries all the RESOLVED ids — and not diff_g3
    // (the unresolved event's partial fix is excluded).
    expect(pattern.anchors.resolvedFindingIds).toEqual(['diff_g1', 'diff_g2', 'diff_gu']);
    expect(pattern.anchors.resolvedFindingIds).not.toContain('diff_g3');
    expect(pattern.status).toBe('repair-pattern'); // anchors exist → the mint
  });

  test('pattern ids are content-addressed and the empty input is legal', async () => {
    // Empty input is legal: zero groups, zero patterns — counted honestly.
    const empty = await mineRepairPatterns([]);
    expect(empty).toEqual({ ok: true, patterns: [] });

    // Two unrelated groups, each with a resolved recurrence.
    const summaryP = 'The form submits without required fields.';
    const summaryQ = 'A cosmetic icon divergence.';
    const events = [
      failureRecord({
        idSeed: 'p1',
        findingId: 'diff_p1',
        dimension: 'semantic',
        severity: 'major',
        summary: summaryP,
        repair: { resolved: true, resolvedFindingIds: ['diff_p1'], generalized: true },
      }),
      failureRecord({
        idSeed: 'p2',
        findingId: 'diff_p2',
        dimension: 'semantic',
        severity: 'major',
        summary: summaryP,
        repair: { resolved: true, resolvedFindingIds: ['diff_p2'], generalized: null },
      }),
      failureRecord({
        idSeed: 'q1',
        findingId: 'diff_q1',
        dimension: 'visual',
        severity: 'info',
        summary: summaryQ,
        repair: { resolved: true, resolvedFindingIds: ['diff_q1'], generalized: null },
      }),
      failureRecord({
        idSeed: 'q2',
        findingId: 'diff_q2',
        dimension: 'visual',
        severity: 'info',
        summary: summaryQ,
        repair: { resolved: true, resolvedFindingIds: ['diff_q2'], generalized: null },
      }),
    ];

    const first = await mine(events);
    expect(first.map((pattern) => pattern.signature.summary)).toEqual([summaryP, summaryQ]);

    // The content-addressed id shape: 'rpat_' + 64 lowercase hex chars.
    for (const pattern of first) {
      expect(pattern.id).toMatch(/^rpat_[0-9a-f]{64}$/);
    }
    const firstP = bySummary(first, summaryP);
    const firstQ = bySummary(first, summaryQ);
    expect(firstP.support).toEqual({ total: 2, resolved: 2, generalized: 1 });

    // Change ONE event's repair outcome (a deep copy — the originals stay
    // untouched): the affected pattern's id MOVES...
    const mutated = JSON.parse(JSON.stringify(events)) as FailureRecord[];
    const flipped = entry(mutated, 0);
    flipped.repair.resolved = false;
    const second = await mine(mutated);
    const secondP = bySummary(second, summaryP);
    expect(secondP.id).not.toBe(firstP.id); // support.resolved 2 → 1 moved the digest
    expect(secondP.support).toEqual({ total: 2, resolved: 1, generalized: 1 });
    expect(secondP.anchors.resolvedFindingIds).toEqual(['diff_p2']); // the flipped event's id left the union

    // ...while the unrelated group's id stays byte-stable.
    const secondQ = bySummary(second, summaryQ);
    expect(secondQ.id).toBe(firstQ.id);
    expect(secondQ).toEqual(firstQ);
  });
});
