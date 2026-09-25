/**
 * @clapp/gentests — the TEST SUITE GENERATOR (CLAPP-032).
 *
 * `generateTestSuite(plan, options)` renders a SynthesisPlan (contract v0.1
 * mirror, canonical owner @clapp/plan) into an EXECUTABLE bun-test suite:
 * deterministic, self-contained .ts test files that a candidate app
 * conforming to the plan must pass.
 *
 * Generated groups (one file each; emitted only when the group has tests):
 *
 * - routes.test.ts  — ROUTE tests: one test per planned route (GET path →
 *   200 + text/html + body contains every element testId, every heading
 *   text, every form field label declared on the page) plus ONE server
 *   health test (GET plan.server.healthPath → 200).
 * - api.test.ts     — API tests: one test per planned endpoint. Endpoints
 *   WITH mocks: the planned method is requested once per mock, in
 *   declaration order, and each answer is checked for statusCode + exact
 *   JSON body match. Endpoints WITHOUT mocks: one request → 501 with an
 *   error body naming the endpoint (the plan contract v0.1 declares no
 *   per-endpoint error status, so 501 is the fixed default).
 * - acceptance.test.ts — ACCEPTANCE tests: one test per PlannedAcceptance.
 *   Entries whose journey record was supplied replay the EXTENDED journey
 *   (record actions + one appended assert-visible per must-see element —
 *   testId selector first, else role+name) through createDomApplier +
 *   replayJourney, then assert: zero errors (the replay resolving is the
 *   assertion), validateJourney(extended) === true, actionsApplied ===
 *   record actions + appended assert-visibles, and the final route (the
 *   LAST URL the applier fetched — the v0 ReplaySummary exposes no
 *   current-URL, so the generated test injects a fetch-level echo, the
 *   "final navigate echo" named by the packet) lands on expectedRoute.
 *   Entries WITHOUT a supplied record are emitted as it.skip and listed
 *   in the manifest's skippedAcceptanceIds — honest, never fabricated.
 *
 * Determinism: generation is a pure function of (plan, options). No
 * timestamps, no randomness, no hidden global state: two calls with the
 * same inputs produce byte-identical files (pinned by tests).
 *
 * Generated-code contract (pinned by the hygiene tests): files import ONLY
 * from 'bun:test' (bun stdlib), '@clapp/journey', and node/bun stdlib —
 * never from '@clapp/gentests — so the suite runs standalone once written
 * to any directory from which '@clapp/journey' resolves (any directory
 * inside the clapp workspace, or with @clapp/journey installed next to it).
 *
 * Honest limitations (also in README "Known limitations"):
 * - The plan's storage bindings and navigation transitions generate NO
 *   dedicated assertions: the journey applier executes no page scripts, so
 *   storage writes are unverifiable here (declared for the P4 paired
 *   runner), and transitions are exercised indirectly by the acceptance
 *   replays.
 * - A must-see element with neither a testId nor a role cannot be turned
 *   into a TargetSelector: no assert-visible is appended and the generated
 *   file carries an explicit comment naming the gap. The same happens for
 *   a must-see element id that is absent from the plan's pages.
 * - Endpoints with several mocks are asserted in declaration order; this
 *   pins the mock-consumption semantics (sequential, last repeats) that
 *   the conforming server implements and that @clapp/codegen must match.
 */

import { validateJourney, validateJourneyDetailed, type Journey, type TargetSelector } from '@clapp/journey';
import {
  PLAN_VERSION,
  type PlannedAcceptance,
  type PlannedElement,
  type PlannedPage,
  type SynthesisPlan,
} from './synthesis-contract';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface GenerateTestsOptions {
  /** Suite name used in describe() labels; default: plan.application.name. */
  suiteName?: string;
  /**
   * Base URL the generated tests request. Default: the plan's server spec
   * (`http://127.0.0.1:<plan.server.port>/`). The integration gate points
   * the suite at ANY conforming server by overriding this.
   */
  baseUrl?: string;
  /**
   * Full Journey records located BY acceptance.journeyId. Each record is
   * validated with validateJourney at generation time — invalid records
   * throw. Records not referenced by any acceptance entry are ignored;
   * acceptance entries without a matching record are skipped honestly.
   */
  journeyRecords?: Journey[];
}

export interface GeneratedFile {
  /** Path relative to the suite root (forward slashes, no '..'). */
  path: string;
  contents: string;
}

