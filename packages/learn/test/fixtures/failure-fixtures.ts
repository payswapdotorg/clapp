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
