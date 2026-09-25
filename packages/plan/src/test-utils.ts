/**
 * @clapp/plan — shared test fixtures (NOT part of the public surface; the
 * package's tests import it directly, the same pattern as
 * @clapp/extract's src/test-utils.ts).
 *
 * - deterministic uuid-shaped ids for literal plans (hex-only, version/
 *   variant bits NOT pinned — same leniency as the id patterns);
 * - three DISTINCT valid literal SynthesisPlans (minimal / medium / full)
 *   used by the contract, validator, and serialize batteries;
 * - a rich hand-built IrModel factory (via @clapp/ir's frozen builder) used
 *   by the derivation and determinism batteries;
 * - two journey records (one with a matching IrJourney, one without).
 */

import type { EvidenceRef } from '@clapp/core';
import type { Journey } from '@clapp/journey';
import { createIrModelBuilder } from '@clapp/ir';
import type { IrModel } from '@clapp/ir';
import type { PlanProvenance, SynthesisPlan } from './synthesis-contract';

// ---------------------------------------------------------------------------
// Deterministic ids + evidence refs
// ---------------------------------------------------------------------------

function fixedId(prefix: string, n: string): string {
  return `${prefix}${n}`;
}

/** Deterministic uuid-shaped hex (satisfies the 8-4-4-4-12 shape, any bits). */
export const U = {
  one: '11111111-1111-4111-8111-111111111111',
  two: '22222222-2222-4222-8222-222222222222',
  three: '33333333-3333-4333-8333-333333333333',
  four: '44444444-4444-4444-8444-444444444444',
  five: '55555555-5555-4555-8555-555555555555',
  six: '66666666-6666-4666-8666-666666666666',
  seven: '77777777-7777-4777-8777-777777777777',
  eight: '88888888-8888-4888-8888-888888888888',
  nine: '99999999-9999-4999-8999-999999999999',
  ten: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  eleven: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  twelve: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
} as const;

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const SHA_C = 'c'.repeat(64);

export const DOM_REF: EvidenceRef = { evidenceId: fixedId('ev_', U.one), kind: 'dom', sha256: SHA_A };
export const USER_REF: EvidenceRef = { evidenceId: fixedId('ev_', U.two), kind: 'user', sha256: SHA_B };
export const STATIC_REF: EvidenceRef = { evidenceId: fixedId('ev_', U.three), kind: 'static', sha256: SHA_C };

function derived(rationale: string, sourceIds: string[], evidenceRefs: EvidenceRef[]): PlanProvenance {
  return { level: 'derived', rationale, sourceIds: [...sourceIds], evidenceRefs: evidenceRefs.map((r) => ({ ...r })) };
}

/** A 'planned'-level provenance block (no single IR source). */
export function planned(rationale: string): PlanProvenance {
  return { level: 'planned', rationale, sourceIds: [], evidenceRefs: [] };
}

// ---------------------------------------------------------------------------
// Literal plan 1 — minimal (empty sections are structurally valid)
// ---------------------------------------------------------------------------

export const LITERAL_PLAN_MINIMAL: SynthesisPlan = {
  planVersion: '0.1',
  application: {
    id: fixedId('appsyn_', U.one),
    name: 'Empty (synth)',
    platform: 'web',
    sourceModelId: fixedId('app_', U.four),
    entrypoints: [],
  },
  routes: [],
  pages: [],
  navigation: [],
  storage: [],
  api: { endpoints: [], mocks: [] },
  acceptance: [],
  server: { startCommand: 'bun run start', port: 4173, healthPath: '/' },
  assumptions: ['nothing was observed — the plan is structurally empty'],
  constraints: [],
};

// ---------------------------------------------------------------------------
// Literal plan 2 — routes/pages/elements/forms/navigation/storage
// ---------------------------------------------------------------------------

