/**
 * @clapp/plan — public API (CLAPP-030).
 *
 * The CLAPP architecture planner and CANONICAL OWNER of the shared
 * synthesis-contract v0.1 (src/synthesis-contract.ts — the byte-identical
 * tech-lead declaration; @clapp/codegen (CLAPP-031) and @clapp/gentests
 * (CLAPP-032) carry mirrors; the tech lead verifies byte-equality at
 * integration and freezes. Changes require an ADR).
 *
 * The plan is the intermediate artifact between the Behavioral IR (frozen at
 * P2, @clapp/ir) and the synthesized candidate web app: the PLANNER (this
 * package) derives it from a validated IrModel; the CODEGEN renders it into
 * runnable app source + mock backend; the TEST GENERATOR renders it into a
 * generated acceptance suite. All three speak ONLY through the contract.
 *
 * Dependencies are deliberately minimal (runtime: @clapp/core for
 * EvidenceRef, @clapp/ir for validation + canonicalJson + the adapter-info
 * shape, @clapp/journey for the Journey record type + validation; e2e only:
 * @clapp/explore, @clapp/evidence, @clapp/store). The plan NEVER depends on
 * @clapp/codegen or @clapp/gentests — they are parallel P3 workers.
 *
 * Sibling packages must import `@clapp/plan` and never reach into deeper
 * paths. Quick start:
 *
 *   import { planSynthesis, serializeSynthesisPlan, validateSynthesisPlanDetailed } from '@clapp/plan';
 *
 *   const plan = planSynthesis(validatedIrModel, { journeys: seededJourneys });
 *   const check = validateSynthesisPlanDetailed(plan);   // { valid: true, errors: [] }
 *   const text = serializeSynthesisPlan(plan);            // canonical JSON
 */

// ---- canonical contract (canonical owner: this package) --------------------
export * from './synthesis-contract';

// ---- identifier helpers ----------------------------------------------------
export {
  ACCEPTANCE_ID_PATTERN,
  API_ENDPOINT_ID_PATTERN,
  ELEMENT_ID_PATTERN,
  FORM_ID_PATTERN,
  MOCK_ID_PATTERN,
  NAV_ID_PATTERN,
  PAGE_ID_PATTERN,
  PLAN_ID_PREFIXES,
  PLANNED_APPLICATION_ID_PATTERN,
  ROUTE_ID_PATTERN,
  STORAGE_BINDING_ID_PATTERN,
  UUID_SHAPE_RE,
  mintPlanId,
  newAcceptanceId,
  newApiEndpointId,
  newElementId,
  newFormId,
  newMockId,
  newNavId,
  newPageId,
  newPlannedApplicationId,
  newRouteId,
  newStorageBindingId,
  planIdPatternFor,
} from './ids';

// ---- validation ------------------------------------------------------------
export {
  EVIDENCE_ID_PATTERN,
  IR_APPLICATION_ID_PATTERN,
  IR_ENTITY_ID_PATTERN,
  IR_OPERATION_ID_PATTERN,
  IR_TRANSITION_ID_PATTERN,
  JOURNEY_ID_PATTERN,
  SHA256_HEX_RE,
  validateSynthesisPlan,
  validateSynthesisPlanDetailed,
} from './validate';
export type { PlanValidationResult } from './validate';

// ---- serialization -----------------------------------------------------------
export { PlanSerializationError, parseSynthesisPlan, serializeSynthesisPlan } from './serialize';

// ---- the planner --------------------------------------------------------------
export {
  PlanSynthesisError,
  describeJourneyAction,
  describeTarget,
  planSynthesis,
  routeFromJourneyUrl,
  sketchMockBody,
} from './plan';
export type { PlanIdKind, PlanOptions } from './plan';

// ---- diff --------------------------------------------------------------------
export { PLAN_DIFF_SECTIONS, diffSynthesisPlans } from './diff';
export type { PlanDiff, PlanDiffSection } from './diff';

// ---- stats ---------------------------------------------------------------------
export { planStats } from './stats';
export type { PlanStats } from './stats';

// ---- adapter honesty summary ------------------------------------------------------
export { PLAN_ADAPTER_INFO, PlanAdapterError, describePlanAdapter } from './adapter';
