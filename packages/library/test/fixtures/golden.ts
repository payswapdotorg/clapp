// CLAPP-050 — the golden verified-extraction fixture.
//
// A minimal but TYPE-COMPLETE, contract-honest ExtractionPorts: a 3-route /
// 2-endpoint web plan (one cookie storage binding, one form, three
// navigation transitions, two acceptance journeys, two assumptions, three
// deliberately-unsorted constraints), its generated app, and a parity
// report + repair result that satisfy the verified gate EXACTLY as the P4
// runner produces them: counts.critical === 0 ⇒ verdict 'equivalent'
// (see @clapp/diff's report.ts), with one major and one minor finding that
// the repair loop resolved across two attempts (one directive per
// iteration, per the @clapp/repair loop semantics).
//
// All ids are uuid-v4-SHAPED with zero-padded hex suffixes so lexicographic
// order is stable and predictable; all sha256 values are hex-shaped
// placeholders (fixture convention — same as the sibling packages' golden
// fixtures).

import type { EvidenceRef } from '@clapp/core';
import type { PlanProvenance, SynthesisPlan } from '@clapp/plan';
import type { GeneratedApp } from '@clapp/codegen';
import type { DiffReport } from '@clapp/diff';
import type { RepairLoopResult } from '@clapp/repair';
import type { ExtractionPorts } from '../../src/extract';

// ---- shared id constants (used by the fixtures AND the test assertions) ----------

export const GOLDEN_IDS = {
  applicationId: 'appsyn_00000000-0000-4000-8000-000000000001',
  reportId: 'diffr_00000000-0000-4000-8000-0000000000d1',
  findingText: 'diff_00000000-0000-4000-8000-0000000000f1',
  findingMock: 'diff_00000000-0000-4000-8000-0000000000f2',
  acceptanceBrowse: 'acc_00000000-0000-4000-8000-0000000000c1',
  acceptanceContact: 'acc_00000000-0000-4000-8000-0000000000c2',
  journeyBrowse: 'journey_00000000-0000-4000-8000-000000000001',
  journeyContact: 'journey_00000000-0000-4000-8000-000000000002',
  baseSha: '0f1c2a3b4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a',
} as const;

// ---- evidence entries (hex-shaped fixture hashes) --------------------------------

function hex64(seed: string): string {
  return seed.padEnd(64, '0');
}

function evidenceEntry(evidenceId: string, kind: EvidenceRef['kind'], seed: string): EvidenceRef {
  return { evidenceId, kind, sha256: hex64(seed) };
}

// Plan-provenance evidence (module-private: it must NEVER leak into the
// manifest's evidence — only the parity report's entries belong there).
const EV_PLAN_DOM_HOME = evidenceEntry('ev_00000000-0000-4000-8000-000000000001', 'dom', 'e001');
const EV_PLAN_DOM_PRICING = evidenceEntry('ev_00000000-0000-4000-8000-000000000002', 'dom', 'e002');
const EV_PLAN_DOM_CONTACT = evidenceEntry('ev_00000000-0000-4000-8000-000000000003', 'dom', 'e003');
const EV_PLAN_STATIC = evidenceEntry('ev_00000000-0000-4000-8000-000000000004', 'static', 'e004');

// Parity-report evidence (exported: the tests assert the manifest's
// evidence equals exactly these, deduped by evidenceId and sorted — note
// the finding-anchor ids (0005/0006) sort BELOW the run ids (0010-0013),
// so sorted output ≠ traversal order, and finding 1's anchors re-cite the
// run evidence (dedup), while finding 2's anchors cite fresh entries).
export const EV_NET_LEFT = evidenceEntry('ev_00000000-0000-4000-8000-000000000005', 'network', 'e005');
export const EV_NET_RIGHT = evidenceEntry('ev_00000000-0000-4000-8000-000000000006', 'network', 'e006');
export const EV_RUN_1_LEFT = evidenceEntry('ev_00000000-0000-4000-8000-000000000010', 'dom', 'e010');
export const EV_RUN_1_RIGHT = evidenceEntry('ev_00000000-0000-4000-8000-000000000011', 'dom', 'e011');
export const EV_RUN_2_LEFT = evidenceEntry('ev_00000000-0000-4000-8000-000000000012', 'dom', 'e012');
export const EV_RUN_2_RIGHT = evidenceEntry('ev_00000000-0000-4000-8000-000000000013', 'dom', 'e013');

// ---- provenance helpers ------------------------------------------------------------

const planned = (rationale: string): PlanProvenance => ({
  level: 'planned',
  rationale,
  sourceIds: [],
  evidenceRefs: [],
});