const L2_ROUTE_HOME = fixedId('route_', U.one);
const L2_PAGE_HOME = fixedId('page_', U.one);
const L2_ROUTE_PRODUCTS = fixedId('route_', U.two);
const L2_PAGE_PRODUCTS = fixedId('page_', U.two);
const L2_FORM = fixedId('form_', U.one);
const L2_EL_HEADING = fixedId('el_', U.one);
const L2_EL_SEARCH = fixedId('el_', U.two);
const L2_EL_SUBMIT = fixedId('el_', U.three);
const L2_EL_FORM = fixedId('el_', U.four);
const L2_EL_IMAGE = fixedId('el_', U.five);
const L2_NAV = fixedId('nav_', U.one);
const L2_STORE = fixedId('store_', U.one);

export const LITERAL_PLAN_MEDIUM: SynthesisPlan = {
  planVersion: '0.1',
  application: {
    id: fixedId('appsyn_', U.two),
    name: 'Shop (synth)',
    platform: 'web',
    sourceModelId: fixedId('app_', U.four),
    entrypoints: ['/'],
  },
  routes: [
    { id: L2_ROUTE_HOME, path: '/', pageId: L2_PAGE_HOME, provenance: derived('from screen /', [fixedId('screen_', U.one)], [DOM_REF]) },
    { id: L2_ROUTE_PRODUCTS, path: '/products', pageId: L2_PAGE_PRODUCTS, provenance: derived('from screen /products', [fixedId('screen_', U.two)], [DOM_REF]) },
  ],
  pages: [
    {
      id: L2_PAGE_HOME,
      routeId: L2_ROUTE_HOME,
      title: 'Shop home',
      elements: [
        {
          id: L2_EL_HEADING,
          kind: 'heading',
          role: 'heading',
          name: 'Shop home',
          text: 'Shop home',
          level: 1,
          provenance: derived('heading component', [fixedId('comp_', U.one)], [DOM_REF]),
        },
        {
          id: L2_EL_FORM,
          kind: 'form',
          role: 'form',
          name: 'Search',
          formId: L2_FORM,
          provenance: derived('form component', [fixedId('comp_', U.two)], [DOM_REF]),
        },
        {
          id: L2_EL_SEARCH,
          kind: 'other',
          role: 'textbox',
          name: 'Search',
          testId: 'search-box',
          formId: L2_FORM,
          provenance: derived('textbox component', [fixedId('comp_', U.three)], [DOM_REF]),
        },
        {
          id: L2_EL_SUBMIT,
          kind: 'button',
          role: 'button',
          name: 'Subscribe',
          testId: 'search-submit',
          provenance: derived('button component', [fixedId('comp_', U.four)], [DOM_REF]),
        },
      ],
      forms: [
        {
          id: L2_FORM,
          action: '/products',
          method: 'get',
          fields: [
            { name: 'Search', type: 'search', label: 'Search', testId: 'search-box', required: true, placeholder: 'Type to search' },
          ],
          submitLabel: 'Subscribe',
          submitTestId: 'search-submit',
          provenance: derived('form from textboxes + submit transition', [fixedId('trans_', U.one), fixedId('comp_', U.three), fixedId('comp_', U.four)], [DOM_REF, USER_REF]),
        },
      ],
      provenance: derived('page from screen', [fixedId('screen_', U.one)], [DOM_REF]),
    },
    {
      id: L2_PAGE_PRODUCTS,
      routeId: L2_ROUTE_PRODUCTS,
      title: 'Products',
      elements: [
        {
          id: L2_EL_IMAGE,
          kind: 'image',
          role: 'image',
          name: 'Product photo',
          alt: 'Product photo',
          provenance: derived('image component', [fixedId('comp_', U.five)], [DOM_REF]),
        },
      ],
      forms: [],
      provenance: derived('page from screen', [fixedId('screen_', U.two)], [DOM_REF]),
    },
  ],
  navigation: [
    {
      id: L2_NAV,
      fromRouteId: L2_ROUTE_HOME,
      toRouteId: L2_ROUTE_PRODUCTS,
      trigger: { kind: 'link', elementId: L2_EL_FORM },
      sourceTransitionIds: [fixedId('trans_', U.two)],
      provenance: derived('click transition attributed to the unique link', [fixedId('trans_', U.two)], [USER_REF]),
    },
  ],
  storage: [
    {
      id: L2_STORE,
      key: 'cart-count',
      storage: 'localStorage',
      entityFieldNames: ['itemCount'],
      writtenOn: [L2_NAV],
      sourceEntityIds: [fixedId('ent_', U.one)],
      provenance: derived('persistence entry', [fixedId('ent_', U.one), fixedId('trans_', U.two)], [DOM_REF]),
    },
  ],
  api: { endpoints: [], mocks: [] },
  acceptance: [],
  server: { startCommand: 'bun run start', port: 4173, healthPath: '/' },
  assumptions: ['form on route "/" planned with method "get" — no HTTP form method is observable in IR v0.1'],
  constraints: ['observed charset utf-8'],
};

