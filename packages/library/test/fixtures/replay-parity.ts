// CLAPP-053 — replay-benchmark fixtures.
//
// NEW builder exports for the replay-benchmark tests; the existing fixture
// exports (test/fixtures/golden.ts, compat-manifests.ts,
// retrieval-manifests.ts) are untouched. Same conventions as every lane:
// every sha256-shaped value is a hex placeholder (never a real
// content-address — replay consumes the manifest's PARITY FACTS and the
// recomputed parity pair, not its provenance truth), every id is
// minted-SHAPED with a SHORT lowercase-hex seed so the ids sort
// lexicographically in a stable, predictable order, and `generatedAt` is a
// fixed caller-injected constant (fixtures never read the clock — measured
// durations enter through the injected clock port ONLY).
//
// `replayManifest` builds a TYPE-COMPLETE, VALID PackageManifest v0.1 by
// default (it passes the frozen validator exactly as landed in CLAPP-050).
// `recomputedParity` builds the recomputeParity RETURN shape — a
// gate-green-by-default { report, repair } pair (verdict 'equivalent',
// critical 0, converged true) overridable on exactly the three gate axes
// plus the report id (the provenance-comparison source). `candidateRecord`
// wraps a manifest in the PackageCandidate input shape with an HONEST
// extractionContext.manifestSha256 by default (the real
// sha256Hex(canonicalJson(manifest)) — drift tests override it on purpose
// with a valid 64-hex placeholder). The `overrides` arguments deliberately
// permit INVALID values because the fail-closed tests inject them on
// purpose.

import { sha256Hex } from '@clapp/core';
import { canonicalJson } from '@clapp/observe';
import type { DiffReport } from '@clapp/diff';
import type { RepairLoopResult } from '@clapp/repair';
import type { PackageManifest } from '../../src/package-contract';
import { PACKAGE_VERSION } from '../../src/package-contract';
import type { PackageCandidate } from '../../src/record';
import { EXTRACTED_BY } from '../../src/record';

/** 64-char lowercase-hex placeholder (the golden fixture's convention). */
export function hex64(seed: string): string {
  return seed.padEnd(64, '0');
}

/** A diffr_-shaped parity-report id placeholder, unique per seed. */
export function replayReportId(seed: string): string {
  return `diffr_00000000-0000-4000-8000-${seed.padStart(12, '0')}`;
}

// ---- the manifest builder ---------------------------------------------------------

/** Field overrides applied LAST over the default valid manifest. */
export type ReplayManifestOverrides = Partial<PackageManifest>;

export interface ReplayManifestSpec {
  /** Short lowercase-hex seed — the id is `'pkg_' + seed.padEnd(64, '0')`. */
  idSeed: string;
  /** The recorded provenance diffReportId (defaults to the seed's report id). */
  diffReportId?: string;
  /** Applied after the defaults; deliberately-invalid values are the fail-closed tests' job. */
  overrides?: ReplayManifestOverrides;
}

/**
 * A type-complete, VALID PackageManifest v0.1 (unless overridden) with the
 * replay-relevant facts — provenance.diffReportId (the recorded half of the
 * provenance comparison) — left at honest, boring defaults the caller
 * specializes.
 */
export function replayManifest({ idSeed, diffReportId, overrides = {} }: ReplayManifestSpec): PackageManifest {
  const manifest: PackageManifest = {
    packageVersion: PACKAGE_VERSION,
    id: `pkg_${hex64(idSeed)}`,
    version: '1.0.0',
    category: 'application',
    purpose: `A replay-benchmark fixture package (seed ${idSeed}).`,
    interface: [],
    capabilities: [],
    constraints: [],
    dependencies: [],
    supportedTargets: ['web'],
    provenance: {
      // hex-shaped placeholders shared across fixtures (fixture convention —
      // provenance digests are compared, never re-verified, by the replay)
      planSha256: hex64('c0de'),
      appManifestSha256: hex64('face'),
      diffReportId: diffReportId ?? replayReportId(idSeed),
      repairConverged: true,
      candidateBaseSha: null,
    },
    evidence: [],
    tests: [],
    benchmark: null,
    examples: [],
    failureModes: [],
    generatedAt: '2026-10-02T12:00:00Z',
  };
  return { ...manifest, ...overrides };
}

