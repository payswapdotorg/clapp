/**
 * CLAPP-012 test battery — validateJourney structural validation.
 *
 * Covers: valid minimal/full journeys; every malformed shape for Journey,
 * JourneyAction and TargetSelector; precise path-qualified messages; the
 * type-predicate contract.
 */

import { describe, expect, it } from 'bun:test';
import type { Journey, JourneyAction } from './journey-contract';
import {
  JOURNEY_ID_PATTERN,
  validateJourney,
  validateJourneyAction,
  validateJourneyDetailed,
  validateTargetSelector,
} from './validate';

function validJourney(overrides: Partial<Journey> = {}): Journey {
  return {
    id: 'journey_00000000-0000-4000-8000-000000000000',
    name: 'fixture journey',
    targetId: 'bench/b01-static',
    actions: [
      { type: 'navigate', url: '/' },
      { type: 'click', target: { testId: 'nav-home' } },
    ],
    ...overrides,
  };
}

describe('validateJourney — valid input', () => {
  it('accepts a fully-populated journey', () => {
    expect(validateJourney(validJourney())).toBe(true);
  });

  it('accepts a journey with zero actions (structurally valid)', () => {
    expect(validateJourney(validJourney({ actions: [] }))).toBe(true);
  });

  it('accepts an empty TargetSelector (all fields optional per contract)', () => {
    const journey = validJourney({
      actions: [{ type: 'assert-visible', target: {} }],
    });
    expect(validateJourney(journey)).toBe(true);
  });

  it('accepts every action type with well-formed fields', () => {
    const actions: JourneyAction[] = [
      { type: 'navigate', url: 'https://example.invalid/' },
      { type: 'click', target: { role: 'link', name: 'Docs' } },
      { type: 'fill', target: { testId: 'email' }, value: '' },
      { type: 'press', key: 'Enter' },
      { type: 'wait', ms: 0 },
      { type: 'assert-visible', target: { role: 'heading', nth: 2 } },
    ];
    expect(validateJourney(validJourney({ actions }))).toBe(true);
  });

  it('accepts extra properties (forward compatibility)', () => {
    const journey = {
      ...validJourney(),
      extraTopLevel: true,
      actions: [{ type: 'wait', ms: 1, note: 'extension field' }],
    };
    expect(validateJourney(journey)).toBe(true);
  });

  it('narrows unknown input to Journey (predicate contract)', () => {
    const unknown: unknown = validJourney();
    if (validateJourney(unknown)) {
      expect(unknown.actions[0]?.type).toBe('navigate');
    } else {
      throw new Error('predicate returned false for a valid journey');
    }
  });
});

describe('validateJourney — malformed top level', () => {
  const cases: Array<[unknown, string]> = [
    [null, 'journey: expected a non-null object, got null'],
    [undefined, 'journey: expected a non-null object, got undefined'],
    [42, 'journey: expected a non-null object, got number'],
    ['journey', 'journey: expected a non-null object, got string'],
    [[], 'journey: expected a non-null object, got array'],
  ];

  for (const [input, message] of cases) {
    it(`rejects ${message.split(', ')[1]} with a precise message`, () => {
      const result = validateJourneyDetailed(input);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toBe(message);
      expect(validateJourney(input)).toBe(false);
    });
  }

  it('rejects a missing id', () => {
    const journey = validJourney();
    delete (journey as { id?: string }).id;
    const result = validateJourneyDetailed(journey);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('id: expected a string, got undefined');
  });

  it('rejects a non-string id', () => {
    const result = validateJourneyDetailed(validJourney({ id: 123 as unknown as string }));
    expect(result.errors).toContain('id: expected a string, got number');
  });

  it('rejects an id without the journey_ prefix', () => {
    const result = validateJourneyDetailed(validJourney({ id: 'run_00000000-0000-4000-8000-000000000000' }));
    expect(result.errors[0]).toMatch(/^id: expected "journey_" \+ uuid/);
  });

  it('rejects a journey_ id that is not uuid-shaped', () => {
    const result = validateJourneyDetailed(validJourney({ id: 'journey_not-a-uuid' }));
    expect(result.errors[0]).toMatch(/^id: expected "journey_" \+ uuid/);
  });

  it('exposes the id pattern for external checks', () => {
    expect(JOURNEY_ID_PATTERN.test('journey_3f2504e0-4f89-41d3-9a0c-0305e82c3301')).toBe(true);
    expect(JOURNEY_ID_PATTERN.test('journey_3F2504E0-4F89-41D3-9A0C-0305E82C3301')).toBe(true);
    expect(JOURNEY_ID_PATTERN.test('art_3f2504e0-4f89-41d3-9a0c-0305e82c3301')).toBe(false);
  });

  it('rejects an empty name and empty targetId', () => {
    const result = validateJourneyDetailed(validJourney({ name: '  ', targetId: '' }));
    expect(result.errors).toContain('name: expected a non-empty string, got "  "');
    expect(result.errors).toContain('targetId: expected a non-empty string, got ""');
  });

  it('rejects non-array actions', () => {
    const result = validateJourneyDetailed(validJourney({ actions: 'nope' as unknown as JourneyAction[] }));
    expect(result.errors).toContain('actions: expected an array, got string');
  });
});

