/**
 * @clapp/ir — shared test fixtures (NOT a test file; imported by the test
 * files in this package, mirroring @clapp/evidence's test-utils.ts
 * convention).
 *
 * The reference model is hand-built over the bench/b01-static corpus pages
 * ('/', '/pricing', '/features' as screens) with a couple of components,
 * one navigate transition, and one api operation synthesized from a fake
 * EvidenceRef (the corpus is static HTML — the operation is honestly
 * marked 'assumed'). Journey ids reuse the REAL seeded b01-nav journey id
 * from @clapp/journey's fixture corpus (a public literal, not an import —
 * @clapp/ir never depends on @clapp/journey).
 *
 * fakeSha256 derives a deterministic, obviously-fake 64-hex digest from a
 * seed string: no secret-shaped literals anywhere in the fixtures.
 */

import type { EvidenceRef } from '@clapp/core';
import type {
  IrApplication,
  IrEvidenceEntry,
  IrJourney,
  IrModel,
  IrScreen,
  Provenance,
} from './ir-contract';

// ---------------------------------------------------------------------------
// Deterministic fake digests + provenance helper
// ---------------------------------------------------------------------------

/** Deterministic, obviously-fake 64-lowercase-hex digest for fixtures. */
export function fakeSha256(seed: string): string {
  let hex = '';
  for (let index = 0; index < seed.length; index += 1) {
    hex += seed.charCodeAt(index).toString(16).padStart(4, '0');
  }
  while (hex.length < 64) hex += hex;
  return hex.slice(0, 64);
}

/** Concise provenance-block constructor for fixtures (refs deep-cloned per model). */
export function prov(
  level: Provenance['level'],
  value: number,
  rationale: string,
  refs: EvidenceRef[],
): Provenance {
  // Clone the refs: mutation tests must never poison the module constants.
  return { level, confidence: { value, rationale, evidenceRefs: refs.map((ref) => ({ ...ref })) } };
}

// ---------------------------------------------------------------------------
// Stable fixture ids
// ---------------------------------------------------------------------------

export const IDS = {
  application: 'app_0a000000-0000-4000-8000-000000000001',
  homeScreen: 'screen_10000000-0000-4000-8000-000000000001',
  pricingScreen: 'screen_10000000-0000-4000-8000-000000000002',
  featuresScreen: 'screen_10000000-0000-4000-8000-000000000003',
  navComponent: 'comp_20000000-0000-4000-8000-000000000001',
  heroHeading: 'comp_20000000-0000-4000-8000-000000000002',
  planList: 'comp_20000000-0000-4000-8000-000000000003',
  teamCta: 'comp_20000000-0000-4000-8000-000000000004',
  subscribedVar: 'var_30000000-0000-4000-8000-000000000001',
  navTransition: 'trans_40000000-0000-4000-8000-000000000001',
  newsletterEntity: 'ent_50000000-0000-4000-8000-000000000001',
  newsletterOp: 'op_60000000-0000-4000-8000-000000000001',
  emailIntegration: 'integ_70000000-0000-4000-8000-000000000001',
  staticAssumption: 'assume_80000000-0000-4000-8000-000000000001',
  /** The REAL seeded b01-nav journey id from @clapp/journey's corpus. */
  navJourney: 'journey_5bee1e16-86b8-4447-8c9e-26ee583a341a',
} as const;

// ---------------------------------------------------------------------------
// Evidence refs (fake but well-formed: ev_ ids + fake sha256 digests)
// ---------------------------------------------------------------------------

export const DOM_HOME: EvidenceRef = {
  evidenceId: 'ev_01000000-0000-4000-8000-000000000001',
  kind: 'dom',
  sha256: fakeSha256('dom:/'),
};
export const DOM_PRICING: EvidenceRef = {
  evidenceId: 'ev_01000000-0000-4000-8000-000000000002',
  kind: 'dom',
  sha256: fakeSha256('dom:/pricing'),
};
export const DOM_FEATURES: EvidenceRef = {
  evidenceId: 'ev_01000000-0000-4000-8000-000000000003',
  kind: 'dom',
  sha256: fakeSha256('dom:/features'),
};
export const SHOT_HOME: EvidenceRef = {
  evidenceId: 'ev_01000000-0000-4000-8000-000000000004',
  kind: 'screenshot',
  sha256: fakeSha256('screenshot:/'),
};
export const NET_NEWSLETTER: EvidenceRef = {
  evidenceId: 'ev_01000000-0000-4000-8000-000000000005',
  kind: 'network',
  sha256: fakeSha256('network:POST /api/newsletter'),
};
export const STORAGE_NEWSLETTER: EvidenceRef = {
  evidenceId: 'ev_01000000-0000-4000-8000-000000000006',
  kind: 'storage',
  sha256: fakeSha256('storage:newsletter-email'),
};

