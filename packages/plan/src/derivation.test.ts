/**
 * CLAPP-030 test battery — the binding derivation rules of planSynthesis,
 * exercised against a rich hand-built IrModel (see test-utils.buildShopModel)
 * plus purpose-built small models for the negative paths. Every rule in the
 * work item's binding list has at least one assertion here.
 */

import { describe, expect, it } from 'bun:test';
import type { Journey } from '@clapp/journey';
import { createIrModelBuilder } from '@clapp/ir';
import {
  PlanSynthesisError,
  describeJourneyAction,
  planSynthesis,
  routeFromJourneyUrl,
  sketchMockBody,
  validateSynthesisPlanDetailed,
} from './index';
import {
  DOM_REF,
  MATCHED_JOURNEY,
  UNMATCHED_JOURNEY,
  U,
  buildShopModel,
} from './test-utils';
import type { PlannedElement, SynthesisPlan } from './synthesis-contract';

function pageOf(plan: SynthesisPlan, routePath: string) {
  const page = plan.pages.find((candidate) => candidate.routeId === plan.routes.find((r) => r.path === routePath)?.id);
  if (page === undefined) throw new Error(`no page for route ${routePath}`);
  return page;
}

function elementsOn(plan: SynthesisPlan, routePath: string): PlannedElement[] {
  return pageOf(plan, routePath).elements;
}

describe('planSynthesis — input honesty', () => {
  it('refuses to plan from an invalid IrModel', () => {
    const fixture = buildShopModel();
    const broken = { ...fixture.model, modelVersion: '9.9' };
    expect(() => planSynthesis(broken as typeof fixture.model)).toThrow(PlanSynthesisError);
  });

  it('refuses invalid journey records', () => {
    const fixture = buildShopModel();
    const bad = { ...MATCHED_JOURNEY, actions: [{ type: 'teleport' }] } as unknown as Journey;
    expect(() => planSynthesis(fixture.model, { journeys: [bad] })).toThrow(PlanSynthesisError);
  });

  it('throws when entrypoints have no screens (unplannable — never fabricates routes)', () => {
    const builder = createIrModelBuilder({
      application: { id: `app_${U.four}`, name: 'Ghost', platform: 'web', entrypoints: ['/gone'] },
    });
    builder.addEvidenceEntry(DOM_REF, 'run:run_x:dom');
    builder.addScreen({
      route: '/',
      provenance: { level: 'observed', confidence: { value: 1, rationale: 'dom', evidenceRefs: [DOM_REF] } },
      treeRef: DOM_REF,
    });
    const model = builder.finish();
    expect(() => planSynthesis(model)).toThrow(PlanSynthesisError);
  });

  it('self-checks its own output (a factory minting bad ids fails fast)', () => {
    const fixture = buildShopModel();
    expect(() =>
      planSynthesis(fixture.model, { idFactory: () => 'not-an-id' }),
    ).toThrow(PlanSynthesisError);
  });
});

