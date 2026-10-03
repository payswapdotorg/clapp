/**
 * @clapp/factory — public API (CLAPP-085).
 *
 * The CLAPP Autonomous App Factory FIRST lane (P9, the first roadmap
 * checkbox: "target classification"): the entry classifier that binds
 * the five frozen P8 platform literals and the learn lane's frozen
 * archetype classification (consumed as DATA, never forked) into the
 * factory's first frozen output — the fail-closed, content-addressed
 * TargetClassification ('tcls_' ids, caller-injected clocks).
 *
 * Quick start:
 *
 *   import { classifyTarget } from '@clapp/factory';
 *
 *   const result = await classifyTarget(
 *     {
 *       platform: 'linux',
 *       classification: learnClassification, // the learn lane's data, as-is
 *       budgetTier: 'standard',
 *     },
 *     '2026-10-03T02:00:00Z', // caller-injected — never a clock
 *   );
 *   // result.ok === true  → result.classification is the TargetClassification
 *   // result.ok === false → result.errors names EVERY offending field
 *
 * Sibling packages must import `@clapp/factory` and never reach into
 * deeper paths. The consumed learn shapes are referenced TYPE-ONLY inside
 * src/target-classification.ts (the compile-time binding pin) — the
 * public surface below re-exports ONLY this package's own contracts.
 * Exploration budgets (CLAPP-086), package-graph synthesis (CLAPP-087),
 * multi-pass repair (CLAPP-088), and the human release gate (CLAPP-089)
 * are later lanes, never this package's.
 */

// ---- the target classifier (CLAPP-085 — the P9 opener) ------------------------------
export {
  ARCHETYPE_BINDING_VERSION,
  BUDGET_TIERS,
  TARGET_CLASS_VERSION,
  TARGET_PLATFORMS,
  classifyTarget,
} from './target-classification';
export type {
  TargetClassification,
  TargetClassificationResult,
  TargetRequest,
} from './target-classification';

// ---- the adaptive exploration budgets (CLAPP-086 — the P9 second lane) --------------
// The frozen v0.1 tier table that spends the CLAPP-085 budget-tier tags
// as exploration caps (the explore policy's three budget axes as data),
// the fail-closed resolver (a fresh caps copy per resolution, the tcls_
// provenance carried verbatim), and the CLAPP-075-law ledger (a refused
// spend never consumes; remaining is measured from the given caps,
// never asserted from the tier name).
export {
  EXPLORATION_BUDGET_VERSION,
  TIER_CAPS,
  createBudgetLedger,
  resolveExplorationBudget,
} from './exploration-budgets';
export type {
  BudgetLedger,
  ExplorationBudget,
  ExplorationBudgetResult,
  ExplorationCaps,
  LedgerResult,
  SpendRequest,
  SpendResult,
} from './exploration-budgets';

// ---- the package-graph synthesis (CLAPP-087 — the P9 third lane) --------------------
// The graph the codegen lane walks: synthesized fail-closed from a
// CLAPP-085 target classification + a learn composition plan (both
// consumed as DATA, never forked), one 'target' node + one 'component'
// node per selected manifest + one 'targets' edge per component (the
// 'depends' kind reserved for the later cgraph-edge lane), counts
// MEASURED, the tcls_/comp_ provenance carried verbatim, and
// content-addressed 'pgraph_' ids (a DISTINCT prefix — the library
// lane's 'cgraph_' is its own frozen identity, never re-used here).
export {
  COMPOSITION_BINDING_VERSION,
  PACKAGE_GRAPH_VERSION,
  synthesizePackageGraph,
} from './package-graph';
export type {
  PackageGraph,
  PackageGraphEdge,
  PackageGraphEdgeKind,
  PackageGraphNode,
  PackageGraphNodeKind,
  PackageGraphResult,
} from './package-graph';

// ---- the multi-pass repair scheduler (CLAPP-088 — the P9 fourth lane) ----------------
// The tier-capped pass scheduler that drives bounded repair rounds
// through a duck-typed runner seam (ONE bounded repair round per
// invocation — the repair lane's frozen loop, scheduled, never
// re-implemented) until convergence (terminal), an honest regression
// stop, or pass-cap exhaustion: outcomes DERIVED from each round's own
// facts (never reported by the seam), counts MEASURED, convergence
// never inferred, the tcls_ provenance carried verbatim, and
// content-addressed 'mpass_' ids (a DISTINCT prefix — the repair
// lane's own ids are its own frozen identity, never re-used here).
export {
  MULTI_PASS_REPAIR_VERSION,
  TIER_PASS_CAPS,
  scheduleMultiPassRepair,
} from './multi-pass-repair';
export type {
  MultiPassResult,
  MultiPassSchedule,
  PassOutcome,
  PassRecord,
  RepairRoundRunner,
  RoundFacts,
} from './multi-pass-repair';
