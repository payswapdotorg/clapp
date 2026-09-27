// ============ SHARED CONTRACT: diff-contract.ts ============
// CLAPP Differential Verification contract v0.1 — declared by the tech
// lead. Canonical owner: @clapp/diff (CLAPP-040). Mirrors (byte-identical,
// re-export carriers) live in @clapp/diffext (CLAPP-041) and @clapp/repair
// (CLAPP-042); the tech lead byte-checks every mirror at integration.
// Frozen at P3 close (2026-09-25). Bump to v0.2 ONLY via a new TL
// declaration wave; mirrors follow the canonical byte-identity rule.
//
// Purpose: one journey, replayed against BOTH the observed original
// (left: the authorized target site) and the synthesized candidate
// (right: the CLAPP-031 generated app + mock backend). Each side is
// captured with the SAME machinery (@clapp/journey appliers —
// createDomApplier / createPlaywrightApplier — plus the @clapp/observe
// capture vocabulary where available); the captures are diffed per
// dimension; findings roll up into a DiffReport; the repair loop
// consumes findings to iterate the candidate.
//
// Design principles (inherited, binding):
//   1. Symmetric capture: both sides run the SAME journey through the
//      SAME runner; asymmetry is itself a finding, never an assumption.
//   2. Everything cites evidence: every finding refs the left/right
//      evidence entries that prove it. No free-floating judgments.
//   3. Severity is honest: 'critical' only when a seeded journey's
//      postcondition or the IR-predicted state is contradicted.
//   4. Unknown is a valid value: optional fields stay ABSENT, never null.
//   5. Serializable, diffable, versioned; self-contained beyond
//      @clapp/core EvidenceRef (IR/plan constructs referenced by id
//      string only — same discipline as the synthesis contract).

import type { EvidenceRef } from '@clapp/core';

// ---- identity + version ----------------------------------------------------

export const DIFF_VERSION = '0.1';

/** "diffr_" + uuid v4 — a paired-run report's identity. */
export type DiffReportId = string;

// ---- paired run -------------------------------------------------------------

/** One side of a paired replay. */
export type DiffSide = 'left' | 'right';

export interface PairedTarget {
  side: DiffSide;
  /** Left: the authorized original site's base URL. Right: the candidate app's local server URL. */
  baseUrl: string;
  /** Left: the observation target id the evidence corpus used. Right: the candidate app id ("appsyn_..."). */
  targetId: string;
  /** How this side was driven: the same journey vocabulary either way. */
  driver: 'replayer-dom' | 'replayer-playwright';
}

/** The outcome of one journey replayed on one side. */
export interface SideRunResult {
  side: DiffSide;
  journeyId: string;
  /** Replay completed through the final step. */
  completed: boolean;
  /** Steps completed before failure (full count == completed). */
  stepsCompleted: number;
  /** First failure description (absent when completed). */
  failure?: string;
  /** Evidence bundle ref for this side's capture (rootHash-verifiable). */
  evidenceRef: EvidenceRef;
  /** Per-step capture page ids, aligned by step index (absent entries = step not captured). */
  stepPageIds: (string | undefined)[];
  /** Per-step network capture ids, aligned by step index. */
  stepNetworkIds: (string | undefined)[];
  /** Post-run storage inventory ids (ls/ss/cookies), per the observe vocabulary. */
  storageIds: string[];
}

/** One journey, both sides. The unit of differential verification. */
export interface PairedRun {
  journeyId: string;
  /** IR transition ids the journey exercises (semantic baseline anchor). */
  transitionIds: string[];
  left: PairedTarget;
  right: PairedTarget;
  runs: { left: SideRunResult; right: SideRunResult };
}

// ---- dimensions + findings ---------------------------------------------------

/** The diff dimensions. One package may own several; each finding names its dimension. */
export type DiffDimension =
  | 'semantic'    // post-step DOM/a11y structure vs IR-predicted state
  | 'visual'      // screenshot pairs, structural + pixel comparison
  | 'network'     // captured requests/responses vs the plan's api/mock spec
  | 'state';      // storage keys/values vs the plan's PlannedStorageBinding[]

export type DiffSeverity =
  | 'critical'    // contradicts a journey postcondition or IR-predicted state
  | 'major'       // dimension mismatch with behavioral consequence
  | 'minor'       // cosmetic or non-behavioral divergence
  | 'info';       // recorded divergence, no consequence established

/** Where a finding is anchored (either side's artifacts, or both). */
export interface DiffAnchor {
  stepIndex: number;
  leftEvidence?: EvidenceRef;
  rightEvidence?: EvidenceRef;
  /** IR ids (screen_/comp_/trans_) or plan ids (route_/page_/elem_...) this concerns. */
  sourceIds: string[];
}

/** One verified discrepancy between the sides (or a side and its baseline). */
export interface DiffFinding {
  id: string;            // "diff_" + uuid v4
  dimension: DiffDimension;
  severity: DiffSeverity;
  /** One honest sentence: what diverges. */
  summary: string;
  anchors: DiffAnchor[];
  /** Machine-checkable expectation vs actual (dimension-specific shape; absent when structural). */
  expected?: unknown;
  actual?: unknown;
}

// ---- report ------------------------------------------------------------------

export interface DiffReport {
  id: DiffReportId;
  diffVersion: string;
  /** The plan id of the candidate under verification ("appsyn_..." application id). */
  candidateAppId: string;
  /** The evidence corpus rootHash the left side derives from. */
  baselineRootHash: string;
  runs: PairedRun[];
  findings: DiffFinding[];
  /** Honest counts by severity (computed, never asserted). */
  counts: { critical: number; major: number; minor: number; info: number };
  /** The verdict: candidate behaviorally equivalent w.r.t. the replayed journeys. */
  verdict: 'equivalent' | 'divergent';
  generatedAt: string;
}

// ---- repair loop ---------------------------------------------------------------

/** A repair directive: the repair loop's work order for one finding cluster. */
export interface RepairDirective {
  id: string;            // "repd_" + uuid v4
  findingIds: string[];
  /** Candidate-side file paths the repair may touch (scoped). */
  scopePaths: string[];
  /** The invariant the repair must re-establish (checked by re-running the paired run). */
  acceptance: string;
}

/** One repair iteration's record. */
export interface RepairAttempt {
  directiveId: string;
  iteration: number;      // 1..maxIterations
  /** Candidate commit BEFORE the repair (the repair loop commits its own work). */
  baseSha: string;
  /** Paths actually changed. */
  changedPaths: string[];
  /** Re-run report verdict after the change. */
  rerunVerdict: 'equivalent' | 'divergent' | 'worse' | 'error';
  /** Findings resolved by this attempt (ids). */
  resolvedFindingIds: string[];
}

export interface RepairLoopResult {
  maxIterations: number;
  attempts: RepairAttempt[];
  remainingCriticalFindings: string[];
  converged: boolean;     // true iff remainingCriticalFindings is empty
}

// ---- runner surface (the CLAPP-040 spine) -------------------------------------

/** The paired runner's public surface (implementation contract). */
export interface PairedRunner {
  runPair(journeyId: string): Promise<PairedRun>;
  diff(run: PairedRun): Promise<DiffFinding[]>;
  report(runs: PairedRun[]): Promise<DiffReport>;
}
