// CLAPP-020 — id-stable model diff: add/remove/change by element id,
// whole-value sections, constraints set-diff, section-array reordering is
// NOT a change, and the documented set-semantics exceptions inside
// elements (journey steps stay ORDERED).

import { describe, expect, test } from 'bun:test';
import { DIFF_SECTIONS, diffIrModels } from './diff';
import { DOM_HOME, DOM_PRICING, IDS, buildReferenceModel, cloneModel, prov } from './test-model';

function sectionOf(diff: ReturnType<typeof diffIrModels>, name: string) {
  const section = diff.sections.find((entry) => entry.section === name);
  if (section === undefined) throw new Error(`no section ${name} in diff`);
  return section;
}

describe('diffIrModels — identical models', () => {
  test('a model diffs against an equal clone as fully identical', () => {
    const diff = diffIrModels(buildReferenceModel(), cloneModel(buildReferenceModel()));
    expect(diff.identical).toBe(true);
    for (const section of diff.sections) {
      expect(section.added).toEqual([]);
      expect(section.removed).toEqual([]);
      expect(section.changed).toEqual([]);
    }
  });

  test('sections come back in the fixed canonical order', () => {
    const diff = diffIrModels(buildReferenceModel(), buildReferenceModel());
    expect(diff.sections.map((section) => section.section)).toEqual([...DIFF_SECTIONS]);
    expect(DIFF_SECTIONS).toHaveLength(14);
  });

  test('unchangedCount reflects every matched element', () => {
    const diff = diffIrModels(buildReferenceModel(), buildReferenceModel());
    expect(sectionOf(diff, 'screens').unchangedCount).toBe(3);
    expect(sectionOf(diff, 'components').unchangedCount).toBe(4);
    expect(sectionOf(diff, 'evidence').unchangedCount).toBe(6);
    expect(sectionOf(diff, 'journeys').unchangedCount).toBe(1);
    expect(sectionOf(diff, 'constraints').unchangedCount).toBe(2);
    expect(sectionOf(diff, 'modelVersion').unchangedCount).toBe(1);
    expect(sectionOf(diff, 'application').unchangedCount).toBe(1);
    expect(sectionOf(diff, 'environment').unchangedCount).toBe(1);
  });
});

describe('diffIrModels — section-array order is not identity', () => {
  test('reordering screens produces NO changes', () => {
    const a = buildReferenceModel();
    const b = cloneModel(a);
    b.screens = [b.screens[2]!, b.screens[0]!, b.screens[1]!];
    const diff = diffIrModels(a, b);
    expect(diff.identical).toBe(true);
    expect(sectionOf(diff, 'screens').added).toEqual([]);
    expect(sectionOf(diff, 'screens').changed).toEqual([]);
  });

  test('reordering several sections at once still diffs identical', () => {
    const a = buildReferenceModel();
    const b = cloneModel(a);
    b.screens = [...b.screens].reverse();
    b.components = [...b.components].reverse();
    b.evidence = [...b.evidence].reverse();
    b.journeys = [...b.journeys];
    b.api.operations = [...b.api.operations];
    const diff = diffIrModels(a, b);
    expect(diff.identical).toBe(true);
  });
});

