// CLAPP-055 — registry fixtures.
//
// NEW builder exports for the registry tests; the existing fixture exports
// (test/fixtures/golden.ts, compat-manifests.ts, replay-parity.ts,
// retrieval-manifests.ts) are untouched. Same conventions as every lane:
// hex-shaped placeholder digests, minted-shaped ids from SHORT
// lowercase-hex seeds so ids sort lexicographically in a stable, predictable
// order, and fixed caller-injected timestamps (fixtures never read the
// clock).
//
// The promotion fixtures are built the HONEST way (the packet's preferred
// option): each PackagePromotionRecord is minted by exercising the landed
// promoteCandidate over a REAL green replayCandidate record (the same
// green-replay discipline as the promotion lane's own tests) — never
// hand-assembled. The candidates carry the REAL extractionContext
// manifestSha256 (sha256Hex(canonicalJson(manifest)) — computed, never
// asserted) via the shared candidateRecord builder. The `overrides`
// arguments deliberately permit INVALID manifest values because the
// fail-closed registry tests inject them on purpose.

import { promoteCandidate } from '../../src/promotion';
import { replayCandidate } from '../../src/replay-benchmark';
import type { PackageManifest } from '../../src/package-contract';
import type { PackageCandidate } from '../../src/record';
import type { PackagePromotionRecord } from '../../src/promotion';
import {
  candidateRecord,
  recomputedParity,
  replayManifest,
  sequenceClock,
} from './replay-parity';

/** Fixed caller-injected registration timestamps (fixtures never read the clock). */
export const REGISTERED_AT_A = '2026-10-02T16:00:00Z';
export const REGISTERED_AT_B = '2026-10-02T17:00:00Z';
export const REGISTERED_AT_C = '2026-10-02T18:00:00Z';

/** The promotion fixture's caller-injected promotedAt (the gate's own discipline). */
export const PROMOTED_AT = '2026-10-02T14:00:00Z';

// ---- the candidate-shaped admission builder ---------------------------------------

/** Field overrides applied LAST over the default valid manifest. */
export type RegistryManifestOverrides = Partial<PackageManifest>;

export interface RegistryCandidateSpec {
  /** Short lowercase-hex seed — the id is `'pkg_' + seed.padEnd(64, '0')`. */
  idSeed: string;
  /** Defaults to '1.0.0'; a different version of one id is a legal sibling. */
  version?: string;
  /** Applied after the defaults; deliberately-invalid values are the fail-closed tests' job. */
  overrides?: RegistryManifestOverrides;
  /** Defaults to 'candidate' (the only stage the record contract mints). */
  stage?: PackageCandidate['stage'];
}

/**
 * A candidate-shaped admission built the honest way: a valid manifest (the
 * shared replay-parity builder) wrapped in the PackageCandidate record
 * shape with the REAL extractionContext.manifestSha256.
 */
export async function registryCandidate({
  idSeed,
  version,
  overrides = {},
  stage,
}: RegistryCandidateSpec): Promise<PackageCandidate> {
  const manifest = replayManifest({
    idSeed,
    overrides: version === undefined ? overrides : { ...overrides, version },
  });
  return candidateRecord({ manifest, stage });
}

// ---- the promotion-shaped admission builder ---------------------------------------

export interface RegistryPromotionSpec {
  /** Short lowercase-hex seed — the id is `'pkg_' + seed.padEnd(64, '0')`. */
  idSeed: string;
  /** Defaults to '1.0.0'; a different version of one id is a legal sibling. */
  version?: string;
  /** Applied after the defaults; deliberately-invalid values are the fail-closed tests' job. */
  overrides?: RegistryManifestOverrides;
}

/**
 * A promotion-shaped admission built the honest way: run the REAL
 * replayCandidate (green and chain-intact by construction — the recomputed
 * parity's report id equals the manifest's recorded provenance) over the
 * candidate, then the REAL promoteCandidate over that green evidence. The
 * returned PackagePromotionRecord is genuinely minted by the landed lanes.
 */
export async function registryPromotion({
  idSeed,
  version,
  overrides = {},
}: RegistryPromotionSpec): Promise<PackagePromotionRecord> {
  const manifest = replayManifest({
    idSeed,
    overrides: version === undefined ? overrides : { ...overrides, version },
  });
  const candidate = await candidateRecord({ manifest });
  const ports = {
    recomputeParity: async () =>
      recomputedParity({ reportId: manifest.provenance.diffReportId }),
    now: sequenceClock([1000, 1042]),
  };
  const replay = await replayCandidate(candidate, ports);
  if (!replay.ok) {
    throw new Error(`registry fixture: the green replay failed — ${replay.errors.join('; ')}`);
  }
  const promotion = await promoteCandidate(candidate, { replay: replay.record }, { promotedAt: PROMOTED_AT });
  if (!promotion.ok) {
    throw new Error(`registry fixture: the honest promotion failed — ${promotion.errors.join('; ')}`);
  }
  return promotion.promotion;
}