export const RUN_ID = 'run_0b000000-0000-4000-8000-000000000001';

function evidenceEntry(
  suffix: string,
  ref: EvidenceRef,
  channel: string,
): IrEvidenceEntry {
  return {
    id: `irev_90000000-0000-4000-8000-00000000000${suffix}`,
    ref: { ...ref }, // clone — mutation tests must never poison the module constants
    source: `run:${RUN_ID}:${channel}`,
  };
}

/** Clone a fixture ref for embedding in a model (same anti-poisoning rule). */
function refOf(ref: EvidenceRef): EvidenceRef {
  return { ...ref };
}

// ---------------------------------------------------------------------------
// The reference model (fresh object tree per call — no shared mutable state)
// ---------------------------------------------------------------------------

/** Hand-built valid reference model over the b01 corpus pages. */
export function buildReferenceModel(): IrModel {
  const application: IrApplication = {
    id: IDS.application,
    name: 'Nimbus Notes',
    platform: 'web',
    entrypoints: ['/', '/features', '/pricing', '/contact'],
  };

  const screens: IrScreen[] = [
    {
      id: IDS.homeScreen,
      route: '/',
      provenance: prov('observed', 1, 'route and DOM structure captured directly from the dom channel', [DOM_HOME]),
      treeRef: refOf(DOM_HOME),
      visualRef: refOf(SHOT_HOME),
    },
    {
      id: IDS.pricingScreen,
      route: '/pricing',
      provenance: prov('observed', 1, 'route and DOM structure captured directly from the dom channel', [DOM_PRICING]),
      treeRef: refOf(DOM_PRICING),
    },
    {
      id: IDS.featuresScreen,
      route: '/features',
      provenance: prov('observed', 1, 'route and DOM structure captured directly from the dom channel', [DOM_FEATURES]),
      treeRef: refOf(DOM_FEATURES),
    },
  ];

  const journey: IrJourney = {
    id: IDS.navJourney,
    purpose: 'Walk the main navigation: Home → Features → Pricing → Home → Contact',
    preconditions: ['fixture server is serving bench/b01-static', 'no authentication required'],
    steps: [
      'navigate to /',
      'assert the main navigation is visible',
      'click the Features nav link',
      'assert the features heading is visible',
      'click the Pricing link',
      'assert the pricing heading is visible',
      'click the Home nav link',
      'assert the home heading is visible',
      'click the Contact link',
      'assert the contact heading is visible',
      'wait 25ms for the page to settle',
    ],
    provenance: prov(
      'derived',
      0.9,
      'step summaries derived from the seeded b01 navigation journey record',
      [DOM_HOME, DOM_PRICING, DOM_FEATURES],
    ),
  };

  return {
    modelVersion: '0.1',
    application,
    environment: {
      browser: 'chromium',
      os: 'linux',
      viewport: { width: 1280, height: 720 },
      locale: 'en-US',
      timezone: 'UTC',
      network: 'deny-all',
    },
    evidence: [
      evidenceEntry('1', DOM_HOME, 'dom'),
      evidenceEntry('2', DOM_PRICING, 'dom'),
      evidenceEntry('3', DOM_FEATURES, 'dom'),
      evidenceEntry('4', SHOT_HOME, 'screenshot'),
      evidenceEntry('5', NET_NEWSLETTER, 'network'),
      evidenceEntry('6', STORAGE_NEWSLETTER, 'storage'),
    ],
    journeys: [journey],
    screens,
    components: [
      {
        id: IDS.navComponent,
        role: 'navigation',
        screenId: IDS.homeScreen,
        properties: { label: 'Main', testId: 'main-nav' },
        events: ['click'],
        provenance: prov('observed', 0.95, 'navigation landmark read from the home DOM capture', [DOM_HOME]),
      },
      {
        id: IDS.heroHeading,
        role: 'heading',
        screenId: IDS.homeScreen,
        properties: { name: 'Capture every idea, calmly', level: 1 },
        events: [],
        provenance: prov('observed', 0.95, 'h1 read from the home DOM capture', [DOM_HOME]),
      },
      {
        id: IDS.planList,
        role: 'list',
        screenId: IDS.pricingScreen,
        properties: { label: 'Plans', itemCount: 3 },
        events: [],
        provenance: prov('observed', 0.95, 'plans list read from the pricing DOM capture', [DOM_PRICING]),
      },
      {
        id: IDS.teamCta,
        role: 'button',
        screenId: IDS.pricingScreen,
        properties: { name: 'Choose Team', testId: 'plan-team-cta' },
        events: ['click'],
        provenance: prov('observed', 0.95, 'Team plan CTA read from the pricing DOM capture', [DOM_PRICING]),
      },
    ],
    state: {
      variables: [
        {
          id: IDS.subscribedVar,
          name: 'newsletter.subscribed',
          domain: 'boolean',
          provenance: prov(
            'derived',
            0.8,
            'subscription state derived from the presence of the newsletter-email storage key',
            [STORAGE_NEWSLETTER],
          ),
        },
      ],
      transitions: [
        {
          id: IDS.navTransition,
          fromScreenId: IDS.homeScreen,
          toScreenId: IDS.pricingScreen,
          trigger: { type: 'action', action: 'navigate' },
          sideEffects: [],
          provenance: prov(
            'derived',
            0.9,
            'screen-to-screen transition derived from the recorded navigation journey steps',
            [DOM_HOME, DOM_PRICING],
          ),
        },
      ],
    },
    data: {
      entities: [
        {
          id: IDS.newsletterEntity,
          name: 'NewsletterSubscription',
          fields: [
            {
              name: 'email',
              domain: 'text',
              provenance: prov('observed', 0.9, 'email input captured in the newsletter form DOM', [DOM_HOME]),
            },
          ],
          persistence: ['localStorage:newsletter-email'],
        },
      ],
    },
    api: {
      operations: [
        {
          id: IDS.newsletterOp,
          transport: 'http',
          method: 'POST',
          urlPattern: '/api/newsletter',
          headersNeeded: ['content-type'],
          requestSchema: { type: 'object', properties: { email: { type: 'string' } }, required: ['email'] },
          responseSchema: { type: 'object', properties: { ok: { type: 'boolean' } } },
          observedExamples: [refOf(NET_NEWSLETTER)],
          replayability: 'side-effects',
          externalSideEffects: ['subscribes the email to the Nimbus Notes newsletter'],
          provenance: prov(
            'assumed',
            0.3,
            'synthesized for the CLAPP-020 reference fixture: bench/b01-static is a static corpus and never issues this call',
            [NET_NEWSLETTER],
          ),
        },
      ],
    },
    integrations: [
      {
        id: IDS.emailIntegration,
        capability: 'email-newsletter-delivery',
        status: 'unreproducible',
        provenance: prov(
          'unavailable',
          0.2,
          'no backend response was ever observed; only the request intent in the static markup',
          [NET_NEWSLETTER],
        ),
      },
    ],
    assumptions: [
      {
        id: IDS.staticAssumption,
        statement: 'bench/b01-static pages are static HTML with no client-side auth',
        provenance: prov('assumed', 0.5, 'stated without evidence for synthesis grounding; the corpus never authenticates', []),
      },
    ],
    constraints: [
      'v0 web adapter: screen == state (declared simplification)',
      'one screen per route in v0; captures of the same route are merged by the caller',
    ],
  };
}

/** Deep clone helper for mutation tests (fresh object tree, no shared refs). */
export function cloneModel(model: IrModel): IrModel {
  return structuredClone(model);
}

/** A well-formed EvidenceRef not cataloged in the reference model. */
export const UNCATALOGED_REF: EvidenceRef = {
  evidenceId: 'ev_0c000000-0000-4000-8000-000000000001',
  kind: 'runtime',
  sha256: fakeSha256('runtime:uncataloged'),
};
