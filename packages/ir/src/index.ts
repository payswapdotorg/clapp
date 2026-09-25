/**
 * @clapp/ir — public API.
 *
 * CLAPP-020: the Behavioral IR package and CANONICAL OWNER of the shared
 * ir-contract v0.1 (src/ir-contract.ts — the byte-identical tech-lead
 * declaration; @clapp/extract and @clapp/explore carry mirrors; the tech
 * lead verifies byte-equality at integration and freezes. Contract changes
 * require an ADR).
 *
 * The IR is deliberately framework-independent (docs/BEHAVIORAL_IR.md §1
 * principles 5/6): it depends only on @clapp/core (EvidenceRef is the only
 * evidence type it needs) and never on @clapp/evidence, @clapp/journey,
 * @clapp/observe, @clapp/store, or @clapp/sandbox.
 *
 * Sibling packages must import `@clapp/ir` and never reach into deeper
 * paths. The per-element check functions and FirstSeen/CatalogEntry/
 * IrReferenceContext exports of src/validate.ts are INTERNAL (shared with
 * src/builder.ts so the builder and the validator can never disagree) and
 * are deliberately NOT re-exported here.
 */

// ---- canonical contract (canonical owner: this package) --------------------
export * from './ir-contract';

// ---- identifier helpers ----------------------------------------------------
export {
  API_OPERATION_ID_PATTERN,
  APPLICATION_ID_PATTERN,
  ASSUMPTION_ID_PATTERN,
  COMPONENT_ID_PATTERN,
  DATA_ENTITY_ID_PATTERN,
  EVIDENCE_ENTRY_ID_PATTERN,
  INTEGRATION_ID_PATTERN,
  IR_ID_PREFIXES,
  JOURNEY_ID_PATTERN,
  SCREEN_ID_PATTERN,
  STATE_VARIABLE_ID_PATTERN,
  TRANSITION_ID_PATTERN,
  UUID_SHAPE_RE,
  irIdPatternFor,
  mintIrId,
  newApiOperationId,
  newApplicationId,
  newAssumptionId,
  newComponentId,
  newDataEntityId,
  newEvidenceEntryId,
  newIntegrationId,
  newScreenId,
  newStateVariableId,
  newTransitionId,
} from './ids';

// ---- canonical JSON (own implementation — same platform semantics) ---------
export { CanonicalJsonError, canonicalJson, canonicalJsonBytes, isCanonicalJsonSafe } from './canonical-json';

// ---- validation ------------------------------------------------------------
export { validateIrModel, validateIrModelDetailed } from './validate';
export type { IrValidationResult } from './validate';

// ---- serialization + persistence -------------------------------------------
export {
  IrPersistenceError,
  IrSerializationError,
  loadIrModel,
  parseIrModel,
  saveIrModel,
  serializeIrModel,
} from './serialize';

// ---- diff ------------------------------------------------------------------
export { DIFF_SECTIONS, SET_SEMANTICS_PATHS, diffIrModels } from './diff';
export type { IrDiff, IrDiffSection } from './diff';

// ---- builder ---------------------------------------------------------------
export { IrBuilderError, createIrModelBuilder } from './builder';
export type {
  AddApiOperationInput,
  AddAssumptionInput,
  AddComponentInput,
  AddDataEntityInput,
  AddIntegrationInput,
  AddScreenInput,
  AddStateVariableInput,
  AddTransitionInput,
  CreateIrModelBuilderInit,
  IrModelBuilder,
} from './builder';

// ---- stats -----------------------------------------------------------------
export { irModelStats } from './stats';
export type { IrModelStats } from './stats';

// ---- adapter honesty summaries ----------------------------------------------
export { IrAdapterError, describeIrAdapter } from './adapter';
