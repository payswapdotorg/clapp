/**
 * CLAPP-022 test battery — the IR emitter + its internal structural check.
 *
 * Hand-built EmitIrModelInput records verify the emission rules exactly:
 * route-changing applied actions become transitions with observed input
 * and honest side effects; route-preserving actions emit a self-transition
 * ONLY when a new storage key appeared (the mechanism fires on hand-built
 * records even though real v0 walks can never trigger it); skipped and
 * assert-only records never become transitions; checkIrLiteral catches
 * hand-broken invariants.
 */

import { describe, expect, it } from 'bun:test';
import { createRecorder } from '@clapp/journey';
import type { EvidenceRef } from '@clapp/core';
import { emitIrModel, describeAction } from '../src/ir-emitter';
import { checkIrLiteral } from '../src/ir-emitter';
import type { ActionRecord } from '../src/explorer';
import type { EmitIrModelInput } from '../src/ir-emitter';
import type { IrModel } from '../src/ir-contract';

const REF_DOM_A: EvidenceRef = {
  evidenceId: 'ev_11111111-1111-4111-8111-111111111111',
  kind: 'dom',
  sha256: 'a'.repeat(64),
};
const REF_DOM_B: EvidenceRef = {
  evidenceId: 'ev_22222222-2222-4222-8222-222222222222',
  kind: 'dom',
  sha256: 'b'.repeat(64),
};
const REF_USER_1: EvidenceRef = {
  evidenceId: 'ev_33333333-3333-4333-8333-333333333333',
  kind: 'user',
  sha256: 'c'.repeat(64),
};
const REF_USER_2: EvidenceRef = {
  evidenceId: 'ev_44444444-4444-4444-8444-444444444444',
  kind: 'user',
  sha256: 'd'.repeat(64),
};
const REF_USER_3: EvidenceRef = {
  evidenceId: 'ev_55555555-5555-4555-8555-555555555555',
  kind: 'user',
  sha256: 'e'.repeat(64),
};
const REF_USER_4: EvidenceRef = {
  evidenceId: 'ev_66666666-6666-4666-8666-666666666666',
  kind: 'user',
  sha256: 'f'.repeat(64),
};

const APPLICATION = {
  id: 'app_emitter-fixture',
  name: 'emitter-fixture',
  platform: 'web' as const,
  entrypoints: ['/'],
};

function baseInput(): EmitIrModelInput {
  const recorder = createRecorder({ name: 'explore: reach /done' });
  recorder.start(APPLICATION.id);
  recorder.record({ type: 'navigate', url: '/' });
  recorder.record({ type: 'fill', target: { role: 'textbox', name: 'Query' }, value: 'probe' });
  recorder.record({ type: 'click', target: { role: 'button', name: 'Go' } });
  const journey = recorder.finish();

  const actions: ActionRecord[] = [
    {
      action: { type: 'navigate', url: '/' },
      outcome: 'applied',
      routeBefore: '',
      routeAfter: '/',
      ref: REF_USER_1,
    },
    {
      // route-preserving fill: never a transition
      action: { type: 'fill', target: { role: 'textbox', name: 'Query' }, value: 'probe' },
      outcome: 'applied',
      routeBefore: '/',
      routeAfter: '/',
      ref: REF_USER_1,
    },
    {
      // assert probes are applied actions but can never be transitions
      action: { type: 'assert-visible', target: { role: 'button', name: 'Go' } },
      outcome: 'applied',
      routeBefore: '/',
      routeAfter: '/',
      ref: REF_USER_1,
    },
    {
      // route-changing submit-click WITH observed input + side effect
      action: { type: 'click', target: { role: 'button', name: 'Go' } },
      outcome: 'applied',
      routeBefore: '/',
      routeAfter: '/done',
      ref: REF_USER_2,
      submittedForm: 'main-form',
      submitParams: [
        ['q', 'probe'],
        ['mode', 'on'],
      ],
    },
    {
      // route-preserving no-op click WITHOUT a storage check: no transition
      action: { type: 'click', target: { role: 'button', name: 'Toggle' } },
      outcome: 'applied',
      routeBefore: '/done',
      routeAfter: '/done',
      ref: REF_USER_3,
    },
    {
      // route-preserving self-submit WITH a storage check, no new key: none
      action: { type: 'click', target: { role: 'button', name: 'Save' } },
      outcome: 'applied',
      routeBefore: '/done',
      routeAfter: '/done',
      ref: REF_USER_3,
      submittedForm: 'self-form',
      submitParams: [['q', 'x']],
      storageKeysAfter: [], // honest empty inventory — no signal
    },
    {
      // route-preserving click WHILE a new storage key appears: SELF-transition
      action: { type: 'click', target: { role: 'button', name: 'Sync' } },
      outcome: 'applied',
      routeBefore: '/done',
      routeAfter: '/done',
      ref: REF_USER_4,
      storageKeysAfter: ['localStorage:cart'],
    },
    {
      // failed actions never become transitions
      action: { type: 'click', target: { role: 'button', name: 'Broken' } },
      outcome: 'skipped',
      routeBefore: '/done',
      routeAfter: '/done',
      ref: null,
    },
  ];

  return {
    application: APPLICATION,
    refs: [REF_DOM_A, REF_DOM_B, REF_USER_1, REF_USER_2, REF_USER_3, REF_USER_4],
    screens: [
      {
        route: '/',
        treeRef: REF_DOM_A,
        actionables: [
          {
            path: 'html>body>main>form>input',
            tag: 'input',
            role: 'textbox',
            journeyRole: 'textbox',
            name: 'Query',
            testId: 'q',
            inputType: 'text',
            form: 'main-form',
            target: { role: 'textbox', name: 'Query' },
          },
        ],
      },
      { route: '/done', treeRef: REF_DOM_B, actionables: [] },
    ],
    actions,
    journeys: [
      {
        route: '/done',
        journey,
        actionRefs: [REF_USER_1, REF_USER_1, REF_USER_2],
      },
    ],
  };
}

