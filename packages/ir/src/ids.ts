/**
 * @clapp/ir — identifier helpers for the Behavioral IR contract v0.1.
 *
 * Every IR element id is a prefixed uuid v4 string so models are
 * self-describing at a glance, mirroring the run/artifact/evidence id
 * conventions in @clapp/core and the journey id convention in
 * @clapp/journey:
 *
 *   app_ (application)          irev_ (evidence catalog entry)
 *   journey_ (@clapp/journey)   screen_ / comp_ / var_ / trans_
 *   ent_ / op_ / integ_ / assume_
 *
 * Honest scope notes:
 * - The uuid version/variant bits are NOT pinned by the patterns (any
 *   uuid-shaped hex is accepted, case-insensitive), matching the
 *   JOURNEY_ID_PATTERN precedent from @clapp/journey — ids minted by other
 *   v0.1 tools remain valid. `mintIrId` always mints true uuid v4 via
 *   `crypto.randomUUID()`.
 * - There is deliberately NO `newJourneyId` here: journey ids are owned by
 *   @clapp/journey. The IR (and its builder) ACCEPTS journey ids from
 *   callers; it never mints them.
 */

import type {
  IrApplication,
  IrAssumption,
  IrApiOperation,
  IrComponent,
  IrDataEntity,
  IrEvidenceEntry,
  IrIntegration,
  IrScreen,
  IrStateVariable,
  IrTransition,
} from './ir-contract';

/** uuid v4 shape (8-4-4-4-12 hex) without pinning version/variant bits. */
export const UUID_SHAPE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `"app_" + uuid` — IrApplication.id. */
export const APPLICATION_ID_PATTERN = /^app_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `"irev_" + uuid` — IrEvidenceEntry.id. */
export const EVIDENCE_ENTRY_ID_PATTERN = /^irev_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `"journey_" + uuid` — IrJourney.id (minted by @clapp/journey, accepted here). */
export const JOURNEY_ID_PATTERN = /^journey_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `"screen_" + uuid` — IrScreen.id. */
export const SCREEN_ID_PATTERN = /^screen_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `"comp_" + uuid` — IrComponent.id. */
export const COMPONENT_ID_PATTERN = /^comp_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `"var_" + uuid` — IrStateVariable.id. */
export const STATE_VARIABLE_ID_PATTERN = /^var_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `"trans_" + uuid` — IrTransition.id. */
export const TRANSITION_ID_PATTERN = /^trans_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `"ent_" + uuid` — IrDataEntity.id. */
export const DATA_ENTITY_ID_PATTERN = /^ent_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `"op_" + uuid` — IrApiOperation.id. */
export const API_OPERATION_ID_PATTERN = /^op_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `"integ_" + uuid` — IrIntegration.id. */
export const INTEGRATION_ID_PATTERN = /^integ_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `"assume_" + uuid` — IrAssumption.id. */
export const ASSUMPTION_ID_PATTERN = /^assume_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** All declared IR id prefixes, keyed by element kind. */
export const IR_ID_PREFIXES = {
  application: 'app_',
  evidenceEntry: 'irev_',
  journey: 'journey_',
  screen: 'screen_',
  component: 'comp_',
  stateVariable: 'var_',
  transition: 'trans_',
  dataEntity: 'ent_',
  apiOperation: 'op_',
  integration: 'integ_',
  assumption: 'assume_',
} as const;

/** The pattern for a given declared prefix (undefined for unknown prefixes). */
export function irIdPatternFor(prefix: string): RegExp | undefined {
  switch (prefix) {
    case IR_ID_PREFIXES.application: return APPLICATION_ID_PATTERN;
    case IR_ID_PREFIXES.evidenceEntry: return EVIDENCE_ENTRY_ID_PATTERN;
    case IR_ID_PREFIXES.journey: return JOURNEY_ID_PATTERN;
    case IR_ID_PREFIXES.screen: return SCREEN_ID_PATTERN;
    case IR_ID_PREFIXES.component: return COMPONENT_ID_PATTERN;
    case IR_ID_PREFIXES.stateVariable: return STATE_VARIABLE_ID_PATTERN;
    case IR_ID_PREFIXES.transition: return TRANSITION_ID_PATTERN;
    case IR_ID_PREFIXES.dataEntity: return DATA_ENTITY_ID_PATTERN;
    case IR_ID_PREFIXES.apiOperation: return API_OPERATION_ID_PATTERN;
    case IR_ID_PREFIXES.integration: return INTEGRATION_ID_PATTERN;
    case IR_ID_PREFIXES.assumption: return ASSUMPTION_ID_PATTERN;
    default: return undefined;
  }
}

/** Fresh prefixed uuid v4 id (internal workhorse for the minters below). */
export function mintIrId(prefix: string): string {
  return `${prefix}${crypto.randomUUID()}`;
}

/** Fresh `IrApplication['id']`: `"app_" + uuid v4`. */
export function newApplicationId(): IrApplication['id'] {
  return mintIrId(IR_ID_PREFIXES.application);
}

/** Fresh `IrEvidenceEntry['id']`: `"irev_" + uuid v4`. */
export function newEvidenceEntryId(): IrEvidenceEntry['id'] {
  return mintIrId(IR_ID_PREFIXES.evidenceEntry);
}

/**
 * Fresh `IrScreen['id']`: `"screen_" + uuid v4`.
 * (No `newJourneyId` exists in this package — @clapp/journey owns journey
 * id minting; the IR accepts journey ids from callers.)
 */
export function newScreenId(): IrScreen['id'] {
  return mintIrId(IR_ID_PREFIXES.screen);
}

/** Fresh `IrComponent['id']`: `"comp_" + uuid v4`. */
export function newComponentId(): IrComponent['id'] {
  return mintIrId(IR_ID_PREFIXES.component);
}

/** Fresh `IrStateVariable['id']`: `"var_" + uuid v4`. */
export function newStateVariableId(): IrStateVariable['id'] {
  return mintIrId(IR_ID_PREFIXES.stateVariable);
}

/** Fresh `IrTransition['id']`: `"trans_" + uuid v4`. */
export function newTransitionId(): IrTransition['id'] {
  return mintIrId(IR_ID_PREFIXES.transition);
}

/** Fresh `IrDataEntity['id']`: `"ent_" + uuid v4`. */
export function newDataEntityId(): IrDataEntity['id'] {
  return mintIrId(IR_ID_PREFIXES.dataEntity);
}

/** Fresh `IrApiOperation['id']`: `"op_" + uuid v4`. */
export function newApiOperationId(): IrApiOperation['id'] {
  return mintIrId(IR_ID_PREFIXES.apiOperation);
}

/** Fresh `IrIntegration['id']`: `"integ_" + uuid v4`. */
export function newIntegrationId(): IrIntegration['id'] {
  return mintIrId(IR_ID_PREFIXES.integration);
}

/** Fresh `IrAssumption['id']`: `"assume_" + uuid v4`. */
export function newAssumptionId(): IrAssumption['id'] {
  return mintIrId(IR_ID_PREFIXES.assumption);
}
