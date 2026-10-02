// CLAPP-053 — the replay-benchmark tests: determinism under injected ports
// (identical inputs → identical records AND identical benchmark references),
// fail-closed validation (malformed candidates AND ports — never an
// exception, every error naming its field), the extraction-consistent gate
// (three killer recomputed parities, each reason naming the failed condition
// AND its observed value), the honest successful record (measured duration —
// the test recomputes the expected clock delta independently — and the
// benchmark REFERENCE in its exact format: a string, never a bare number),
// the provenance comparison (a moved evidence chain disclosed without
// flipping the outcome), the measured-clock discipline (a known sequence →
// the exact delta), the recomputed manifest digest with honest drift
// disclosure (both digests reported, no silent trust), and the loud-harness
// boundary (a throwing recomputeParity rejects with the thrown error itself
// — never a synthetic 'malformed' record).

import { describe, expect, test } from 'bun:test';
import { sha256Hex } from '@clapp/core';
import { canonicalJson } from '@clapp/observe';
import { REPLAY_VERSION, replayCandidate } from '../src/replay-benchmark';
import type { ReplayBenchmarkRecord, ReplayResult } from '../src/replay-benchmark';
import type { PackageManifest } from '../src/package-contract';
import {
  candidateRecord,
  hex64,
  recomputedParity,
  replayManifest,
  replayPorts,
  replayReportId,
  sequenceClock,
} from './fixtures/replay-parity';
import type { RecomputedParity } from './fixtures/replay-parity';

/** Fail loudly (with the honest errors) if a replay did not produce a record. */
function requireRecord(outcome: ReplayResult): ReplayBenchmarkRecord {
  if (!outcome.ok) {
    throw new Error(`expected a replay record, got fail-closed errors: ${outcome.errors.join('; ')}`);
  }
  return outcome.record;
}

/** The observed outcome of a call — a rejection (if any) is DATA, never a crash. */
type Observed =
  | { threw: false; value: ReplayResult }
  | { threw: true; error: unknown };

async function observeOutcome(candidate: unknown, ports: unknown): Promise<Observed> {
  return replayCandidate(candidate, ports).then(
    (value): Observed => ({ threw: false, value }),
    (error: unknown): Observed => ({ threw: true, error }),
  );
}

/**
 * The clean scenario: a valid candidate manifest + a gate-green recomputed
 * parity with MATCHING provenance ids (the recorded diffReportId equals the
 * recomputed report id, so the clean fixtures carry zero disclosure reasons).
 */
function cleanPair(idSeed: string): { manifest: PackageManifest; parity: RecomputedParity } {
  return {
    manifest: replayManifest({ idSeed }),
    parity: recomputedParity({ reportId: replayReportId(idSeed) }),
  };
}

describe('determinism', () => {
  test('replay is deterministic under injected ports — identical inputs produce identical records', async () => {
    const { manifest, parity } = cleanPair('a1');
    const candidate = await candidateRecord({ manifest });
    const candidateBefore = JSON.stringify(candidate);

    // FRESH identically-constructed ports per run (a sequence clock is
    // consumed by the run that reads it): fixed clock sequence + fixed
    // recomputed parity, run twice.
    const first = requireRecord(
      await replayCandidate(candidate, replayPorts(parity, sequenceClock([1000, 1042]))),
    );
    const second = requireRecord(
      await replayCandidate(candidate, replayPorts(parity, sequenceClock([1000, 1042]))),
    );

    expect(first.outcome).toBe('replayed');
    expect(second).toEqual(first);
    expect(second.benchmarkRef).toBe(first.benchmarkRef);

    // the module never mutates its inputs — the candidate is byte-identical
    expect(JSON.stringify(candidate)).toBe(candidateBefore);
  });
});

