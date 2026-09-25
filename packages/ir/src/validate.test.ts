// CLAPP-020 — structural validation: the valid b01 reference model passes
// cleanly, ~45 malformed mutations each produce the RIGHT path-qualified
// error, and both entry points are total (never throw) on garbage,
// including cycles and exotic values.

import { describe, expect, test } from 'bun:test';
import type { IrModel } from './ir-contract';
import { validateIrModel, validateIrModelDetailed } from './validate';
import {
  DOM_HOME,
  DOM_PRICING,
  IDS,
  UNCATALOGED_REF,
  buildReferenceModel,
  fakeSha256,
} from './test-model';

/** Run one mutation of the reference model and assert the exact error. */
function expectMutationError(name: string, mutate: (model: IrModel) => void, expected: string): void {
  test(name, () => {
    const model = buildReferenceModel();
    mutate(model);
    const result = validateIrModelDetailed(model);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(expected);
    expect(validateIrModel(model)).toBe(false);
  });
}

const NULL_MSG = (path: string): string =>
  `${path}: null is not a valid IR value — omit the field instead (absent, never null)`;

describe('validateIrModelDetailed — the reference model is valid', () => {
  test('b01 reference model passes with zero errors', () => {
    const result = validateIrModelDetailed(buildReferenceModel());
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  test('validateIrModel narrows the reference model', () => {
    const model: unknown = buildReferenceModel();
    expect(validateIrModel(model)).toBe(true);
  });
});

describe('validateIrModelDetailed — model header', () => {
  expectMutationError('wrong modelVersion', (m) => { m.modelVersion = '9.9'; },
    'modelVersion: expected "0.1", got "9.9"');
  expectMutationError('null modelVersion', (m) => { m.modelVersion = null as unknown as string; },
    'modelVersion: null is not a valid IR value — omit the field instead (absent, never null)');

  test('null model root', () => {
    const result = validateIrModelDetailed(null);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(['model: expected a non-null object, got null']);
    expect(validateIrModel(null)).toBe(false);
  });

  test('array model root', () => {
    expect(validateIrModelDetailed([1, 2]).errors).toContain('model: expected a non-null object, got array');
  });
});

describe('validateIrModelDetailed — application / environment', () => {
  expectMutationError('application.id with wrong prefix', (m) => { m.application.id = 'scr_123'; },
    'application.id: expected a "app_"-prefixed uuid v4 string ("app_" + 8-4-4-4-12 hex), got "scr_123"');
  expectMutationError('application.name empty', (m) => { m.application.name = ''; },
    'application.name: expected a non-empty string, got ""');
  expectMutationError('application.entrypoints with a number entry', (m) => { m.application.entrypoints = [42] as unknown as string[]; },
    'application.entrypoints[0]: expected a string, got number');
  expectMutationError('application.entrypoints null', (m) => { m.application.entrypoints = null as unknown as string[]; },
    'application.entrypoints: null is not a valid IR value — omit the field instead (absent, never null)');
  expectMutationError('environment is an array', (m) => { m.environment = [] as unknown as IrModel['environment']; },
    'environment: expected a non-null object, got array');
  expectMutationError('environment.browser null (absent, never null)', (m) => {
    (m.environment as Record<string, unknown>)['browser'] = null;
  }, NULL_MSG('environment.browser'));
  expectMutationError('environment.viewport.width is a string', (m) => {
    if (m.environment.viewport !== undefined) m.environment.viewport.width = 'wide' as unknown as number;
  }, 'environment.viewport.width: expected a positive integer, got "wide"');
  expectMutationError('environment.viewport.height zero', (m) => {
    if (m.environment.viewport !== undefined) m.environment.viewport.height = 0;
  }, 'environment.viewport.height: expected a positive integer, got 0');
});

describe('validateIrModelDetailed — evidence catalog', () => {
  expectMutationError('evidence id with wrong prefix', (m) => {
    m.evidence[1]!.id = 'irev_bad';
  }, 'evidence[1].id: expected a "irev_"-prefixed uuid v4 string ("irev_" + 8-4-4-4-12 hex), got "irev_bad"');
  expectMutationError('evidence ref evidenceId malformed', (m) => {
    m.evidence[0]!.ref.evidenceId = 'not-an-id';
  }, 'evidence[0].ref.evidenceId: expected an "ev_"-prefixed uuid v4 string ("ev_" + 8-4-4-4-12 hex), got "not-an-id"');
  expectMutationError('evidence ref kind outside the core vocabulary', (m) => {
    m.evidence[0]!.ref.kind = 'vibes' as never;
  }, 'evidence[0].ref.kind: expected one of dom|runtime|network|storage|screenshot|static|user, got "vibes"');
  expectMutationError('evidence ref sha256 not hex', (m) => {
    m.evidence[0]!.ref.sha256 = 'XYZ';
  }, 'evidence[0].ref.sha256: expected 64 lowercase hex characters, got "XYZ"');
  expectMutationError('evidence source empty', (m) => {
    m.evidence[0]!.source = '';
  }, 'evidence[0].source: expected a non-empty string, got ""');
  expectMutationError('duplicate irev id inside the catalog', (m) => {
    m.evidence[1]!.id = m.evidence[0]!.id;
  }, 'evidence[1].id: duplicate id "irev_90000000-0000-4000-8000-000000000001" (also at evidence[0].id)');
  expectMutationError('duplicate catalog evidenceId', (m) => {
    m.evidence[2]!.ref = DOM_HOME;
  }, 'evidence[2].ref.evidenceId: duplicate catalog evidenceId "ev_01000000-0000-4000-8000-000000000001" (also at evidence[0].ref.evidenceId) — catalog each evidence item exactly once so citation is unambiguous');
});

describe('validateIrModelDetailed — journeys', () => {
  expectMutationError('journey id with wrong prefix', (m) => {
    m.journeys[0]!.id = 'trip_123';
  }, 'journeys[0].id: expected a "journey_"-prefixed uuid v4 string ("journey_" + 8-4-4-4-12 hex), got "trip_123"');
  expectMutationError('null step inside a journey', (m) => {
    m.journeys[0]!.steps[0] = null as unknown as string;
  }, NULL_MSG('journeys[0].steps[0]'));
  expectMutationError('journey purpose empty', (m) => {
    m.journeys[0]!.purpose = '';
  }, 'journeys[0].purpose: expected a non-empty string, got ""');
});

describe('validateIrModelDetailed — screens', () => {
  expectMutationError('screen route empty', (m) => {
    m.screens[0]!.route = '';
  }, 'screens[0].route: expected a non-empty string, got ""');
  expectMutationError('duplicate route (one screen per route in v0)', (m) => {
    m.screens[2]!.route = '/';
  }, 'screens[2].route: duplicate route "/" (also at screens[0].route) — one screen per route in v0; merge captures of the same route before building the model');
  expectMutationError('duplicate screen id', (m) => {
    m.screens[1]!.id = m.screens[0]!.id;
  }, `screens[1].id: duplicate id "${IDS.homeScreen}" (also at screens[0].id)`);
  expectMutationError('treeRef null (absent, never null)', (m) => {
    m.screens[0]!.treeRef = null as unknown as never;
  }, NULL_MSG('screens[0].treeRef'));
  expectMutationError('treeRef cites uncataloged evidence', (m) => {
    m.screens[1]!.treeRef = UNCATALOGED_REF;
  }, 'screens[1].treeRef: evidence "ev_0c000000-0000-4000-8000-000000000001" is not in the evidence catalog (add an IrEvidenceEntry for it first)');
  expectMutationError('treeRef does not match its catalog entry', (m) => {
    m.screens[1]!.treeRef = { ...DOM_PRICING, sha256: fakeSha256('tampered') };
  }, 'screens[1].treeRef: evidence ref for "ev_01000000-0000-4000-8000-000000000002" does not match its catalog entry irev_90000000-0000-4000-8000-000000000002 (kind/sha256 differ — an EvidenceRef is self-describing)');
  expectMutationError('missing required route', (m) => {
    delete (m.screens[0] as unknown as Record<string, unknown>)['route'];
  }, 'screens[0].route: expected a string, got undefined');
});

describe('validateIrModelDetailed — components & provenance', () => {
  expectMutationError('component screenId does not resolve', (m) => {
    m.components[0]!.screenId = 'screen_missing';
  }, 'components[0].screenId: no screen with id "screen_missing" (declare the screen in screens first)');
  expectMutationError('component events with a number entry', (m) => {
    m.components[0]!.events = [42] as unknown as string[];
  }, 'components[0].events[0]: expected a string, got number');
  expectMutationError('provenance level outside the vocabulary', (m) => {
    m.components[1]!.provenance.level = 'guessed' as never;
  }, 'components[1].provenance.level: expected one of observed|derived|inferred|assumed|unavailable, got "guessed"');
  expectMutationError('confidence value above 1', (m) => {
    m.components[1]!.provenance.confidence.value = 1.5;
  }, 'components[1].provenance.confidence.value: expected a finite number in [0, 1], got 1.5');
  expectMutationError('confidence value NaN', (m) => {
    m.components[1]!.provenance.confidence.value = Number.NaN;
  }, 'components[1].provenance.confidence.value: expected a finite number in [0, 1], got NaN');
  expectMutationError('confidence value is a string', (m) => {
    m.components[1]!.provenance.confidence.value = 'high' as unknown as number;
  }, 'components[1].provenance.confidence.value: expected a finite number in [0, 1], got "high"');
  expectMutationError('confidence rationale empty', (m) => {
    m.components[1]!.provenance.confidence.rationale = '';
  }, 'components[1].provenance.confidence.rationale: expected a non-empty string, got ""');
  expectMutationError('empty evidenceRefs on a non-assumed level', (m) => {
    m.components[1]!.provenance.confidence.evidenceRefs = [];
  }, 'components[1].provenance.confidence.evidenceRefs: must not be empty for level "observed" (empty evidenceRefs are legal only for level "assumed")');
  expectMutationError('provenance block missing (null)', (m) => {
    m.components[1]!.provenance = null as unknown as never;
  }, 'components[1].provenance: expected a non-null object, got null');
  expectMutationError('provenance cites uncataloged evidence', (m) => {
    m.components[1]!.provenance.confidence.evidenceRefs = [UNCATALOGED_REF];
  }, 'components[1].provenance.confidence.evidenceRefs[0]: evidence "ev_0c000000-0000-4000-8000-000000000001" is not in the evidence catalog (add an IrEvidenceEntry for it first)');
  expectMutationError('provenance evidenceRefs not an array', (m) => {
    (m.components[1]!.provenance.confidence as unknown as Record<string, unknown>)['evidenceRefs'] = 'nope';
  }, 'components[1].provenance.confidence.evidenceRefs: expected an array, got string');
  expectMutationError('properties is not an object', (m) => {
    (m.components[0] as unknown as Record<string, unknown>)['properties'] = 'nope';
  }, 'components[0].properties: expected a non-null object, got string');
  expectMutationError('null deep inside component properties', (m) => {
    m.components[0]!.properties['foo'] = null;
  }, NULL_MSG('components[0].properties.foo'));
});

describe('validateIrModelDetailed — state machine', () => {
  expectMutationError('state variable name empty', (m) => {
    m.state.variables[0]!.name = '';
  }, 'state.variables[0].name: expected a non-empty string, got ""');
  expectMutationError('transition fromScreenId does not resolve', (m) => {
    m.state.transitions[0]!.fromScreenId = 'screen_missing';
  }, 'state.transitions[0].fromScreenId: no screen with id "screen_missing" (declare the screen in screens first)');
  expectMutationError('transition toScreenId does not resolve', (m) => {
    m.state.transitions[0]!.toScreenId = 'screen_missing';
  }, 'state.transitions[0].toScreenId: no screen with id "screen_missing" (declare the screen in screens first)');
  expectMutationError('trigger type outside the union', (m) => {
    (m.state.transitions[0] as unknown as Record<string, unknown>)['trigger'] = { type: 'gesture' };
  }, 'state.transitions[0].trigger.type: expected one of action|timer|background-event|api-response|websocket-message, got "gesture"');
  expectMutationError('action trigger missing its action', (m) => {
    (m.state.transitions[0] as unknown as Record<string, unknown>)['trigger'] = { type: 'action' };
  }, 'state.transitions[0].trigger.action: expected a string, got undefined');
  expectMutationError('timer trigger with null label', (m) => {
    (m.state.transitions[0] as unknown as Record<string, unknown>)['trigger'] = { type: 'timer', label: null };
  }, NULL_MSG('state.transitions[0].trigger.label'));
  expectMutationError('api-response trigger with dangling operationId', (m) => {
    (m.state.transitions[0] as unknown as Record<string, unknown>)['trigger'] = {
      type: 'api-response',
      operationId: 'op_0d000000-0000-4000-8000-000000000001',
    };
  }, 'state.transitions[0].trigger.operationId: no api operation with id "op_0d000000-0000-4000-8000-000000000001" (declare the operation in api.operations first)');
  expectMutationError('transition input null', (m) => {
    m.state.transitions[0]!.input = null;
  }, NULL_MSG('state.transitions[0].input'));
  expectMutationError('null deep inside transition input payload', (m) => {
    m.state.transitions[0]!.input = { retryAfter: null };
  }, NULL_MSG('state.transitions[0].input.retryAfter'));
  expectMutationError('transition outputs not an array', (m) => {
    m.state.transitions[0]!.outputs = 'nope' as unknown as unknown[];
  }, 'state.transitions[0].outputs: expected an array or absent, got string');
  expectMutationError('transition sideEffects with a number entry', (m) => {
    m.state.transitions[0]!.sideEffects = [42] as unknown as string[];
  }, 'state.transitions[0].sideEffects[0]: expected a string, got number');
});

describe('validateIrModelDetailed — data & api', () => {
  expectMutationError('data field provenance missing (null)', (m) => {
    m.data.entities[0]!.fields[0]!.provenance = null as unknown as never;
  }, 'data.entities[0].fields[0].provenance: expected a non-null object, got null');
  expectMutationError('entity persistence with a number entry', (m) => {
    m.data.entities[0]!.persistence = [42] as unknown as string[];
  }, 'data.entities[0].persistence[0]: expected a string, got number');
  expectMutationError('api transport empty', (m) => {
    m.api.operations[0]!.transport = '';
  }, 'api.operations[0].transport: expected a non-empty string, got ""');
  expectMutationError('api urlPattern empty', (m) => {
    m.api.operations[0]!.urlPattern = '';
  }, 'api.operations[0].urlPattern: expected a non-empty string, got ""');
  expectMutationError('api method null (absent, never null)', (m) => {
    m.api.operations[0]!.method = null as unknown as string;
  }, NULL_MSG('api.operations[0].method'));
  expectMutationError('api headersNeeded with an empty entry', (m) => {
    m.api.operations[0]!.headersNeeded = [''];
  }, 'api.operations[0].headersNeeded[0]: expected a non-empty string, got ""');
  expectMutationError('api replayability outside the union', (m) => {
    m.api.operations[0]!.replayability = 'maybe' as never;
  }, 'api.operations[0].replayability: expected one of replayable|needs-auth|side-effects|unreproducible, got "maybe"');
  expectMutationError('api observedExamples cites uncataloged evidence', (m) => {
    m.api.operations[0]!.observedExamples = [UNCATALOGED_REF];
  }, 'api.operations[0].observedExamples[0]: evidence "ev_0c000000-0000-4000-8000-000000000001" is not in the evidence catalog (add an IrEvidenceEntry for it first)');
  expectMutationError('api responseSchema null', (m) => {
    m.api.operations[0]!.responseSchema = null;
  }, NULL_MSG('api.operations[0].responseSchema'));
});

describe('validateIrModelDetailed — integrations, assumptions, constraints, sections', () => {
  expectMutationError('integration status outside the union', (m) => {
    m.integrations[0]!.status = 'imagined' as never;
  }, 'integrations[0].status: expected one of observed|inferred|mocked|unreproducible, got "imagined"');
  expectMutationError('assumption statement empty', (m) => {
    m.assumptions[0]!.statement = '';
  }, 'assumptions[0].statement: expected a non-empty string, got ""');
  expectMutationError('null constraint', (m) => {
    m.constraints[0] = null as unknown as string;
  }, NULL_MSG('constraints[0]'));
  expectMutationError('missing screens section', (m) => {
    delete (m as unknown as Record<string, unknown>)['screens'];
  }, 'screens: expected an array, got undefined');
  expectMutationError('missing state section', (m) => {
    delete (m as unknown as Record<string, unknown>)['state'];
  }, 'state: expected a non-null object, got undefined');
  expectMutationError('state.variables not an array', (m) => {
    (m.state as unknown as Record<string, unknown>)['variables'] = 'nope';
  }, 'state.variables: expected an array, got string');
  expectMutationError('evidence section not an array', (m) => {
    (m as unknown as Record<string, unknown>)['evidence'] = 'nope';
  }, 'evidence: expected an array, got string');
});

describe('validateIrModelDetailed — serializability probe', () => {
  test('a Date inside component properties is rejected with its path', () => {
    const model = buildReferenceModel();
    model.components[0]!.properties['when'] = new Date(0);
    const result = validateIrModelDetailed(model);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (error) => error.startsWith('model: not canonical-JSON serializable') && error.includes('components[0].properties.when'),
      ),
    ).toBe(true);
  });

  test('undefined inside component properties is rejected with its path', () => {
    const model = buildReferenceModel();
    model.components[0]!.properties['gone'] = undefined;
    const result = validateIrModelDetailed(model);
    expect(
      result.errors.some(
        (error) => error.startsWith('model: not canonical-JSON serializable') && error.includes('components[0].properties.gone'),
      ),
    ).toBe(true);
  });

  test('a reference cycle is reported, not crashed on', () => {
    const model = buildReferenceModel();
    const screen = model.screens[0] as unknown as Record<string, unknown>;
    screen['self'] = model.screens[0];
    const result = validateIrModelDetailed(model);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('screens[0].self: reference cycle detected (the IR model must be a tree)');
  });
});