describe('diffIrModels — add / remove / change by id', () => {
  test('added screen', () => {
    const a = buildReferenceModel();
    const b = cloneModel(a);
    b.screens.push({
      id: 'screen_99000000-0000-4000-8000-000000000001',
      route: '/contact',
      provenance: prov('observed', 1, 'fixture', [DOM_HOME]),
    });
    const diff = diffIrModels(a, b);
    expect(diff.identical).toBe(false);
    const screens = sectionOf(diff, 'screens');
    expect(screens.added).toEqual(['screen_99000000-0000-4000-8000-000000000001']);
    expect(screens.removed).toEqual([]);
    expect(screens.changed).toEqual([]);
    expect(screens.unchangedCount).toBe(3);
  });

  test('removed component', () => {
    const a = buildReferenceModel();
    const b = cloneModel(a);
    b.components = b.components.filter((component) => component.id !== IDS.teamCta);
    const diff = diffIrModels(a, b);
    const components = sectionOf(diff, 'components');
    expect(components.removed).toEqual([IDS.teamCta]);
    expect(components.added).toEqual([]);
    expect(components.unchangedCount).toBe(3);
    expect(diff.identical).toBe(false);
  });

  test('changed component (same id, different content)', () => {
    const a = buildReferenceModel();
    const b = cloneModel(a);
    b.components[0]!.properties['label'] = 'Main navigation';
    const diff = diffIrModels(a, b);
    const components = sectionOf(diff, 'components');
    expect(components.changed).toEqual([IDS.navComponent]);
    expect(components.unchangedCount).toBe(3);
  });

  test('changing two of three screens reports changed=2, unchanged=1', () => {
    const a = buildReferenceModel();
    const b = cloneModel(a);
    b.screens[0]!.route = '/home';
    b.screens[1]!.provenance.confidence.value = 0.5;
    const diff = diffIrModels(a, b);
    const screens = sectionOf(diff, 'screens');
    expect(screens.changed).toHaveLength(2);
    expect(screens.unchangedCount).toBe(1);
  });

  test('add/remove across the remaining id-keyed sections', () => {
    const a = buildReferenceModel();
    const b = cloneModel(a);
    b.state.variables.push({
      id: 'var_99000000-0000-4000-8000-000000000001',
      name: 'cart.itemCount',
      domain: 'count',
      provenance: prov('derived', 0.5, 'fixture', [DOM_HOME]),
    });
    b.state.transitions.push({
      id: 'trans_99000000-0000-4000-8000-000000000001',
      fromScreenId: IDS.homeScreen,
      toScreenId: IDS.homeScreen,
      trigger: { type: 'timer', label: 'autosave' },
      sideEffects: [],
      provenance: prov('assumed', 0.1, 'fixture', []),
    });
    b.data.entities.push({
      id: 'ent_99000000-0000-4000-8000-000000000001',
      name: 'Draft',
      fields: [],
      persistence: [],
    });
    b.api.operations.push({
      id: 'op_99000000-0000-4000-8000-000000000001',
      transport: 'websocket',
      urlPattern: '/ws/live',
      observedExamples: [],
      replayability: 'replayable',
      externalSideEffects: [],
      provenance: prov('assumed', 0.1, 'fixture', []),
    });
    b.integrations.push({
      id: 'integ_99000000-0000-4000-8000-000000000001',
      capability: 'analytics',
      status: 'mocked',
      provenance: prov('assumed', 0.1, 'fixture', []),
    });
    b.assumptions.push({
      id: 'assume_99000000-0000-4000-8000-000000000001',
      statement: 'fixture assumption',
      provenance: prov('assumed', 0.1, 'fixture', []),
    });
    b.evidence.push({
      id: 'irev_99000000-0000-4000-8000-000000000001',
      ref: DOM_HOME,
      source: 'exploration',
    });
    b.journeys.push({
      id: 'journey_99000000-0000-4000-8000-000000000001',
      purpose: 'fixture journey',
      preconditions: [],
      steps: [],
      provenance: prov('assumed', 0.1, 'fixture', []),
    });
    const diff = diffIrModels(a, b);
    expect(sectionOf(diff, 'state.variables').added).toEqual(['var_99000000-0000-4000-8000-000000000001']);
    expect(sectionOf(diff, 'state.transitions').added).toEqual(['trans_99000000-0000-4000-8000-000000000001']);
    expect(sectionOf(diff, 'data.entities').added).toEqual(['ent_99000000-0000-4000-8000-000000000001']);
    expect(sectionOf(diff, 'api.operations').added).toEqual(['op_99000000-0000-4000-8000-000000000001']);
    expect(sectionOf(diff, 'integrations').added).toEqual(['integ_99000000-0000-4000-8000-000000000001']);
    expect(sectionOf(diff, 'assumptions').added).toEqual(['assume_99000000-0000-4000-8000-000000000001']);
    expect(sectionOf(diff, 'evidence').added).toEqual(['irev_99000000-0000-4000-8000-000000000001']);
    expect(sectionOf(diff, 'journeys').added).toEqual(['journey_99000000-0000-4000-8000-000000000001']);
  });

  test('content change in api operation and state variable', () => {
    const a = buildReferenceModel();
    const b = cloneModel(a);
    b.api.operations[0]!.urlPattern = '/api/newsletter/v2';
    b.state.variables[0]!.domain = 'enum';
    const diff = diffIrModels(a, b);
    expect(sectionOf(diff, 'api.operations').changed).toEqual([IDS.newsletterOp]);
    expect(sectionOf(diff, 'state.variables').changed).toEqual([IDS.subscribedVar]);
  });
});