describe('ir-emitter — emission rules', () => {
  it('emits exactly the qualifying transitions with input and side effects', () => {
    const model = emitIrModel(baseInput());
    const routeOf = new Map(model.screens.map((screen) => [screen.id, screen.route]));
    const edges = model.state.transitions.map((transition) => ({
      from: routeOf.get(transition.fromScreenId),
      to: routeOf.get(transition.toScreenId),
      trigger: transition.trigger,
    }));
    expect(edges).toEqual([
      { from: '/', to: '/done', trigger: { type: 'action', action: 'click' } },
      { from: '/done', to: '/done', trigger: { type: 'action', action: 'click' } },
    ]);
    const submit = model.state.transitions[0];
    expect(submit?.input).toEqual({ q: 'probe', mode: 'on' });
    expect(submit?.sideEffects).toEqual(['submits form main-form']);
    expect(submit?.provenance.level).toBe('observed');
    expect(submit?.provenance.confidence.evidenceRefs.map((ref) => ref.evidenceId)).toContain(
      REF_USER_2.evidenceId,
    );
    const self = model.state.transitions[1];
    expect(self?.sideEffects).toEqual(['storage keys appeared: localStorage:cart']);
    expect(self?.provenance.confidence.evidenceRefs).toHaveLength(1);
  });

  it('maps journey verbs to IR trigger vocabulary (fill renders as type)', () => {
    // fill never changes routes in real walks; if it ever did, the trigger
    // vocabulary renders it as 'type' (BEHAVIORAL_IR §4):
    const model = emitIrModel({
      application: APPLICATION,
      refs: [REF_DOM_A, REF_DOM_B, REF_USER_1],
      screens: [
        { route: '/', treeRef: REF_DOM_A, actionables: [] },
        { route: '/next', treeRef: REF_DOM_B, actionables: [] },
      ],
      actions: [
        {
          action: { type: 'fill', target: { role: 'textbox', name: 'Q' }, value: 'v' },
          outcome: 'applied',
          routeBefore: '/',
          routeAfter: '/next',
          ref: REF_USER_1,
        },
      ],
      journeys: [],
    });
    expect(model.state.transitions[0]?.trigger).toEqual({ type: 'action', action: 'type' });
  });

  it('summarizes journeys with purpose, steps, and user-capture provenance', () => {
    const model = emitIrModel(baseInput());
    expect(model.journeys).toHaveLength(1);
    const journey = model.journeys[0];
    if (journey === undefined) throw new Error('missing journey');
    expect(journey.purpose).toBe('reach /done');
    expect(journey.preconditions).toEqual([]);
    expect(journey.steps).toEqual([
      'navigate to /',
      'fill role=textbox name="Query" with "probe"',
      'click role=button name="Go"',
    ]);
    expect(journey.provenance.level).toBe('derived');
    expect(journey.provenance.confidence.evidenceRefs.every((ref) => ref.kind === 'user')).toBe(true);
  });

  it('leaves unsupported sections empty (unknown is a valid value)', () => {
    const model = emitIrModel(baseInput());
    expect(model.modelVersion).toBe('0.1');
    expect(model.environment).toEqual({});
    expect(model.state.variables).toEqual([]);
    expect(model.data.entities).toEqual([]);
    expect(model.api.operations).toEqual([]);
    expect(model.integrations).toEqual([]);
    expect(model.assumptions).toEqual([]);
    expect(model.constraints).toEqual([]);
    // visualRef stays ABSENT for screens (no screenshots in exploration)
    for (const screen of model.screens) {
      expect('visualRef' in screen).toBe(false);
      expect(screen.treeRef).toBeDefined();
    }
  });

  it('emits components with role, properties, and applier-executable events', () => {
    const model = emitIrModel(baseInput());
    expect(model.components).toHaveLength(1);
    const component = model.components[0];
    if (component === undefined) throw new Error('missing component');
    expect(component.role).toBe('textbox');
    expect(component.properties).toEqual({
      tag: 'input',
      path: 'html>body>main>form>input',
      name: 'Query',
      testId: 'q',
      form: 'main-form',
    });
    expect(component.events).toEqual(['fill']);
    expect(component.provenance.confidence.evidenceRefs[0]?.evidenceId).toBe(REF_DOM_A.evidenceId);
  });

  it('describes actions in one human-readable line each', () => {
    expect(describeAction({ type: 'navigate', url: '/x' })).toBe('navigate to /x');
    expect(describeAction({ type: 'fill', target: { testId: 'q' }, value: 'v' })).toBe(
      'fill testId=q with "v"',
    );
    expect(describeAction({ type: 'assert-visible', target: { role: 'heading', nth: 2 } })).toBe(
      'assert role=heading nth=2 is visible',
    );
  });
});

