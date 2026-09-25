// CLAPP-020 — referentially-sound builder: happy path over the b01 model,
// immediate rejection of every referential/shape violation, the
// canonical-JSON-safety gate at add time, and the finish() validation
// gate (model-wide deep-null scan).

import { describe, expect, test } from 'bun:test';
import { createIrModelBuilder, IrBuilderError } from './builder';
import type { IrModelBuilder } from './builder';
import { irModelStats } from './stats';
import { parseIrModel, serializeIrModel } from './serialize';
import { validateIrModelDetailed } from './validate';
import {
  DOM_FEATURES,
  DOM_HOME,
  DOM_PRICING,
  IDS,
  NET_NEWSLETTER,
  SHOT_HOME,
  STORAGE_NEWSLETTER,
  UNCATALOGED_REF,
  buildReferenceModel,
  prov,
} from './test-model';

function freshBuilder(): IrModelBuilder {
  return createIrModelBuilder({
    application: { id: IDS.application, name: 'Nimbus Notes', platform: 'web', entrypoints: ['/'] },
  });
}

/** Builder with the home DOM + screenshot evidence cataloged and the home screen added. */
function builderWithHome(): { builder: IrModelBuilder; homeId: string } {
  const builder = freshBuilder();
  builder.addEvidenceEntry(DOM_HOME, 'run:run_0b000000-0000-4000-8000-000000000001:dom');
  builder.addEvidenceEntry(SHOT_HOME, 'run:run_0b000000-0000-4000-8000-000000000001:screenshot');
  const home = builder.addScreen({
    route: '/',
    provenance: prov('observed', 1, 'route and structure captured from the dom channel', [DOM_HOME]),
    treeRef: DOM_HOME,
    visualRef: SHOT_HOME,
  });
  return { builder, homeId: home.id };
}

