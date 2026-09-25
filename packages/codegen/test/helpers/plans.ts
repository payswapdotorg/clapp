/**
 * @clapp/codegen tests — deterministic small-plan builder (CLAPP-031).
 *
 * makePlan mints a contract-conforming SynthesisPlan from compact inits:
 * ids are uuid-v4-shaped placeholders assigned by index, so tests can
 * cross-reference minted ids through the exported testRouteId /
 * testNavId / testFormId helpers (page i is served at route i; the j-th
 * form declared across pages gets form id j; the k-th transition gets
 * nav id k).
 */

import type {
  MockResponse,
  PlannedAcceptance,
  PlannedApiEndpoint,
  PlannedElement,
  PlannedForm,
  PlannedPage,
  PlannedRoute,
  PlannedStorageBinding,
  PlannedTransition,
  PlanProvenance,
  SynthesisPlan,
} from '../../src/synthesis-contract';

const UUID = '00000000-0000-4000-8000-';

const hex12 = (n: number): string => n.toString(16).padStart(12, '0');

export const testRouteId = (index: number): string => `route_${UUID}${hex12(index)}`;
export const testNavId = (index: number): string => `nav_${UUID}${hex12(index)}`;
export const testFormId = (index: number): string => `form_${UUID}${hex12(index)}`;

const testProvenance: PlanProvenance = {
  level: 'planned',
  rationale: 'Test plan element (codegen battery).',
  sourceIds: [],
  evidenceRefs: [],
};

export type ElementInit = Omit<PlannedElement, 'id' | 'provenance'>;
export type FormInit = Omit<PlannedForm, 'id' | 'provenance'>;
export type NavInit = Omit<PlannedTransition, 'id' | 'provenance' | 'sourceTransitionIds'>;
export type StoreInit = Omit<PlannedStorageBinding, 'id' | 'provenance'>;
export type EndpointInit = Omit<PlannedApiEndpoint, 'id' | 'provenance' | 'sourceOperationIds'>;
export type MockInit = Omit<MockResponse, 'id'>;
export type AcceptanceInit = Omit<PlannedAcceptance, 'id' | 'provenance' | 'sourceJourneyIds'>;

export interface PageInit {
  path: string;
  title?: string;
  elements: ElementInit[];
  forms?: FormInit[];
}

export interface MakePlanInput {
  planVersion?: string;
  name?: string;
  port?: number;
  healthPath?: string;
  startCommand?: string;
  pages: PageInit[];
  /** Route paths that carry NO page (dangling pageId) — for redirect tests. */
  bareRoutes?: string[];
  navigation?: NavInit[];
  storage?: StoreInit[];
  endpoints?: EndpointInit[];
  mocks?: MockInit[];
  acceptance?: AcceptanceInit[];
  assumptions?: string[];
  constraints?: string[];
}

/** Builds a small, deterministic, contract-typed plan. */
export function makePlan(input: MakePlanInput): SynthesisPlan {
  const routes: PlannedRoute[] = [];
  const pages: PlannedPage[] = [];
  let formIndex = 0;
  let elementIndex = 0;

  for (const [index, pageInit] of input.pages.entries()) {
    const routeId = testRouteId(index);
    routes.push({
      id: routeId,
      path: pageInit.path,
      pageId: `page_${UUID}${hex12(index)}`,
      provenance: testProvenance,
    });
    pages.push({
      id: `page_${UUID}${hex12(index)}`,
      routeId,
      title: pageInit.title ?? `Page ${index}`,
      elements: pageInit.elements.map((element) => ({
        id: `el_${UUID}${hex12(elementIndex++)}`,
        ...element,
        provenance: testProvenance,
      })),
      forms: (pageInit.forms ?? []).map((form) => ({
        ...form,
        id: testFormId(formIndex++),
        provenance: testProvenance,
      })),
      provenance: testProvenance,
    });
  }
  for (const [index, path] of (input.bareRoutes ?? []).entries()) {
    routes.push({
      id: testRouteId(input.pages.length + index),
      path,
      pageId: `page_${UUID}${hex12(900 + index)}`, // deliberately NOT in plan.pages
      provenance: testProvenance,
    });
  }

  return {
    planVersion: input.planVersion ?? '0.1',
    application: {
      id: `appsyn_${UUID}${hex12(1)}`,
      name: input.name ?? 'Test App',
      platform: 'web',
      sourceModelId: `app_${UUID}${hex12(1)}`,
      entrypoints: input.pages.length > 0 ? [input.pages[0]?.path ?? '/'] : [],
    },
    routes,
    pages,
    navigation: (input.navigation ?? []).map((transition, index) => ({
      ...transition,
      id: testNavId(index),
      sourceTransitionIds: [`trans_${UUID}${hex12(index)}`],
      provenance: testProvenance,
    })),
    storage: (input.storage ?? []).map((binding, index) => ({
      ...binding,
      id: `store_${UUID}${hex12(index)}`,
      provenance: testProvenance,
    })),
    api: {
      endpoints: (input.endpoints ?? []).map((endpoint, index) => ({
        ...endpoint,
        id: `api_${UUID}${hex12(index)}`,
        sourceOperationIds: [`op_${UUID}${hex12(index)}`],
        provenance: testProvenance,
      })),
      mocks: (input.mocks ?? []).map((mock, index) => ({ ...mock, id: `mock_${UUID}${hex12(index)}` })),
    },
    acceptance: (input.acceptance ?? []).map((acceptance, index) => ({
      ...acceptance,
      id: `acc_${UUID}${hex12(index)}`,
      sourceJourneyIds: [`journey_${UUID}${hex12(index)}`],
      provenance: testProvenance,
    })),
    server: {
      startCommand: input.startCommand ?? 'bun server.ts',
      port: input.port ?? 4610,
      healthPath: input.healthPath ?? '/',
    },
    assumptions: input.assumptions ?? [],
    constraints: input.constraints ?? [],
  };
}

/** A minimal heading-only element init (the common page body). */
export function headingInit(text: string, level = 1, testId?: string): ElementInit {
  return { kind: 'heading', level, ...(testId === undefined ? {} : { testId }), text };
}
