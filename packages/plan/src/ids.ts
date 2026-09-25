/**
 * @clapp/plan — identifier helpers for the Synthesis Plan contract v0.1.
 *
 * Every planned-element id is a prefixed uuid v4 string so plans are
 * self-describing at a glance, mirroring the id discipline of @clapp/core
 * (run/artifact/evidence), @clapp/journey (journey records), and @clapp/ir
 * (the Behavioral IR this package plans from):
 *
 *   appsyn_ (planned application)   route_ / page_ / el_ / form_
 *   nav_ (planned transition)        store_ (storage binding)
 *   api_ / mock_ / acc_
 *
 * Honest scope notes (same discipline as @clapp/ir's ids.ts):
 * - The uuid version/variant bits are NOT pinned by the patterns (any
 *   uuid-shaped hex is accepted, case-insensitive), matching the
 *   JOURNEY_ID_PATTERN precedent from @clapp/journey — ids minted by other
 *   v0.1 tools remain valid. `mintPlanId` always mints true uuid v4 via
 *   `crypto.randomUUID()`.
 * - There is deliberately NO `newJourneyId` here: journey ids are owned by
 *   @clapp/journey. The plan ACCEPTS journey ids (acceptance entries locate
 *   journey records BY id); it never mints them.
 */

/** uuid v4 shape (8-4-4-4-12 hex) without pinning version/variant bits. */
export const UUID_SHAPE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `"appsyn_" + uuid` — PlannedApplication.id. */
export const PLANNED_APPLICATION_ID_PATTERN = /^appsyn_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `"route_" + uuid` — PlannedRoute.id. */
export const ROUTE_ID_PATTERN = /^route_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `"page_" + uuid` — PlannedPage.id. */
export const PAGE_ID_PATTERN = /^page_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `"el_" + uuid` — PlannedElement.id. */
export const ELEMENT_ID_PATTERN = /^el_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `"form_" + uuid` — PlannedForm.id. */
export const FORM_ID_PATTERN = /^form_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `"nav_" + uuid` — PlannedTransition.id. */
export const NAV_ID_PATTERN = /^nav_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `"store_" + uuid` — PlannedStorageBinding.id. */
export const STORAGE_BINDING_ID_PATTERN = /^store_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `"api_" + uuid` — PlannedApiEndpoint.id. */
export const API_ENDPOINT_ID_PATTERN = /^api_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `"mock_" + uuid` — MockResponse.id. */
export const MOCK_ID_PATTERN = /^mock_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `"acc_" + uuid` — PlannedAcceptance.id. */
export const ACCEPTANCE_ID_PATTERN = /^acc_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** All declared plan id prefixes, keyed by planned-element kind. */
export const PLAN_ID_PREFIXES = {
  plannedApplication: 'appsyn_',
  route: 'route_',
  page: 'page_',
  element: 'el_',
  form: 'form_',
  navigation: 'nav_',
  storageBinding: 'store_',
  apiEndpoint: 'api_',
  mock: 'mock_',
  acceptance: 'acc_',
} as const;

/** The pattern for a given declared prefix (undefined for unknown prefixes). */
export function planIdPatternFor(prefix: string): RegExp | undefined {
  switch (prefix) {
    case PLAN_ID_PREFIXES.plannedApplication: return PLANNED_APPLICATION_ID_PATTERN;
    case PLAN_ID_PREFIXES.route: return ROUTE_ID_PATTERN;
    case PLAN_ID_PREFIXES.page: return PAGE_ID_PATTERN;
    case PLAN_ID_PREFIXES.element: return ELEMENT_ID_PATTERN;
    case PLAN_ID_PREFIXES.form: return FORM_ID_PATTERN;
    case PLAN_ID_PREFIXES.navigation: return NAV_ID_PATTERN;
    case PLAN_ID_PREFIXES.storageBinding: return STORAGE_BINDING_ID_PATTERN;
    case PLAN_ID_PREFIXES.apiEndpoint: return API_ENDPOINT_ID_PATTERN;
    case PLAN_ID_PREFIXES.mock: return MOCK_ID_PATTERN;
    case PLAN_ID_PREFIXES.acceptance: return ACCEPTANCE_ID_PATTERN;
    default: return undefined;
  }
}

/** Fresh prefixed uuid v4 id (internal workhorse for the minters below). */
export function mintPlanId(prefix: string): string {
  return `${prefix}${crypto.randomUUID()}`;
}

/** Fresh `PlannedApplication['id']`: `"appsyn_" + uuid v4`. */
export function newPlannedApplicationId(): string {
  return mintPlanId(PLAN_ID_PREFIXES.plannedApplication);
}

/** Fresh `PlannedRoute['id']`: `"route_" + uuid v4`. */
export function newRouteId(): string {
  return mintPlanId(PLAN_ID_PREFIXES.route);
}

/** Fresh `PlannedPage['id']`: `"page_" + uuid v4`. */
export function newPageId(): string {
  return mintPlanId(PLAN_ID_PREFIXES.page);
}

/** Fresh `PlannedElement['id']`: `"el_" + uuid v4`. */
export function newElementId(): string {
  return mintPlanId(PLAN_ID_PREFIXES.element);
}

/** Fresh `PlannedForm['id']`: `"form_" + uuid v4`. */
export function newFormId(): string {
  return mintPlanId(PLAN_ID_PREFIXES.form);
}

/** Fresh `PlannedTransition['id']`: `"nav_" + uuid v4`. */
export function newNavId(): string {
  return mintPlanId(PLAN_ID_PREFIXES.navigation);
}

/** Fresh `PlannedStorageBinding['id']`: `"store_" + uuid v4`. */
export function newStorageBindingId(): string {
  return mintPlanId(PLAN_ID_PREFIXES.storageBinding);
}

/** Fresh `PlannedApiEndpoint['id']`: `"api_" + uuid v4`. */
export function newApiEndpointId(): string {
  return mintPlanId(PLAN_ID_PREFIXES.apiEndpoint);
}

/** Fresh `MockResponse['id']`: `"mock_" + uuid v4`. */
export function newMockId(): string {
  return mintPlanId(PLAN_ID_PREFIXES.mock);
}

/** Fresh `PlannedAcceptance['id']`: `"acc_" + uuid v4`. */
export function newAcceptanceId(): string {
  return mintPlanId(PLAN_ID_PREFIXES.acceptance);
}
