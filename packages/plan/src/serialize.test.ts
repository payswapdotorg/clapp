/**
 * CLAPP-030 test battery — canonical serialization.
 *
 * Byte-stable round-trips over the three distinct literal plans (and over
 * planner output), parse rejecting malformed JSON and non-conforming plans,
 * and the canonical-form invariants (key-sorted, compact, array order
 * preserved).
 */

import { describe, expect, it } from 'bun:test';
import { PlanSerializationError, parseSynthesisPlan, serializeSynthesisPlan, validateSynthesisPlanDetailed } from './index';
import { LITERAL_PLANS, LITERAL_PLAN_FULL, LITERAL_PLAN_MEDIUM, LITERAL_PLAN_MINIMAL, buildShopModel, clonePlan, MATCHED_JOURNEY } from './test-utils';
import { planSynthesis } from './plan';

describe('serializeSynthesisPlan — byte-stable round-trips', () => {
  it('round-trips each of the 3 distinct literal plans byte-stably', () => {
    expect(LITERAL_PLANS).toHaveLength(3);
    for (const plan of LITERAL_PLANS) {
      const text = serializeSynthesisPlan(plan);
      expect(typeof text).toBe('string');
      const parsed = parseSynthesisPlan(text);
      const text2 = serializeSynthesisPlan(parsed);
      expect(text2).toBe(text); // serialize(parse(serialize(p))) === serialize(p)
      expect(validateSynthesisPlanDetailed(parsed).valid).toBe(true);
    }
  });

  it('round-trips planner output byte-stably', () => {
    const fixture = buildShopModel();
    const plan = planSynthesis(fixture.model, { journeys: [MATCHED_JOURNEY] });
    const text = serializeSynthesisPlan(plan);
    const text2 = serializeSynthesisPlan(parseSynthesisPlan(text));
    expect(text2).toBe(text);
  });

  it('canonical form: key-sorted, compact, no insignificant whitespace', () => {
    const text = serializeSynthesisPlan(LITERAL_PLAN_MINIMAL);
    // strip string literals first — their CONTENTS may legitimately contain
    // whitespace (assumption sentences); the JSON STRUCTURE may not.
    const structure = text.replace(/"(?:[^"\\]|\\.)*"/g, '""');
    expect(structure).not.toMatch(/\s/); // compact
    expect(structure).not.toContain('\n');
    // application keys sorted: entrypoints, id, name, platform, sourceModelId
    const applicationStart = text.indexOf('"application":{');
    expect(applicationStart).toBeGreaterThanOrEqual(0);
    const slice = text.slice(applicationStart, applicationStart + 400);
    const keyPositions = ['"entrypoints"', '"id"', '"name"', '"platform"', '"sourceModelId"'].map(
      (key) => slice.indexOf(key),
    );
    expect(keyPositions.every((position) => position >= 0)).toBe(true);
    expect([...keyPositions].sort((a, b) => a - b)).toEqual(keyPositions);
  });

  it('array order inside elements is preserved (order is semantic)', () => {
    const text = serializeSynthesisPlan(LITERAL_PLAN_MEDIUM);
    const firstElement = text.indexOf('"kind":"heading"');
    const laterElement = text.indexOf('"kind":"other"');
    expect(firstElement).toBeGreaterThan(0);
    expect(laterElement).toBeGreaterThan(firstElement); // document order kept
  });

  it('a clone with reshuffled insertion order serializes identically (value-determined)', () => {
    const reordered = clonePlan(LITERAL_PLAN_FULL);
    // rebuild one page with keys inserted in a different order
    const page = reordered.pages[0]!;
    reordered.pages[0] = {
      elements: page.elements,
      forms: page.forms,
      title: page.title,
      routeId: page.routeId,
      provenance: page.provenance,
      id: page.id,
    };
    expect(serializeSynthesisPlan(reordered)).toBe(serializeSynthesisPlan(LITERAL_PLAN_FULL));
  });
});

describe('parseSynthesisPlan — rejections', () => {
  it('rejects malformed JSON with a single PlanSerializationError', () => {
    expect(() => parseSynthesisPlan('{not json')).toThrow(PlanSerializationError);
    expect(() => parseSynthesisPlan('')).toThrow(PlanSerializationError);
    expect(() => parseSynthesisPlan('null')).toThrow(PlanSerializationError);
    try {
      parseSynthesisPlan('{not json');
    } catch (error) {
      expect((error as PlanSerializationError).message).toContain('not valid JSON');
    }
  });

  it('rejects valid JSON that is not a conforming plan (path-qualified errors joined)', () => {
    try {
      parseSynthesisPlan(JSON.stringify({ planVersion: '0.2', application: null }));
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(PlanSerializationError);
      const message = (error as PlanSerializationError).message;
      expect(message).toContain('plan.planVersion');
      expect(message).toContain('plan.application');
    }
  });

  it('rejects a plan with a null smuggled through JSON', () => {
    const text = JSON.stringify(LITERAL_PLAN_MEDIUM).replace('"title":"Shop home"', '"title":null');
    expect(() => parseSynthesisPlan(text)).toThrow(PlanSerializationError);
  });

  it('refuses to serialize an invalid plan (never a one-way door)', () => {
    const broken = clonePlan(LITERAL_PLAN_MEDIUM);
    broken.routes[0]!.pageId = 'page_99999999-9999-4999-8999-999999999999';
    expect(() => serializeSynthesisPlan(broken)).toThrow(PlanSerializationError);
    try {
      serializeSynthesisPlan(broken);
    } catch (error) {
      expect((error as PlanSerializationError).message).toContain('routes[0].pageId');
    }
  });
});