describe('fail-closed validation', () => {
  test('malformed candidates and ports fail closed with named errors — never an exception', async () => {
    const { manifest, parity } = cleanPair('9a');
    const validPorts = replayPorts(parity, sequenceClock([1, 2]));
    const validCandidate = await candidateRecord({ manifest });

    // (a) a non-object candidate
    const nonObject = await observeOutcome('not-a-candidate', validPorts);
    expect(nonObject.threw).toBe(false);
    if (nonObject.threw) throw new Error('expected a fail-closed result, not an exception');
    expect(nonObject.value.ok).toBe(false);
    if (nonObject.value.ok) throw new Error('expected fail-closed errors');
    expect(nonObject.value.errors).toHaveLength(1);
    expect(nonObject.value.errors[0]).toContain('candidate');

    // (b) a manifest that fails the FROZEN validator
    const invalidManifestCandidate = {
      manifest: replayManifest({ idSeed: '9b', overrides: { packageVersion: '9.9' } }),
      stage: 'candidate',
    };
    const invalidManifest = await observeOutcome(invalidManifestCandidate, validPorts);
    expect(invalidManifest.threw).toBe(false);
    if (invalidManifest.threw) throw new Error('expected a fail-closed result, not an exception');
    expect(invalidManifest.value.ok).toBe(false);
    if (invalidManifest.value.ok) throw new Error('expected fail-closed errors');
    expect(
      invalidManifest.value.errors.some(
        (error) => error.includes('manifest') && error.includes('packageVersion'),
      ),
    ).toBe(true);

    // (c) stage 'verified' — replay accepts candidate-stage records ONLY
    const verifiedStageCandidate = { ...validCandidate, stage: 'verified' };
    const wrongStage = await observeOutcome(verifiedStageCandidate, validPorts);
    expect(wrongStage.threw).toBe(false);
    if (wrongStage.threw) throw new Error('expected a fail-closed result, not an exception');
    expect(wrongStage.value.ok).toBe(false);
    if (wrongStage.value.ok) throw new Error('expected fail-closed errors');
    expect(wrongStage.value.errors).toHaveLength(1);
    expect(wrongStage.value.errors[0]).toContain('stage');
    expect(wrongStage.value.errors[0]).toContain('verified');

    // (d) ports missing `now`
    const portsMissingNow = { recomputeParity: validPorts.recomputeParity };
    const noClock = await observeOutcome(validCandidate, portsMissingNow);
    expect(noClock.threw).toBe(false);
    if (noClock.threw) throw new Error('expected a fail-closed result, not an exception');
    expect(noClock.value.ok).toBe(false);
    if (noClock.value.ok) throw new Error('expected fail-closed errors');
    expect(noClock.value.errors).toHaveLength(1);
    expect(noClock.value.errors[0]).toContain('ports.now');
  });
});