// ---------------------------------------------------------------------------
// Literal plan 3 — api endpoints + mocks + acceptance + assumptions/constraints
// ---------------------------------------------------------------------------

const L3_ROUTE_A = fixedId('route_', U.three);
const L3_PAGE_A = fixedId('page_', U.three);
const L3_EL_HEADING = fixedId('el_', U.six);
const L3_API_LIST = fixedId('api_', U.one);
const L3_API_GET = fixedId('api_', U.two);
const L3_MOCK_LIST = fixedId('mock_', U.one);
const L3_ACC = fixedId('acc_', U.one);

export const LITERAL_PLAN_FULL: SynthesisPlan = {
  planVersion: '0.1',
  application: {
    id: fixedId('appsyn_', U.three),
    name: 'Api (synth)',
    platform: 'web',
    sourceModelId: fixedId('app_', U.four),
    entrypoints: ['/list'],
  },
  routes: [{ id: L3_ROUTE_A, path: '/list', pageId: L3_PAGE_A, provenance: derived('from screen /list', [fixedId('screen_', U.three)], [STATIC_REF]) }],
  pages: [
    {
      id: L3_PAGE_A,
      routeId: L3_ROUTE_A,
      title: 'Item list',
      elements: [
        {
          id: L3_EL_HEADING,
          kind: 'heading',
          role: 'heading',
          name: 'Item list',
          text: 'Item list',
          level: 2,
          provenance: derived('heading component', [fixedId('comp_', U.six)], [STATIC_REF]),
        },
      ],
      forms: [],
      provenance: derived('page from screen', [fixedId('screen_', U.three)], [STATIC_REF]),
    },
  ],
  navigation: [],
  storage: [],
  api: {
    endpoints: [
      {
        id: L3_API_LIST,
        method: 'GET',
        urlPattern: '/api/items',
        requestSchema: { type: 'object', keys: ['q'], valueTypes: { q: 'string' } },
        responseSchema: { type: 'object', keys: ['items', 'total'], valueTypes: { items: 'array', total: 'number' } },
        errorSchema: { type: 'object', keys: ['message'], valueTypes: { message: 'string' } },
        sourceOperationIds: [fixedId('op_', U.one)],
        provenance: derived('http api operation', [fixedId('op_', U.one)], [USER_REF]),
      },
      {
        id: L3_API_GET,
        method: 'POST',
        urlPattern: '/api/items/:id',
        sourceOperationIds: [fixedId('op_', U.two)],
        provenance: derived('http api operation', [fixedId('op_', U.two)], [USER_REF]),
      },
    ],
    mocks: [
      { id: L3_MOCK_LIST, endpointId: L3_API_LIST, statusCode: 200, bodyJson: { items: [], total: 0 } },
    ],
  },
  acceptance: [
    {
      id: L3_ACC,
      journeyId: fixedId('journey_', U.one),
      purpose: 'reach /list',
      steps: ['navigate to /list', 'assert role=heading name="Item list" is visible'],
      expectedRoute: '/list',
      mustSeeElementIds: [L3_EL_HEADING],
      sourceJourneyIds: [fixedId('journey_', U.one)],
      provenance: derived('journey record + matching IrJourney', [fixedId('journey_', U.one)], [USER_REF]),
    },
  ],
  server: { startCommand: 'bun run start', port: 4173, healthPath: '/' },
  assumptions: [
    'page title for route "/list" assumed from the route basename',
    'unresolved assert target (testId=missing) in journey j1',
  ],
  constraints: ['api requires no auth', 'viewport 1280x720'],
};

