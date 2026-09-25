// ================= SHARED CONTRACT: synthesis-contract.ts =================
// CLAPP Synthesis Plan contract v0.1 — declared by the tech lead (P3 wave,
// 2026-09-25). Canonical owner: @clapp/plan (CLAPP-030). Byte-identical
// mirrors are carried by every package that needs the types (@clapp/codegen
// CLAPP-031, @clapp/gentests CLAPP-032); the tech lead verifies byte-equality
// at integration and freezes. Changes require an ADR.
//
// The SynthesisPlan is the intermediate artifact between the Behavioral IR
// (frozen at P2, @clapp/ir) and the synthesized candidate web app: the
// PLANNER (CLAPP-030) derives it from a validated IrModel; the CODEGEN
// (CLAPP-031) renders it into runnable app source + mock backend; the TEST
// GENERATOR (CLAPP-032) renders it into a generated test suite. All three
// speak ONLY through this contract.
//
// Design principles (inherited from the P2 contract, binding):
//   1. The plan is DERIVED ART: every planned element cites the IR element
//      ids and evidence refs it was derived from (never the reverse).
//   2. Behavioral equivalence is structural: routes, element testids/roles/
//      names, form fields, and storage keys are preserved from the observed
//      model so that reference journeys replay against the candidate.
//   3. Unknown is a valid value: optional fields stay ABSENT, never null.
//   4. Serializable, diffable, versioned (same discipline as the IR).
//   5. The plan is self-contained: it never imports from @clapp/ir —
//      IR constructs are referenced BY ID STRING only.

import type { EvidenceRef } from '@clapp/core';

// ---- provenance (every planned element carries one) ------------------------

/**
 * How a planned element relates to the observed model it synthesizes.
 * 'derived'  — deterministic mapping of one or more IR elements.
 * 'planned'  — a synthesis choice with no single IR source (e.g. a layout
 *              container, a server spec).
 * 'assumed'  — a choice not established by evidence (documented in the
 *              plan's assumptions list as well).
 */
export type PlanProvenanceLevel = 'derived' | 'planned' | 'assumed';

/** Provenance block carried by every planned element. */
export interface PlanProvenance {
  level: PlanProvenanceLevel;
  /** one honest sentence: why this plan element exists as it does. */
  rationale: string;
  /** IR element ids this renders/derives from (e.g. "screen_...", "comp_..."). */
  sourceIds: string[];
  /** evidence refs backing the derivation (empty is legal for 'planned'). */
  evidenceRefs: EvidenceRef[];
}

// ---- plan identity ----------------------------------------------------------

/** Plan contract version (the plan is versioned like the IR). */
export const PLAN_VERSION = '0.1';

export interface PlannedApplication {
  /** "appsyn_" + uuid v4 — the synthesized application's identity. */
  id: string;
  name: string;
  platform: 'web' | 'native' | (string & {});
  /** id of the IrModel this plan was derived from ("app_" + uuid v4). */
  sourceModelId: string;
  /** routes/URLs the candidate app must serve journeys from. */
  entrypoints: string[];
}

// ---- routes & pages ---------------------------------------------------------

export interface PlannedRoute {
  /** "route_" + uuid v4. */
  id: string;
  /** normalized path the candidate server serves, e.g. "/pricing". */
  path: string;
  /** the page rendered at this route. */
  pageId: string;
  provenance: PlanProvenance;
}

/** One form field as planned (rendered inside the owning form). */
export interface PlannedField {
  /** input name attribute (required — forms submit by name). */
  name: string;
  /** 'text' | 'email' | 'password' | 'number' | 'tel' | 'url' | 'search' |
   *  'checkbox' | 'radio' | 'select' | 'textarea' | 'date' | 'hidden'. */
  type: string;
  /** accessible label text (the <label> wrapping/pointing at the input). */
  label: string;
  testId?: string;
  required?: boolean;
  placeholder?: string;
  /** for select/radio: the options offered (value + label). */
  options?: { value: string; label: string }[];
}

/** A planned form: fields + submit affordance + submission semantics. */
export interface PlannedForm {
  /** "form_" + uuid v4. */
  id: string;
  /** route path the form submits to (the ACTION target). */
  action: string;
  method: 'get' | 'post';
  fields: PlannedField[];
  /** the submit button's accessible label. */
  submitLabel: string;
  submitTestId?: string;
  provenance: PlanProvenance;
}

/**
 * One rendered element in document order. The kind vocabulary mirrors the
 * shared role table used by @clapp/observe/@clapp/explore — a synthesized
 * page's element list is what a journey applier resolves targets against.
 */
export interface PlannedElement {
  /** "el_" + uuid v4. */
  id: string;
  kind:
    | 'heading'
    | 'text'
    | 'link'
    | 'button'
    | 'image'
    | 'navigation'
    | 'form'
    | 'list'
    | 'other';
  /** data-testid as observed (journey targets resolve by testId first). */
  testId?: string;
  /** role-table role name (e.g. 'link', 'button', 'textbox' — the role the
   *  element presents to accessibility tooling, not the literal tag). */
  role?: string;
  /** accessible name (aria-label or visible text). */
  name?: string;
  /** static text content (headings, text, link/button labels). */
  text?: string;
  /** link target — an internal route path (external URLs allowed only for
   *  observed-external links; codegen renders them as-is). */
  href?: string;
  /** image alt text. */
  alt?: string;
  /** owning form (kind 'form' elements reference the PlannedForm id). */
  formId?: string;
  /** heading level 1-6 (kind 'heading' only). */
  level?: number;
  provenance: PlanProvenance;
}

