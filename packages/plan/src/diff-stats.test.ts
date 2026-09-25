/**
 * CLAPP-030 test battery — plan diff + plan stats (the reporting surfaces).
 *
 * diffSynthesisPlans: id-stable section diff — added/removed/changed keyed by
 * id, section reordering is not a change, whole-value sections, string-set
 * sections. planStats: section counts + breakdowns + evidence totals.
 */

import { describe, expect, it } from 'bun:test';
import { PLAN_DIFF_SECTIONS, diffSynthesisPlans, planStats, planSynthesis } from './index';
import {
  LITERAL_PLAN_FULL,
  LITERAL_PLAN_MEDIUM,
  LITERAL_PLAN_MINIMAL,
  MATCHED_JOURNEY,
  UNMATCHED_JOURNEY,
  buildShopModel,
  clonePlan,
} from './test-utils';

describe('diffSynthesisPlans', () => {
  it('a plan diffs identical to itself', () => {
    const diff = diffSynthesisPlans(LITERAL_PLAN_MEDIUM, LITERAL_PLAN_MEDIUM);
    expect(diff.identical).toBe(true);
    for (const section of diff.sections) {
      expect(section.added).toEqual([]);
      expect(section.removed).toEqual([]);
      expect(section.changed).toEqual([]);
    }
  });

  it('reports the fixed section order', () => {
    const diff = diffSynthesisPlans(LITERAL_PLAN_MINIMAL, LITERAL_PLAN_MINIMAL);
    expect(diff.sections.map((section) => section.section)).toEqual([...PLAN_DIFF_SECTIONS]);
  });

  it('adding/removing a route lands in routes.added / routes.removed (direction: a → b)', () => {
    const withRoute = clonePlan(LITERAL_PLAN_MEDIUM);
    const withoutRoute = clonePlan(LITERAL_PLAN_MEDIUM);
    withoutRoute.routes = withoutRoute.routes.slice(0, 1);
    withoutRoute.pages = withoutRoute.pages.slice(0, 1);
    const diff = diffSynthesisPlans(withoutRoute, withRoute);
    const routes = diff.sections.find((section) => section.section === 'routes')!;
    const extraRoute = withRoute.routes[1]!;
    expect(routes.added).toEqual([extraRoute.id]); // present only in b
    expect(routes.removed).toEqual([]);
    const reverse = diffSynthesisPlans(withRoute, withoutRoute);
    const reverseRoutes = reverse.sections.find((section) => section.section === 'routes')!;
    expect(reverseRoutes.removed).toEqual([extraRoute.id]); // present only in a
    expect(diff.identical).toBe(false);
  });

  it('changing an element lands in elements.changed keyed by its id', () => {
    const changed = clonePlan(LITERAL_PLAN_MEDIUM);
    changed.pages[0]!.elements[0]!.text = 'Shop home (edited)';
    const diff = diffSynthesisPlans(LITERAL_PLAN_MEDIUM, changed);
    const elements = diff.sections.find((section) => section.section === 'elements')!;
    expect(elements.changed).toEqual([LITERAL_PLAN_MEDIUM.pages[0]!.elements[0]!.id]);
  });

  it('reordering a section array is NOT a change (id-keyed)', () => {
    const reordered = clonePlan(LITERAL_PLAN_MEDIUM);
    reordered.routes = [...reordered.routes].reverse();
    reordered.pages = [...reordered.pages].reverse();
    expect(diffSynthesisPlans(LITERAL_PLAN_MEDIUM, reordered).identical).toBe(true);
  });

  it('whole-value sections (planVersion/application/server) and string sets (assumptions/constraints) diff by value', () => {
    const changed = clonePlan(LITERAL_PLAN_FULL);
    changed.application.name = 'Api (renamed)';
    changed.assumptions = [...changed.assumptions, 'one more honest note'];
    const diff = diffSynthesisPlans(LITERAL_PLAN_FULL, changed);
    expect(diff.sections.find((section) => section.section === 'application')!.changed).toEqual(['application']);
    expect(diff.sections.find((section) => section.section === 'assumptions')!.added).toEqual(['one more honest note']);
    expect(diff.sections.find((section) => section.section === 'planVersion')!.unchangedCount).toBe(1);
  });

  it('differing plans built from the same model (with/without journeys) diff in acceptance only + assumptions', () => {
    // per-kind deterministic ids so the two plans share every minted id for
    // their shared sections — only acceptance ids (absent in the without-plan)
    // and the assumptions list may differ.
    const makeIdFactory = () => {
      const counters: Record<string, number> = {};
      return (kind: string): string => {
        counters[kind] = (counters[kind] ?? 0) + 1;
        const prefix =
          kind === 'application' ? 'appsyn'
          : kind === 'storageBinding' ? 'store'
          : kind === 'apiEndpoint' ? 'api'
          : kind === 'navigation' ? 'nav'
          : kind === 'element' ? 'el'
          : kind === 'acceptance' ? 'acc'
          : kind; // route, page, form, mock
        return `${prefix}_11111111-1111-4111-8111-${(counters[kind] ?? 0).toString(16).padStart(12, '0')}`;
      };
    };
    const fixture = buildShopModel();
    const withJourneys = planSynthesis(fixture.model, {
      journeys: [MATCHED_JOURNEY, UNMATCHED_JOURNEY],
      idFactory: makeIdFactory(),
    });
    const without = planSynthesis(fixture.model, { idFactory: makeIdFactory() });
    const diff = diffSynthesisPlans(without, withJourneys);
    expect(diff.identical).toBe(false);
    const acceptance = diff.sections.find((section) => section.section === 'acceptance')!;
    expect(acceptance.added).toHaveLength(2);
    expect(acceptance.removed).toHaveLength(0);
    for (const section of diff.sections) {
      if (section.section !== 'acceptance' && section.section !== 'assumptions') {
        expect(section.added).toEqual([]);
        expect(section.removed).toEqual([]);
        expect(section.changed).toEqual([]);
      }
    }
  });
});

