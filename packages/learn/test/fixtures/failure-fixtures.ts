// CLAPP-060 — failure-memory fixtures.
//
// Minimal DiffFinding-shaped literals over the FROZEN diff-contract v0.1
// vocabulary (@clapp/diff — TYPE-ONLY import; the memory consumes
// contract-shaped DATA, never the implementations' behavior), plus the
// honest repair-facts derivation from a RepairLoopResult-shaped literal
// (@clapp/repair — TYPE-ONLY import) exactly as a real caller would reduce
// the repair loop's outcome: attempted = at least one attempt, resolved =
// converged, resolvedFindingIds = the attempts' resolved ids (the memory
// sorts + dedupes them into the record), generalized caller-judged (null
// when unknown).
//
// Conventions (the registry-fixture discipline, CLAPP-055): minted-shaped
// package ids from SHORT lowercase-hex seeds (stable lexicographic order),
// fixed caller-injected timestamps (fixtures never read the clock), and
// deliberately-overridable builders so the fail-closed tests can inject
// contract-violating DATA on purpose.

import type { DiffAnchor, DiffDimension, DiffFinding, DiffSeverity } from '@clapp/diff';
import type { RepairLoopResult } from '@clapp/repair';

/** Fixed caller-injected observation timestamps (fixtures never read the clock). */
export const OBSERVED_AT_A = '2026-10-02T19:00:00Z';
export const OBSERVED_AT_B = '2026-10-02T20:00:00Z';
export const OBSERVED_AT_C = '2026-10-02T21:00:00Z';

/** A minted-shaped package id from a short lowercase-hex seed. */
export function packageId(idSeed: string): string {
  return `pkg_${idSeed.padEnd(64, '0')}`;
}

/** The failing package, when known — { id, version } verbatim. */
export function packageRef(idSeed: string, version = '1.0.0'): { id: string; version: string } {
  return { id: packageId(idSeed), version };
}

// ---- the finding builder --------------------------------------------------------

export interface FindingSpec {
  id: string;
  dimension?: DiffDimension;
  severity?: DiffSeverity;
  summary?: string;
  /** Carried verbatim when the KEY IS PRESENT on the spec (structural findings omit it). */
  expected?: unknown;
  actual?: unknown;
}

/** A minimal, type-complete DiffFinding over the frozen vocabulary. */
export function diffFinding(spec: FindingSpec): DiffFinding {
  const anchors: DiffAnchor[] = [{ stepIndex: 0, sourceIds: [] }];
  const finding: DiffFinding = {
    id: spec.id,
    dimension: spec.dimension ?? 'semantic',
    severity: spec.severity ?? 'major',
    summary: spec.summary ?? 'The candidate diverges from the observed original.',
    anchors,
  };
  if ('expected' in spec) {
    finding.expected = spec.expected;
  }
  if ('actual' in spec) {
    finding.actual = spec.actual;
  }
  return finding;
}

// ---- the repair outcome facts -----------------------------------------------------

/** The repair outcome facts the memory records (the §7 field list). */
export interface RepairFacts {
  attempted: boolean;
  resolved: boolean;
  resolvedFindingIds: string[];
  generalized: boolean | null;
}

/** Direct repair-facts builder (deliberately permissive for the fail-closed tests). */
export function repairFacts(spec: Partial<RepairFacts> = {}): RepairFacts {
  return {
    attempted: spec.attempted ?? true,
    resolved: spec.resolved ?? true,
    resolvedFindingIds: spec.resolvedFindingIds ?? [],
    generalized: spec.generalized ?? null,
  };
}

// ---- the honest RepairLoopResult derivation ----------------------------------------

export interface LoopSpec {
  /** Finding ids the loop's attempts resolved. */
  resolvedIds?: string[];
  /** The final re-run verdict; only 'equivalent' converges the loop. */
  verdict?: 'equivalent' | 'divergent' | 'worse' | 'error';
}