export interface SuiteManifest {
  /** Total tests in the generated suite (route + api + acceptance). */
  testCount: number;
  /** One per planned route, plus one server-health test. */
  routeTestCount: number;
  /** One per planned endpoint (with or without mocks). */
  apiTestCount: number;
  /** One per acceptance entry, skipped entries included. */
  acceptanceTestCount: number;
  /** Plan ids of acceptance entries emitted as it.skip (no record supplied). */
  skippedAcceptanceIds: string[];
}

export interface GeneratedTestSuite {
  files: GeneratedFile[];
  manifest: SuiteManifest;
}

/** Thrown for structurally unusable generateTestSuite inputs. */
export class GentestsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GentestsError';
  }
}

// ---------------------------------------------------------------------------
// Small helpers (pure, deterministic)
// ---------------------------------------------------------------------------

/** JSON.stringify as a TS string literal (deterministic, fully escaping). */
function lit(value: string): string {
  return JSON.stringify(value);
}

/** Makes unvalidated plan ids safe for single-line // comments. */
function commentSafe(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\*\//g, '*_/');
}

/** Derives the appended assert-visible selector: testId first, else role(+name). */
export function mustSeeSelectorFor(element: PlannedElement): TargetSelector | null {
  if (element.testId !== undefined && element.testId !== '') {
    return { testId: element.testId };
  }
  if (element.role !== undefined && element.role !== '') {
    if (element.name !== undefined && element.name !== '') {
      return { role: element.role, name: element.name };
    }
    // role-only selector (e.g. a footer's implicit contentinfo): legal in
    // the journey contract, resolvable when the page has a single such
    // element (documented in README).
    return { role: element.role };
  }
  return null;
}

/** Substitutes urlPattern params deterministically: ":id" → "test-id". */
export function concreteUrlForPattern(urlPattern: string): string {
  return urlPattern
    .split('/')
    .map((segment) => (segment.startsWith(':') ? `test-${segment.slice(1)}` : segment))
    .join('/');
}

/** Both '/' and '/x' normalize to their route-path form. */
function normalizeRoutePath(path: string): string {
  if (path.length > 1 && path.endsWith('/')) {
    return path.slice(0, -1);
  }
  return path;
}

interface PlanIndex {
  pagesById: Map<string, PlannedPage>;
  elementById: Map<string, PlannedElement>;
}

function indexPlan(plan: SynthesisPlan): PlanIndex {
  const pagesById = new Map<string, PlannedPage>();
  const elementById = new Map<string, PlannedElement>();
  for (const page of plan.pages) {
    pagesById.set(page.id, page);
    for (const element of page.elements) {
      elementById.set(element.id, element);
    }
  }
  return { pagesById, elementById };
}

// ---------------------------------------------------------------------------
// Line writer
// ---------------------------------------------------------------------------

class Lines {
  private readonly out: string[] = [];

  line(text = ''): void {
    this.out.push(text);
  }

  toString(): string {
    return `${this.out.join('\n')}\n`;
  }
}

function generatedHeader(group: string, plan: SynthesisPlan, suiteName: string): string[] {
  return [
    `// GENERATED FILE — CLAPP-032 generated test suite (${group} group). DO NOT EDIT BY HAND.`,
    `// Suite: ${suiteName} | Plan: ${plan.application.id} (v${plan.planVersion})`,
    '// Imports are limited to bun:test (bun stdlib), @clapp/journey, and node/bun',
    '// stdlib. Network access is limited to the suite BASE_URL (a local server).',
    '// Resolution requirement: run `bun test` from a directory where',
    "// '@clapp/journey' resolves (e.g. anywhere inside the clapp workspace).",
  ];
}

// ---------------------------------------------------------------------------
// ROUTE group
// ---------------------------------------------------------------------------