describe('planStats', () => {
  const fixture = buildShopModel();
  const plan = planSynthesis(fixture.model, { journeys: [MATCHED_JOURNEY, UNMATCHED_JOURNEY] });

  it('counts every section of the shop-model plan', () => {
    const stats = planStats(plan);
    expect(stats.planVersion).toBe('0.1');
    expect(stats.routes).toBe(4);
    expect(stats.pages).toBe(4);
    expect(stats.elements).toBe(16);
    expect(stats.forms).toBe(1);
    expect(stats.fields).toBe(2);
    expect(stats.transitions).toBe(5);
    expect(stats.storageBindings).toBe(2);
    expect(stats.endpoints).toBe(2);
    expect(stats.mocks).toBe(1);
    expect(stats.acceptance).toBe(2);
    expect(stats.assumptions).toBe(plan.assumptions.length);
    expect(stats.constraints).toBe(1);
  });

  it('elementsByKind is total over the closed vocabulary (zeros included)', () => {
    const stats = planStats(plan);
    // '/': heading×1, link×1, form×1, other×3 (textboxes), button×1
    // '/products': heading×2, image×1, list×1, other×2 (textbox+combobox), link×3
    expect(stats.elementsByKind).toEqual({
      button: 1,
      form: 1,
      heading: 3,
      image: 1,
      link: 4,
      list: 1,
      navigation: 0,
      other: 5,
      text: 0,
    });
    expect(
      Object.values(stats.elementsByKind).reduce((sum, count) => sum + count, 0),
    ).toBe(stats.elements);
  });

  it('provenanceByLevel totals every provenance block', () => {
    const stats = planStats(plan);
    const blocks =
      plan.routes.length +
      plan.pages.length +
      plan.pages.reduce((sum, page) => sum + page.elements.length + page.forms.length, 0) +
      plan.navigation.length +
      plan.storage.length +
      plan.api.endpoints.length +
      plan.acceptance.length;
    expect(
      Object.values(stats.provenanceByLevel).reduce((sum, count) => sum + count, 0),
    ).toBe(blocks);
    expect(stats.provenanceByLevel.planned).toBe(0); // every block in this plan is derived/assumed
    expect(stats.provenanceByLevel.assumed).toBe(3); // the three redirect transitions
  });

  it('evidence-ref totals: citations >= unique ids, both > 0', () => {
    const stats = planStats(plan);
    expect(stats.evidenceRefCitations).toBeGreaterThan(0);
    expect(stats.uniqueEvidenceRefs).toBeGreaterThan(0);
    expect(stats.evidenceRefCitations).toBeGreaterThanOrEqual(stats.uniqueEvidenceRefs);
  });

  it('counts the minimal literal plan as all zeros (defensive, never throws)', () => {
    const stats = planStats(LITERAL_PLAN_MINIMAL);
    expect(stats.routes).toBe(0);
    expect(stats.elements).toBe(0);
    expect(stats.acceptance).toBe(0);
    expect(stats.provenanceByLevel).toEqual({ derived: 0, planned: 0, assumed: 0 });
  });
});
