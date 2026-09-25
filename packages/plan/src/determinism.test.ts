/**
 * CLAPP-030 test battery — planner determinism.
 *
 * planSynthesis(sameModel) twice yields structure-identical plans: the same
 * routes/paths/element testIds/kinds/labels/assumptions, differing only in
 * minted ids. Pinned by normalizing every minted id (by first-appearance
 * order) in the canonical serializations and comparing byte-for-byte. The
 * idFactory override path is pinned exactly: same factory → identical bytes.
 */

import { describe, expect, it } from 'bun:test';
import { planSynthesis, serializeSynthesisPlan } from './index';
import { MATCHED_JOURNEY, UNMATCHED_JOURNEY, buildShopModel } from './test-utils';

/** Replace every minted plan id with a first-appearance placeholder. */
function normalizeIds(text: string): string {
  const seen = new Map<string, string>();
  return text.replace(
    /\b(?:appsyn|route|page|el|form|nav|store|api|mock|acc)_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    (match) => {
      let replacement = seen.get(match);
      if (replacement === undefined) {
        replacement = `<id-${seen.size}>`;
        seen.set(match, replacement);
      }
      return replacement;
    },
  );
}

describe('planSynthesis — determinism', () => {
  const fixture = buildShopModel();
  const journeys = [MATCHED_JOURNEY, UNMATCHED_JOURNEY];

  it('planning the same model twice yields structure-identical plans (ids differ)', () => {
    const first = planSynthesis(fixture.model, { journeys });
    const second = planSynthesis(fixture.model, { journeys });
    const textFirst = serializeSynthesisPlan(first);
    const textSecond = serializeSynthesisPlan(second);
    expect(textFirst).not.toBe(textSecond); // minted ids really do differ
    expect(normalizeIds(textFirst)).toBe(normalizeIds(textSecond)); // structure is identical
  });

  it('same structure without journeys, twice', () => {
    const first = planSynthesis(fixture.model);
    const second = planSynthesis(fixture.model);
    expect(
      normalizeIds(serializeSynthesisPlan(first)),
    ).toBe(normalizeIds(serializeSynthesisPlan(second)));
  });

  it('a deterministic idFactory yields BYTE-IDENTICAL plans', () => {
    const factoryFor = (state: { value: number }) => (kind: string): string => {
      state.value += 1;
      const hex = state.value.toString(16).padStart(12, '0');
      const prefix =
        kind === 'application' ? 'appsyn'
        : kind === 'storageBinding' ? 'store'
        : kind === 'apiEndpoint' ? 'api'
        : kind === 'navigation' ? 'nav'
        : kind === 'element' ? 'el'
        : kind === 'acceptance' ? 'acc'
        : kind; // route, page, form, mock
      return `${prefix}_11111111-1111-4111-8111-${hex}`;
    };
    const counterA = { value: 0 };
    const counterB = { value: 0 };
    const a = planSynthesis(fixture.model, { journeys, idFactory: factoryFor(counterA) });
    const b = planSynthesis(fixture.model, { journeys, idFactory: factoryFor(counterB) });
    expect(serializeSynthesisPlan(a)).toBe(serializeSynthesisPlan(b));
    expect(counterA.value).toBeGreaterThan(0);
    expect(counterB.value).toBe(counterA.value);
  });
});
