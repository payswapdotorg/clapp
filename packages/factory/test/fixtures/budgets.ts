// CLAPP-086 — exploration-budget fixtures.
//
// Two sections: the CLAPP-085 classification DATA (full frozen v0.1
// TargetClassification shapes — one per frozen tier, each carrying a REAL
// content-addressed tcls_ id minted by the actual classifyTarget over
// the 085 fixtures' VALID_REQUEST, so the ids are honest provenance for
// each tier's body, not invented strings; the fixtures import
// @clapp/factory's own contracts for TYPES ONLY, never runtime values)
// and the resolved-budget + spend-request builders over them (relative
// TYPE-ONLY imports from src — the fixtures are plain data builders,
// the house discipline).
//
// The tcls_ ids are OPAQUE fixture data to this lane: the resolver
// duck-validates exactly the fields it consumes (targetVersion /
// budgetTier / id) and carries the id VERBATIM as the provenance
// binding — it never recomputes or asserts the id's content (this lane
// mints no new ids).

import type { TargetClassification } from '../../src/target-classification';
import type { ExplorationBudget, SpendRequest } from '../../src/exploration-budgets';

/** Fixed caller-injected classification time shared by the fixtures (fixtures never read a clock). */
export const FIXTURE_CLASSIFIED_AT = '2026-10-03T02:00:00Z';

// ---- the classification fixtures (REAL CLAPP-085 outputs, one per tier) -------------

/**
 * The minimal-tier classification — the 085 VALID_REQUEST (linux, the
 * two-match learn classification) resolved with budgetTier 'minimal';
 * the tcls_ id is the real content-addressed digest of that body.
 */
export const MINIMAL_CLASSIFICATION: TargetClassification = {
  targetVersion: '0.1',
  platform: 'linux',
  primaryArchetype: 'api-backed-app',
  matchCount: 2,
  budgetTier: 'minimal',
  outcome: 'classified',
  id: 'tcls_0b43529d4c00ef0c4e76e1b4215e2bcf143a6ff5479906e46439cabdf4b63a99',
  classifiedAt: FIXTURE_CLASSIFIED_AT,
};

/**
 * The standard-tier classification — the 085 VALID_REQUEST resolved
 * with budgetTier 'standard' (the well-formed fixture this lane's tests
 * default to); the tcls_ id is the real content-addressed digest of
 * that body.
 */
export const STANDARD_CLASSIFICATION: TargetClassification = {
  targetVersion: '0.1',
  platform: 'linux',
  primaryArchetype: 'api-backed-app',
  matchCount: 2,
  budgetTier: 'standard',
  outcome: 'classified',
  id: 'tcls_348dd61862f09e4a1df8c7815d47665a798785be395da4c346d3b9507ef9c7f8',
  classifiedAt: FIXTURE_CLASSIFIED_AT,
};

/**
 * The extended-tier classification — the 085 VALID_REQUEST resolved
 * with budgetTier 'extended'; the tcls_ id is the real content-addressed
 * digest of that body.
 */
export const EXTENDED_CLASSIFICATION: TargetClassification = {
  targetVersion: '0.1',
  platform: 'linux',
  primaryArchetype: 'api-backed-app',
  matchCount: 2,
  budgetTier: 'extended',
  outcome: 'classified',
  id: 'tcls_d2348576e123ad0182b1a9a48efc2ef9a60b93122682275e1bf3ac3bb4269af5',
  classifiedAt: FIXTURE_CLASSIFIED_AT,
};

/** The well-formed classification fixture (the standard tier). */
export const VALID_CLASSIFICATION: TargetClassification = STANDARD_CLASSIFICATION;

/** Overriding builder: the valid fixture with contract-violating DATA injected on purpose. */
export function malformedClassification(patch: Record<string, unknown>): unknown {
  return { ...STANDARD_CLASSIFICATION, ...patch };
}

// ---- the resolved-budget fixtures (the ledger's duck-check inputs) ------------------

/** A well-formed resolved ExplorationBudget over the standard tier (the ledger's valid input). */
export const VALID_BUDGET: ExplorationBudget = {
  budgetVersion: '0.1',
  budgetTier: 'standard',
  caps: { maxSteps: 120, maxScreens: 20, maxActionsPerScreen: 5 },
  classificationId: STANDARD_CLASSIFICATION.id,
};

/**
 * A duck-valid budget whose caps DIFFER from its tier's table entry (a
 * hand-built probe, never a resolver output): the measured-not-asserted
 * pin — a ledger over this budget must start at THE GIVEN caps (10/4),
 * never at the minimal table entry (40/8) looked up from the tier name.
 */
export const CUSTOM_CAPS_BUDGET: ExplorationBudget = {
  budgetVersion: '0.1',
  budgetTier: 'minimal',
  caps: { maxSteps: 10, maxScreens: 4, maxActionsPerScreen: 2 },
  classificationId: MINIMAL_CLASSIFICATION.id,
};

/** Overriding builder: the valid budget with contract-violating DATA injected on purpose. */
export function malformedBudget(patch: Record<string, unknown>): unknown {
  return { ...VALID_BUDGET, ...patch };
}

// ---- the spend-request builders ------------------------------------------------------

/** A well-formed spend request (each axis independently spendable; 0 is a valid no-op). */
export function spendRequest(steps: number, screens: number): SpendRequest {
  return { steps, screens };
}