describe('builder — happy path over the b01 reference structure', () => {
  test('the reference model rebuilds through the builder and finishes valid', () => {
    const reference = buildReferenceModel();
    const builder = createIrModelBuilder({
      application: reference.application,
      environment: reference.environment,
    });

    // Evidence first: every later citation resolves against the catalog.
    for (const entry of reference.evidence) {
      builder.addEvidenceEntry(entry.ref, entry.source);
    }

    const home = builder.addScreen({
      route: '/',
      provenance: reference.screens[0]!.provenance,
      treeRef: DOM_HOME,
      visualRef: SHOT_HOME,
    });
    const pricing = builder.addScreen({
      route: '/pricing',
      provenance: reference.screens[1]!.provenance,
      treeRef: DOM_PRICING,
    });
    const features = builder.addScreen({
      route: '/features',
      provenance: reference.screens[2]!.provenance,
      treeRef: DOM_FEATURES,
    });
    void features; // captured for parity with home/pricing; not otherwise referenced

    for (const component of reference.components) {
      const owning = component.screenId === IDS.homeScreen ? home : pricing;
      builder.addComponent({
        role: component.role,
        screenId: owning.id,
        properties: component.properties,
        events: component.events,
        provenance: component.provenance,
      });
    }

    builder.addStateVariable({
      name: 'newsletter.subscribed',
      domain: 'boolean',
      provenance: prov('derived', 0.8, 'derived from storage key presence', [STORAGE_NEWSLETTER]),
    });

    builder.addTransition({
      fromScreenId: home.id,
      toScreenId: pricing.id,
      trigger: { type: 'action', action: 'navigate' },
      sideEffects: [],
      provenance: prov('derived', 0.9, 'derived from the navigation journey', [DOM_HOME, DOM_PRICING]),
    });

    const newsletterOp = builder.addApiOperation({
      transport: 'http',
      method: 'POST',
      urlPattern: '/api/newsletter',
      headersNeeded: ['content-type'],
      requestSchema: { type: 'object', properties: { email: { type: 'string' } } },
      observedExamples: [NET_NEWSLETTER],
      replayability: 'side-effects',
      externalSideEffects: ['subscribes the email to the newsletter'],
      provenance: prov('assumed', 0.3, 'synthesized for fixtures; the corpus never issues this call', [NET_NEWSLETTER]),
    });

    builder.addTransition({
      fromScreenId: home.id,
      toScreenId: home.id,
      trigger: { type: 'api-response', operationId: newsletterOp.id },
      sideEffects: ['persists newsletter subscription locally'],
      provenance: prov('inferred', 0.6, 'newsletter submit leads to a local storage write', [NET_NEWSLETTER, STORAGE_NEWSLETTER]),
    });

    builder.addDataEntity({
      name: 'NewsletterSubscription',
      fields: [
        { name: 'email', domain: 'text', provenance: prov('observed', 0.9, 'email input captured in the DOM', [DOM_HOME]) },
      ],
      persistence: ['localStorage:newsletter-email'],
    });

    builder.addIntegration({
      capability: 'email-newsletter-delivery',
      status: 'unreproducible',
      provenance: prov('unavailable', 0.2, 'no backend response was ever observed', [NET_NEWSLETTER]),
    });

    builder.addAssumption({
      statement: 'bench/b01-static pages are static HTML with no client-side auth',
      provenance: prov('assumed', 0.5, 'stated without evidence for synthesis grounding', []),
    });

    builder.addJourney(reference.journeys[0]!);
    builder.addConstraint('v0 web adapter: screen == state (declared simplification)');
    builder.addConstraint('one screen per route in v0; captures of the same route are merged by the caller');

    const model = builder.finish();
    const result = validateIrModelDetailed(model);
    expect(result.errors).toEqual([]);

    const stats = irModelStats(model);
    expect(stats.screens).toBe(3);
    expect(stats.components).toBe(4);
    expect(stats.stateVariables).toBe(1);
    expect(stats.transitions).toBe(2);
    expect(stats.dataEntities).toBe(1);
    expect(stats.apiOperations).toBe(1);
    expect(stats.integrations).toBe(1);
    expect(stats.assumptions).toBe(1);
    expect(stats.journeys).toBe(1);
    expect(stats.evidenceEntries).toBe(6);
    expect(stats.constraints).toBe(2);

    // The builder product round-trips through serialization.
    expect(parseIrModel(serializeIrModel(model)).modelVersion).toBe('0.1');
  });

  test('minted ids carry the declared prefixes', () => {
    const { builder, homeId } = builderWithHome();
    const component = builder.addComponent({
      role: 'heading',
      screenId: homeId,
      properties: {},
      events: [],
      provenance: prov('observed', 1, 'captured', [DOM_HOME]),
    });
    expect(homeId).toMatch(/^screen_[0-9a-f-]{36}$/);
    expect(component.id).toMatch(/^comp_[0-9a-f-]{36}$/);
  });

  test('an empty builder finishes a valid (if uninformative) model', () => {
    const model = freshBuilder().finish();
    expect(validateIrModelDetailed(model).valid).toBe(true);
    expect(irModelStats(model).screens).toBe(0);
  });

  test('finish() snapshots sections — later adds do not mutate a finished model', () => {
    const { builder } = builderWithHome();
    const model = builder.finish();
    const constraintsBefore = model.constraints.length;
    builder.addConstraint('late arrival');
    expect(model.constraints).toHaveLength(constraintsBefore);
  });
});