describe('the replay gate', () => {
  test('the replay gate demands the extraction conditions — equivalent verdict, zero critical, converged repair', async () => {
    const manifest = replayManifest({ idSeed: 'c3' });
    const candidate = await candidateRecord({ manifest });
    const matchedId = replayReportId('c3'); // clean provenance: the gate reason is the only one

    // killer 1: verdict 'divergent' (criticals 0, converged true)
    const divergent = requireRecord(
      await replayCandidate(
        candidate,
        replayPorts(recomputedParity({ reportId: matchedId, verdict: 'divergent' }), sequenceClock([100, 100])),
      ),
    );
    expect(divergent.outcome).toBe('diverged');
    expect(divergent.benchmarkRef).toBeNull();
    expect(divergent.gate.verdict).toBe('divergent');
    expect(divergent.reasons).toHaveLength(1);
    const divergentReason = divergent.reasons[0];
    if (divergentReason === undefined) throw new Error('expected the verdict refusal reason');
    expect(divergentReason).toContain('verdict');
    expect(divergentReason).toContain('divergent');

    // killer 2: counts.critical > 0 while the verdict stays 'equivalent' —
    // the count condition is checked INDEPENDENTLY, so a lying verdict
    // cannot sneak a critical-laden replay past the gate
    const criticals = requireRecord(
      await replayCandidate(
        candidate,
        replayPorts(recomputedParity({ reportId: matchedId, critical: 2 }), sequenceClock([100, 100])),
      ),
    );
    expect(criticals.outcome).toBe('diverged');
    expect(criticals.benchmarkRef).toBeNull();
    expect(criticals.gate.criticalCount).toBe(2);
    expect(criticals.reasons).toHaveLength(1);
    const criticalsReason = criticals.reasons[0];
    if (criticalsReason === undefined) throw new Error('expected the critical refusal reason');
    expect(criticalsReason).toContain('critical');
    expect(criticalsReason).toContain('2');

    // killer 3: converged false (verdict 'equivalent', criticals 0)
    const unconverged = requireRecord(
      await replayCandidate(
        candidate,
        replayPorts(recomputedParity({ reportId: matchedId, converged: false }), sequenceClock([100, 100])),
      ),
    );
    expect(unconverged.outcome).toBe('diverged');
    expect(unconverged.benchmarkRef).toBeNull();
    expect(unconverged.gate.repairConverged).toBe(false);
    expect(unconverged.reasons).toHaveLength(1);
    const unconvergedReason = unconverged.reasons[0];
    if (unconvergedReason === undefined) throw new Error('expected the converged refusal reason');
    expect(unconvergedReason).toContain('converged');
    expect(unconvergedReason).toContain('false');
  });
});

describe('the honest record', () => {
  test('a successful replay produces an honest record with measured duration and a benchmark REFERENCE — never a bare number', async () => {
    const { manifest, parity } = cleanPair('b7');
    const candidate = await candidateRecord({ manifest });
    const clockTimes = [1500, 1573] as const;
    // the test recomputes the expected delta INDEPENDENTLY from the sequence
    const expectedDurationMs = clockTimes[1] - clockTimes[0];

    const record = requireRecord(
      await replayCandidate(candidate, replayPorts(parity, sequenceClock([...clockTimes]))),
    );

    expect(record.outcome).toBe('replayed');
    expect(record.replayVersion).toBe(REPLAY_VERSION);
    expect(record.packageId).toBe(manifest.id);
    expect(record.measured.durationMs).toBe(expectedDurationMs);
    expect(record.measured.attempts).toBe(1);
    expect(record.gate).toEqual({ verdict: 'equivalent', criticalCount: 0, repairConverged: true });
    expect(record.provenanceCheck.matches).toBe(true);
    expect(record.reasons).toEqual([]);

    // the benchmark REFERENCE — the exact format string over the MEASURED facts
    const expectedRef = `replay:${REPLAY_VERSION}:${manifest.id}:${manifest.version}:ok:${expectedDurationMs}ms:attempts:1`;
    expect(record.benchmarkRef).toBe(expectedRef);
    // a REFERENCE, never a bare number: the field is a string
    expect(typeof record.benchmarkRef).toBe('string');
    // nothing is minted into the manifest here — lifting a reference into
    // manifest.benchmark is the promotion gate's (CLAPP-054) decision
    expect(manifest.benchmark).toBeNull();
  });
});

describe('provenance comparison', () => {
  test('provenance is compared, not trusted — a moved evidence chain is disclosed without flipping the outcome', async () => {
    // recorded provenance names a5e…; the recomputed parity report id is f00d…
    const manifest = replayManifest({ idSeed: 'd4', diffReportId: replayReportId('a5e') });
    const parity = recomputedParity({ reportId: replayReportId('f00d') });
    const candidate = await candidateRecord({ manifest });

    const record = requireRecord(
      await replayCandidate(candidate, replayPorts(parity, sequenceClock([7, 9]))),
    );

    // the gate is over the RECOMPUTED conditions (gate-green here) — the
    // moved chain is a disclosure, never an outcome flip
    expect(record.outcome).toBe('replayed');
    expect(record.provenanceCheck).toEqual({
      recordedDiffReportId: replayReportId('a5e'),
      recomputedDiffReportId: replayReportId('f00d'),
      matches: false,
    });
    const movedReason = record.reasons.find((reason) => reason.includes('the evidence chain moved'));
    expect(movedReason).toBeDefined();
    if (movedReason === undefined) throw new Error('expected the provenance-drift disclosure reason');
    expect(movedReason).toContain(replayReportId('a5e'));
    expect(movedReason).toContain(replayReportId('f00d'));
    // the reference is still minted — the outcome gate never consulted the recorded provenance
    expect(typeof record.benchmarkRef).toBe('string');
  });
});