export const LITERAL_PLANS: readonly SynthesisPlan[] = [LITERAL_PLAN_MINIMAL, LITERAL_PLAN_MEDIUM, LITERAL_PLAN_FULL];

// ---------------------------------------------------------------------------
// Hand-built IrModel for derivation tests (via @clapp/ir's frozen builder)
// ---------------------------------------------------------------------------

export interface ShopModelFixture {
  model: IrModel;
  ids: {
    homeScreen: string;
    productsScreen: string;
    checkoutScreen: string;
    plainScreen: string;
    searchComponent: string;
    emailComponent: string;
    mysteryComponent: string;
    submitButton: string;
    imageComponent: string;
    submitTransition: string;
    clickToProducts: string;
    clickSelf: string;
    timerTransition: string;
    clickAmbiguous: string;
    homeIrJourney: string;
  };
}

/**
 * A rich, deterministic IrModel exercising every binding derivation rule:
 *
 * - screens: '/', '/products', '/checkout-success', '/plain';
 * - '/' has a submit transition (form planned: 2 usable textboxes become
 *   fields, 1 unusable one is skipped with an assumption) + heading title;
 * - '/products' has NO submit transition (textboxes stay plain elements),
 *   h2/h3 headings (title = the h2, lowest level wins), an image, a list,
 *   two textbox components, and two same-href links (click ambiguity);
 * - '/plain' has NO heading (title falls back to the route basename) and no
 *   components;
 * - transitions: click attributed by input (→ link), click without input
 *   (→ redirect + assumption), a self-transition, a timer trigger
 *   (→ redirect + assumption), submit (→ form + form-submit), an ambiguous
 *   click (→ redirect + assumption);
 * - data entity with three persistence entries (one unparseable);
 * - api: GET with responseSchema (endpoint + mock), POST without
 *   responseSchema (endpoint, no mock), a websocket op (skipped + assumption),
 *   a methodless http op (skipped + assumption);
 * - one IrJourney whose id matches MATCHED_JOURNEY below.
 */