const derived = (rationale: string, sourceIds: string[], evidenceRefs: EvidenceRef[]): PlanProvenance => ({
  level: 'derived',
  rationale,
  sourceIds,
  evidenceRefs,
});

// ---- the SynthesisPlan (3 routes, 1 storage binding, 2 api endpoints,
//      2 assumptions, 3 constraints — deliberately unsorted constraints) ------------

export const goldenPlan: SynthesisPlan = {
  planVersion: '0.1',
  application: {
    id: GOLDEN_IDS.applicationId,
    name: 'Nimbus Notes',
    platform: 'web',
    sourceModelId: 'app_00000000-0000-4000-8000-0000000000ff',
    entrypoints: ['/'],
  },
  routes: [
    {
      id: 'route_00000000-0000-4000-8000-000000000001',
      path: '/',
      pageId: 'page_00000000-0000-4000-8000-000000000001',
      provenance: derived('the observed home route', ['screen_00000000-0000-4000-8000-000000000001'], [EV_PLAN_DOM_HOME]),
    },
    {
      id: 'route_00000000-0000-4000-8000-000000000002',
      path: '/pricing',
      pageId: 'page_00000000-0000-4000-8000-000000000002',
      provenance: derived('the observed pricing route', ['screen_00000000-0000-4000-8000-000000000002'], [EV_PLAN_DOM_PRICING]),
    },
    {
      id: 'route_00000000-0000-4000-8000-000000000003',
      path: '/contact',
      pageId: 'page_00000000-0000-4000-8000-000000000003',
      provenance: derived('the observed contact route', ['screen_00000000-0000-4000-8000-000000000003'], [EV_PLAN_DOM_CONTACT]),
    },
  ],
  pages: [
    {
      id: 'page_00000000-0000-4000-8000-000000000001',
      routeId: 'route_00000000-0000-4000-8000-000000000001',
      title: 'Nimbus Notes — Home',
      elements: [
        {
          id: 'el_00000000-0000-4000-8000-000000000011',
          kind: 'heading',
          level: 1,
          text: 'Nimbus Notes',
          provenance: derived('the observed home heading', ['comp_00000000-0000-4000-8000-000000000011'], [EV_PLAN_DOM_HOME]),
        },
        {
          id: 'el_00000000-0000-4000-8000-000000000012',
          kind: 'text',
          text: 'Notes that stay in sync.',
          provenance: planned('supporting copy under the home heading'),
        },
        {
          id: 'el_00000000-0000-4000-8000-000000000013',
          kind: 'link',
          role: 'link',
          name: 'Pricing',
          text: 'Pricing',
          href: '/pricing',
          testId: 'nav-pricing',
          provenance: derived('the observed navigation link to pricing', ['comp_00000000-0000-4000-8000-000000000013'], [EV_PLAN_DOM_HOME]),
        },
        {
          id: 'el_00000000-0000-4000-8000-000000000014',
          kind: 'link',
          role: 'link',
          name: 'Contact',
          text: 'Contact',
          href: '/contact',
          testId: 'nav-contact',
          provenance: derived('the observed navigation link to contact', ['comp_00000000-0000-4000-8000-000000000014'], [EV_PLAN_DOM_HOME]),
        },
      ],
      forms: [],
      provenance: derived('the observed home page', ['screen_00000000-0000-4000-8000-000000000001'], [EV_PLAN_DOM_HOME]),
    },
    {
      id: 'page_00000000-0000-4000-8000-000000000002',
      routeId: 'route_00000000-0000-4000-8000-000000000002',
      title: 'Nimbus Notes — Pricing',
      elements: [
        {
          id: 'el_00000000-0000-4000-8000-000000000021',
          kind: 'heading',
          level: 1,
          text: 'Simple, honest pricing',
          testId: 'pricing-heading',
          provenance: derived('the observed pricing heading', ['comp_00000000-0000-4000-8000-000000000021'], [EV_PLAN_DOM_PRICING]),
        },
        {
          id: 'el_00000000-0000-4000-8000-000000000022',
          kind: 'text',
          text: 'One plan. Every feature.',
          provenance: planned('supporting copy under the pricing heading'),
        },
      ],
      forms: [],
      provenance: derived('the observed pricing page', ['screen_00000000-0000-4000-8000-000000000002'], [EV_PLAN_DOM_PRICING]),
    },
    {
      id: 'page_00000000-0000-4000-8000-000000000003',
      routeId: 'route_00000000-0000-4000-8000-000000000003',
      title: 'Nimbus Notes — Contact',
      elements: [
        {
          id: 'el_00000000-0000-4000-8000-000000000031',
          kind: 'heading',
          level: 1,
          text: 'Contact us',
          testId: 'contact-heading',
          provenance: derived('the observed contact heading', ['comp_00000000-0000-4000-8000-000000000031'], [EV_PLAN_DOM_CONTACT]),
        },
        {
          id: 'el_00000000-0000-4000-8000-000000000032',
          kind: 'form',
          role: 'form',
          name: 'Contact',
          formId: 'form_00000000-0000-4000-8000-000000000001',
          provenance: derived('the observed contact form', ['comp_00000000-0000-4000-8000-000000000032'], [EV_PLAN_DOM_CONTACT]),
        },
      ],
      forms: [
        {
          id: 'form_00000000-0000-4000-8000-000000000001',
          action: '/contact',
          method: 'post',
          fields: [
            { name: 'email', type: 'email', label: 'Email address', required: true },
            { name: 'message', type: 'textarea', label: 'Message' },
          ],
          submitLabel: 'Send message',
          submitTestId: 'contact-submit',
          provenance: derived('the observed contact form fields', ['comp_00000000-0000-4000-8000-000000000032'], [EV_PLAN_DOM_CONTACT]),
        },
      ],
      provenance: derived('the observed contact page', ['screen_00000000-0000-4000-8000-000000000003'], [EV_PLAN_DOM_CONTACT]),
    },
  ],
  navigation: [
    {
      id: 'nav_00000000-0000-4000-8000-000000000001',
      fromRouteId: 'route_00000000-0000-4000-8000-000000000001',
      toRouteId: 'route_00000000-0000-4000-8000-000000000002',
      trigger: { kind: 'link', elementId: 'el_00000000-0000-4000-8000-000000000013' },
      sourceTransitionIds: ['trans_00000000-0000-4000-8000-000000000001'],
      provenance: derived('the observed home→pricing navigation', ['trans_00000000-0000-4000-8000-000000000001'], [EV_PLAN_DOM_HOME]),
    },
    {
      id: 'nav_00000000-0000-4000-8000-000000000002',
      fromRouteId: 'route_00000000-0000-4000-8000-000000000001',
      toRouteId: 'route_00000000-0000-4000-8000-000000000003',
      trigger: { kind: 'link', elementId: 'el_00000000-0000-4000-8000-000000000014' },
      sourceTransitionIds: ['trans_00000000-0000-4000-8000-000000000002'],
      provenance: derived('the observed home→contact navigation', ['trans_00000000-0000-4000-8000-000000000002'], [EV_PLAN_DOM_HOME]),
    },
    {
      id: 'nav_00000000-0000-4000-8000-000000000003',
      fromRouteId: 'route_00000000-0000-4000-8000-000000000003',
      toRouteId: 'route_00000000-0000-4000-8000-000000000003',
      trigger: { kind: 'form-submit', formId: 'form_00000000-0000-4000-8000-000000000001' },
      sourceTransitionIds: ['trans_00000000-0000-4000-8000-000000000003'],
      provenance: derived('the observed contact form submission', ['trans_00000000-0000-4000-8000-000000000003'], [EV_PLAN_DOM_CONTACT]),
    },
  ],
  storage: [
    {
      id: 'store_00000000-0000-4000-8000-000000000001',
      key: 'newsletter-email',
      storage: 'cookie',
      entityFieldNames: ['email'],
      writtenOn: ['nav_00000000-0000-4000-8000-000000000003'],
      sourceEntityIds: ['ent_00000000-0000-4000-8000-000000000001'],
      provenance: derived('the observed newsletter-email cookie write on form submission', ['ent_00000000-0000-4000-8000-000000000001'], [EV_PLAN_DOM_CONTACT]),
    },
  ],
  api: {
    endpoints: [
      {
        id: 'api_00000000-0000-4000-8000-000000000001',
        method: 'GET',
        urlPattern: '/api/status',
        sourceOperationIds: ['op_00000000-0000-4000-8000-000000000001'],
        provenance: derived('the observed status endpoint', ['op_00000000-0000-4000-8000-000000000001'], [EV_PLAN_STATIC]),
      },
      {
        id: 'api_00000000-0000-4000-8000-000000000002',
        method: 'POST',
        urlPattern: '/api/contact',
        sourceOperationIds: ['op_00000000-0000-4000-8000-000000000002'],
        provenance: derived('the observed contact submission endpoint', ['op_00000000-0000-4000-8000-000000000002'], [EV_PLAN_DOM_CONTACT]),
      },
    ],
    mocks: [
      {
        id: 'mock_00000000-0000-4000-8000-000000000001',
        endpointId: 'api_00000000-0000-4000-8000-000000000001',
        statusCode: 200,
        bodyJson: { status: 'ok' },
      },
      {
        id: 'mock_00000000-0000-4000-8000-000000000002',
        endpointId: 'api_00000000-0000-4000-8000-000000000002',
        statusCode: 201,
        bodyJson: { ok: true },
      },
    ],
  },
  acceptance: [
    {
      id: GOLDEN_IDS.acceptanceBrowse,
      journeyId: GOLDEN_IDS.journeyBrowse,
      purpose: 'a visitor browses the pricing page',
      steps: ['navigate to /', 'click the Pricing link'],
      expectedRoute: '/pricing',
      mustSeeElementIds: ['el_00000000-0000-4000-8000-000000000021'],
      sourceJourneyIds: [GOLDEN_IDS.journeyBrowse],
      provenance: derived('the observed pricing browse journey', ['journey_00000000-0000-4000-8000-000000000001'], [EV_PLAN_DOM_PRICING]),
    },
    {
      id: GOLDEN_IDS.acceptanceContact,
      journeyId: GOLDEN_IDS.journeyContact,
      purpose: 'a visitor submits the contact form',
      steps: ['navigate to /', 'click the Contact link', 'fill the contact form', 'submit the form'],
      expectedRoute: '/contact',
      mustSeeElementIds: ['el_00000000-0000-4000-8000-000000000031'],
      sourceJourneyIds: [GOLDEN_IDS.journeyContact],
      provenance: derived('the observed contact submission journey', ['journey_00000000-0000-4000-8000-000000000002'], [EV_PLAN_DOM_CONTACT]),
    },
  ],
  server: {
    startCommand: 'bun server.ts',
    port: 4173,
    healthPath: '/',
  },
  assumptions: [
    'the pricing page is static pre-rendered HTML',
    'the contact form succeeds against the mock backend',
  ],
  constraints: [
    'serve journeys from the observed entrypoints',
    'preserve the observed data-testid attributes',
    'no client-side scripting beyond declared storage writes',
  ],
};

