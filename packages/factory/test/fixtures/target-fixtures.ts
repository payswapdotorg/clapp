// CLAPP-085 — target-request fixtures.
//
// Two sections: the learn-lane classification DATA (full frozen v0.1
// ArchetypeClassification shapes — the fixtures import @clapp/learn for
// TYPES ONLY, never runtime values, so the literals are COMPILE-CHECKED
// against the frozen shape: a real learn classification fits the
// request's classification slot as-is) and the request builders over
// them (relative TYPE-ONLY imports from src — the fixtures are plain
// data builders, the house discipline).
//
// The ids inside the learn-classification fixtures ('arch_…') are
// OPAQUE fixture data to this lane: the factory duck-validates exactly
// the fields it consumes (archetypeVersion / outcome / matches) and
// never reads the classification's own id — real content-addressed
// arch_ ids are the learn lane's minted artifacts (classifyManifest),
// never asserted here. The match evidence arrays mirror what the learn
// table's rules actually measure, so the fixtures are honest
// learn-classification-shaped DATA, not invented verdicts.

import type { ArchetypeClassification } from '@clapp/learn';
import type { TargetRequest } from '../../src/target-classification';

/** Fixed caller-injected classification timestamps (fixtures never read the clock). */
export const CLASSIFIED_AT_A = '2026-10-03T02:00:00Z';
export const CLASSIFIED_AT_B = '2026-10-03T03:00:00Z';

// ---- the learn-classification fixtures (consumed as DATA) ---------------------------

/**
 * A learn-lane classification with TWO matches, in the learn table's
 * canonical order (rule 1 'api-backed-app', then rule 2
 * 'form-driven-app') — the classified fixture.
 */
export const TWO_MATCH_CLASSIFICATION: ArchetypeClassification = {
  archetypeVersion: '0.1',
  tableVersion: '0.1',
  id: 'arch_fixture-api-backed-form-driven',
  manifestId: 'pkg_fixture-b02-dashboard',
  manifestVersion: '1.0.0',
  matches: [
    {
      name: 'api-backed-app',
      matchedCapabilities: ['api-mock'],
      matchedInterface: ['/api/items'],
      reasons: [
        "capabilities includes 'api-mock'",
        "interface entry '/api/items' starts with '/api/'",
      ],
    },
    {
      name: 'form-driven-app',
      matchedCapabilities: ['form'],
      matchedInterface: [],
      reasons: ["capabilities includes 'form'"],
    },
  ],
  outcome: 'classified',
  classifiedAt: '2026-10-02T22:00:00Z',
  reasons: [],
};

/**
 * A learn-lane classification with ZERO matches and the honest
 * 'unclassified' verdict (one unclaimed capability, one honest reason) —
 * the unclassified fixture.
 */
export const UNCLASSIFIED_CLASSIFICATION: ArchetypeClassification = {
  archetypeVersion: '0.1',
  tableVersion: '0.1',
  id: 'arch_fixture-unclaimed-route',
  manifestId: 'pkg_fixture-b03-catalog',
  manifestVersion: '1.0.0',
  matches: [],
  outcome: 'unclassified',
  classifiedAt: '2026-10-02T22:30:00Z',
  reasons: [
    "capabilities entry 'route' is unclaimed — no v0.1 archetype rule's evidence includes it",
  ],
};

// ---- the request fixtures + builders ------------------------------------------------

/** The well-formed request fixture (linux, the two-match classification, the standard tier). */
export const VALID_REQUEST: TargetRequest = {
  platform: 'linux',
  classification: TWO_MATCH_CLASSIFICATION,
  budgetTier: 'standard',
};

/** The per-test override spec for the request builder. */
export interface RequestSpec {
  platform?: string;
  classification?: TargetRequest['classification'];
  budgetTier?: string;
}

/** An overridable well-formed request (defaults to the VALID_REQUEST fixture). */
export function targetRequest(spec: RequestSpec = {}): TargetRequest {
  return { ...VALID_REQUEST, ...spec };
}

/** Overriding builder: the valid fixture with contract-violating DATA injected on purpose. */
export function malformedRequest(patch: Record<string, unknown>): unknown {
  return { ...VALID_REQUEST, ...patch };
}