function renderRoutesFile(plan: SynthesisPlan, suiteName: string, baseUrl: string): string {
  const lines = new Lines();
  for (const header of generatedHeader('route', plan, suiteName)) {
    lines.line(header);
  }
  lines.line();
  lines.line(`import { describe, expect, it } from 'bun:test';`);
  lines.line();
  lines.line(`const BASE_URL = ${lit(baseUrl)};`);
  lines.line();
  lines.line(`describe(${lit(`routes — ${suiteName}`)}, () => {`);
  for (const route of plan.routes) {
    const page = plan.pages.find((candidate) => candidate.id === route.pageId);
    const testIds = page === undefined ? [] : collectTestIds(page);
    const headings = page === undefined ? [] : collectHeadingTexts(page);
    const labels = page === undefined ? [] : collectFieldLabels(page);
    lines.line(`  it(${lit(`GET ${route.path} — ${page === undefined ? route.pageId : page.id} — serves conforming HTML`)}, async () => {`);
    lines.line(`    const response = await fetch(new URL(${lit(route.path)}, BASE_URL));`);
    lines.line('    expect(response.status).toBe(200);');
    lines.line(`    expect((response.headers.get('content-type') ?? '').toLowerCase()).toContain('text/html');`);
    lines.line('    const body = await response.text();');
    if (page === undefined) {
      lines.line('    // route.pageId does not resolve to a planned page (generator kept the test honest):');
      lines.line(`    // only the 200 + content-type guarantees above are asserted for this route.`);
    }
    for (const testId of testIds) {
      lines.line(`    expect(body).toContain(${lit(`data-testid="${testId}"`)});`);
    }
    for (const heading of headings) {
      lines.line(`    expect(body).toContain(${lit(heading)});`);
    }
    for (const label of labels) {
      lines.line(`    expect(body).toContain(${lit(label)});`);
    }
    lines.line('  });');
    lines.line();
  }
  const healthPath = plan.server.healthPath === '' ? '/' : plan.server.healthPath;
  lines.line(`  it(${lit(`server health: GET ${healthPath} answers 200`)}, async () => {`);
  lines.line(`    const response = await fetch(new URL(${lit(healthPath)}, BASE_URL));`);
  lines.line('    expect(response.status).toBe(200);');
  lines.line('  });');
  lines.line('});');
  return lines.toString();
}

function collectTestIds(page: PlannedPage): string[] {
  const out: string[] = [];
  for (const element of page.elements) {
    if (element.testId !== undefined && element.testId !== '' && !out.includes(element.testId)) {
      out.push(element.testId);
    }
  }
  for (const form of page.forms) {
    if (form.submitTestId !== undefined && form.submitTestId !== '' && !out.includes(form.submitTestId)) {
      out.push(form.submitTestId);
    }
    for (const field of form.fields) {
      if (field.testId !== undefined && field.testId !== '' && !out.includes(field.testId)) {
        out.push(field.testId);
      }
    }
  }
  return out;
}

function collectHeadingTexts(page: PlannedPage): string[] {
  const out: string[] = [];
  for (const element of page.elements) {
    if (element.kind === 'heading' && element.text !== undefined && element.text !== '' && !out.includes(element.text)) {
      out.push(element.text);
    }
  }
  return out;
}