// ---- the GeneratedApp (5 files; manifest surface deliberately in plan order, NOT sorted) ----

export const goldenApp: GeneratedApp = {
  files: [
    { path: 'package.json', contents: '{"name":"clapp-app-nimbus-notes","type":"module"}' },
    { path: 'server.ts', contents: '// generated zero-dependency server (mock backend included)' },
    { path: 'pages/index.html.ts', contents: '// home page module' },
    { path: 'pages/pricing.html.ts', contents: '// pricing page module' },
    { path: 'pages/contact.html.ts', contents: '// contact page module' },
  ],
  manifest: {
    packageName: 'clapp-app-nimbus-notes',
    startCommand: 'bun server.ts',
    port: 4173,
    healthPath: '/',
    routePaths: ['/', '/pricing', '/contact'],
    apiEndpoints: ['/api/status', '/api/contact'],
  },
};

// ---- the DiffReport (verdict 'equivalent' because counts.critical === 0,
//      exactly the P4 runner's derived-verdict rule; one major + one minor
//      finding, honest counts) ------------------------------------------------------

export const goldenReport: DiffReport = {
  id: GOLDEN_IDS.reportId,
  diffVersion: '0.1',
  candidateAppId: GOLDEN_IDS.applicationId,
  baselineRootHash: hex64('ba5e'),
  runs: [
    {
      journeyId: GOLDEN_IDS.journeyBrowse,
      transitionIds: ['trans_00000000-0000-4000-8000-000000000001'],
      left: {
        side: 'left',
        baseUrl: 'https://nimbus.example',
        targetId: 'bench/nimbus-notes',
        driver: 'replayer-dom',
      },
      right: {
        side: 'right',
        baseUrl: 'http://127.0.0.1:4173',
        targetId: GOLDEN_IDS.applicationId,
        driver: 'replayer-dom',
      },
      runs: {
        left: {
          side: 'left',
          journeyId: GOLDEN_IDS.journeyBrowse,
          completed: true,
          stepsCompleted: 2,
          evidenceRef: EV_RUN_1_LEFT,
          stepPageIds: ['cap_00000000-0000-4000-8000-000000000101', 'cap_00000000-0000-4000-8000-000000000102'],
          stepNetworkIds: [],
          storageIds: [],
        },
        right: {
          side: 'right',
          journeyId: GOLDEN_IDS.journeyBrowse,
          completed: true,
          stepsCompleted: 2,
          evidenceRef: EV_RUN_1_RIGHT,
          stepPageIds: ['cap_00000000-0000-4000-8000-000000000201', 'cap_00000000-0000-4000-8000-000000000202'],
          stepNetworkIds: [],
          storageIds: [],
        },
      },
    },
    {
      journeyId: GOLDEN_IDS.journeyContact,
      transitionIds: ['trans_00000000-0000-4000-8000-000000000002', 'trans_00000000-0000-4000-8000-000000000003'],
      left: {
        side: 'left',
        baseUrl: 'https://nimbus.example',
        targetId: 'bench/nimbus-notes',
        driver: 'replayer-dom',
      },
      right: {
        side: 'right',
        baseUrl: 'http://127.0.0.1:4173',
        targetId: GOLDEN_IDS.applicationId,
        driver: 'replayer-dom',
      },
      runs: {
        left: {
          side: 'left',
          journeyId: GOLDEN_IDS.journeyContact,
          completed: true,
          stepsCompleted: 4,
          evidenceRef: EV_RUN_2_LEFT,
          stepPageIds: [
            'cap_00000000-0000-4000-8000-000000000103',
            'cap_00000000-0000-4000-8000-000000000104',
            'cap_00000000-0000-4000-8000-000000000105',
            'cap_00000000-0000-4000-8000-000000000106',
          ],
          stepNetworkIds: ['cap_00000000-0000-4000-8000-000000000107'],
          storageIds: ['cap_00000000-0000-4000-8000-000000000108'],
        },
        right: {
          side: 'right',
          journeyId: GOLDEN_IDS.journeyContact,
          completed: true,
          stepsCompleted: 4,
          evidenceRef: EV_RUN_2_RIGHT,
          stepPageIds: [
            'cap_00000000-0000-4000-8000-000000000203',
            'cap_00000000-0000-4000-8000-000000000204',
            'cap_00000000-0000-4000-8000-000000000205',
            'cap_00000000-0000-4000-8000-000000000206',
          ],
          stepNetworkIds: ['cap_00000000-0000-4000-8000-000000000207'],
          storageIds: ['cap_00000000-0000-4000-8000-000000000208'],
        },
      },
    },
  ],
  findings: [
    {
      id: GOLDEN_IDS.findingText,
      dimension: 'semantic',
      severity: 'major',
      summary: 'the pricing heading text diverged between the sides',
      anchors: [
        {
          stepIndex: 1,
          sourceIds: ['el_00000000-0000-4000-8000-000000000021'],
          leftEvidence: EV_RUN_1_LEFT,
          rightEvidence: EV_RUN_1_RIGHT,
        },
      ],
      expected: { kind: 'text', route: '/pricing', text: 'Simple, honest pricing' },
      actual: { kind: 'text', route: '/pricing', text: 'Simple, dishonest pricing' },
    },
    {
      id: GOLDEN_IDS.findingMock,
      dimension: 'network',
      severity: 'minor',
      summary: 'the contact mock returned a divergent status code',
      anchors: [
        {
          stepIndex: 3,
          sourceIds: ['api_00000000-0000-4000-8000-000000000002'],
          leftEvidence: EV_NET_LEFT,
          rightEvidence: EV_NET_RIGHT,
        },
      ],
    },
  ],
  counts: { critical: 0, major: 1, minor: 1, info: 0 },
  verdict: 'equivalent',
  generatedAt: '2026-09-28T10:00:00Z',
};

// ---- the RepairLoopResult (two attempts — one per directive; converged) -----------

export const goldenRepair: RepairLoopResult = {
  maxIterations: 5,
  attempts: [
    {
      directiveId: 'repd_00000000-0000-4000-8000-0000000000d1',
      iteration: 1,
      baseSha: GOLDEN_IDS.baseSha,
      changedPaths: ['pages/pricing.html.ts'],
      rerunVerdict: 'divergent',
      resolvedFindingIds: [GOLDEN_IDS.findingText],
    },
    {
      directiveId: 'repd_00000000-0000-4000-8000-0000000000d2',
      iteration: 2,
      baseSha: '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b',
      changedPaths: ['server.ts'],
      rerunVerdict: 'equivalent',
      resolvedFindingIds: [GOLDEN_IDS.findingMock],
    },
  ],
  remainingCriticalFindings: [],
  converged: true,
};

// ---- the assembled verified ports ---------------------------------------------------

export const goldenPorts: ExtractionPorts = {
  plan: goldenPlan,
  app: goldenApp,
  parity: { report: goldenReport, repair: goldenRepair },
};