export interface PlannedPage {
  /** "page_" + uuid v4. */
  id: string;
  /** the route this page is rendered at (back-reference). */
  routeId: string;
  /** <title> content. */
  title: string;
  /** elements in document order. */
  elements: PlannedElement[];
  /** forms declared on this page (referenced by element formId). */
  forms: PlannedForm[];
  provenance: PlanProvenance;
}

// ---- navigation graph -------------------------------------------------------

export interface PlannedTransition {
  /** "nav_" + uuid v4. */
  id: string;
  /** route navigated FROM. */
  fromRouteId: string;
  /** route navigated TO. */
  toRouteId: string;
  trigger:
    | { kind: 'link'; elementId: string }
    | { kind: 'form-submit'; formId: string }
    | { kind: 'redirect'; reason: string };
  /** IR transition ids this planned transition derives from. */
  sourceTransitionIds: string[];
  provenance: PlanProvenance;
}

// ---- storage bindings -------------------------------------------------------

/**
 * A storage key the candidate app is planned to write. NOTE (honest scope):
 * the journey applier does not execute page scripts, so storage writes are
 * declared here for P4's paired runner; codegen emits the write at the
 * declared trigger where its runtime model allows, and documents where it
 * cannot. Absent bindings = no observed storage to reproduce.
 */
export interface PlannedStorageBinding {
  /** "store_" + uuid v4. */
  id: string;
  /** storage key, e.g. "newsletter-email". */
  key: string;
  storage: 'localStorage' | 'sessionStorage' | 'cookie' | 'server';
  /** IR data-entity field names this binding reproduces. */
  entityFieldNames: string[];
  /** planned transition ids after which the write happens. */
  writtenOn: string[];
  sourceEntityIds: string[];
  provenance: PlanProvenance;
}

// ---- API layer & mocks ------------------------------------------------------

/**
 * An HTTP endpoint the candidate app's API layer (client) calls and the
 * mock backend serves. urlPattern is parameterized like the IR's
 * ("/api/items/:id").
 */
export interface PlannedApiEndpoint {
  /** "api_" + uuid v4. */
  id: string;
  method: string;
  urlPattern: string;
  /** canonical-JSON-safe schema descriptors; absent when unknown. */
  requestSchema?: unknown;
  responseSchema?: unknown;
  errorSchema?: unknown;
  /** IR api-operation ids this endpoint reproduces. */
  sourceOperationIds: string[];
  provenance: PlanProvenance;
}

/** One canned response the mock backend serves for an endpoint. */
export interface MockResponse {
  /** "mock_" + uuid v4. */
  id: string;
  /** the endpoint this response serves. */
  endpointId: string;
  statusCode: number;
  /** canonical-JSON-safe body; absent for empty bodies. */
  bodyJson?: unknown;
}

// ---- acceptance -------------------------------------------------------------

/**
 * One journey the synthesized app MUST support. The full Journey record
 * (action sequence) lives with the journey store (@clapp/journey records /
 * evidence bundle) and is located BY the journeyId; the acceptance entry
 * declares the expectation the generated test suite enforces: replay the
 * journey against the candidate app, expect the final route and the
 * must-see elements.
 */
export interface PlannedAcceptance {
  /** "acc_" + uuid v4. */
  id: string;
  /** IR journey id ("journey_" + uuid v4) — the locator of the record. */
  journeyId: string;
  /** what the journey demonstrates (from the IR journey). */
  purpose: string;
  /** human-readable step summaries, one per action (from the IR journey). */
  steps: string[];
  /** route path the replay must END on. */
  expectedRoute: string;
  /** plan element ids (on the expected page) that must be visible at the
   *  end — derived from the journey's terminal assert-visible actions. */
  mustSeeElementIds: string[];
  sourceJourneyIds: string[];
  provenance: PlanProvenance;
}

// ---- server contract --------------------------------------------------------

/**
 * How a conforming candidate app is started. The codegen emits a package
 * whose start command satisfies this; the test generator's harness starts
 * it (or an equivalent conforming server) before replaying journeys.
 */
export interface PlannedServerSpec {
  /** command that starts the server from the app package root. */
  startCommand: string;
  /** port the server listens on (127.0.0.1). */
  port: number;
  /** path returning 200 when the server is ready, e.g. "/". */
  healthPath: string;
}

// ---- the plan ---------------------------------------------------------------

/** The Synthesis Plan — the whole canonical artifact. */
export interface SynthesisPlan {
  planVersion: string;   // MUST equal PLAN_VERSION ('0.1') in v0
  application: PlannedApplication;
  routes: PlannedRoute[];
  pages: PlannedPage[];
  navigation: PlannedTransition[];
  storage: PlannedStorageBinding[];
  api: {
    endpoints: PlannedApiEndpoint[];
    mocks: MockResponse[];
  };
  acceptance: PlannedAcceptance[];
  server: PlannedServerSpec;
  /** synthesis choices not established by evidence (one per 'assumed' provenance). */
  assumptions: string[];
  constraints: string[];
}
