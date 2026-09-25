/**
 * @clapp/extract — IR identifier minters.
 *
 * Every id is a prefixed uuid v4 string per the ir-contract v0.1 comments,
 * mirroring the @clapp/core convention (self-describing ids in logs, object
 * stores, and foreign keys). Minted ids are identity, not content: two
 * extractions of the same bundle produce structurally identical models
 * except for these ids.
 */

import type { IrAssumption, IrComponent, IrDataEntity, IrEvidenceEntry, IrJourney, IrScreen, IrStateVariable, IrTransition } from './ir-contract';

function prefixedUuid(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function newIrEvidenceEntryId(): string {
  return prefixedUuid('irev');
}

export function newScreenId(): string {
  return prefixedUuid('screen');
}

export function newComponentId(): string {
  return prefixedUuid('comp');
}

export function newStateVariableId(): string {
  return prefixedUuid('var');
}

export function newTransitionId(): string {
  return prefixedUuid('trans');
}

export function newEntityId(): string {
  return prefixedUuid('ent');
}

export function newOperationId(): string {
  return prefixedUuid('op');
}

export function newAssumptionId(): string {
  return prefixedUuid('assume');
}

export function newApplicationId(): string {
  return prefixedUuid('app');
}

// Convenience typedefs for the model element shapes this package mints
// (kept local; the contract types stay the single source of truth).
export type ScreenElement = IrScreen;
export type ComponentElement = IrComponent;
export type VariableElement = IrStateVariable;
export type TransitionElement = IrTransition;
export type EntityElement = IrDataEntity;
export type AssumptionElement = IrAssumption;
export type JourneyElement = IrJourney;
export type CatalogEntry = IrEvidenceEntry;