/** A minimal RepairLoopResult-shaped literal (the frozen repair contract). */
export function loopResult({ resolvedIds = [], verdict = 'equivalent' }: LoopSpec = {}): RepairLoopResult {
  const attempts =
    resolvedIds.length === 0
      ? []
      : [
          {
            directiveId: 'repd_fixture000000000000000000000000000',
            iteration: 1,
            baseSha: '0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0',
            changedPaths: ['src/app/page.tsx'],
            rerunVerdict: verdict,
            resolvedFindingIds: resolvedIds,
          },
        ];
  const remainingCriticalFindings = verdict === 'equivalent' ? [] : ['diff_unresolved'];
  return {
    maxIterations: 5,
    attempts,
    remainingCriticalFindings,
    converged: remainingCriticalFindings.length === 0, // the frozen iff
  };
}

/** The honest caller derivation: repair facts reduced from a RepairLoopResult. */
export function repairFactsFromLoop(
  loop: RepairLoopResult,
  generalized: boolean | null = null,
): RepairFacts {
  return {
    attempted: loop.attempts.length > 0,
    resolved: loop.converged,
    resolvedFindingIds: loop.attempts.flatMap((attempt) => attempt.resolvedFindingIds),
    generalized,
  };
}

// ---- the admission-input builder ----------------------------------------------------

/** The record() admission input: { finding, repair, packageRef?, target, context }. */
export interface FailureEventInput {
  finding: DiffFinding;
  repair: RepairFacts;
  packageRef: { id: string; version: string } | null;
  target: string;
  context: string;
}

export interface FailureEventSpec {
  finding: DiffFinding;
  /** Defaults to the honest loop-derived facts over the finding's own id. */
  repair?: RepairFacts;
  /** Defaults to null — the failure predates packaging. */
  packageRef?: { id: string; version: string } | null;
  target?: string;
  context?: string;
  /** The caller's generalization judgment (feeds the default repair facts). */
  generalized?: boolean | null;
}

export function failureEvent(spec: FailureEventSpec): FailureEventInput {
  return {
    finding: spec.finding,
    repair:
      spec.repair ??
      repairFactsFromLoop(loopResult({ resolvedIds: [spec.finding.id] }), spec.generalized ?? null),
    packageRef: spec.packageRef ?? null,
    target: spec.target ?? 'bench/b01-static',
    context: spec.context ?? 'paired replay of journey j01, step 0',
  };
}

// ---- the failure-record literals (CLAPP-061 — the repair-pattern mining fixtures) ----
//
// The miner consumes the memory's STORED shape (FailureRecord literals —
// typically `createFailureMemory().list()`), so the mining tests need
// record-shaped data. Two channels, both honest:
// - REAL records: admit failureEvent(...) inputs through a real
//   createFailureMemory() and mine `memory.list()` (the 060→061 handoff,
//   exercised in the determinism test);
// - LITERALS: the builders below — FailureRecord-shaped data over the
//   frozen vocabulary, for the tests that need precise control over the
//   measured support (splits, ratios, anchor unions) or deliberately
//   malformed fields.
//
// This section is APPENDED below the 060 exports (a pure addition — the
// existing exports above are byte-identical). The imports are hoisted
// top-level ES declarations and live with the section they serve; the
// runtime constant comes from the frozen store module in-package (the
// drift-proof pin: the literals carry exactly FAILURE_VERSION).

import { FAILURE_VERSION } from '../../src/failure-memory';
import type { FailureRecord } from '../../src/failure-memory';

/** A minted-shaped failure-event id from a short lowercase-hex seed. */
export function failureEventId(idSeed: string): string {
  return `fail_${idSeed.padEnd(64, '0')}`;
}