describe('ir-emitter — checkIrLiteral (internal self-check)', () => {
  it('passes for every emitted model (and is exposed for the battery only)', () => {
    const model = emitIrModel(baseInput());
    expect(checkIrLiteral(model)).toEqual([]);
  });

  it('catches a dangling provenance citation', () => {
    const model = emitIrModel(baseInput());
    const broken: IrModel = structuredClone(model);
    broken.screens[0]!.provenance.confidence.evidenceRefs = [
      { evidenceId: 'ev_00000000-0000-4000-8000-000000000000', kind: 'dom', sha256: '0'.repeat(64) },
    ];
    const violations = checkIrLiteral(broken);
    expect(violations.some((line) => line.includes('does not resolve to the evidence catalog'))).toBe(true);
  });

  it('catches a dangling screen cross-reference', () => {
    const model = emitIrModel(baseInput());
    const broken: IrModel = structuredClone(model);
    broken.components[0]!.screenId = 'screen_99999999-9999-4999-8999-999999999999';
    const violations = checkIrLiteral(broken);
    expect(violations.some((line) => line.includes('does not resolve to a screen'))).toBe(true);
  });

  it('catches a transition with no cited evidence', () => {
    const model = emitIrModel(baseInput());
    const broken: IrModel = structuredClone(model);
    broken.state.transitions[0]!.provenance.confidence.evidenceRefs = [];
    const violations = checkIrLiteral(broken);
    expect(violations.some((line) => line.includes('must cite at least one evidence ref'))).toBe(true);
  });

  it('catches malformed element ids and model versions', () => {
    const model = emitIrModel(baseInput());
    const broken: IrModel = structuredClone(model);
    broken.screens[0]!.id = 'screen_not-a-uuid';
    broken.modelVersion = '9.9';
    const violations = checkIrLiteral(broken);
    expect(violations.some((line) => line.includes('screen id must be "screen_"+uuid'))).toBe(true);
    expect(violations.some((line) => line.includes("modelVersion must equal '0.1'"))).toBe(true);
  });

  it('is wired into emitIrModel as a loud self-check', () => {
    const input = baseInput();
    // Break an invariant behind the emitter's back and expect the throw.
    input.screens[0]!.treeRef = {
      evidenceId: 'ev_00000000-0000-4000-8000-000000000000',
      kind: 'dom',
      sha256: '0'.repeat(64),
    };
    expect(() => emitIrModel(input)).toThrow(/self-check failed/);
  });
});