describe('builder — immediate rejection paths', () => {
  test('malformed init application', () => {
    expect(() =>
      createIrModelBuilder({ application: { id: IDS.application, name: '', platform: 'web', entrypoints: ['/'] } }),
    ).toThrow(/application\.name: expected a non-empty string/);
  });

  test('malformed init environment', () => {
    expect(() =>
      createIrModelBuilder({
        application: { id: IDS.application, name: 'Nimbus Notes', platform: 'web', entrypoints: ['/'] },
        environment: { viewport: { width: 0, height: 720 } },
      }),
    ).toThrow(/environment\.viewport\.width/);
  });

  test('component before its screen', () => {
    const builder = freshBuilder();
    expect(() =>
      builder.addComponent({
        role: 'heading',
        screenId: 'screen_00000000-0000-4000-8000-0000000000ff',
        properties: {},
        events: [],
        provenance: prov('assumed', 0.1, 'no evidence yet', []),
      }),
    ).toThrow(/addComponent: component\.screenId: no screen with id/);
  });

  test('duplicate route names the existing screen', () => {
    const { builder } = builderWithHome();
    let existingScreenId = '';
    try {
      builder.addScreen({
        route: '/',
        provenance: prov('observed', 1, 'second capture of the same route', [DOM_HOME]),
      });
    } catch (error) {
      expect(error).toBeInstanceOf(IrBuilderError);
      expect((error as Error).message).toContain(
        'addScreen: route "/" is already claimed by screen screen_',
      );
      existingScreenId = 'reported';
    }
    expect(existingScreenId).toBe('reported');
  });

  test('transition with dangling fromScreenId', () => {
    const { builder, homeId } = builderWithHome();
    expect(() =>
      builder.addTransition({
        fromScreenId: 'screen_00000000-0000-4000-8000-0000000000ff',
        toScreenId: homeId,
        trigger: { type: 'action', action: 'navigate' },
        provenance: prov('assumed', 0.1, 'fixture', []),
      }),
    ).toThrow(/transition\.fromScreenId: no screen with id/);
  });

  test('api-response trigger with dangling operationId', () => {
    const { builder, homeId } = builderWithHome();
    expect(() =>
      builder.addTransition({
        fromScreenId: homeId,
        toScreenId: homeId,
        trigger: { type: 'api-response', operationId: 'op_0d000000-0000-4000-8000-000000000001' },
        provenance: prov('assumed', 0.1, 'fixture', []),
      }),
    ).toThrow(/transition\.trigger\.operationId: no api operation with id/);
  });

  test('duplicate catalog evidenceId', () => {
    const builder = freshBuilder();
    builder.addEvidenceEntry(DOM_HOME, 'run:r1:dom');
    expect(() => builder.addEvidenceEntry(DOM_HOME, 'run:r2:dom')).toThrow(
      /already cataloged as irev_.* — catalog each evidence item exactly once/,
    );
  });

  test('malformed evidence ref is rejected at add time', () => {
    const builder = freshBuilder();
    expect(() =>
      builder.addEvidenceEntry({ ...DOM_HOME, sha256: 'XYZ' }, 'run:r1:dom'),
    ).toThrow(/ref\.sha256: expected 64 lowercase hex characters/);
  });

  test('provenance citing uncataloged evidence', () => {
    const builder = freshBuilder();
    expect(() =>
      builder.addScreen({
        route: '/',
        provenance: prov('observed', 1, 'cites evidence nobody cataloged', [UNCATALOGED_REF]),
      }),
    ).toThrow(/is not in the evidence catalog/);
  });

  test('treeRef citing uncataloged evidence', () => {
    const builder = freshBuilder();
    expect(() =>
      builder.addScreen({
        route: '/',
        provenance: prov('assumed', 0.1, 'fixture', []),
        treeRef: UNCATALOGED_REF,
      }),
    ).toThrow(/treeRef: evidence "ev_0c000000-0000-4000-8000-000000000001" is not in the evidence catalog/);
  });

  test('observedExamples citing uncataloged evidence', () => {
    const builder = freshBuilder();
    expect(() =>
      builder.addApiOperation({
        transport: 'http',
        urlPattern: '/api/x',
        observedExamples: [UNCATALOGED_REF],
        replayability: 'replayable',
        provenance: prov('assumed', 0.1, 'fixture', []),
      }),
    ).toThrow(/observedExamples\[0\]: evidence "ev_0c000000-0000-4000-8000-000000000001" is not in the evidence catalog/);
  });

  test('empty evidenceRefs on a non-assumed provenance level', () => {
    const builder = freshBuilder();
    expect(() =>
      builder.addScreen({ route: '/', provenance: prov('observed', 1, 'observed nothing?', []) }),
    ).toThrow(/must not be empty for level "observed"/);
  });

  test('confidence out of range', () => {
    const builder = freshBuilder();
    expect(() =>
      builder.addScreen({ route: '/', provenance: prov('assumed', 1.5, 'too sure', []) }),
    ).toThrow(/confidence\.value: expected a finite number in \[0, 1\], got 1\.5/);
  });

  test('duplicate journey id', () => {
    const { builder } = builderWithHome();
    builder.addEvidenceEntry(DOM_PRICING, 'run:run_0b000000-0000-4000-8000-000000000001:dom');
    builder.addEvidenceEntry(DOM_FEATURES, 'run:run_0b000000-0000-4000-8000-000000000001:dom');
    const journey = buildReferenceModel().journeys[0]!;
    builder.addJourney(journey);
    expect(() => builder.addJourney(journey)).toThrow(/duplicate journey id/);
  });

  test('journey with a malformed id', () => {
    const { builder } = builderWithHome();
    const journey = { ...buildReferenceModel().journeys[0]!, id: 'trip_123' };
    expect(() => builder.addJourney(journey)).toThrow(/journey\.id: expected a "journey_"-prefixed uuid v4 string/);
  });

  test('empty constraint text', () => {
    expect(() => freshBuilder().addConstraint('')).toThrow(/addConstraint: expected a non-empty string/);
    expect(() => freshBuilder().addConstraint('   ')).toThrow(/addConstraint: expected a non-empty string/);
  });

  test('element that is not canonical-JSON serializable is rejected at add time', () => {
    const { builder, homeId } = builderWithHome();
    expect(() =>
      builder.addComponent({
        role: 'button',
        screenId: homeId,
        properties: { onClick: () => 1 },
        events: ['click'],
        provenance: prov('observed', 1, 'captured', [DOM_HOME]),
      }),
    ).toThrow(/not canonical-JSON serializable/);
  });
});

