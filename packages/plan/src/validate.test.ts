/**
 * CLAPP-030 test battery — the validator defect battery.
 *
 * A hand-built defect applied to a VALID literal plan (or the medium plan's
 * structure) must produce the PATH-QUALIFIED error naming the defect's exact
 * location; the same plan without the defect must stay valid. Totality is
 * pinned too: exotic inputs (null, arrays, cycles) produce errors, never
 * throws.
 */

import { describe, expect, it } from 'bun:test';
import { validateSynthesisPlan, validateSynthesisPlanDetailed } from './index';
import { LITERAL_PLAN_MEDIUM, clonePlan } from './test-utils';
import type { SynthesisPlan } from './synthesis-contract';

/** Mutate a clone of the medium literal plan; return the clone. */
function mutate(fn: (plan: SynthesisPlan) => void): SynthesisPlan {
  const plan = clonePlan(LITERAL_PLAN_MEDIUM);
  fn(plan);
  return plan;
}

/** Expect the mutation to produce at least one error matching every fragment. */
function expectErrors(plan: SynthesisPlan, ...fragments: string[]): void {
  const result = validateSynthesisPlanDetailed(plan);
  expect(result.valid).toBe(false);
  for (const fragment of fragments) {
    const matched = result.errors.some((error) => error.includes(fragment));
    expect(matched).toBe(true);
  }
}

describe('validator — id discipline', () => {
  it('a bad route id is reported at its exact path', () => {
    expectErrors(mutate((plan) => { plan.routes[0]!.id = 'not-an-id'; }), 'routes[0].id', 'route_');
  });
  it('a bad page id is reported at its exact path', () => {
    expectErrors(mutate((plan) => { plan.pages[1]!.id = 'page_x'; }), 'pages[1].id', 'page_');
  });
  it('a bad element id is reported at its exact path', () => {
    expectErrors(mutate((plan) => { plan.pages[0]!.elements[2]!.id = ''; }), 'pages[0].elements[2].id');
  });
  it('a bad form id is reported at its exact path', () => {
    expectErrors(mutate((plan) => { plan.pages[0]!.forms[0]!.id = 'form_nouuid'; }), 'pages[0].forms[0].id', 'form_');
  });
  it('a bad storage-binding id is reported at its exact path', () => {
    expectErrors(mutate((plan) => { plan.storage[0]!.id = 'store_000'; }), 'storage[0].id');
  });
  it('a bad planned-application id is reported', () => {
    expectErrors(mutate((plan) => { plan.application.id = 'app_00000000-0000-4000-8000-000000000000'; }), 'application.id', 'appsyn_');
  });
  it('a bad sourceModelId (IR app_ pattern) is reported', () => {
    expectErrors(mutate((plan) => { plan.application.sourceModelId = 'appzz_00000000-0000-4000-8000-000000000000'; }), 'application.sourceModelId', 'app_');
  });
  it('a bad journeyId shape on acceptance is reported', () => {
    expectErrors(mutate((plan) => {
      plan.acceptance.push({
        id: 'acc_11111111-1111-4111-8111-111111111112',
        journeyId: 'j_00000000-0000-4000-8000-000000000000',
        purpose: 'p',
        steps: ['s'],
        expectedRoute: '/',
        mustSeeElementIds: [],
        sourceJourneyIds: [],
        provenance: { level: 'planned', rationale: 'r', sourceIds: [], evidenceRefs: [] },
      });
    }), 'acceptance[0].journeyId', 'journey_');
  });
  it('a bad sourceTransitionId (IR trans_ pattern) is reported', () => {
    expectErrors(mutate((plan) => { plan.navigation[0]!.sourceTransitionIds = ['transX_1']; }), 'navigation[0].sourceTransitionIds[0]', 'trans_');
  });
  it('a bad sourceEntityIds entry (IR ent_ pattern) is reported', () => {
    expectErrors(mutate((plan) => { plan.storage[0]!.sourceEntityIds = ['ent_bad']; }), 'storage[0].sourceEntityIds[0]', 'ent_');
  });
  it('a bad sourceOperationIds entry (IR op_ pattern) is reported', () => {
    expectErrors(mutate((plan) => {
      plan.api.endpoints.push({
        id: 'api_11111111-1111-4111-8111-111111111113',
        method: 'GET',
        urlPattern: '/x',
        sourceOperationIds: ['op?'],
        provenance: { level: 'planned', rationale: 'r', sourceIds: [], evidenceRefs: [] },
      });
    }), 'api.endpoints[0].sourceOperationIds[0]', 'op_');
  });
});

