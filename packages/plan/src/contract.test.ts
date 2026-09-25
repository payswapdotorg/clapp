/**
 * CLAPP-030 test battery — the canonical contract file + id minters.
 *
 * Pins that the byte-identical contract declaration is live (PLAN_VERSION,
 * exported types usable), that every declared id prefix mints
 * pattern-conforming ids, and that the three literal plans validate with
 * ZERO detailed errors (the validator's happy path, independent of the
 * planner).
 */

import { describe, expect, it } from 'bun:test';
import {
  ACCEPTANCE_ID_PATTERN,
  API_ENDPOINT_ID_PATTERN,
  ELEMENT_ID_PATTERN,
  FORM_ID_PATTERN,
  MOCK_ID_PATTERN,
  NAV_ID_PATTERN,
  PAGE_ID_PATTERN,
  PLAN_ID_PREFIXES,
  PLAN_VERSION,
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
  validateSynthesisPlan,
  validateSynthesisPlanDetailed,
} from './index';
import { LITERAL_PLANS, LITERAL_PLAN_FULL, LITERAL_PLAN_MEDIUM, LITERAL_PLAN_MINIMAL } from './test-utils';

describe('synthesis-contract v0.1', () => {
  it('declares PLAN_VERSION 0.1', () => {
    expect(PLAN_VERSION).toBe('0.1');
  });

  it('the three literal plans validate with ZERO detailed errors', () => {
    expect(LITERAL_PLANS).toHaveLength(3);
    for (const plan of LITERAL_PLANS) {
      const result = validateSynthesisPlanDetailed(plan);
      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
      expect(validateSynthesisPlan(plan)).toBe(true);
    }
  });

  it('the literal plans are pairwise distinct (coverage, not triple-checking one shape)', () => {
    const shapes = [
      LITERAL_PLAN_MINIMAL,
      LITERAL_PLAN_MEDIUM,
      LITERAL_PLAN_FULL,
    ].map((plan) => ({
      routes: plan.routes.length,
      pages: plan.pages.length,
      elements: plan.pages.reduce((sum, page) => sum + page.elements.length, 0),
      forms: plan.pages.reduce((sum, page) => sum + page.forms.length, 0),
      navigation: plan.navigation.length,
      storage: plan.storage.length,
      endpoints: plan.api.endpoints.length,
      mocks: plan.api.mocks.length,
      acceptance: plan.acceptance.length,
    }));
    expect(new Set(shapes.map((shape) => JSON.stringify(shape))).size).toBe(3);
  });
});

describe('plan id minters', () => {
  const minters = [
    ['appsyn_', newPlannedApplicationId, PLANNED_APPLICATION_ID_PATTERN],
    ['route_', newRouteId, ROUTE_ID_PATTERN],
    ['page_', newPageId, PAGE_ID_PATTERN],
    ['el_', newElementId, ELEMENT_ID_PATTERN],
    ['form_', newFormId, FORM_ID_PATTERN],
    ['nav_', newNavId, NAV_ID_PATTERN],
    ['store_', newStorageBindingId, STORAGE_BINDING_ID_PATTERN],
    ['api_', newApiEndpointId, API_ENDPOINT_ID_PATTERN],
    ['mock_', newMockId, MOCK_ID_PATTERN],
    ['acc_', newAcceptanceId, ACCEPTANCE_ID_PATTERN],
  ] as const;

  it('every minter mints a pattern-conforming, pairwise-distinct id', () => {
    const seen = new Set<string>();
    for (const [prefix, mint, pattern] of minters) {
      const id = mint();
      expect(id.startsWith(prefix)).toBe(true);
      expect(pattern.test(id)).toBe(true);
      expect(UUID_SHAPE_RE.test(id.slice(prefix.length))).toBe(true);
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
  });

  it('mintPlanId and planIdPatternFor cover every declared prefix', () => {
    for (const prefix of Object.values(PLAN_ID_PREFIXES)) {
      const pattern = planIdPatternFor(prefix);
      expect(pattern).toBeDefined();
      expect(pattern?.test(mintPlanId(prefix))).toBe(true);
    }
    expect(planIdPatternFor('bogus_')).toBeUndefined();
  });

  it('patterns accept any uuid-shaped hex (version/variant bits not pinned, case-insensitive)', () => {
    expect(ROUTE_ID_PATTERN.test('route_ABCDEF01-ABCD-4ABC-8ABC-ABCDEF012345')).toBe(true);
    expect(ROUTE_ID_PATTERN.test('route_not-a-uuid')).toBe(false);
    expect(ROUTE_ID_PATTERN.test('routE_11111111-1111-4111-8111-111111111111')).toBe(true);
  });
});
