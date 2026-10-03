// CLAPP-087 — package-graph synthesis fixtures.
//
// Two sections: the factory-lane classification DATA (the frozen v0.1
// CLAPP-085 TargetClassification shape, carrying the REAL content-addressed
// tcls_ id the 086 fixtures minted by the actual classifier over the 085
// VALID_REQUEST — honest provenance for the graph's classificationId
// binding; the fixtures import @clapp/factory's own contracts for TYPES
// ONLY, never runtime values) and the learn-lane composition-plan DATA
// (full frozen v0.1 CompositionPlan shapes — the fixtures import
// @clapp/learn for TYPES ONLY, never runtime values, so the literals are
// COMPILE-CHECKED against the frozen shape: a real learn plan fits the
// synthesizer's plan slot as-is) plus the builders over them (relative
// TYPE-ONLY imports from src — the fixtures are plain data builders, the
// house discipline).
//
// The comp_ plan ids and pkg_ manifest ids inside the plan fixtures are
// OPAQUE fixture data to this lane: the synthesizer duck-validates
// exactly the fields it consumes (compositionVersion / id /
// selected[].id) and carries the ids VERBATIM as the provenance binding —
// real content-addressed comp_ ids are the learn lane's minted artifacts
// (planComposition), never asserted here (the 085 arch_-fixture
// precedent). The selected arrays mirror what the greedy planner
// actually produces (rank order, one entry per selected manifest, the
// measured considered/graphEdgeCount facts of a ranked corpus), so the
// fixtures are honest plan-shaped DATA, not invented compositions.

import type { CompositionPlan, SelectedComponent } from '@clapp/learn';
import type { TargetClassification } from '../../src/target-classification';

/** Fixed caller-injected synthesis timestamps (fixtures never read the clock). */
export const SYNTHESIZED_AT_A = '2026-10-03T04:00:00Z';
export const SYNTHESIZED_AT_B = '2026-10-03T05:00:00Z';

// ---- the classification fixture (the factory's own real 085 output) ------------------

/**
 * The well-formed classification fixture — the 086 standard-tier
 * classification (the 085 VALID_REQUEST resolved with budgetTier
 * 'standard'); the tcls_ id is the real content-addressed digest of that
 * body, carried VERBATIM as every synthesized graph's classificationId.
 */
export const GRAPH_CLASSIFICATION: TargetClassification = {
  targetVersion: '0.1',
  platform: 'linux',
  primaryArchetype: 'api-backed-app',
  matchCount: 2,
  budgetTier: 'standard',
  outcome: 'classified',
  id: 'tcls_348dd61862f09e4a1df8c7815d47665a798785be395da4c346d3b9507ef9c7f8',
  classifiedAt: '2026-10-03T02:00:00Z',
};

/** Overriding builder: the valid classification with contract-violating DATA injected on purpose. */
export function malformedClassification(patch: Record<string, unknown>): unknown {
  return { ...GRAPH_CLASSIFICATION, ...patch };
}

// ---- the composition-plan fixtures (the learn lane's data, consumed as DATA) ---------

/**
 * The well-formed plan fixture — THREE selected components in the plan's
 * greedy rank order (ranks 0–2), two honest exclusions (a runtime
 * conflict and a rank cut), and the measured facts of a five-candidate
 * ranked corpus: considered 5, graphEdgeCount 10 (the induced subgraph's
 * ten unordered pairs). The graphEdgeCount deliberately diverges from the
 * selected count — the pin that the synthesizer's edgeCount is MEASURED
 * from the derived edges (3), never asserted from the plan's own counts.
 */