describe('validateIrModelDetailed — deliberate leniency (documented, tested)', () => {
  test('extra properties are allowed (forward compatibility)', () => {
    const model = buildReferenceModel();
    (model as unknown as Record<string, unknown>)['futureNote'] = 'forward-compat field';
    (model.screens[0] as unknown as Record<string, unknown>)['captureCount'] = 2;
    expect(validateIrModelDetailed(model).valid).toBe(true);
  });

  test('absent optional fields are legal (unknown = absent)', () => {
    const model = buildReferenceModel();
    delete (model.screens[1] as unknown as Record<string, unknown>)['treeRef'];
    expect(validateIrModelDetailed(model).valid).toBe(true);
  });

  test("empty evidenceRefs on 'assumed' is legal", () => {
    const model = buildReferenceModel();
    // assumptions[0] already exercises this; make it explicit here too.
    expect(model.assumptions[0]!.provenance.confidence.evidenceRefs).toEqual([]);
    expect(validateIrModelDetailed(model).valid).toBe(true);
  });

  test("non-empty evidenceRefs on 'assumed' is also legal", () => {
    const model = buildReferenceModel();
    model.assumptions[0]!.provenance.confidence.evidenceRefs = [DOM_HOME];
    expect(validateIrModelDetailed(model).valid).toBe(true);
  });

  test('empty sections are structurally legal', () => {
    const model = buildReferenceModel();
    model.journeys = [];
    model.integrations = [];
    expect(validateIrModelDetailed(model).valid).toBe(true);
  });

  test('duplicate strings inside a set-semantics array are NOT rejected (documented)', () => {
    const model = buildReferenceModel();
    model.components[0]!.events = ['click', 'click'];
    expect(validateIrModelDetailed(model).valid).toBe(true);
  });

  test('comment-only vocabularies are NOT enforced (domain stays a free string)', () => {
    const model = buildReferenceModel();
    model.state.variables[0]!.domain = 'rgb-triplet';
    expect(validateIrModelDetailed(model).valid).toBe(true);
  });
});

