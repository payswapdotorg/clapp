// CLAPP-051 — compatibility-graph manifest fixtures.
//
// NEW builder exports for the compat-graph tests; the golden fixture's
// existing exports (test/fixtures/golden.ts) are untouched. Same fixture
// conventions as the golden lane: every sha256-shaped value is a hex
// placeholder (never a real content-address — the graph consumes the
// manifest's compatibility facts, not its provenance truth), every id is
// minted-SHAPED, and `generatedAt` is a fixed caller-injected constant
// (fixtures never read the clock).
//
// `compatManifest` builds a TYPE-COMPLETE, VALID PackageManifest v0.1 by
// default (it passes the frozen validator exactly as landed in CLAPP-050).
// The `overrides` argument deliberately permits INVALID values — a wrong
// `packageVersion`, unsorted `capabilities`, … — because the fail-closed
// tests inject them on purpose. Id seeds must be SHORT lowercase-hex strings
// ('a1' < 'b2' < 'c3' < 'd4') so the minted-shaped ids sort lexicographically
// in a stable, predictable order.

import type { PackageManifest } from '../../src/package-contract';
import { PACKAGE_VERSION } from '../../src/package-contract';

/** 64-char lowercase-hex placeholder (the golden fixture's convention). */
export function hex64(seed: string): string {
  return seed.padEnd(64, '0');
}

/** Field overrides applied LAST over the default valid manifest. */
export type CompatManifestOverrides = Partial<PackageManifest>;

export interface CompatManifestSpec {
  /** Short lowercase-hex seed — the id is `'pkg_' + seed.padEnd(64, '0')`. */
  idSeed: string;
  /**
   * Applied after the defaults; deliberately-invalid values (wrong
   * packageVersion, unsorted capabilities, …) are the fail-closed tests' job.
   */
  overrides?: CompatManifestOverrides;
}

/**
 * A type-complete, VALID PackageManifest v0.1 (unless overridden) with the
 * compatibility-relevant facts — capabilities, supportedTargets,
 * dependencies — left at honest, boring defaults the caller specializes.
 */
export function compatManifest({ idSeed, overrides = {} }: CompatManifestSpec): PackageManifest {
  const manifest: PackageManifest = {
    packageVersion: PACKAGE_VERSION,
    id: `pkg_${hex64(idSeed)}`,
    version: '1.0.0',
    category: 'application',
    purpose: `A compatibility-graph fixture package (seed ${idSeed}).`,
    interface: [],
    capabilities: [],
    constraints: [],
    dependencies: [],
    supportedTargets: ['web'],
    provenance: {
      // hex-shaped placeholders shared across fixtures (fixture convention —
      // provenance is not a compatibility fact, so the graph never reads it)
      planSha256: hex64('c0de'),
      appManifestSha256: hex64('face'),
      diffReportId: `diffr_00000000-0000-4000-8000-${idSeed.padStart(12, '0')}`,
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