describe('validateJourney — malformed actions', () => {
  function errorsFor(actions: unknown[]): string[] {
    return validateJourneyDetailed(validJourney({ actions: actions as JourneyAction[] })).errors;
  }

  it('rejects a non-object action with its index', () => {
    expect(errorsFor([null])).toContain('actions[0]: expected a non-null object, got null');
  });

  it('rejects an unknown action type and stops checking that action', () => {
    const errors = errorsFor([{ type: 'scroll', target: {} }]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBe(
      "actions[0].type: expected one of navigate | click | fill | press | wait | assert-visible, got \"scroll\"",
    );
  });

  it('rejects a missing action type', () => {
    expect(errorsFor([{}])[0]).toMatch(/^actions\[0\].type: expected one of /);
  });

  it('rejects navigate without url and with an empty url', () => {
    expect(errorsFor([{ type: 'navigate' }])).toContain('actions[0].url: expected a string, got undefined');
    expect(errorsFor([{ type: 'navigate', url: ' ' }])).toContain('actions[0].url: expected a non-empty string, got " "');
  });

  it('rejects navigate with a non-string url', () => {
    expect(errorsFor([{ type: 'navigate', url: 1 }])).toContain('actions[0].url: expected a string, got number');
  });

  it('rejects click without target', () => {
    expect(errorsFor([{ type: 'click' }])).toContain('actions[0].target: expected a non-null object, got undefined');
  });

  it('rejects click with an array target', () => {
    expect(errorsFor([{ type: 'click', target: [] }])).toContain('actions[0].target: expected a non-null object, got array');
  });

  it('rejects fill with a non-string value (empty value is valid)', () => {
    expect(errorsFor([{ type: 'fill', target: { testId: 'x' }, value: 5 }])).toContain(
      'actions[0].value: expected a string, got number',
    );
    expect(errorsFor([{ type: 'fill', target: { testId: 'x' }, value: '' }])).toHaveLength(0);
  });

  it('rejects press without key and with an empty key', () => {
    expect(errorsFor([{ type: 'press' }])).toContain('actions[0].key: expected a string, got undefined');
    expect(errorsFor([{ type: 'press', key: '' }])).toContain('actions[0].key: expected a non-empty string, got ""');
  });

  it('rejects wait with negative, fractional, and non-number ms', () => {
    expect(errorsFor([{ type: 'wait', ms: -1 }])).toContain(
      'actions[0].ms: expected a non-negative integer, got -1',
    );
    expect(errorsFor([{ type: 'wait', ms: 1.5 }])).toContain(
      'actions[0].ms: expected a non-negative integer, got 1.5',
    );
    expect(errorsFor([{ type: 'wait', ms: 'soon' }])).toContain(
      'actions[0].ms: expected a number, got string',
    );
  });

  it('rejects assert-visible without target', () => {
    expect(errorsFor([{ type: 'assert-visible' }])).toContain(
      'actions[0].target: expected a non-null object, got undefined',
    );
  });

  it('accumulates errors across multiple actions with indices', () => {
    const errors = errorsFor([{ type: 'wait', ms: -5 }, { type: 'wait', ms: -6 }]);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain('actions[0].ms');
    expect(errors[1]).toContain('actions[1].ms');
  });
});

describe('validateTargetSelector — malformed selectors', () => {
  it('rejects non-string role/name/testId with field-qualified messages', () => {
    const errors = validateTargetSelector({ role: 7, name: [], testId: {} });
    expect(errors).toContain('role: expected a string, got number');
    expect(errors).toContain('name: expected a string, got array');
    expect(errors).toContain('testId: expected a string, got object');
  });

  it('rejects a negative and fractional nth', () => {
    expect(validateTargetSelector({ nth: -1 })).toContain(
      'nth: expected a non-negative integer, got -1',
    );
    expect(validateTargetSelector({ nth: 0.5 })).toContain(
      'nth: expected a non-negative integer, got 0.5',
    );
  });

  it('rejects a non-number nth', () => {
    expect(validateTargetSelector({ nth: 'first' })).toContain('nth: expected a number, got string');
  });

  it('accepts nth 0 and undefined optional fields', () => {
    expect(validateTargetSelector({ nth: 0 })).toHaveLength(0);
    expect(validateTargetSelector({ role: 'link' })).toHaveLength(0);
  });
});

describe('validateJourneyAction — direct predicate use', () => {
  it('reports errors relative to the action itself', () => {
    const errors = validateJourneyAction({ type: 'wait', ms: -3 });
    expect(errors).toEqual(['ms: expected a non-negative integer, got -3']);
  });

  it('qualifies target errors with the target. prefix', () => {
    const errors = validateJourneyAction({ type: 'click', target: { nth: -2 } });
    expect(errors).toEqual(['target.nth: expected a non-negative integer, got -2']);
  });
});