describe('validator — cross-references', () => {
  it('a dangling route.pageId is reported', () => {
    expectErrors(mutate((plan) => { plan.routes[1]!.pageId = 'page_99999999-9999-4999-8999-999999999999'; }), 'routes[1].pageId', 'does not resolve to a PlannedPage');
  });
  it('a dangling page.routeId is reported', () => {
    expectErrors(mutate((plan) => { plan.pages[1]!.routeId = 'route_99999999-9999-4999-8999-999999999999'; }), 'pages[1].routeId', 'does not resolve to a PlannedRoute');
  });
  it('a formId on the WRONG page is reported (same-page rule)', () => {
    // the search-box element lives on page[0]; point its formId at a form that
    // does not exist on that page (it exists nowhere — simplest wrong-page case)
    expectErrors(mutate((plan) => { plan.pages[0]!.elements[2]!.formId = 'form_99999999-9999-4999-8999-999999999999'; }), 'pages[0].elements[2].formId', 'SAME page');
  });
  it('a nav link trigger whose element is on ANOTHER page is reported', () => {
    // the link trigger points at the products-page image element
    expectErrors(mutate((plan) => {
      const wrong = plan.pages[1]!.elements[0]!.id;
      plan.navigation[0]!.trigger = { kind: 'link', elementId: wrong };
    }), 'navigation[0].trigger.elementId', "from-route's page");
  });
  it('a nav form-submit trigger with a form not on the from-route page is reported', () => {
    expectErrors(mutate((plan) => {
      plan.navigation[0]!.trigger = { kind: 'form-submit', formId: 'form_99999999-9999-4999-8999-999999999999' };
    }), 'navigation[0].trigger.formId', "from-route's page");
  });
  it('dangling nav from/to route ids are reported', () => {
    expectErrors(mutate((plan) => { plan.navigation[0]!.fromRouteId = 'route_99999999-9999-4999-8999-999999999999'; }), 'navigation[0].fromRouteId');
    expectErrors(mutate((plan) => { plan.navigation[0]!.toRouteId = 'route_88888888-8888-4888-8888-888888888888'; }), 'navigation[0].toRouteId');
  });
  it('a mock with an unknown endpointId is reported', () => {
    expectErrors(mutate((plan) => {
      plan.api.mocks.push({ id: 'mock_11111111-1111-4111-8111-111111111111', endpointId: 'api_99999999-9999-4999-8999-999999999999', statusCode: 200 });
    }), 'api.mocks[0].endpointId', 'does not resolve');
  });
  it('a storage writtenOn id that resolves to no transition is reported', () => {
    expectErrors(mutate((plan) => { plan.storage[0]!.writtenOn = ['nav_99999999-9999-4999-8999-999999999999']; }), 'storage[0].writtenOn[0]', 'does not resolve');
  });
  it('an entrypoint that is not a served route is reported', () => {
    expectErrors(mutate((plan) => { plan.application.entrypoints = ['/nowhere']; }), 'application.entrypoints[0]', 'not a served route');
  });
  it('an expectedRoute that is not a served route is reported', () => {
    expectErrors(mutate((plan) => {
      plan.acceptance.push({
        id: 'acc_11111111-1111-4111-8111-111111111111',
        journeyId: 'journey_11111111-1111-4111-8111-111111111111',
        purpose: 'p',
        steps: ['s'],
        expectedRoute: '/missing',
        mustSeeElementIds: [],
        sourceJourneyIds: [],
        provenance: { level: 'planned', rationale: 'r', sourceIds: [], evidenceRefs: [] },
      });
    }), 'acceptance[0].expectedRoute', 'not a served route');
  });
  it('a mustSee element on the WRONG page (another page) is reported', () => {
    expectErrors(mutate((plan) => {
      plan.acceptance.push({
        id: 'acc_11111111-1111-4111-8111-111111111111',
        journeyId: 'journey_11111111-1111-4111-8111-111111111111',
        purpose: 'p',
        steps: ['s'],
        expectedRoute: '/',
        // the image element lives on /products, not on the expected page /
        mustSeeElementIds: [plan.pages[1]!.elements[0]!.id],
        sourceJourneyIds: [],
        provenance: { level: 'planned', rationale: 'r', sourceIds: [], evidenceRefs: [] },
      });
    }), 'acceptance[0].mustSeeElementIds[0]', "expectedRoute's page");
  });
  it('the route↔page bijection is enforced (two routes on one page)', () => {
    expectErrors(mutate((plan) => { plan.routes[1]!.pageId = plan.routes[0]!.pageId; }), 'routes[1].pageId', 'already rendered by another route');
  });
  it('the route↔page bijection is enforced (two pages on one route)', () => {
    expectErrors(mutate((plan) => { plan.pages[1]!.routeId = plan.pages[0]!.routeId; }), 'pages[1].routeId', 'already rendered by');
  });
  it('an orphan page (no route renders it) is reported', () => {
    expectErrors(mutate((plan) => { plan.routes = plan.routes.slice(0, 1); }), 'pages[1].id', 'not rendered by any route');
  });
  it('a duplicate route path is reported', () => {
    expectErrors(mutate((plan) => { plan.routes[1]!.path = '/'; }), 'routes[1].path', 'duplicate route path');
  });
  it('a duplicate element id across pages is reported', () => {
    expectErrors(mutate((plan) => { plan.pages[1]!.elements[0]!.id = plan.pages[0]!.elements[0]!.id; }), 'duplicate element id');
  });
});

