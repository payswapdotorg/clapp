// CLAPP-054 — the promotion gate tests (the tech lead's lane).
//
// The evidence under test is built the HONEST way: the green
// ReplayBenchmarkRecords come from running the REAL replayCandidate
// (CLAPP-053) over the shared replay-parity fixtures — never hand-minted.
// The killer cases specialize exactly the promotion axes (stage, outcome,
// version, packageId, digest drift, provenance chain, timestamp injection).
// The overrides deliberately permit INVALID values because the fail-closed
// tests inject them on purpose.

import { describe, expect, test } from 'bun:test';

import { promoteCandidate, PROMOTED_BY, PROMOTION_VERSION } from '../src/promotion';
import { replayCandidate } from '../src/replay-benchmark';
import { candidateRecord, hex64, recomputedParity, replayManifest, replayReportId, sequenceClock } from './fixtures/replay-parity';
import type { PackageManifest } from '../src/package-contract';
import type { ReplayBenchmarkRecord } from '../src/replay-benchmark';

const PROMOTED_AT = '2026-10-02T14:00:00Z';

/** Build green replay evidence the honest way: run the real replay. */
async function greenReplay(manifest: PackageManifest, reportId?: string): Promise<ReplayBenchmarkRecord> {
  const ports = {
    recomputeParity: async () => recomputedParity({ reportId: reportId ?? manifest.provenance.diffReportId }),
    now: sequenceClock([1000, 1042]),
  };
  const result = await replayCandidate(await candidateRecord({ manifest }), ports);
  if (!result.ok) throw new Error(`fixture replay failed: ${result.errors.join('; ')}`);
  return result.record;
}