export const THREE_COMPONENT_PLAN: CompositionPlan = {
  compositionVersion: '0.1',
  id: 'comp_fixture-b02-three-component',
  queryDigest: 'rq_fixture-b02-dashboard-query',
  selected: [
    { id: 'pkg_fixture-router', version: '1.2.0', score: 0.92, rank: 0 },
    { id: 'pkg_fixture-forms', version: '2.0.1', score: 0.87, rank: 1 },
    { id: 'pkg_fixture-api-client', version: '1.0.4', score: 0.81, rank: 2 },
  ],
  excluded: [
    {
      id: 'pkg_fixture-node-runtime',
      version: '3.1.0',
      reason:
        'runtime conflict with selected pkg_fixture-router — alternative runtimes never compose in v0.1',
    },
    {
      id: 'pkg_fixture-charts',
      version: '0.9.0',
      reason: 'rank cut — measured rank 4 is beyond maxComponents 3',
    },
  ],
  considered: 5,
  graphEdgeCount: 10,
  plannedAt: '2026-10-03T03:30:00Z',
};

/**
 * The empty-selection plan fixture — a legal plan over an empty corpus:
 * zero selected, zero excluded, measured zeros (the honest empty plan
 * the greedy planner mints for an empty corpus).
 */
export const EMPTY_SELECTION_PLAN: CompositionPlan = {
  compositionVersion: '0.1',
  id: 'comp_fixture-b03-empty-corpus',
  queryDigest: 'rq_fixture-b03-catalog-query',
  selected: [],
  excluded: [],
  considered: 0,
  graphEdgeCount: 0,
  plannedAt: '2026-10-03T03:45:00Z',
};

/**
 * The DUPLICATE-selection plan fixture — contract-violating DATA on
 * purpose: the same manifest id selected twice (two versions of one
 * package). The greedy planner's corpus admission refuses duplicate
 * manifest ids, so a real plan never looks like this — the fixture
 * exists to prove the synthesizer's OWN identity law fires fail-closed
 * (a graph never carries two nodes with one id).
 */
export const DUPLICATE_SELECTION_PLAN: CompositionPlan = {
  compositionVersion: '0.1',
  id: 'comp_fixture-duplicate-selection',
  queryDigest: 'rq_fixture-duplicate-query',
  selected: [
    { id: 'pkg_fixture-router', version: '1.2.0', score: 0.92, rank: 0 },
    { id: 'pkg_fixture-forms', version: '2.0.1', score: 0.87, rank: 1 },
    { id: 'pkg_fixture-router', version: '1.3.0', score: 0.84, rank: 2 },
  ],
  excluded: [],
  considered: 3,
  graphEdgeCount: 3,
  plannedAt: '2026-10-03T03:50:00Z',
};

/**
 * The self-target plan fixture — contract-violating DATA on purpose: one
 * selected id EQUALS the classification's own tcls_ id (a manifest-id
 * slot carrying a classification id). A real plan never looks like this;
 * the fixture exists to prove the synthesizer's identity law fires
 * fail-closed (the target is never also a component).
 */
export const SELF_TARGET_SELECTION_PLAN: CompositionPlan = {
  compositionVersion: '0.1',
  id: 'comp_fixture-self-target-selection',
  queryDigest: 'rq_fixture-self-target-query',
  selected: [
    { id: 'pkg_fixture-router', version: '1.2.0', score: 0.92, rank: 0 },
    { id: GRAPH_CLASSIFICATION.id, version: '1.0.0', score: 0.5, rank: 1 },
  ],
  excluded: [],
  considered: 2,
  graphEdgeCount: 1,
  plannedAt: '2026-10-03T03:55:00Z',
};

/**
 * One extra selected component (a fourth, rank 3) — the mutation probe
 * for the id-determinism test: appending it to the valid plan's selected
 * array is a MEASURED plan change that must move the pgraph_ id.
 */
export const EXTRA_SELECTED_COMPONENT: SelectedComponent = {
  id: 'pkg_fixture-storage',
  version: '2.1.0',
  score: 0.78,
  rank: 3,
};

/** Overriding builder: the valid plan with contract-violating DATA injected on purpose. */
export function malformedPlan(patch: Record<string, unknown>): unknown {
  return { ...THREE_COMPONENT_PLAN, ...patch };
}