export function buildShopModel(): ShopModelFixture {
  const builder = createIrModelBuilder({
    application: { id: fixedId('app_', U.four), name: 'Shop', platform: 'web', entrypoints: ['/'] },
  });
  const dom = builder.addEvidenceEntry(DOM_REF, 'run:run_x:dom');
  const user = builder.addEvidenceEntry(USER_REF, 'run:run_x:user');
  const observed = (rationale: string) => ({
    level: 'observed' as const,
    confidence: { value: 1, rationale, evidenceRefs: [dom.ref] },
  });

  const home = builder.addScreen({ route: '/', provenance: observed('visited'), treeRef: dom.ref });
  const products = builder.addScreen({ route: '/products', provenance: observed('visited'), treeRef: dom.ref });
  const checkout = builder.addScreen({ route: '/checkout-success', provenance: observed('visited'), treeRef: dom.ref });
  const plain = builder.addScreen({ route: '/plain', provenance: observed('visited'), treeRef: dom.ref });

  // '/' components: heading, link, form, two named/typed textboxes + one
  // unusable one, submit button.
  builder.addComponent({
    role: 'heading',
    screenId: home.id,
    properties: { tag: 'h1', name: 'Shop home', text: 'Shop home' },
    events: [],
    provenance: observed('dom'),
  });
  builder.addComponent({
    role: 'link',
    screenId: home.id,
    properties: { tag: 'a', name: 'Products', href: '/products', testId: 'nav-products' },
    events: ['click'],
    provenance: observed('dom'),
  });
  builder.addComponent({
    role: 'form',
    screenId: home.id,
    properties: { tag: 'form', name: 'Search' },
    events: ['submit'],
    provenance: observed('dom'),
  });
  const searchComponent = builder.addComponent({
    role: 'textbox',
    screenId: home.id,
    properties: { tag: 'input', name: 'Search', testId: 'search-box', type: 'search', required: true, placeholder: 'Type to search' },
    events: ['fill'],
    provenance: observed('dom'),
  });
  const emailComponent = builder.addComponent({
    role: 'textbox',
    screenId: home.id,
    properties: { tag: 'input', testId: 'email-field' },
    events: ['fill'],
    provenance: observed('dom'),
  });
  const mysteryComponent = builder.addComponent({
    role: 'textbox',
    screenId: home.id,
    properties: { tag: 'input' },
    events: ['fill'],
    provenance: observed('dom'),
  });
  const submitButton = builder.addComponent({
    role: 'button',
    screenId: home.id,
    properties: { tag: 'button', name: 'Checkout', testId: 'checkout-submit' },
    events: ['click'],
    provenance: observed('dom'),
  });

  // '/products' components: h2 + h3 headings, image, list, two textboxes,
  // two same-href links (ambiguity) + one unambiguous home link.
  builder.addComponent({
    role: 'heading',
    screenId: products.id,
    properties: { tag: 'h2', name: 'Products', text: 'Products' },
    events: [],
    provenance: observed('dom'),
  });
  builder.addComponent({
    role: 'heading',
    screenId: products.id,
    properties: { tag: 'h3', name: 'Best sellers', text: 'Best sellers' },
    events: [],
    provenance: observed('dom'),
  });
  const imageComponent = builder.addComponent({
    role: 'image',
    screenId: products.id,
    properties: { tag: 'img', name: 'Product photo', alt: 'Product photo' },
    events: [],
    provenance: observed('dom'),
  });
  builder.addComponent({
    role: 'list',
    screenId: products.id,
    properties: { tag: 'ul', name: 'Results' },
    events: [],
    provenance: observed('dom'),
  });
  builder.addComponent({
    role: 'textbox',
    screenId: products.id,
    properties: { tag: 'input', name: 'Quantity', testId: 'qty' },
    events: ['fill'],
    provenance: observed('dom'),
  });
  builder.addComponent({
    role: 'combobox',
    screenId: products.id,
    properties: { tag: 'select', name: 'Sort by' },
    events: [],
    provenance: observed('dom'),
  });
  builder.addComponent({
    role: 'link',
    screenId: products.id,
    properties: { tag: 'a', name: 'Home', href: '/' },
    events: ['click'],
    provenance: observed('dom'),
  });
  builder.addComponent({
    role: 'link',
    screenId: products.id,
    properties: { tag: 'a', name: 'Detail one', href: '/items/1' },
    events: ['click'],
    provenance: observed('dom'),
  });
  builder.addComponent({
    role: 'link',
    screenId: products.id,
    properties: { tag: 'a', name: 'Detail two', href: '/items/1' },
    events: ['click'],
    provenance: observed('dom'),
  });

  // transitions
  const submitTransition = builder.addTransition({
    fromScreenId: home.id,
    toScreenId: checkout.id,
    trigger: { type: 'action', action: 'submit' },
    sideEffects: ['persists cart'],
    provenance: { level: 'observed', confidence: { value: 1, rationale: 'applied', evidenceRefs: [user.ref, dom.ref] } },
  });
  const clickToProducts = builder.addTransition({
    fromScreenId: home.id,
    toScreenId: products.id,
    trigger: { type: 'action', action: 'click' },
    input: { url: '/products' },
    sideEffects: [],
    provenance: { level: 'observed', confidence: { value: 1, rationale: 'applied', evidenceRefs: [user.ref] } },
  });
  const clickSelf = builder.addTransition({
    fromScreenId: home.id,
    toScreenId: home.id,
    trigger: { type: 'action', action: 'click' },
    sideEffects: [],
    provenance: { level: 'observed', confidence: { value: 1, rationale: 'applied', evidenceRefs: [user.ref] } },
  });
  const timerTransition = builder.addTransition({
    fromScreenId: products.id,
    toScreenId: checkout.id,
    trigger: { type: 'timer', label: 'carousel' },
    sideEffects: [],
    provenance: { level: 'observed', confidence: { value: 1, rationale: 'observed', evidenceRefs: [dom.ref] } },
  });
  const clickAmbiguous = builder.addTransition({
    fromScreenId: products.id,
    toScreenId: checkout.id,
    trigger: { type: 'action', action: 'click' },
    input: { url: '/items/1' },
    sideEffects: [],
    provenance: { level: 'observed', confidence: { value: 1, rationale: 'applied', evidenceRefs: [user.ref] } },
  });

  // data entities
  builder.addDataEntity({
    name: 'cart',
    fields: [{ name: 'itemCount', domain: 'count', provenance: observed('dom') }],
    persistence: ['localStorage:cart-count', 'server:users'],
  });
  builder.addDataEntity({
    name: 'session',
    fields: [{ name: 'userId', domain: 'text', provenance: observed('dom') }],
    persistence: ['cookie:session-id'],
  });

  // api operations
  builder.addApiOperation({
    transport: 'http',
    method: 'GET',
    urlPattern: '/api/items',
    requestSchema: { type: 'object', keys: ['q'], valueTypes: { q: 'string' } },
    responseSchema: { type: 'object', keys: ['items', 'total'], valueTypes: { items: 'array', total: 'number' } },
    errorSchema: { type: 'object', keys: ['message'], valueTypes: { message: 'string' } },
    replayability: 'replayable',
    observedExamples: [dom.ref],
    provenance: observed('network'),
  });
  builder.addApiOperation({
    transport: 'http',
    method: 'POST',
    urlPattern: '/api/checkout',
    replayability: 'side-effects',
    observedExamples: [user.ref],
    provenance: observed('network'),
  });
  builder.addApiOperation({
    transport: 'websocket',
    urlPattern: 'wss://stream.example/items',
    replayability: 'replayable',
    observedExamples: [],
    provenance: { level: 'assumed', confidence: { value: 0.5, rationale: 'ws frame observed', evidenceRefs: [] } },
  });
  builder.addApiOperation({
    transport: 'http',
    urlPattern: '/api/no-method',
    replayability: 'replayable',
    observedExamples: [dom.ref],
    provenance: observed('network'),
  });

  // journeys (one matching MATCHED_JOURNEY's id)
  const homeIrJourney = builder.addJourney({
    id: fixedId('journey_', U.one),
    purpose: 'reach /',
    preconditions: [],
    steps: ['navigate to /', 'assert testId=nav-products is visible', 'assert role=heading name="Shop home" is visible'],
    provenance: { level: 'derived', confidence: { value: 1, rationale: 'recorded prefix', evidenceRefs: [user.ref] } },
  });

  builder.addConstraint('observed charset utf-8');

  return {
    model: builder.finish(),
    ids: {
      homeScreen: home.id,
      productsScreen: products.id,
      checkoutScreen: checkout.id,
      plainScreen: plain.id,
      searchComponent: searchComponent.id,
      emailComponent: emailComponent.id,
      mysteryComponent: mysteryComponent.id,
      submitButton: submitButton.id,
      imageComponent: imageComponent.id,
      submitTransition: submitTransition.id,
      clickToProducts: clickToProducts.id,
      clickSelf: clickSelf.id,
      timerTransition: timerTransition.id,
      clickAmbiguous: clickAmbiguous.id,
      homeIrJourney: homeIrJourney.id,
    },
  };
}

