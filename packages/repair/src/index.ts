/**
 * @clapp/repair — public API (CLAPP-042).
 *
 * The autonomous repair loop: consumes a DiffReport (diff-contract v0.1
 * MIRROR shape — canonical owner @clapp/diff, CLAPP-040; this package
 * consumes contract-shaped DATA, never the diff packages themselves),
 * clusters critical/major findings into scoped RepairDirectives, applies
 * bounded evidence-driven edits (text-restore / attribute-restore /
 * mock-restore) to the candidate app's files as git commits with hard
 * scope enforcement, and iterates against a re-run oracle within a
 * max-iterations budget. The loop NEVER reads a SynthesisPlan (non-
 * degeneracy rule): repairs derive from findings + left-side truth only.
 *
 * Quick start:
 *
 *   import { clusterFindings, runRepairLoop, type RepairLoopOptions } from '@clapp/repair';
 *
 *   const directives = clusterFindings(report);            // scoped work orders
 *   const result = await runRepairLoop({
 *     report,
 *     candidateRoot,                                        // a git repo
 *     rerun: async (root) => rerunPairedVerification(root), // oracle callback
 *     maxIterations: 5,
 *   });
 *   // result.converged === true iff remainingCriticalFindings is empty
 *
 * See README.md for the strategy table, the anchor→file mapping, the
 * scope/budget semantics, and the injectable id factories.
 */

// ---- canonical contract MIRROR (re-export carrier) --------------------------
// Byte-identical mirror of the tech-lead diff-contract v0.1 declaration;
// canonical owner @clapp/diff (CLAPP-040). The tech lead byte-checks this
// mirror at integration.
export * from './diff-contract';

// ---- repair loop --------------------------------------------------------------
export { runRepairLoop } from './loop';
export type { RepairLoopOptions, RerunVerdict } from './loop';

// ---- clustering -----------------------------------------------------------------
export { clusterFindings } from './directives';
export type { ClusterOptions } from './directives';

// ---- bounded edit engine ----------------------------------------------------
export { applyDirective, REPAIR_COMMIT_PREFIX } from './apply';
export type { ApplyDirectiveOptions } from './apply';

// ---- payload vocabulary (finding expected/actual shapes) --------------------
export {
  acceptanceClause,
  findingTargetPath,
  isMockPayload,
  isTestidPayload,
  isTextPayload,
  MOCK_TARGET_PATH,
  pageModulePathForRoute,
  payloadTargetPath,
} from './payload';
export type { MockPayload, TestidPayload, TextPayload } from './payload';

// ---- strategies (pure content transforms; for direct use/testing) -------------
export {
  applyAttributeRestore,
  applyMockRestore,
  applyStrategy,
  applyTextRestore,
  selectStrategy,
  verifyFinding,
} from './strategies';
export type { StrategyName, StrategyPlan, StrategyResult } from './strategies';

// ---- ids + honesty ----------------------------------------------------------
export { countingDirectiveIdFactory, newDirectiveId } from './ids';
export type { DirectiveIdFactory } from './ids';
export { REPAIR_ADAPTER_INFO } from './adapter-info';

// ---- git plumbing (candidate-tree operations; for direct use/testing) --------
export {
  git,
  gitChangedPaths,
  gitCommitPaths,
  gitHead,
  gitResetHard,
  gitStatusPorcelain,
} from './git';
export type { GitResult } from './git';