describe('both validators are total — never throw', () => {
  const garbage: unknown[] = [
    undefined,
    null,
    42,
    'a string',
    true,
    Symbol('sym'),
    new Date(0),
    [],
    [1, 2, 3],
    () => 'function',
  ];

  test.each(garbage.map((value, index) => [`${index}`, value] as const))('garbage %j', (_label, value) => {
    expect(() => validateIrModelDetailed(value)).not.toThrow();
    expect(validateIrModelDetailed(value).valid).toBe(false);
    expect(validateIrModel(value)).toBe(false);
  });

  test('empty object reports its missing header fields without throwing', () => {
    const result = validateIrModelDetailed({});
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('modelVersion: expected "0.1", got undefined');
    expect(result.errors).toContain('application: expected a non-null object, got undefined');
  });

  test('cyclic input returns errors instead of recursing forever', () => {
    const cyclic: Record<string, unknown> = { modelVersion: '0.1' };
    cyclic['self'] = cyclic;
    let result: ReturnType<typeof validateIrModelDetailed> | undefined;
    expect(() => {
      result = validateIrModelDetailed(cyclic);
    }).not.toThrow();
    expect(result?.valid).toBe(false);
    expect(result?.errors.some((error) => error.includes('cycle'))).toBe(true);
  });

  test('deeply broken model collects many errors but still returns', () => {
    const model = buildReferenceModel();
    model.modelVersion = 1 as unknown as string;
    model.application = null as unknown as IrModel['application'];
    model.screens = 'nope' as unknown as IrModel['screens'];
    model.constraints = [null as unknown as string];
    const result = validateIrModelDetailed(model);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(3);
  });

  test('identical double-reported nulls are de-duplicated', () => {
    const model = buildReferenceModel();
    (model.environment as Record<string, unknown>)['browser'] = null;
    const result = validateIrModelDetailed(model);
    const nullErrors = result.errors.filter((error) => error === NULL_MSG('environment.browser'));
    expect(nullErrors.length).toBe(1);
  });
});