describe('builder — finish() validates the assembled model (second gate)', () => {
  test('a null deep inside transition input passes add-time checks and fails finish()', () => {
    const { builder, homeId } = builderWithHome();
    // input is an opaque payload: add-time checks only require it to be
    // canonical-JSON serializable — null inside is legal JSON. The model-wide
    // no-null rule is enforced by finish()'s validation pass.
    builder.addTransition({
      fromScreenId: homeId,
      toScreenId: homeId,
      trigger: { type: 'timer', label: 'autosave' },
      input: { retryAfter: null },
      provenance: prov('assumed', 0.1, 'fixture', []),
    });
    let caught: unknown;
    try {
      builder.finish();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(IrBuilderError);
    expect((caught as Error).message).toContain(
      'state.transitions[0].input.retryAfter: null is not a valid IR value — omit the field instead (absent, never null)',
    );
  });

  test('a null deep inside component properties fails finish()', () => {
    const { builder, homeId } = builderWithHome();
    builder.addComponent({
      role: 'button',
      screenId: homeId,
      properties: { label: 'Go', tooltip: null },
      events: ['click'],
      provenance: prov('observed', 1, 'captured', [DOM_HOME]),
    });
    expect(() => builder.finish()).toThrow(/components\[0\]\.properties\.tooltip: null is not a valid IR value/);
  });

  test('finish() succeeds again once the violation is avoided (fresh builder)', () => {
    const { builder, homeId } = builderWithHome();
    builder.addTransition({
      fromScreenId: homeId,
      toScreenId: homeId,
      trigger: { type: 'timer', label: 'autosave' },
      input: { retryAfter: 500 },
      provenance: prov('assumed', 0.1, 'fixture', []),
    });
    expect(validateIrModelDetailed(builder.finish()).valid).toBe(true);
  });
});