describe('the package promotion gate (CLAPP-054)', () => {
  test('promotion is deterministic — identical candidate and evidence produce identical promotion records', async () => {
    const manifest = replayManifest({ idSeed: 'a1' });
    const candidate = await candidateRecord({ manifest });
    const evidence = { replay: await greenReplay(manifest) };

    const first = await promoteCandidate(candidate, evidence, { promotedAt: PROMOTED_AT });
    const second = await promoteCandidate(candidate, evidence, { promotedAt: PROMOTED_AT });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.promotion).toEqual(first.promotion);
      expect(second.promotion.promotionContext.evidenceDigest).toBe(first.promotion.promotionContext.evidenceDigest);
    }
  });

  test('malformed candidates or evidence fail closed with named errors — never an exception', async () => {
    const manifest = replayManifest({ idSeed: 'b2', overrides: { capabilities: ['form', 'api-mock'] } }); // unsorted
    const candidate = await candidateRecord({ manifest });
    const evidence = { replay: await greenReplay(replayManifest({ idSeed: 'c3' })) };

    const cases: Array<[unknown, unknown, unknown]> = [
      ['not-an-object', evidence, { promotedAt: PROMOTED_AT }],
      [candidate, 'not-evidence', { promotedAt: PROMOTED_AT }],
      [candidate, evidence, 'not-options'],
      [candidate, { replay: 'not-a-record' }, { promotedAt: PROMOTED_AT }],
    ];
    for (const [c, e, o] of cases) {
      const result = await promoteCandidate(c, e, o);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.length).toBeGreaterThan(0);
    }

    const badManifest = await promoteCandidate(candidate, evidence, { promotedAt: PROMOTED_AT });
    expect(badManifest.ok).toBe(false);
    if (!badManifest.ok) {
      expect(badManifest.errors.some((error) => error.includes('capabilities'))).toBe(true);
    }
  });

  test('only candidate-stage records are promotable — anything else is refused with the observed stage', async () => {
    const manifest = replayManifest({ idSeed: 'd4' });
    const candidate = await candidateRecord({ manifest, stage: 'candidate' as never });
    const staged = { ...candidate, stage: 'replayed' } as typeof candidate;
    const evidence = { replay: await greenReplay(manifest) };

    const result = await promoteCandidate(staged, evidence, { promotedAt: PROMOTED_AT });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.includes('candidate.stage'))).toBe(true);
      expect(result.errors.some((error) => error.includes('replayed'))).toBe(true);
    }
  });

  test('promotion demands a green replay record — outcome, version, package id, and manifest digest must all match', async () => {
    const manifest = replayManifest({ idSeed: 'e5' });
    const candidate = await candidateRecord({ manifest });

    // outcome diverged
    const diverged: ReplayBenchmarkRecord = { ...(await greenReplay(manifest)), outcome: 'diverged' };
    const r1 = await promoteCandidate(candidate, { replay: diverged }, { promotedAt: PROMOTED_AT });
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.errors.some((e) => e.includes("outcome") && e.includes('diverged'))).toBe(true);

    // wrong replayVersion
    const wrongVersion: ReplayBenchmarkRecord = { ...(await greenReplay(manifest)), replayVersion: '0.2' };
    const r2 = await promoteCandidate(candidate, { replay: wrongVersion }, { promotedAt: PROMOTED_AT });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.errors.some((e) => e.includes('replayVersion'))).toBe(true);

    // packageId of another package
    const otherId: ReplayBenchmarkRecord = { ...(await greenReplay(manifest)), packageId: `pkg_${hex64('ff')}` };
    const r3 = await promoteCandidate(candidate, { replay: otherId }, { promotedAt: PROMOTED_AT });
    expect(r3.ok).toBe(false);
    if (!r3.ok) expect(r3.errors.some((e) => e.includes('packageId'))).toBe(true);

    // replayed digest of a different manifest
    const driftedDigest: ReplayBenchmarkRecord = { ...(await greenReplay(manifest)), manifestSha256: hex64('dead') };
    const r4 = await promoteCandidate(candidate, { replay: driftedDigest }, { promotedAt: PROMOTED_AT });
    expect(r4.ok).toBe(false);
    if (!r4.ok) expect(r4.errors.some((e) => e.includes('manifestSha256'))).toBe(true);
  });

  test('a moved evidence chain blocks promotion — provenance matches false is a refusal, not a disclosure', async () => {
    const manifest = replayManifest({ idSeed: 'f6' });
    const candidate = await candidateRecord({ manifest });
    // the replay recomputes a DIFFERENT report id than the manifest records:
    // the replay module discloses matches:false without flipping its outcome…
    const movedReplay = await greenReplay(manifest, replayReportId('moved'));
    expect(movedReplay.outcome).toBe('replayed');
    expect(movedReplay.provenanceCheck.matches).toBe(false);

    // …and the promotion gate weighs that disclosure and refuses.
    const result = await promoteCandidate(candidate, { replay: movedReplay }, { promotedAt: PROMOTED_AT });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('provenanceCheck.matches'))).toBe(true);
    }
  });

  test('manifest drift blocks promotion — the replayed digest must equal the recorded digest', async () => {
    const manifest = replayManifest({ idSeed: '17' });
    const evidence = { replay: await greenReplay(manifest) };
    // the candidate carries a valid-shaped but WRONG recorded digest
    const drifted = await candidateRecord({ manifest, manifestSha256: hex64('d41f') });

    const result = await promoteCandidate(drifted, evidence, { promotedAt: PROMOTED_AT });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('extractionContext.manifestSha256'))).toBe(true);
    }
  });

  test('the promoted record carries the manifest verbatim and mints a new stage document — nothing is rewritten', async () => {
    const manifest = replayManifest({ idSeed: 'a8' });
    const candidate = await candidateRecord({ manifest });
    const replay = await greenReplay(manifest);
    const evidence = { replay };

    const result = await promoteCandidate(candidate, evidence, { promotedAt: PROMOTED_AT });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const { promotion } = result;
      expect(promotion.manifest).toBe(manifest);             // VERBATIM — the same object, never a rewrite
      expect(promotion.stage).toBe('replayed');              // the new stage document
      expect(promotion.promotionVersion).toBe(PROMOTION_VERSION);
      expect(promotion.promotionContext.promotedBy).toBe(PROMOTED_BY);
      expect(promotion.promotionContext.benchmarkRef).toBe(replay.benchmarkRef); // carried verbatim
      // the manifest itself was NOT lifted: benchmark stays null, stage stays the record's own
      expect(promotion.manifest.benchmark).toBeNull();
      expect(candidate.stage).toBe('candidate');             // the input record is untouched
    }
  });

  test('promotedAt is caller-injected and validated — the gate never reads a clock', async () => {
    const manifest = replayManifest({ idSeed: 'b9' });
    const candidate = await candidateRecord({ manifest });
    const evidence = { replay: await greenReplay(manifest) };

    const bad = await promoteCandidate(candidate, evidence, { promotedAt: 'not-a-date' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.some((e) => e.includes('promotedAt'))).toBe(true);

    const first = await promoteCandidate(candidate, evidence, { promotedAt: '2026-10-02T14:00:00Z' });
    const second = await promoteCandidate(candidate, evidence, { promotedAt: '2026-10-02T15:30:00Z' });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.promotion.promotionContext.promotedAt).toBe('2026-10-02T14:00:00Z');
      expect(second.promotion.promotionContext.promotedAt).toBe('2026-10-02T15:30:00Z');
      // ONLY the timestamp differs — the digest is content-addressed evidence, clock-free
      expect(second.promotion.promotionContext.evidenceDigest).toBe(first.promotion.promotionContext.evidenceDigest);
    }
  });
});