// ---------------------------------------------------------------------------
// Journey records (Journey contract v0)
// ---------------------------------------------------------------------------

/** Matches the shop model's IrJourney (purpose/steps come from the IR). */
export const MATCHED_JOURNEY: Journey = {
  id: fixedId('journey_', U.one),
  name: 'Shop home walkthrough',
  targetId: 'bench/shop',
  actions: [
    { type: 'navigate', url: '/' },
    { type: 'assert-visible', target: { testId: 'nav-products' } },
    { type: 'assert-visible', target: { role: 'heading', name: 'Shop home' } },
  ],
};

/** No matching IrJourney (purpose/steps derived from the record). */
export const UNMATCHED_JOURNEY: Journey = {
  id: fixedId('journey_', U.two),
  name: 'Products tour',
  targetId: 'bench/shop',
  actions: [
    { type: 'navigate', url: '/products.html' },
    { type: 'assert-visible', target: { role: 'image', name: 'Product photo' } },
    { type: 'assert-visible', target: { testId: 'does-not-exist' } },
    { type: 'wait', ms: 10 },
  ],
};

/** Deep-clone helper (plans and models are treated as immutable by consumers). */
export function clonePlan(plan: SynthesisPlan): SynthesisPlan {
  return JSON.parse(JSON.stringify(plan)) as SynthesisPlan;
}