describe('diffIrModels — whole-value sections and constraints', () => {
  test('modelVersion difference', () => {
    const a = buildReferenceModel();
    const b = cloneModel(a);
    b.modelVersion = '0.2'; // diff is mechanical; it does not validate
    const diff = diffIrModels(a, b);
    const section = sectionOf(diff, 'modelVersion');
    expect(section.changed).toEqual(['modelVersion']);
    expect(section.unchangedCount).toBe(0);
    expect(diff.identical).toBe(false);
  });

  test('environment difference', () => {
    const a = buildReferenceModel();
    const b = cloneModel(a);
    b.environment.browser = 'firefox';
    const diff = diffIrModels(a, b);
    expect(sectionOf(diff, 'environment').changed).toEqual(['environment']);
  });

  test('application difference (name change)', () => {
    const a = buildReferenceModel();
    const b = cloneModel(a);
    b.application.name = 'Nimbus Notes Pro';
    const diff = diffIrModels(a, b);
    expect(sectionOf(diff, 'application').changed).toEqual(['application']);
  });

  test('constraints add/remove as a string set', () => {
    const a = buildReferenceModel();
    const b = cloneModel(a);
    b.constraints = ['v0 web adapter: screen == state (declared simplification)', 'new constraint from repair'];
    const diff = diffIrModels(a, b);
    const section = sectionOf(diff, 'constraints');
    expect(section.added).toEqual(['new constraint from repair']);
    expect(section.removed).toEqual(['one screen per route in v0; captures of the same route are merged by the caller']);
    expect(section.changed).toEqual([]);
    expect(section.unchangedCount).toBe(1);
  });

  test('constraints reorder is not a change (set semantics)', () => {
    const a = buildReferenceModel();
    const b = cloneModel(a);
    b.constraints = [...b.constraints].reverse();
    const diff = diffIrModels(a, b);
    expect(sectionOf(diff, 'constraints').added).toEqual([]);
    expect(sectionOf(diff, 'constraints').removed).toEqual([]);
    expect(diff.identical).toBe(true);
  });
});

describe('diffIrModels — set-semantics arrays inside elements (documented choice)', () => {
  test('reordering component events is NOT a change', () => {
    const a = buildReferenceModel();
    const b = cloneModel(a);
    a.components[3]!.events = ['click', 'focus'];
    b.components[3]!.events = ['focus', 'click'];
    const diff = diffIrModels(a, b);
    expect(sectionOf(diff, 'components').changed).toEqual([]);
    expect(diff.identical).toBe(true);
  });

  test('reordering entrypoints is NOT a change (application section)', () => {
    const a = buildReferenceModel();
    const b = cloneModel(a);
    b.application.entrypoints = [...b.application.entrypoints].reverse();
    const diff = diffIrModels(a, b);
    expect(sectionOf(diff, 'application').changed).toEqual([]);
    expect(diff.identical).toBe(true);
  });

  test('reordering journey preconditions is NOT a change', () => {
    const a = buildReferenceModel();
    const b = cloneModel(a);
    b.journeys[0]!.preconditions = [...b.journeys[0]!.preconditions].reverse();
    const diff = diffIrModels(a, b);
    expect(sectionOf(diff, 'journeys').changed).toEqual([]);
  });

  test('reordering journey STEPS IS a change (steps are sequential)', () => {
    const a = buildReferenceModel();
    const b = cloneModel(a);
    b.journeys[0]!.steps = [...b.journeys[0]!.steps].reverse();
    const diff = diffIrModels(a, b);
    expect(sectionOf(diff, 'journeys').changed).toEqual([IDS.navJourney]);
    expect(diff.identical).toBe(false);
  });

  test('reordering entity fields is NOT a change', () => {
    const a = buildReferenceModel();
    const b = cloneModel(a);
    const second = {
      name: 'subscribedAt',
      domain: 'text',
      provenance: prov('observed', 0.9, 'fixture', [DOM_PRICING]),
    };
    a.data.entities[0]!.fields = [a.data.entities[0]!.fields[0]!, second];
    b.data.entities[0]!.fields = [second, b.data.entities[0]!.fields[0]!];
    const diff = diffIrModels(a, b);
    expect(sectionOf(diff, 'data.entities').changed).toEqual([]);
    expect(diff.identical).toBe(true);
  });

  test('reordering provenance evidenceRefs is NOT a change', () => {
    const a = buildReferenceModel();
    const b = cloneModel(a);
    b.state.transitions[0]!.provenance.confidence.evidenceRefs = [DOM_PRICING, DOM_HOME];
    const diff = diffIrModels(a, b);
    expect(sectionOf(diff, 'state.transitions').changed).toEqual([]);
  });

  test('reordering api observedExamples / headersNeeded / sideEffects is NOT a change', () => {
    const a = buildReferenceModel();
    const b = cloneModel(a);
    a.api.operations[0]!.observedExamples = [DOM_HOME, DOM_PRICING];
    b.api.operations[0]!.observedExamples = [DOM_PRICING, DOM_HOME];
    a.api.operations[0]!.headersNeeded = ['content-type', 'accept'];
    b.api.operations[0]!.headersNeeded = ['accept', 'content-type'];
    a.state.transitions[0]!.sideEffects = ['a', 'b'];
    b.state.transitions[0]!.sideEffects = ['b', 'a'];
    const diff = diffIrModels(a, b);
    expect(sectionOf(diff, 'api.operations').changed).toEqual([]);
    expect(sectionOf(diff, 'state.transitions').changed).toEqual([]);
  });

  test('duplicate entries inside a set-semantics array still differ (multiset)', () => {
    const a = buildReferenceModel();
    const b = cloneModel(a);
    a.components[3]!.events = ['click'];
    b.components[3]!.events = ['click', 'click'];
    const diff = diffIrModels(a, b);
    expect(sectionOf(diff, 'components').changed).toEqual([IDS.teamCta]);
  });
});