describe('planSynthesis — screens → routes + pages', () => {
  const fixture = buildShopModel();
  const plan = planSynthesis(fixture.model);

  it('produces a plan that validates with ZERO errors', () => {
    const result = validateSynthesisPlanDetailed(plan);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('application identity is derived, not fabricated', () => {
    expect(plan.application.name).toBe('Shop (synth)');
    expect(plan.application.sourceModelId).toBe(fixture.model.application.id);
    expect(plan.application.platform).toBe('web');
    expect(plan.application.entrypoints).toEqual(['/']);
    expect(/^appsyn_[0-9a-f-]{36}$/i.test(plan.application.id)).toBe(true);
  });

  it('server spec carries the v0 planned constants', () => {
    expect(plan.server).toEqual({ startCommand: 'bun run start', port: 4173, healthPath: '/' });
  });

  it('every screen becomes exactly one route + page, paths served verbatim', () => {
    expect(plan.routes.map((route) => route.path)).toEqual(['/', '/products', '/checkout-success', '/plain']);
    expect(plan.pages).toHaveLength(4);
    for (const route of plan.routes) {
      const page = plan.pages.find((candidate) => candidate.id === route.pageId);
      expect(page).toBeDefined();
      expect(page?.routeId).toBe(route.id);
    }
  });

  it('page title comes from the lowest-level heading with usable text', () => {
    expect(pageOf(plan, '/').title).toBe('Shop home'); // the h1
    expect(pageOf(plan, '/products').title).toBe('Products'); // h2 beats h3
  });

  it('screens without headings fall back to the route basename WITH an assumption', () => {
    expect(pageOf(plan, '/plain').title).toBe('plain');
    expect(pageOf(plan, '/checkout-success').title).toBe('checkout-success');
    const fallbackAssumptions = plan.assumptions.filter((entry) => entry.includes('assumed from the route basename'));
    expect(fallbackAssumptions).toHaveLength(2);
  });

  it('constraints carry over from the model verbatim', () => {
    expect(plan.constraints).toEqual(['observed charset utf-8']);
  });
});

describe('planSynthesis — components → elements', () => {
  const fixture = buildShopModel();
  const plan = planSynthesis(fixture.model);

  it('EVERY component becomes exactly one element (16 total across the model)', () => {
    const elementCount = plan.pages.reduce((sum, page) => sum + page.elements.length, 0);
    expect(fixture.model.components).toHaveLength(16);
    expect(elementCount).toBe(16);
  });

  it('kinds map from roles: link/button/navigation/heading/image/list/form; others stay other', () => {
    const home = elementsOn(plan, '/');
    const heading = home.find((element) => element.kind === 'heading');
    expect(heading?.level).toBe(1);
    expect(heading?.name).toBe('Shop home');
    expect(heading?.role).toBe('heading');
    expect(heading?.text).toBe('Shop home');

    const link = home.find((element) => element.kind === 'link');
    expect(link?.href).toBe('/products');
    expect(link?.testId).toBe('nav-products');
    expect(link?.name).toBe('Products');

    expect(home.find((element) => element.kind === 'form')).toBeDefined();
    const button = home.find((element) => element.kind === 'button');
    expect(button?.name).toBe('Checkout');

    const products = elementsOn(plan, '/products');
    const image = products.find((element) => element.kind === 'image');
    expect(image?.alt).toBe('Product photo');
    expect(products.find((element) => element.kind === 'list')).toBeDefined();
    const combobox = products.find((element) => element.role === 'combobox');
    expect(combobox?.kind).toBe('other'); // combobox is not a form-field role in v0.1
  });

  it('testIds are preserved VERBATIM (every observed testId appears on its element)', () => {
    const modelTestIds = new Set<string>();
    for (const component of fixture.model.components) {
      const testId = component.properties['testId'];
      if (typeof testId === 'string' && testId !== '') modelTestIds.add(testId);
    }
    const planTestIds = new Set<string>();
    for (const page of plan.pages) {
      for (const element of page.elements) {
        if (element.testId !== undefined) planTestIds.add(element.testId);
      }
    }
    expect([...planTestIds].sort()).toEqual([...modelTestIds].sort());
  });

  it('textboxes on a FORM-BEARING screen carry formId; on a form-less screen they do not', () => {
    const homeTextboxes = elementsOn(plan, '/').filter((element) => element.role === 'textbox');
    expect(homeTextboxes).toHaveLength(3);
    for (const textbox of homeTextboxes) {
      expect(textbox.formId).toBe(pageOf(plan, '/').forms[0]?.id);
    }
    const productsTextbox = elementsOn(plan, '/products').find((element) => element.role === 'textbox');
    expect(productsTextbox).toBeDefined();
    expect(productsTextbox?.formId).toBeUndefined();
  });
});

describe('planSynthesis — forms (gated by submit transitions)', () => {
  const fixture = buildShopModel();
  const plan = planSynthesis(fixture.model);

  it('the submit-bearing screen gets ONE form; method is "get" with an assumption', () => {
    const home = pageOf(plan, '/');
    expect(home.forms).toHaveLength(1);
    const form = home.forms[0]!;
    expect(form.action).toBe('/checkout-success'); // the submit transition's toScreen route
    expect(form.method).toBe('get');
    expect(plan.assumptions.some((entry) => entry.includes('planned with method "get"'))).toBe(true);
  });

  it('fields derive from textbox components: name/label/type/required/placeholder', () => {
    const form = pageOf(plan, '/').forms[0]!;
    expect(form.fields).toHaveLength(2); // search + email; the nameless/testId-less one is skipped
    const search = form.fields.find((field) => field.name === 'Search')!;
    expect(search.type).toBe('search');
    expect(search.label).toBe('Search');
    expect(search.testId).toBe('search-box');
    expect(search.required).toBe(true);
    expect(search.placeholder).toBe('Type to search');
    const email = form.fields.find((field) => field.name === 'email-field')!;
    expect(email.type).toBe('text'); // fallback + assumption
    expect(email.label).toBe('email-field'); // no accessible name — labelled by the derived name
  });

  it('field fallbacks and skips are documented as assumptions (never silent)', () => {
    expect(plan.assumptions.some((entry) => entry.includes('derived from data-testid "email-field"'))).toBe(true);
    expect(plan.assumptions.some((entry) => entry.includes('planned with type "text"'))).toBe(true);
    expect(plan.assumptions.some((entry) => entry.includes('skipped as a form field'))).toBe(true);
  });

  it('submitLabel/submitTestId come from the screen\'s first button component', () => {
    const form = pageOf(plan, '/').forms[0]!;
    expect(form.submitLabel).toBe('Checkout');
    expect(form.submitTestId).toBe('checkout-submit');
  });

  it('screens WITHOUT submit transitions carry NO forms (textboxes stay plain elements)', () => {
    expect(pageOf(plan, '/products').forms).toEqual([]);
    expect(pageOf(plan, '/plain').forms).toEqual([]);
  });

  it('the form container element (first form-role component) references the form', () => {
    const formElement = elementsOn(plan, '/').find((element) => element.kind === 'form');
    expect(formElement?.formId).toBe(pageOf(plan, '/').forms[0]?.id);
  });
});

describe('planSynthesis — transitions → navigation', () => {
  const fixture = buildShopModel();
  const plan = planSynthesis(fixture.model);

  it('every resolvable transition becomes a planned transition (5 of 5)', () => {
    expect(plan.navigation).toHaveLength(5);
  });

  it('a submit transition plans a form-submit trigger', () => {
    const nav = plan.navigation.find((entry) => entry.sourceTransitionIds[0] === fixture.ids.submitTransition);
    const form = pageOf(plan, '/').forms[0];
    expect(form).toBeDefined();
    expect(nav?.trigger).toEqual({ kind: 'form-submit', formId: form!.id });
    expect(nav?.fromRouteId).toBe(plan.routes.find((route) => route.path === '/')?.id);
    expect(nav?.toRouteId).toBe(plan.routes.find((route) => route.path === '/checkout-success')?.id);
  });

  it('a click whose input names exactly one link plans a link trigger', () => {
    const nav = plan.navigation.find((entry) => entry.sourceTransitionIds[0] === fixture.ids.clickToProducts);
    const linkElement = elementsOn(plan, '/').find((element) => element.testId === 'nav-products');
    expect(linkElement).toBeDefined();
    expect(nav?.trigger).toEqual({ kind: 'link', elementId: linkElement!.id });
  });

  it('a self-transition is legal (fromRouteId === toRouteId)', () => {
    const nav = plan.navigation.find((entry) => entry.sourceTransitionIds[0] === fixture.ids.clickSelf);
    expect(nav).toBeDefined();
    expect(nav?.fromRouteId).toBe(nav?.toRouteId);
  });

  it('click without input, timer triggers, and ambiguous clicks plan redirects WITH assumptions', () => {
    const self = plan.navigation.find((entry) => entry.sourceTransitionIds[0] === fixture.ids.clickSelf);
    expect(self?.trigger.kind).toBe('redirect');
    const timer = plan.navigation.find((entry) => entry.sourceTransitionIds[0] === fixture.ids.timerTransition);
    expect(timer?.trigger).toMatchObject({ kind: 'redirect', reason: expect.stringContaining('timer') });
    const ambiguous = plan.navigation.find((entry) => entry.sourceTransitionIds[0] === fixture.ids.clickAmbiguous);
    expect(ambiguous?.trigger).toMatchObject({ kind: 'redirect', reason: expect.stringContaining('more than one link') });
    const redirectAssumptions = plan.assumptions.filter((entry) => entry.includes('planned as a redirect'));
    expect(redirectAssumptions).toHaveLength(3);
  });

  it('redirect triggers carry assumed provenance; attributed ones derived', () => {
    for (const nav of plan.navigation) {
      if (nav.trigger.kind === 'redirect') expect(nav.provenance.level).toBe('assumed');
      else expect(nav.provenance.level).toBe('derived');
    }
  });
});

describe('planSynthesis — data entities → storage bindings', () => {
  const fixture = buildShopModel();
  const plan = planSynthesis(fixture.model);

  it('localStorage/sessionStorage/cookie persistence entries parse into bindings', () => {
    expect(plan.storage).toHaveLength(2);
    const cart = plan.storage.find((binding) => binding.key === 'cart-count')!;
    expect(cart.storage).toBe('localStorage');
    expect(cart.entityFieldNames).toEqual(['itemCount']);
    const entityId = fixture.model.data.entities[0]?.id;
    expect(entityId).toBeDefined();
    expect(cart.sourceEntityIds).toEqual([entityId!]);
    const cookie = plan.storage.find((binding) => binding.key === 'session-id')!;
    expect(cookie.storage).toBe('cookie');
    expect(cookie.entityFieldNames).toEqual(['userId']);
  });

  it('writtenOn lists transitions whose sideEffects mention the entity or key; empty when unobserved', () => {
    const submitNav = plan.navigation.find(
      (entry) => entry.sourceTransitionIds[0] === fixture.ids.submitTransition,
    );
    expect(submitNav).toBeDefined();
    const cart = plan.storage.find((binding) => binding.key === 'cart-count')!;
    expect(cart.writtenOn).toEqual([submitNav!.id]); // "persists cart" mentions the entity name
    const cookie = plan.storage.find((binding) => binding.key === 'session-id')!;
    expect(cookie.writtenOn).toEqual([]); // honestly empty — nothing mentions the session entity or key
  });

  it('unparseable persistence entries are skipped WITH an assumption (never silent)', () => {
    expect(plan.storage.every((binding) => binding.key !== 'users')).toBe(true);
    expect(plan.assumptions.some((entry) => entry.includes('"server:users"'))).toBe(true);
  });
});

describe('planSynthesis — api operations → endpoints + mocks', () => {
  const fixture = buildShopModel();
  const plan = planSynthesis(fixture.model);

  it('http ops with a method become endpoints; schemas pass through', () => {
    expect(plan.api.endpoints).toHaveLength(2);
    const list = plan.api.endpoints.find((endpoint) => endpoint.urlPattern === '/api/items')!;
    expect(list.method).toBe('GET');
    expect(list.requestSchema).toEqual({ type: 'object', keys: ['q'], valueTypes: { q: 'string' } });
    expect(list.responseSchema).toEqual({ type: 'object', keys: ['items', 'total'], valueTypes: { items: 'array', total: 'number' } });
    expect(list.errorSchema).toEqual({ type: 'object', keys: ['message'], valueTypes: { message: 'string' } });
    const listOpId = fixture.model.api.operations.find((op) => op.urlPattern === '/api/items')?.id;
    expect(listOpId).toBeDefined();
    expect(list.sourceOperationIds).toEqual([listOpId!]);
    const checkout = plan.api.endpoints.find((endpoint) => endpoint.urlPattern === '/api/checkout')!;
    expect(checkout.method).toBe('POST');
    expect(checkout.responseSchema).toBeUndefined(); // absent, never null
  });

  it('one sketched MockResponse per endpoint WITH a responseSchema', () => {
    expect(plan.api.mocks).toHaveLength(1);
    const mock = plan.api.mocks[0]!;
    expect(mock.statusCode).toBe(200);
    expect(mock.bodyJson).toEqual({ items: [], total: 0 });
    const listEndpointId = plan.api.endpoints.find((endpoint) => endpoint.urlPattern === '/api/items')?.id;
    expect(listEndpointId).toBeDefined();
    expect(mock.endpointId).toBe(listEndpointId!);
  });

  it('websocket ops are skipped with ONE assumption; methodless http ops too', () => {
    expect(plan.api.endpoints.every((endpoint) => !endpoint.urlPattern.includes('wss://'))).toBe(true);
    const wsAssumption = plan.assumptions.find((entry) => entry.includes('websocket-transport'));
    expect(wsAssumption).toBeDefined();
    expect(wsAssumption).toContain('wss://stream.example/items'); // ids listed, never silent
    expect(plan.assumptions.some((entry) => entry.includes('/api/no-method'))).toBe(true);
  });
});

describe('planSynthesis — journeys → acceptance', () => {
  const fixture = buildShopModel();
  const plan = planSynthesis(fixture.model, { journeys: [MATCHED_JOURNEY, UNMATCHED_JOURNEY] });

  it('one acceptance entry per journey record, in input order', () => {
    expect(plan.acceptance.map((entry) => entry.journeyId)).toEqual([MATCHED_JOURNEY.id, UNMATCHED_JOURNEY.id]);
  });

  it('a matching IrJourney supplies purpose/steps; expectedRoute + mustSee resolve', () => {
    const matched = plan.acceptance[0]!;
    expect(matched.purpose).toBe('reach /'); // from the IrJourney
    const irSteps = fixture.model.journeys[0]?.steps;
    expect(irSteps).toBeDefined();
    expect(matched.steps).toEqual(irSteps!);
    expect(matched.sourceJourneyIds).toEqual([fixture.ids.homeIrJourney]);
    expect(matched.expectedRoute).toBe('/'); // last resolved assert: heading "Shop home" on /
    const navLink = elementsOn(plan, '/').find((element) => element.testId === 'nav-products');
    const heading = elementsOn(plan, '/').find((element) => element.kind === 'heading');
    expect(navLink).toBeDefined();
    expect(heading).toBeDefined();
    expect(matched.mustSeeElementIds).toEqual([navLink!.id, heading!.id]);
  });

  it('an unmatched journey derives purpose/steps from the record WITH an assumption', () => {
    const unmatched = plan.acceptance[1]!;
    expect(unmatched.purpose).toBe(UNMATCHED_JOURNEY.name);
    expect(unmatched.steps).toEqual(UNMATCHED_JOURNEY.actions.map(describeJourneyAction));
    expect(unmatched.sourceJourneyIds).toEqual([]);
    expect(plan.assumptions.some((entry) => entry.includes('no matching IrJourney'))).toBe(true);
  });

  it('expectedRoute falls back through the journey\'s own navigation evidence', () => {
    // the unmatched journey navigates "/products.html" and asserts an image there;
    // the last RESOLVED assert is the image on /products
    const unmatched = plan.acceptance[1]!;
    expect(unmatched.expectedRoute).toBe('/products');
    const image = elementsOn(plan, '/products').find((element) => element.kind === 'image');
    expect(image).toBeDefined();
    expect(unmatched.mustSeeElementIds).toEqual([image!.id]);
  });

  it('every unresolved assert target gets exactly one assumption (never dropped silently)', () => {
    const unresolved = plan.assumptions.filter((entry) => entry.startsWith('unresolved assert target'));
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0]).toContain('testId=does-not-exist');
    expect(unresolved[0]).toContain(UNMATCHED_JOURNEY.id);
  });

  it('absent journeys → acceptance stays EMPTY with one assumption', () => {
    const empty = planSynthesis(fixture.model);
    expect(empty.acceptance).toEqual([]);
    expect(empty.assumptions.some((entry) => entry.includes('no journey records were supplied'))).toBe(true);
  });
});