describe('validator — shapes, vocabularies, nulls', () => {
  it('a wrong planVersion is reported', () => {
    expectErrors(mutate((plan) => { plan.planVersion = '0.2'; }), 'planVersion');
  });
  it('a null value anywhere is reported at its exact path (never valid)', () => {
    expectErrors(mutate((plan) => { (plan.pages[0] as unknown as Record<string, unknown>)['title'] = null; }), 'pages[0].title', 'null');
    expectErrors(mutate((plan) => { (plan.pages[0]!.elements[0] as unknown as Record<string, unknown>)['href'] = null; }), 'pages[0].elements[0].href', 'null');
  });
  it('a null buried in an opaque mock body is reported by the deep scan', () => {
    expectErrors(mutate((plan) => {
      plan.api.endpoints.push({
        id: 'api_11111111-1111-4111-8111-111111111114',
        method: 'GET',
        urlPattern: '/x',
        responseSchema: { nested: null },
        sourceOperationIds: [],
        provenance: { level: 'planned', rationale: 'r', sourceIds: [], evidenceRefs: [] },
      });
    }), 'null');
  });
  it('an invalid element kind is reported with the vocabulary', () => {
    expectErrors(mutate((plan) => { (plan.pages[0]!.elements[0] as unknown as Record<string, unknown>)['kind'] = 'textbox'; }), 'pages[0].elements[0].kind', 'heading|text|link|button|image|navigation|form|list|other');
  });
  it('a heading level outside 1-6 is reported', () => {
    expectErrors(mutate((plan) => { plan.pages[0]!.elements[0]!.level = 7; }), 'pages[0].elements[0].level', 'integer 1-6');
  });
  it('a level on a non-heading element is reported', () => {
    expectErrors(mutate((plan) => { plan.pages[1]!.elements[0]!.level = 2; }), 'pages[1].elements[0].level', 'only on kind "heading"');
  });
  it('an invalid storage kind is reported with the vocabulary', () => {
    expectErrors(mutate((plan) => { (plan.storage[0] as unknown as Record<string, unknown>)['storage'] = 'indexedDB'; }), 'storage[0].storage', 'localStorage|sessionStorage|cookie|server');
  });
  it('an invalid form method is reported', () => {
    expectErrors(mutate((plan) => { (plan.pages[0]!.forms[0] as unknown as Record<string, unknown>)['method'] = 'put'; }), 'pages[0].forms[0].method', 'get|post');
  });
  it('an invalid trigger kind is reported', () => {
    expectErrors(mutate((plan) => {
      (plan.navigation[0] as unknown as Record<string, unknown>)['trigger'] = { kind: 'magic' };
    }), 'navigation[0].trigger.kind', 'link|form-submit|redirect');
  });
  it('a redirect trigger without a reason is reported', () => {
    expectErrors(mutate((plan) => { plan.navigation[0]!.trigger = { kind: 'redirect', reason: '' }; }), 'navigation[0].trigger.reason', 'non-empty');
  });
  it('an invalid provenance level is reported', () => {
    expectErrors(mutate((plan) => { (plan.routes[0]!.provenance as unknown as Record<string, unknown>)['level'] = 'observed'; }), 'routes[0].provenance.level', 'derived|planned|assumed');
  });
  it('an empty provenance rationale is reported', () => {
    expectErrors(mutate((plan) => { plan.routes[0]!.provenance.rationale = '  '; }), 'routes[0].provenance.rationale', 'non-empty');
  });
  it('a malformed evidenceRef (id/kind/sha256) is reported', () => {
    expectErrors(mutate((plan) => { plan.routes[0]!.provenance.evidenceRefs[0]!.evidenceId = 'evv_1'; }), 'routes[0].provenance.evidenceRefs[0].evidenceId', 'ev_');
    expectErrors(mutate((plan) => { (plan.routes[0]!.provenance.evidenceRefs[0] as unknown as Record<string, unknown>)['kind'] = 'vibe'; }), 'routes[0].provenance.evidenceRefs[0].kind', 'dom|runtime|network|storage|screenshot|static|user');
    expectErrors(mutate((plan) => { plan.routes[0]!.provenance.evidenceRefs[0]!.sha256 = 'zz'; }), 'routes[0].provenance.evidenceRefs[0].sha256', '64 lowercase hex');
  });
  it('a bad server spec is reported (command/port/healthPath)', () => {
    expectErrors(mutate((plan) => { plan.server.startCommand = ''; }), 'server.startCommand', 'non-empty');
    expectErrors(mutate((plan) => { plan.server.port = 0; }), 'server.port', 'integer 1-65535');
    expectErrors(mutate((plan) => { plan.server.port = 99999; }), 'server.port', 'integer 1-65535');
    expectErrors(mutate((plan) => { plan.server.healthPath = 'health'; }), 'server.healthPath', 'starting with "/"');
  });
  it('an empty field name / label / type is reported', () => {
    expectErrors(mutate((plan) => { plan.pages[0]!.forms[0]!.fields[0]!.name = ''; }), 'pages[0].forms[0].fields[0].name', 'non-empty');
    expectErrors(mutate((plan) => { plan.pages[0]!.forms[0]!.fields[0]!.type = ''; }), 'pages[0].forms[0].fields[0].type', 'non-empty');
    expectErrors(mutate((plan) => { plan.pages[0]!.forms[0]!.fields[0]!.label = ''; }), 'pages[0].forms[0].fields[0].label', 'non-empty');
  });
  it('malformed field options are reported', () => {
    expectErrors(mutate((plan) => { plan.pages[0]!.forms[0]!.fields[0]!.options = [{ value: '', label: 'x' }]; }), 'fields[0].options[0].value', 'non-empty');
  });
  it('a bad mock statusCode is reported', () => {
    expectErrors(mutate((plan) => {
      plan.api.mocks.push({ id: 'mock_11111111-1111-4111-8111-111111111112', endpointId: plan.api.endpoints[0]?.id ?? 'api_1', statusCode: 42 });
    }), 'api.mocks[0].statusCode', 'integer 100-599');
  });
});

describe('validator — totality (never throws)', () => {
  it('exotic inputs produce errors, not throws', () => {
    for (const input of [null, undefined, 42, 'plan', [], [[]], { planVersion: '0.1' }]) {
      const result = validateSynthesisPlanDetailed(input);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });
  it('a cyclic input produces an error, not a hang or throw', () => {
    const cyclic: Record<string, unknown> = { planVersion: '0.1' };
    cyclic['self'] = cyclic;
    const result = validateSynthesisPlanDetailed(cyclic);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
  it('the predicate narrows a valid plan', () => {
    const plan = clonePlan(LITERAL_PLAN_MEDIUM);
    if (validateSynthesisPlan(plan)) {
      expect(plan.routes).toHaveLength(2); // narrowed and usable
    } else {
      throw new Error('predicate should have accepted the medium plan');
    }
  });
});
