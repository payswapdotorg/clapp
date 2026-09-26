/**
 * @clapp/repair — runRepairLoop: the autonomous repair loop (CLAPP-042).
 *
 * Iterates within a bounded budget, per the frozen contract:
 *
 *   clusterFindings(report)  →  ordered directives (severity, then path,
 *                               then step, then id — deterministic)
 *   for each directive (until the budget or convergence):
 *     applyDirective(...)    →  one bounded edit + ONE git commit in the
 *                               candidate tree (scope-enforced)
 *     options.rerun(root)   →  the verification oracle's verdict for the
 *                               candidate's CURRENT state
 *     record the attempt    →  baseSha / changedPaths / verdict /
 *                               resolvedFindingIds
 *   stop when a re-run is 'equivalent' (converged, remainingCriticalFindings
 *   empty) or the budget (maxIterations, default 5) is exhausted.
 *
 * VERDICT FLOW: aborted attempts (verdict 'error' from applyDirective —
 * scope violation, no matching strategy, dirty tree, missing file) are
 * recorded as-is and the oracle is NOT consulted (nothing changed, so a
 * re-run would only restate the divergence). Applied attempts have their
 * provisional verdict overwritten with the oracle's.
 *
 * CONVERGENCE (frozen contract, literal): converged is TRUE IFF
 * remainingCriticalFindings is empty. remainingCriticalFindings is []
 * when a re-run verdict was 'equivalent' (everything verified resolved);
 * otherwise it lists the report's critical findings that no attempt
 * resolved. Honest corner, documented in the README: when every critical
 * finding is edit-resolved but the oracle never said 'equivalent' (e.g. a
 * major-only defect outlived the budget), the contract's iff still yields
 * converged=true with an empty remaining list — the attempts honestly
 * record the divergent verdicts, so a "fake convergence" is always
 * detectable from the result's own record.
 *
 * ONE REPORT PER RUN: the loop consumes the report it was given; the
 * oracle returns a verdict, not new findings. The production composition
 * (see README): the orchestrator re-runs the paired runner, rebuilds the
 * report, and re-invokes the loop — each invocation is one bounded
 * repair round.
 *
 * NON-DEGENERACY: the loop sees ONLY the report (contract-shaped data),
 * the candidate tree, and the oracle verdict. Never a SynthesisPlan.
 */

import type { DiffFinding, DiffReport, RepairAttempt, RepairLoopResult } from './diff-contract';
import { clusterFindings } from './directives';
import { applyDirective } from './apply';
import { newDirectiveId, type DirectiveIdFactory } from './ids';

/**
 * The re-run verdict vocabulary — the contract's RepairAttempt.rerunVerdict
 * factored out for the oracle callback. Declared here (NOT in the mirror,
 * which stays byte-identical to the canonical contract).
 */
export type RerunVerdict = 'equivalent' | 'divergent' | 'worse' | 'error';

/** Options for {@link runRepairLoop}. */
export interface RepairLoopOptions {
  /** The diff-contract v0.1-shaped report to repair from. */
  report: DiffReport;
  /**
   * Absolute path to the candidate tree's root — a git repository whose
   * history the loop extends with its own repair commits.
   */
  candidateRoot: string;
  /**
   * The verification oracle: re-runs the paired verification against the
   * candidate at its CURRENT (post-edit) state. In tests this replays
   * the seeded journeys against a freshly spawned candidate server and
   * re-synthesizes findings; in production it is @clapp/diff's (CLAPP-040)
   * report verdict.
   */
  rerun: (candidateRoot: string) => Promise<RerunVerdict>;
  /** Iteration budget. Default 5. */
  maxIterations?: number;
  /**
   * Directive id factory (determinism hook — see README). Default mints
   * "repd_" + uuid v4. Passed through to clusterFindings.
   */
  idFactory?: DirectiveIdFactory;
}

/**
 * Runs the bounded autonomous repair loop over one DiffReport. See the
 * module doc for the iteration model and the honest verdict/convergence
 * semantics.
 */
export async function runRepairLoop(options: RepairLoopOptions): Promise<RepairLoopResult> {
  const maxIterations = options.maxIterations ?? 5;
  const directives = clusterFindings(options.report, { idFactory: options.idFactory ?? newDirectiveId });

  const attempts: RepairAttempt[] = [];
  const resolvedIds = new Set<string>();
  let reachedEquivalence = false;

  for (const directive of directives) {
    if (attempts.length >= maxIterations) {
      break; // budget exhausted
    }
    const iteration = attempts.length + 1;
    const attempt = await applyDirective(directive, options.candidateRoot, options.report.findings, {
      iteration,
    });
    if (attempt.rerunVerdict === 'error') {
      // Aborted attempt (scope violation / no strategy / dirty tree):
      // honestly recorded; the oracle is not consulted (nothing changed).
      attempts.push(attempt);
      continue;
    }
    // Applied attempt: the oracle decides the real verdict.
    attempt.rerunVerdict = await options.rerun(options.candidateRoot);
    attempts.push(attempt);
    for (const id of attempt.resolvedFindingIds) {
      resolvedIds.add(id);
    }
    if (attempt.rerunVerdict === 'equivalent') {
      reachedEquivalence = true;
      break; // converged — verified by the oracle
    }
  }

  const criticalIds = options.report.findings
    .filter((finding: DiffFinding) => finding.severity === 'critical')
    .map((finding: DiffFinding) => finding.id);

  const remainingCriticalFindings =
    reachedEquivalence || criticalIds.length === 0
      ? []
      : criticalIds.filter((id) => !resolvedIds.has(id));

  // Frozen contract (literal iff): converged is true iff
  // remainingCriticalFindings is empty.
  const converged = remainingCriticalFindings.length === 0;

  return {
    maxIterations,
    attempts,
    remainingCriticalFindings,
    converged,
  };
}