/** The FailureRecord-literal spec (deliberately permissive for the mining tests). */
export interface FailureRecordSpec {
  /** Short lowercase-hex seed for the minted-shaped 'fail_' event id. */
  idSeed: string;
  /** The finding's id — the per-event anchor (never a grouping key). */
  findingId: string;
  /** Defaults to 'semantic' (the frozen vocabulary). */
  dimension?: DiffDimension;
  /** Defaults to 'major' (the frozen vocabulary). */
  severity?: DiffSeverity;
  /** Defaults to the house divergence sentence. */
  summary?: string;
  /** The repair outcome facts; defaults to repairFacts() — resolved, no recorded ids. */
  repair?: Partial<RepairFacts>;
  /** Defaults to OBSERVED_AT_A (fixtures never read the clock). */
  observedAt?: string;
  /** Defaults to null — the failure predates packaging. */
  packageRef?: { id: string; version: string } | null;
  /** Defaults to the house target. */
  target?: string;
  /** Defaults to the house context. */
  context?: string;
  /** Overridable for the fail-closed tests; defaults to FAILURE_VERSION. */
  failureVersion?: string;
}

/** A FailureRecord-shaped literal — the memory's stored event shape, as fixture data. */
export function failureRecord(spec: FailureRecordSpec): FailureRecord {
  return {
    failureVersion: spec.failureVersion ?? FAILURE_VERSION,
    id: failureEventId(spec.idSeed),
    packageRef: spec.packageRef ?? null,
    target: spec.target ?? 'bench/b01-static',
    context: spec.context ?? 'paired replay of journey j01, step 0',
    signature: {
      dimension: spec.dimension ?? 'semantic',
      severity: spec.severity ?? 'major',
      findingId: spec.findingId,
      summary: spec.summary ?? 'The candidate diverges from the observed original.',
    },
    repair: repairFacts(spec.repair),
    observedAt: spec.observedAt ?? OBSERVED_AT_A,
  };
}

// ---- the archetype-classifier fixtures (CLAPP-062) ----------------------------------
//
// The classifier consumes manifest-SHAPED data — the @clapp/library
// PackageManifest's id/version/capabilities/interface fields (its LOCAL
// admission shape; the full manifest validation is the library's own
// business). The builders below produce deliberately-overridable
// manifest-shaped literals with varied capabilities/interface, so the
// table tests exercise every rule and the fail-closed tests inject
// contract-violating DATA on purpose.
//
// This section is APPENDED below the 060/061 exports (a pure addition —
// the existing exports above are byte-identical). @clapp/library is the
// TYPE-ONLY source for the manifest vocabulary (the 062 contract set —
// pinned, with diff/repair, by the import-discipline test inside
// test/failure-memory.test.ts).

import type { PackageManifest } from '@clapp/library';

/** Fixed caller-injected classification timestamps (fixtures never read the clock). */
export const CLASSIFIED_AT_A = '2026-10-02T22:00:00Z';
export const CLASSIFIED_AT_B = '2026-10-02T23:00:00Z';

/** The manifest fields the classifier consumes — the frozen manifest's own shapes. */
export type ManifestAdmission = Pick<
  PackageManifest,
  'id' | 'version' | 'capabilities' | 'interface'
>;

/** The manifest-shaped literal spec (deliberately permissive for the classifier tests). */
export interface ManifestSpec {
  /** Short lowercase-hex seed for the minted-shaped package id (packageId above). */
  idSeed?: string;
  /** Defaults to '1.0.0' — the manifest's immutable version. */
  version?: string;
  /** Defaults to [] — an interface-only manifest. */
  capabilities?: string[];
  /** Defaults to []. */
  interface?: string[];
}

/** A manifest-shaped literal — the classifier's admission data, as fixture data. */
export function manifestShape(spec: ManifestSpec = {}): ManifestAdmission {
  return {
    id: packageId(spec.idSeed ?? 'e5'),
    version: spec.version ?? '1.0.0',
    capabilities: spec.capabilities ?? [],
    interface: spec.interface ?? [],
  };
}