// ---- the recomputed-parity builder -------------------------------------------------

/** The recomputeParity return shape (TYPE-ONLY contract imports, data only). */
export interface RecomputedParity {
  report: DiffReport;
  repair: RepairLoopResult;
}

/** The axes the replay tests override — the three gate facts + the report id. */
export interface RecomputedParitySpec {
  /** The recomputed DiffReport id — the provenance-comparison source. */
  reportId?: string;
  /** Defaults to 'equivalent' (gate-green). */
  verdict?: DiffReport['verdict'];
  /** Defaults to 0 (gate-green). */
  critical?: number;
  /** Defaults to true (gate-green). */
  converged?: boolean;
}

/**
 * A gate-green-by-default recomputed parity pair. The three gate axes are
 * independent on purpose (the extractor's killer-fixture discipline): a
 * 'divergent' verdict keeps criticals 0 and repair converged; a critical > 0
 * keeps the verdict 'equivalent' (a lying verdict must not be able to sneak
 * a critical-laden replay past the count check); converged false carries the
 * honest remainingCriticalFindings while the counts stay clean.
 */
export function recomputedParity({
  reportId,
  verdict = 'equivalent',
  critical = 0,
  converged = true,
}: RecomputedParitySpec = {}): RecomputedParity {
  return {
    report: {
      id: reportId ?? replayReportId('e0'),
      diffVersion: '0.1',
      candidateAppId: 'appsyn_00000000-0000-4000-8000-0000000000e0',
      baselineRootHash: hex64('ba5e'),
      runs: [],
      findings: [],
      counts: { critical, major: 0, minor: 0, info: 0 },
      verdict,
      generatedAt: '2026-10-02T12:00:00Z',
    },
    repair: {
      maxIterations: 3,
      attempts: [],
      remainingCriticalFindings: converged ? [] : ['diff_00000000-0000-4000-8000-00000000dead'],
      converged,
    },
  };
}

// ---- the candidate + ports builders ------------------------------------------------

export interface CandidateSpec {
  manifest: PackageManifest;
  /** Defaults to 'candidate' (the only stage replay accepts). */
  stage?: PackageCandidate['stage'];
  /**
   * Defaults to the HONEST record digest sha256Hex(canonicalJson(manifest))
   * — WITH the id, the record discipline. Drift tests override it with a
   * valid 64-hex placeholder on purpose.
   */
  manifestSha256?: string;
}

/**
 * The replay input: a PackageCandidate-shaped record. The default
 * extractionContext.manifestSha256 is the REAL digest of the manifest as
 * built (computed, never asserted) so the clean fixtures are drift-free.
 */
export async function candidateRecord({
  manifest,
  stage = 'candidate',
  manifestSha256,
}: CandidateSpec): Promise<PackageCandidate> {
  return {
    manifest,
    stage,
    extractionContext: {
      extractedBy: EXTRACTED_BY,
      manifestSha256: manifestSha256 ?? (await sha256Hex(canonicalJson(manifest))),
    },
  };
}

/**
 * A clock over a FIXED sequence — each call advances; past the end the last
 * value holds (a one-value sequence is a constant clock, duration 0). The
 * replay reads the clock exactly twice (t0 before the recompute, t1 after),
 * so a two-value sequence measures its own delta.
 */
export function sequenceClock(times: readonly number[]): () => number {
  let index = 0;
  return () => {
    const value = times[Math.min(index, times.length - 1)] ?? Number.NaN;
    index += 1;
    return value;
  };
}

/**
 * Fixed deterministic ports: a fixed recomputed parity + an injectable
 * clock. The recomputeParity port ignores its manifest argument by design
 * (the fixture's parity is FIXED — determinism is the thing under test), so
 * it is declared with zero parameters, which is assignable to the port
 * signature and reads exactly as "constant parity".
 */
export function replayPorts(parity: RecomputedParity, now: () => number) {
  return {
    recomputeParity: async (): Promise<RecomputedParity> => parity,
    now,
  };
}
