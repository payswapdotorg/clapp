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