describe('planSynthesis — small helpers', () => {
  it('routeFromJourneyUrl mirrors the explore normalization', () => {
    expect(routeFromJourneyUrl('/')).toBe('/');
    expect(routeFromJourneyUrl('/index.html')).toBe('/');
    expect(routeFromJourneyUrl('/contact.html?x=1#frag')).toBe('/contact');
    expect(routeFromJourneyUrl('features.html')).toBe('/features');
    expect(routeFromJourneyUrl('/a/b.html')).toBe('/a/b');
  });

  it('describeJourneyAction renders the canonical step summaries', () => {
    expect(describeJourneyAction({ type: 'navigate', url: '/' })).toBe('navigate to /');
    expect(describeJourneyAction({ type: 'click', target: { testId: 'x' } })).toBe('click testId=x');
    expect(describeJourneyAction({ type: 'fill', target: { role: 'textbox', name: 'Email' }, value: 'a@b.c' }))
      .toBe('fill role=textbox name="Email" with "a@b.c"');
    expect(describeJourneyAction({ type: 'assert-visible', target: { role: 'heading', name: 'Hi' } }))
      .toBe('assert role=heading name="Hi" is visible');
    expect(describeJourneyAction({ type: 'press', key: 'Enter' })).toBe('press Enter');
    expect(describeJourneyAction({ type: 'wait', ms: 25 })).toBe('wait 25ms');
  });

  it('sketchMockBody is deterministic and covers the declared sketch semantics', () => {
    const schema = { type: 'object', keys: ['a', 'b', 'c', 'd', 'e'], valueTypes: { a: 'string', b: 'number', c: 'boolean', d: 'array', e: 'object' } };
    expect(sketchMockBody(schema)).toEqual({ a: 'mock', b: 0, c: false, d: [], e: {} });
    expect(sketchMockBody(schema)).toEqual(sketchMockBody(schema));
    expect(sketchMockBody({ type: 'array' })).toEqual([]);
    expect(sketchMockBody({ type: 'string' })).toBe('mock');
    expect(sketchMockBody({ type: 'boolean' })).toBe(false);
    expect(sketchMockBody({ type: 'integer' })).toBe(0);
    expect(sketchMockBody({ type: 'null' })).toBeUndefined();
    expect(sketchMockBody({ type: 'object', keys: ['gone'], valueTypes: { gone: 'null' } })).toEqual({}); // null-typed keys omitted
    expect(sketchMockBody({ type: 'object' })).toEqual({});
    expect(sketchMockBody({ unknown: true })).toEqual({});
    expect(sketchMockBody('weird')).toBe('mock');
    expect(sketchMockBody(42)).toBe(0);
    expect(sketchMockBody([1, 2])).toEqual([]);
  });
});