function collectFieldLabels(page: PlannedPage): string[] {
  const out: string[] = [];
  for (const form of page.forms) {
    for (const field of form.fields) {
      if (field.label !== '' && !out.includes(field.label)) {
        out.push(field.label);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// API group
// ---------------------------------------------------------------------------

function renderApiFile(plan: SynthesisPlan, suiteName: string, baseUrl: string): string {
  const lines = new Lines();
  for (const header of generatedHeader('api', plan, suiteName)) {
    lines.line(header);
  }
  lines.line();
  lines.line(`import { describe, expect, it } from 'bun:test';`);
  lines.line();
  lines.line(`const BASE_URL = ${lit(baseUrl)};`);
  lines.line();
  lines.line(`describe(${lit(`api — ${suiteName}`)}, () => {`);
  for (const endpoint of plan.api.endpoints) {
    const mocks = plan.api.mocks.filter((mock) => mock.endpointId === endpoint.id);
    const concrete = concreteUrlForPattern(endpoint.urlPattern);
    const method = endpoint.method.toUpperCase();
    if (mocks.length === 0) {
      lines.line(`  it(${lit(`${method} ${endpoint.urlPattern} (no planned mock) answers 501 naming the endpoint`)}, async () => {`);
      lines.line(`    const response = await fetch(new URL(${lit(concrete)}, BASE_URL), { method: ${lit(method)} });`);
      lines.line('    expect(response.status).toBe(501);');
      lines.line('    const body = await response.text();');
      lines.line(`    expect(body).toContain(${lit(endpoint.id)});`);
      lines.line('  });');
      lines.line();
      continue;
    }
    lines.line(`  it(${lit(`${method} ${endpoint.urlPattern} answers its planned mocks exactly (in declaration order)`)}, async () => {`);
    for (const [index, mock] of mocks.entries()) {
      const name = index === 0 ? 'first' : index === 1 ? 'second' : `response${index + 1}`;
      lines.line(`    const ${name} = await fetch(new URL(${lit(concrete)}, BASE_URL), { method: ${lit(method)} });`);
      lines.line(`    expect(${name}.status).toBe(${mock.statusCode});`);
      if (mock.bodyJson === undefined) {
        lines.line(`    expect(await ${name}.text()).toBe('');`);
      } else {
        lines.line(`    expect(await ${name}.json()).toEqual(${JSON.stringify(mock.bodyJson, null, 4).replace(/\n/g, '\n    ')});`);
      }
    }
    lines.line('  });');
    lines.line();
  }
  lines.line('});');
  return lines.toString();
}

// ---------------------------------------------------------------------------
// ACCEPTANCE group
// ---------------------------------------------------------------------------

interface AcceptancePlanEntry {
  acceptance: PlannedAcceptance;
  record: Journey | undefined;
  selectors: { elementId: string; selector: TargetSelector | null }[];
}

// ---------------------------------------------------------------------------
// generateTestSuite
// ---------------------------------------------------------------------------

export function generateTestSuite(plan: SynthesisPlan, options: GenerateTestsOptions = {}): GeneratedTestSuite {
  // ---- input validation ------------------------------------------------------
  if (plan.planVersion !== PLAN_VERSION) {
    throw new GentestsError(
      `plan.planVersion must equal PLAN_VERSION ('${PLAN_VERSION}'); got ${lit(plan.planVersion)}`,
    );
  }
  const routePaths = new Set<string>();
  for (const route of plan.routes) {
    const normalized = normalizeRoutePath(route.path);
    if (routePaths.has(normalized)) {
      throw new GentestsError(`duplicate planned route path: ${route.path}`);
    }
    routePaths.add(normalized);
  }
  const recordsById = new Map<string, Journey>();
  for (const record of options.journeyRecords ?? []) {
    if (!validateJourney(record)) {
      const { errors } = validateJourneyDetailed(record);
      const id =
        typeof (record as { id?: unknown }).id === 'string' ? (record as { id: string }).id : '<missing id>';
      throw new GentestsError(`journeyRecords: invalid journey ${id}: ${errors.join('; ')}`);
    }
    if (recordsById.has(record.id)) {
      throw new GentestsError(`journeyRecords: duplicate journey id ${record.id}`);
    }
    recordsById.set(record.id, record);
  }

  // ---- common values ---------------------------------------------------------
  const suiteName = options.suiteName ?? plan.application.name;
  let baseUrl = options.baseUrl ?? `http://127.0.0.1:${plan.server.port}/`;
  if (!baseUrl.endsWith('/')) {
    baseUrl = `${baseUrl}/`;
  }

  const files: GeneratedFile[] = [];
  const routeTestCount = plan.routes.length + 1; // routes + server health
  const apiTestCount = plan.api.endpoints.length;
  const acceptanceTestCount = plan.acceptance.length;
  const skippedAcceptanceIds: string[] = [];

  // ---- route group -----------------------------------------------------------
  files.push({ path: 'routes.test.ts', contents: renderRoutesFile(plan, suiteName, baseUrl) });

  // ---- api group -------------------------------------------------------------
  if (plan.api.endpoints.length > 0) {
    files.push({ path: 'api.test.ts', contents: renderApiFile(plan, suiteName, baseUrl) });
  }

  // ---- acceptance group ------------------------------------------------------
  if (plan.acceptance.length > 0) {
    const index = indexPlan(plan);
    const entries: AcceptancePlanEntry[] = plan.acceptance.map((acceptance) => {
      const record = recordsById.get(acceptance.journeyId);
      if (record === undefined) {
        skippedAcceptanceIds.push(acceptance.id);
      }
      const selectors = acceptance.mustSeeElementIds.map((elementId) => ({
        elementId,
        selector: (() => {
          const element = index.elementById.get(elementId);
          return element === undefined ? null : mustSeeSelectorFor(element);
        })(),
      }));
      return { acceptance, record, selectors };
    });
    files.push({
      path: 'acceptance.test.ts',
      contents: renderAcceptanceFileImpl(entries, plan, suiteName, baseUrl),
    });
  }

  const manifest: SuiteManifest = {
    testCount: routeTestCount + apiTestCount + acceptanceTestCount,
    routeTestCount,
    apiTestCount,
    acceptanceTestCount,
    skippedAcceptanceIds,
  };
  return { files, manifest };
}

// ---------------------------------------------------------------------------
// acceptance rendering (implementation)
// ---------------------------------------------------------------------------

function renderAcceptanceFileImpl(
  entries: AcceptancePlanEntry[],
  plan: SynthesisPlan,
  suiteName: string,
  baseUrl: string,
): string {
  const lines = new Lines();
  for (const header of generatedHeader('acceptance', plan, suiteName)) {
    lines.line(header);
  }
  lines.line();
  const hasReplay = entries.some((entry) => entry.record !== undefined);
  lines.line(`import { describe, expect, it } from 'bun:test';`);
  if (hasReplay) {
    lines.line(`import { createDomApplier, replayJourney, validateJourney } from '@clapp/journey';`);
    lines.line(`import type { Journey, JourneyAction, TargetSelector } from '@clapp/journey';`);
  }
  lines.line();
  lines.line(`const BASE_URL = ${lit(baseUrl)};`);
  lines.line();
  lines.line(`describe(${lit(`acceptance — ${suiteName}`)}, () => {`);
  for (const entry of entries) {
    const { acceptance, record, selectors } = entry;
    const label = `${acceptance.id}: ${acceptance.purpose} (journey ${acceptance.journeyId})`;
    if (record === undefined) {
      lines.line(`  it.skip(${lit(`${label} — journey record not supplied`)}, () => {`);
      lines.line(`    // Honest skip: no Journey record with id ${commentSafe(acceptance.journeyId)} was supplied`);
      lines.line('    // to generateTestSuite({ journeyRecords }) for this acceptance entry.');
      lines.line(`    // The plan id is listed in SuiteManifest.skippedAcceptanceIds: ${commentSafe(acceptance.id)}.`);
      lines.line('  });');
      lines.line();
      continue;
    }
    lines.line(`  it(${lit(label)}, async () => {`);
    lines.line(`    const journeyRecord: Journey = ${JSON.stringify(record, null, 4).replace(/\n/g, '\n    ')};`);
    lines.line();
    lines.line('    // Must-see selectors derived from the plan elements named by the');
    lines.line('    // acceptance entry (testId first, else role+name — see the generator).');
    if (selectors.length === 0) {
      lines.line('    // (This acceptance entry declares no must-see elements.)');
    }
    lines.line('    const mustSee: TargetSelector[] = [');
    for (const { elementId, selector } of selectors) {
      if (selector === null) {
        lines.line(`      // must-see element ${commentSafe(elementId)} has neither a testId nor a role:`);
        lines.line('      // no assert-visible can be appended for it (documented gap).');
        continue;
      }
      const selectorJson = JSON.stringify(selector);
      lines.line(`      ${selectorJson}, // ${commentSafe(elementId)}`);
    }
    lines.line('    ];');
    lines.line();
    lines.line('    // The extended journey: the recorded actions plus one appended');
    lines.line('    // assert-visible per must-see element, validated before replay.');
    lines.line('    const extended: Journey = {');
    lines.line('      ...journeyRecord,');
    lines.line('      actions: [');
    lines.line('        ...journeyRecord.actions,');
    lines.line('        ...mustSee.map((target): JourneyAction => ({ type: \'assert-visible\', target })),');
    lines.line('      ],');
    lines.line('    };');
    lines.line('    expect(validateJourney(extended)).toBe(true);');
    lines.line();
    lines.line('    // Final-route echo: every applier navigation flows through the');
    lines.line('    // injectable fetch, so the LAST fetched URL is where the journey');
    lines.line('    // ended (the v0 ReplaySummary exposes no current-URL field).');
    lines.line('    let lastFetchedUrl = \'\';');
    lines.line('    const fetchEcho = (async (input: URL | string, init?: RequestInit): Promise<Response> => {');
    lines.line('      const response = await fetch(input, init);');
    lines.line(`      lastFetchedUrl = response.url !== '' ? response.url : String(input);`);
    lines.line('      return response;');
    lines.line('    }) as typeof fetch;');
    lines.line();
    lines.line(`    const summary = await replayJourney(extended, createDomApplier({ baseUrl: BASE_URL, fetchImpl: fetchEcho }));`);
    lines.line(`    expect(summary.journeyId).toBe(journeyRecord.id);`);
    lines.line('    // The record\'s actions plus the appended must-see assert-visibles:');
    lines.line('    // every recorded action applied, none skipped.');
    lines.line('    expect(summary.actionsApplied).toBe(journeyRecord.actions.length + mustSee.length);');
    lines.line();
    lines.line('    // The replay must END on the planned expected route…');
    lines.line('    const finalUrl = new URL(lastFetchedUrl === \'\' ? BASE_URL : lastFetchedUrl);');
    lines.line(`    expect(finalUrl.pathname).toBe(${lit(normalizeRoutePath(acceptance.expectedRoute))});`);
    lines.line('    // …and that route must serve the final page.');
    lines.line(`    const finalResponse = await fetch(new URL(${lit(normalizeRoutePath(acceptance.expectedRoute))}, BASE_URL));`);
    lines.line('    expect(finalResponse.status).toBe(200);');
    lines.line('  });');
    lines.line();
  }
  lines.line('});');
  return lines.toString();
}