describe('measured durations', () => {
  test('duration is measured from the injected clock — deltas, not assertions', async () => {
    const { manifest, parity } = cleanPair('88');
    const candidate = await candidateRecord({ manifest });

    const t0 = 1000;
    const t1 = 1042;
    // the expected value computed INDEPENDENTLY — the test's own arithmetic
    const expectedDurationMs = t1 - t0;

    const record = requireRecord(
      await replayCandidate(candidate, replayPorts(parity, sequenceClock([t0, t1]))),
    );

    expect(record.measured.durationMs).toBe(expectedDurationMs);
    expect(record.measured.durationMs).toBe(42);
    // the reference embeds the SAME measured delta — one measurement, consistently reported
    expect(record.benchmarkRef).toBe(
      `replay:${REPLAY_VERSION}:${manifest.id}:${manifest.version}:ok:${expectedDurationMs}ms:attempts:1`,
    );
  });
});

describe('the record digest', () => {
  test('the replay record recomputes the manifest digest and discloses drift honestly', async () => {
    const { manifest, parity } = cleanPair('e5');
    // a VALID 64-hex placeholder that is deliberately NOT the real digest —
    // the recorded extractionContext lies about the candidate as replayed
    const recordedSha = hex64('dead');
    const candidate = await candidateRecord({ manifest, manifestSha256: recordedSha });
    // the INDEPENDENT recomputation — the test's own sha256Hex(canonicalJson(…))
    const expectedDigest = await sha256Hex(canonicalJson(manifest));

    const record = requireRecord(
      await replayCandidate(candidate, replayPorts(parity, sequenceClock([10, 20]))),
    );

    // the record carries the RECOMPUTED digest (the candidate as replayed),
    // never the recorded one on trust
    expect(record.manifestSha256).toBe(expectedDigest);
    expect(record.manifestSha256).not.toBe(recordedSha);
    // drift is a disclosure, never a gate — the parity was gate-green
    expect(record.outcome).toBe('replayed');
    expect(record.reasons).toHaveLength(1);
    const driftReason = record.reasons[0];
    if (driftReason === undefined) throw new Error('expected the digest-drift disclosure reason');
    // BOTH digests are reported — recomputed and recorded
    expect(driftReason).toContain(expectedDigest);
    expect(driftReason).toContain(recordedSha);
  });
});

describe('the loud-harness boundary', () => {
  test('a throwing harness propagates loudly — the module never swallows a broken port', async () => {
    const { manifest } = cleanPair('f6');
    const candidate = await candidateRecord({ manifest });
    const harnessError = new Error('the harness exploded mid-recompute');
    const brokenPorts = {
      recomputeParity: async (): Promise<never> => {
        throw harnessError;
      },
      now: sequenceClock([1]),
    };

    const observed = await observeOutcome(candidate, brokenPorts);
    // the rejection propagates — the caller's failure, never swallowed
    expect(observed.threw).toBe(true);
    if (!observed.threw) throw new Error('expected the broken harness to reject loudly');
    // rejection IDENTITY: the thrown error itself, never a synthetic
    // 'malformed' record standing in for the harness failure
    expect(observed.error).toBe(harnessError);
  });
});
