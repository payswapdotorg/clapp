/**
 * @clapp/plan — the architecture planner (CLAPP-030).
 *
 * `planSynthesis(model, options)` derives a validated SynthesisPlan v0.1 from
 * a validated Behavioral IR model — the architecture blueprint that
 * @clapp/codegen (CLAPP-031) renders into a candidate app and @clapp/gentests
 * (CLAPP-032) renders into acceptance tests. The plan is DERIVED ART: every
 * planned element cites the IR element ids (and evidence refs) it derives
 * from; behavioral equivalence is structural — routes, element
 * testids/roles/names, form fields, and storage keys are preserved verbatim
 * from the observed model so reference journeys replay against the
 * candidate.
 *
 * Binding derivation rules (each unit-tested; see derivation.test.ts):
 * - screens → routes+pages: every IrScreen becomes a PlannedRoute (path =
 *   screen.route) + PlannedPage. The page title comes from the screen's
 *   lowest-level (smallest hN) heading component with usable text; a screen
 *   without one falls back to the route basename WITH an assumption — text is
 *   never fabricated.
 * - components → elements: every IrComponent becomes a PlannedElement (kind
 *   from the role mapping: link→link, button→button, navigation→navigation,
 *   heading→heading with level, image→image, list→list, form→form, and the
 *   form-control/other roles→other with the role preserved verbatim).
 *   role/name/testId/text/href/alt are preserved verbatim when observed.
 *   textbox-role components ALSO become PlannedFields when their screen has
 *   a planned form (below); they remain elements so journey targets resolve.
 * - forms: textbox-role components on a screen + the screen's button
 *   components group into a PlannedForm ONLY when an outgoing IrTransition
 *   with trigger {type:'action', action:'submit'} exists on that screen;
 *   action = the transition's toScreen route, method 'get' (IR v0.1 cannot
 *   observe form methods — post only when observed, which it never is, so
 *   every form carries a 'get' assumption). Screens without submit
 *   transitions carry NO forms (honest, documented) and their textboxes
 *   become plain elements.
 * - transitions → navigation: every IrTransition whose from/to screens both
 *   resolve becomes a PlannedTransition (self-transitions legal). Trigger
 *   derivation: action 'submit' → {kind:'form-submit'}; action 'click' when
 *   the transition's input names (by href/name/testId string equality)
 *   EXACTLY ONE link-role component on the from-screen → {kind:'link'};
 *   otherwise {kind:'redirect'} with an assumption (never silent).
 * - data entities → storage bindings: every IrDataEntity persistence entry
 *   ("localStorage:key" | "sessionStorage:key" | "cookie:name") becomes a
 *   PlannedStorageBinding; writtenOn lists the planned transitions whose
 *   sideEffects mention the entity or key (empty when unobserved — honest).
 * - api operations → endpoints: every http-transport IrApiOperation with a
 *   method becomes a PlannedApiEndpoint (schemas passed through when
 *   present). WebSocket-transport ops are NOT mapped in v0 — one plan
 *   assumption documents the skip (never silent). Endpoints with a
 *   responseSchema get one MockResponse (statusCode 200, bodyJson
 *   deterministically sketched: string→"mock", number→0, boolean→false,
 *   array→[], object→recursive over the sketch descriptor's keys/valueTypes,
 *   null-typed keys omitted — 'planned' placeholder semantics, not observed
 *   data).
 * - journeys → acceptance: each input Journey record yields an acceptance
 *   entry (journeyId = the record's id; purpose/steps from the matching
 *   IrJourney when present, else derived from the record + assumption).
 *   expectedRoute = the owning page's route of the LAST resolved
 *   assert-visible target (by testId first, then role+name; nth selects
 *   among matches); mustSeeElementIds = the journey's assert targets
 *   re-resolved against the expected page. Every unresolved target → one
 *   assumption entry (never dropped silently). Absent journeys → acceptance
 *   stays EMPTY with an assumption (honest, never fabricated).
 * - application: id minted "appsyn_"+uuid v4, name = the IR application's
 *   name + " (synth)", sourceModelId = the IR application id, entrypoints =
 *   the IR application entrypoints (the validator enforces they are served
 *   routes — a model whose entrypoints have no screens cannot be planned and
 *   planSynthesis throws).
 * - server spec: startCommand "bun run start", port 4173, healthPath "/"
 *   (v0 'planned' constants — codegen materializes them).
 *
 * Determinism: planSynthesis is a pure function of (model, options) modulo
 * minted ids — every iteration follows model order and every assumption is
 * appended in a deterministic sequence, so planning the same model twice
 * yields structure-identical plans (ids differ; equal after id normalization
 * — pinned by determinism.test.ts). The assembled plan is self-checked with
 * validateSynthesisPlanDetailed before it is returned; a planner bug that
 * would emit an invalid plan throws instead of leaking.
 */

import type { EvidenceRef } from '@clapp/core';
import type { Journey, JourneyAction, TargetSelector } from '@clapp/journey';
import { validateJourney } from '@clapp/journey';
import type { IrComponent, IrModel, IrScreen, IrTransition } from '@clapp/ir';
import { validateIrModelDetailed } from '@clapp/ir';
import type {
  MockResponse,
  PlanProvenance,
  PlannedAcceptance,
  PlannedApiEndpoint,
  PlannedElement,
  PlannedField,
  PlannedForm,
  PlannedPage,
  PlannedRoute,
  PlannedServerSpec,
  PlannedStorageBinding,
  PlannedTransition,
  SynthesisPlan,
} from './synthesis-contract';
import { PLAN_VERSION } from './synthesis-contract';
import {
  newAcceptanceId,
  newApiEndpointId,
  newElementId,
  newFormId,
  newMockId,
  newNavId,
  newPageId,
  newPlannedApplicationId,
  newRouteId,
  newStorageBindingId,
  planIdPatternFor,
} from './ids';
import { validateSynthesisPlanDetailed } from './validate';

/** Thrown when planning cannot proceed honestly (invalid inputs or a failed self-check). */
export class PlanSynthesisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlanSynthesisError';
  }
}

/** The planned-element kinds an id factory can be asked to mint. */
export type PlanIdKind =
  | 'application'
  | 'route'
  | 'page'
  | 'element'
  | 'form'
  | 'navigation'
  | 'storageBinding'
  | 'apiEndpoint'
  | 'mock'
  | 'acceptance';

/** Options for {@link planSynthesis}. */
export interface PlanOptions {
  /**
   * Journey records the plan derives acceptance entries from. Absent or empty
   * → the plan carries one assumption and the acceptance section stays EMPTY
   * (honest, never fabricated).
   */
  journeys?: Journey[];
  /**
   * Deterministic-id override for tests: mints the id for the given kind.
   * Minted ids are pattern-checked immediately — a factory that mints
   * non-conforming ids fails fast with a clear error instead of failing the
   * plan self-check later.
   */
  idFactory?: (kind: PlanIdKind) => string;
}

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

function joinErrors(errors: readonly string[]): string {
  return errors.length === 1 ? (errors[0] ?? '') : errors.map((e) => `- ${e}`).join('\n');
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Non-empty string or null (the only values carried into plan fields). */
function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function derivedProvenance(rationale: string, sourceIds: string[], evidenceRefs: EvidenceRef[]): PlanProvenance {
  return {
    level: 'derived',
    rationale,
    sourceIds: [...sourceIds],
    evidenceRefs: evidenceRefs.map((ref) => ({ ...ref })),
  };
}

function assumedProvenance(rationale: string, sourceIds: string[], evidenceRefs: EvidenceRef[]): PlanProvenance {
  return {
    level: 'assumed',
    rationale,
    sourceIds: [...sourceIds],
    evidenceRefs: evidenceRefs.map((ref) => ({ ...ref })),
  };
}

/** Union of the provenance evidenceRefs of the given IR elements, first-seen order, deduped by evidenceId. */
function collectRefs(elements: ReadonlyArray<{ provenance?: { confidence?: { evidenceRefs?: unknown } } }>): EvidenceRef[] {
  const seen = new Set<string>();
  const refs: EvidenceRef[] = [];
  for (const element of elements) {
    const refsValue = element.provenance?.confidence?.evidenceRefs;
    if (!Array.isArray(refsValue)) continue;
    for (const ref of refsValue) {
      if (isPlainRecord(ref) && typeof ref['evidenceId'] === 'string' && !seen.has(ref['evidenceId'])) {
        seen.add(ref['evidenceId']);
        refs.push(ref as unknown as EvidenceRef);
      }
    }
  }
  return refs;
}

/** The component's usable text: accessible name first, else observed text. */
function usableTextOf(component: IrComponent): string | null {
  return nonEmptyString(component.properties['name']) ?? nonEmptyString(component.properties['text']);
}

/** Heading level from the observed tag ("h1".."h6"); null when unknown. */
function headingLevelOf(component: IrComponent): number | null {
  const tag = nonEmptyString(component.properties['tag']);
  if (tag === null) return null;
  const match = /^h([1-6])$/i.exec(tag);
  return match === null ? null : Number(match[1]);
}

/** The page-title fallback: the route's last non-empty path segment ("home" for the root). */
function routeBasename(route: string): string {
  const segments = route.split('?')[0]?.split('#')[0]?.split('/').filter((segment) => segment.length > 0) ?? [];
  const last = segments[segments.length - 1];
  return last === undefined || last === '' ? 'home' : last;
}

/** Element kind from the IR component role (the shared role-table vocabulary). */
function kindFromRole(role: string): PlannedElement['kind'] {
  switch (role) {
    case 'link': return 'link';
    case 'button': return 'button';
    case 'navigation': return 'navigation';
    case 'heading': return 'heading';
    case 'image': return 'image';
    case 'list': return 'list';
    case 'form': return 'form';
    default: return 'other';
  }
}

/** String values inside a transition `input` (strings, or record string values). */
function collectInputStrings(input: unknown): string[] {
  if (typeof input === 'string' && input !== '') return [input];
  if (isPlainRecord(input)) {
    const values: string[] = [];
    for (const value of Object.values(input)) {
      const text = nonEmptyString(value);
      if (text !== null) values.push(text);
    }
    return values;
  }
  return [];
}

/** Parsed IR persistence entry ("localStorage:key" | "sessionStorage:key" | "cookie:name"). */
function parsePersistence(entry: string): { storage: PlannedStorageBinding['storage']; key: string } | null {
  for (const storage of ['localStorage', 'sessionStorage', 'cookie'] as const) {
    const prefix = `${storage}:`;
    if (entry.startsWith(prefix) && entry.slice(prefix.length) !== '') {
      return { storage, key: entry.slice(prefix.length) };
    }
  }
  return null;
}

/**
 * Mirror of @clapp/explore's normalizeRoute for journey URL paths (documented
 * reimplementation — the planner cannot depend on @clapp/explore at runtime):
 * strip query/hash, ensure a leading "/", collapse "/index.html" to "/",
 * strip a trailing ".html".
 */
export function routeFromJourneyUrl(url: string): string {
  let path = url.split('?')[0]?.split('#')[0] ?? '/';
  if (path === '') path = '/';
  if (!path.startsWith('/')) path = `/${path}`;
  if (path.endsWith('/index.html')) {
    path = path.slice(0, -'index.html'.length) || '/';
  } else if (path.endsWith('.html')) {
    path = path.slice(0, -'.html'.length);
  }
  return path;
}

/** Human-readable target description (mirrors @clapp/explore's describeTarget). */
export function describeTarget(target: TargetSelector): string {
  const parts: string[] = [];
  if (target.testId !== undefined) parts.push(`testId=${target.testId}`);
  if (target.role !== undefined) parts.push(`role=${target.role}`);
  if (target.name !== undefined) parts.push(`name=${JSON.stringify(target.name)}`);
  if (target.nth !== undefined) parts.push(`nth=${String(target.nth)}`);
  return parts.length > 0 ? parts.join(' ') : '(empty selector)';
}

/** Human-readable step summary for one journey action (mirrors @clapp/explore's describeAction). */
export function describeJourneyAction(action: JourneyAction): string {
  switch (action.type) {
    case 'navigate':
      return `navigate to ${action.url}`;
    case 'click':
      return `click ${describeTarget(action.target)}`;
    case 'fill':
      return `fill ${describeTarget(action.target)} with ${JSON.stringify(action.value)}`;
    case 'assert-visible':
      return `assert ${describeTarget(action.target)} is visible`;
    case 'press':
      return `press ${action.key}`;
    case 'wait':
      return `wait ${action.ms}ms`;
  }
}

// ---------------------------------------------------------------------------
// Mock body sketching ('planned' placeholder semantics — documented, deterministic)
// ---------------------------------------------------------------------------

function sketchTypeValue(type: unknown): unknown {
  switch (type) {
    case 'string': return 'mock';
    case 'number': return 0;
    case 'integer': return 0;
    case 'boolean': return false;
    case 'array': return [];
    case 'object': return {};
    case 'null': return undefined; // null-typed values are OMITTED (absent, never null)
    default: return undefined;
  }
}

/**
 * Deterministically sketch a mock body from a responseSchema descriptor.
 * Understands the platform's sketch shape ({ type, keys, valueTypes } — see
 * @clapp/extract's schema-sketch); anything else degrades to {} (or the
 * type-mapped scalar for type-bearing records and plain scalars). The result
 * is a PLACEHOLDER, never observed data.
 */
export function sketchMockBody(schema: unknown): unknown {
  if (Array.isArray(schema)) return [];
  if (isPlainRecord(schema)) {
    const type = nonEmptyString(schema['type']);
    if (type === 'object') {
      const body: Record<string, unknown> = {};
      const keys = Array.isArray(schema['keys']) ? schema['keys'] : [];
      const valueTypes = isPlainRecord(schema['valueTypes']) ? schema['valueTypes'] : {};
      for (const key of keys) {
        if (typeof key !== 'string' || key === '') continue;
        const sketched = sketchTypeValue(valueTypes[key]);
        if (sketched !== undefined) body[key] = sketched;
      }
      return body;
    }
    if (type === 'null') return undefined; // a null-typed body is ABSENT (empty body), never null
    if (type !== null) {
      const sketched = sketchTypeValue(type);
      return sketched === undefined ? {} : sketched;
    }
    return {};
  }
  if (typeof schema === 'string') return 'mock';
  if (typeof schema === 'number') return 0;
  if (typeof schema === 'boolean') return false;
  return {};
}

// ---------------------------------------------------------------------------
// Acceptance target resolution
// ---------------------------------------------------------------------------

interface ResolvedTarget {
  element: PlannedElement;
  routePath: string;
}

/**
 * Resolve one assert target against the planned elements, BY TESTID FIRST,
 * THEN role+name (the packet's declared resolution order): a testId-bearing
 * target that matches nothing by testId falls back to role+name. nth
 * selects among matches when present. Candidates are collected across pages
 * in plan order (page order, then document order) — a documented v0.1
 * approximation of the applier's per-page nth semantics that is exact for
 * unique targets, which is what acceptance uses.
 */
function resolveTarget(target: TargetSelector, pagesByRoute: ReadonlyArray<{ routePath: string; page: PlannedPage }>): ResolvedTarget | null {
  const wantsTestId = nonEmptyString(target.testId);
  const wantsRole = nonEmptyString(target.role);
  const wantsName = nonEmptyString(target.name);
  if (wantsTestId === null && wantsRole === null && wantsName === null) return null;

  const collect = (byTestId: boolean): ResolvedTarget[] => {
    const candidates: ResolvedTarget[] = [];
    for (const { routePath, page } of pagesByRoute) {
      for (const element of page.elements) {
        let matched: boolean;
        if (byTestId) {
          matched =
            element.testId === wantsTestId &&
            (wantsRole === null || element.role === wantsRole) &&
            (wantsName === null || element.name === wantsName);
        } else {
          matched =
            (wantsRole !== null || wantsName !== null) &&
            (wantsRole === null || element.role === wantsRole) &&
            (wantsName === null || element.name === wantsName);
        }
        if (matched) candidates.push({ element, routePath });
      }
    }
    return candidates;
  };

  let candidates: ResolvedTarget[];
  if (wantsTestId !== null) {
    candidates = collect(true);
    if (candidates.length === 0) candidates = collect(false); // testId first, then role+name
  } else {
    candidates = collect(false);
  }
  if (candidates.length === 0) return null;
  const index = target.nth !== undefined && Number.isInteger(target.nth) && target.nth >= 0 ? target.nth : 0;
  return candidates[index] ?? null;
}

/** Resolve one assert target against ONE page (must-see resolution), by
 * testId first, then role+name (same order as the whole-plan resolver). */
function resolveTargetOnPage(target: TargetSelector, page: PlannedPage): PlannedElement | null {
  const wantsTestId = nonEmptyString(target.testId);
  const wantsRole = nonEmptyString(target.role);
  const wantsName = nonEmptyString(target.name);
  if (wantsTestId === null && wantsRole === null && wantsName === null) return null;

  const collect = (byTestId: boolean): PlannedElement[] => {
    const candidates: PlannedElement[] = [];
    for (const element of page.elements) {
      let matched: boolean;
      if (byTestId) {
        matched =
          element.testId === wantsTestId &&
          (wantsRole === null || element.role === wantsRole) &&
          (wantsName === null || element.name === wantsName);
      } else {
        matched =
          (wantsRole !== null || wantsName !== null) &&
          (wantsRole === null || element.role === wantsRole) &&
          (wantsName === null || element.name === wantsName);
      }
      if (matched) candidates.push(element);
    }
    return candidates;
  };

  let candidates: PlannedElement[];
  if (wantsTestId !== null) {
    candidates = collect(true);
    if (candidates.length === 0) candidates = collect(false);
  } else {
    candidates = collect(false);
  }
  if (candidates.length === 0) return null;
  const index = target.nth !== undefined && Number.isInteger(target.nth) && target.nth >= 0 ? target.nth : 0;
  return candidates[index] ?? null;
}

// ---------------------------------------------------------------------------
// The planner
// ---------------------------------------------------------------------------

interface MintedIdFactory {
  (kind: PlanIdKind): string;
}

function createMint(idFactory: PlanOptions['idFactory']): MintedIdFactory {
  const prefixFor: Record<PlanIdKind, string> = {
    application: 'appsyn_',
    route: 'route_',
    page: 'page_',
    element: 'el_',
    form: 'form_',
    navigation: 'nav_',
    storageBinding: 'store_',
    apiEndpoint: 'api_',
    mock: 'mock_',
    acceptance: 'acc_',
  };
  const defaultMint: Record<PlanIdKind, () => string> = {
    application: newPlannedApplicationId,
    route: newRouteId,
    page: newPageId,
    element: newElementId,
    form: newFormId,
    navigation: newNavId,
    storageBinding: newStorageBindingId,
    apiEndpoint: newApiEndpointId,
    mock: newMockId,
    acceptance: newAcceptanceId,
  };
  return (kind: PlanIdKind): string => {
    const id = idFactory !== undefined ? idFactory(kind) : defaultMint[kind]();
    const pattern = planIdPatternFor(prefixFor[kind]);
    if (pattern === undefined || !pattern.test(id)) {
      throw new PlanSynthesisError(
        `id factory minted a non-conforming ${kind} id ${JSON.stringify(id)} (expected "${prefixFor[kind]}" + uuid v4)`,
      );
    }
    return id;
  };
}

/**
 * Derive a validated SynthesisPlan v0.1 from a validated IrModel. Throws
 * {@link PlanSynthesisError} when the model (or a supplied journey record)
 * is invalid, when the model cannot be planned honestly (e.g. entrypoints
 * with no screens), or when the assembled plan fails the self-check. Pure
 * apart from id minting — deterministic modulo ids for identical inputs.
 */
export function planSynthesis(model: IrModel, options?: PlanOptions): SynthesisPlan {
  // ---- input validation (never plan from an invalid model) ----------------
  const modelCheck = validateIrModelDetailed(model);
  if (!modelCheck.valid) {
    throw new PlanSynthesisError(
      `cannot plan from an invalid IrModel (${modelCheck.errors.length} validation error(s)):\n${joinErrors(modelCheck.errors)}`,
    );
  }
  const journeys = options?.journeys ?? [];
  for (const journey of journeys) {
    const recordId = journey.id;
    if (!validateJourney(journey)) {
      throw new PlanSynthesisError(
        `options.journeys contains an invalid journey record (id ${JSON.stringify(recordId)}) — validate records before planning`,
      );
    }
  }

  const mint = createMint(options?.idFactory);
  const assumptions: string[] = [];
  const note = (text: string): void => {
    assumptions.push(text);
  };

  // ---- screen/component indexes ---------------------------------------------
  const screenById = new Map<string, IrScreen>();
  for (const screen of model.screens) screenById.set(screen.id, screen);
  const componentsByScreen = new Map<string, IrComponent[]>();
  for (const component of model.components) {
    const bucket = componentsByScreen.get(component.screenId);
    if (bucket === undefined) componentsByScreen.set(component.screenId, [component]);
    else bucket.push(component);
  }
  const routePathOfScreen = (screenId: string): string | null => screenById.get(screenId)?.route ?? null;

  // ---- form discovery (submit transitions gate form planning) ----------------
  const submitTransitionsByScreen = new Map<string, IrTransition[]>();
  for (const transition of model.state.transitions) {
    if (transition.trigger.type !== 'action' || transition.trigger.action !== 'submit') continue;
    const bucket = submitTransitionsByScreen.get(transition.fromScreenId);
    if (bucket === undefined) submitTransitionsByScreen.set(transition.fromScreenId, [transition]);
    else bucket.push(transition);
  }

  // ---- screens → routes + pages ----------------------------------------------
  const routes: PlannedRoute[] = [];
  const pages: PlannedPage[] = [];
  const plannedFormByScreen = new Map<string, PlannedForm>();
  const elementByComponentId = new Map<string, PlannedElement>();
  const pageByRoutePath = new Map<string, PlannedPage>();

  for (const screen of model.screens) {
    const components = componentsByScreen.get(screen.id) ?? [];
    const routeId = mint('route');
    const pageId = mint('page');
    const routePath = screen.route;

    // -- planned form (only when a submit transition leaves this screen) ------
    let plannedForm: PlannedForm | undefined;
    const submitTransitions = submitTransitionsByScreen.get(screen.id) ?? [];
    const submitTransition = submitTransitions[0];
    if (submitTransition !== undefined) {
      const actionRoute = routePathOfScreen(submitTransition.toScreenId);
      if (actionRoute === null) {
        note(
          `form planning skipped on route ${routePath}: the submit transition's destination screen does not resolve (IR references a screen that was never captured)`,
        );
      } else {
        const fieldComponents = components.filter((component) => component.role === 'textbox');
        const fields: PlannedField[] = [];
        const fieldSourceIds: string[] = [];
        for (const component of fieldComponents) {
          const accessibleName = nonEmptyString(component.properties['name']);
          const testId = nonEmptyString(component.properties['testId']);
          let name = accessibleName;
          if (name === null && testId !== null) {
            name = testId;
            note(
              `form field name on route ${routePath} derived from data-testid ${JSON.stringify(testId)} — no name was observed in the IR (forms submit by name)`,
            );
          }
          if (name === null) {
            note(
              `textbox component on route ${routePath} skipped as a form field — neither a name nor a testId was observed (forms submit by name)`,
            );
            continue;
          }
          const type = nonEmptyString(component.properties['type']);
          if (type === null) {
            note(
              `form field ${JSON.stringify(name)} on route ${routePath} planned with type "text" — no input type was observed in the IR`,
            );
          }
          const optionsValue = Array.isArray(component.properties['options'])
            ? (component.properties['options'] as unknown[])
                .filter(
                  (option): option is { value: string; label: string } =>
                    isPlainRecord(option) &&
                    nonEmptyString(option['value']) !== null &&
                    nonEmptyString(option['label']) !== null,
                )
                .map((option) => ({ value: option.value, label: option.label }))
            : null;
          fields.push({
            name,
            type: type ?? 'text',
            // label: the accessible name when one derives; else the derived
            // field name (an unnamed control is labelled by what it is).
            label: accessibleName ?? name,
            ...(testId !== null ? { testId } : {}),
            ...(component.properties['required'] === true ? { required: true } : {}),
            ...(nonEmptyString(component.properties['placeholder']) !== null
              ? { placeholder: component.properties['placeholder'] as string }
              : {}),
            ...(optionsValue !== null && optionsValue.length > 0 ? { options: optionsValue } : {}),
          });
          fieldSourceIds.push(component.id);
        }
        const submitButton = components.find((component) => component.role === 'button');
        let submitLabel = nonEmptyString(submitButton?.properties['name'] ?? null);
        if (submitLabel === null) {
          submitLabel = 'Submit';
          note(
            `form on route ${routePath} planned with submit label "Submit" — the screen has no button component with an observed accessible name`,
          );
        }
        const submitTestId = nonEmptyString(submitButton?.properties['testId'] ?? null);
        plannedForm = {
          id: mint('form'),
          action: actionRoute,
          method: 'get', // IR v0.1 cannot observe form methods — 'get' + assumption
          fields,
          submitLabel,
          ...(submitTestId !== null ? { submitTestId } : {}),
          provenance: derivedProvenance(
            `form planned from the screen's textbox and button components, gated by its observed submit transition (action ${JSON.stringify(actionRoute)})`,
            [submitTransition.id, ...fieldSourceIds, ...(submitButton !== undefined ? [submitButton.id] : [])],
            collectRefs([submitTransition, ...fieldComponents, ...(submitButton !== undefined ? [submitButton] : [])]),
          ),
        };
        plannedFormByScreen.set(screen.id, plannedForm);
        note(
          `form on route ${routePath} planned with method "get" — no HTTP form method is observable in IR v0.1 (post only when observed)`,
        );
      }
    }

    // -- elements (every component becomes one; textboxes keep kind 'other' --
    //   with their role preserved so journey targets resolve) -----------------
    const elements: PlannedElement[] = [];
    let formContainerUsed = false;
    for (const component of components) {
      const kind = kindFromRole(component.role);
      const testId = nonEmptyString(component.properties['testId']);
      const name = nonEmptyString(component.properties['name']);
      const text = nonEmptyString(component.properties['text']);
      const href = nonEmptyString(component.properties['href']);
      const alt = nonEmptyString(component.properties['alt']);
      const role = nonEmptyString(component.role);
      const level = kind === 'heading' ? headingLevelOf(component) : null;
      // The first form-role component carries the formId back-reference;
      // textbox elements inside the planned form reference it too.
      let formId: string | undefined;
      if (plannedForm !== undefined) {
        if (kind === 'form' && !formContainerUsed) {
          formId = plannedForm.id;
          formContainerUsed = true;
        } else if (component.role === 'textbox') {
          formId = plannedForm.id;
        }
      }
      const element: PlannedElement = {
        id: mint('element'),
        kind,
        ...(testId !== null ? { testId } : {}),
        ...(role !== null ? { role } : {}),
        ...(name !== null ? { name } : {}),
        ...(text !== null ? { text } : {}),
        ...(href !== null ? { href } : {}),
        ...(alt !== null ? { alt } : {}),
        ...(formId !== undefined ? { formId } : {}),
        ...(level !== null ? { level } : {}),
        provenance: derivedProvenance(
          `planned from the observed ${JSON.stringify(component.role)} component on screen ${JSON.stringify(screen.route)} (role/name/testId preserved verbatim)`,
          [component.id],
          collectRefs([component]),
        ),
      };
      elements.push(element);
      elementByComponentId.set(component.id, element);
    }

    // -- page title (lowest-level heading with usable text; basename fallback) --
    const headingCandidates = components.filter(
      (component) => component.role === 'heading' && usableTextOf(component) !== null,
    );
    let title: string | null = null;
    let bestLevel = Number.POSITIVE_INFINITY;
    for (const component of headingCandidates) {
      const level = headingLevelOf(component);
      const rank = level === null ? Number.POSITIVE_INFINITY : level;
      if (rank < bestLevel) {
        bestLevel = rank;
        title = usableTextOf(component);
      }
    }
    if (title === null) {
      title = routeBasename(screen.route);
      note(
        `page title for route ${JSON.stringify(screen.route)} assumed from the route basename — the screen has no heading component with usable text (titles are never fabricated)`,
      );
    }

    const page: PlannedPage = {
      id: pageId,
      routeId,
      title,
      elements,
      forms: plannedForm !== undefined ? [plannedForm] : [],
      provenance: derivedProvenance(
        `page planned from the observed screen at ${JSON.stringify(screen.route)} (title, elements, and forms derive from its components and transitions)`,
        [screen.id],
        collectRefs([screen]),
      ),
    };
    const route: PlannedRoute = {
      id: routeId,
      path: routePath,
      pageId,
      provenance: derivedProvenance(
        `route planned from the observed screen route ${JSON.stringify(screen.route)} (served verbatim)`,
        [screen.id],
        collectRefs([screen]),
      ),
    };
    routes.push(route);
    pages.push(page);
    pageByRoutePath.set(routePath, page);
  }

  // ---- transitions → navigation ------------------------------------------------
  const navigation: PlannedTransition[] = [];
  const navIdByTransitionId = new Map<string, string>();
  const pagesByRoute = routes.map((route) => ({
    routePath: route.path,
    page: pages.find((page) => page.id === route.pageId) as PlannedPage,
  }));

  for (const transition of model.state.transitions) {
    const fromPath = routePathOfScreen(transition.fromScreenId);
    const toPath = routePathOfScreen(transition.toScreenId);
    if (fromPath === null || toPath === null) {
      note(
        `transition ${JSON.stringify(transition.id)} not planned — its from/to screen does not resolve to a planned route (never silently dropped)`,
      );
      continue;
    }
    const fromRouteId = routes.find((route) => route.path === fromPath)?.id;
    const toRouteId = routes.find((route) => route.path === toPath)?.id;
    if (fromRouteId === undefined || toRouteId === undefined) continue; // unreachable after the screen loop

    const transitionRefs = collectRefs([transition]);
    let trigger: PlannedTransition['trigger'];
    let level: PlanProvenanceLevelValue = 'derived';
    let rationale: string;
    if (transition.trigger.type === 'action' && transition.trigger.action === 'submit') {
      const form = plannedFormByScreen.get(transition.fromScreenId);
      if (form === undefined) {
        trigger = { kind: 'redirect', reason: 'submit transition on a screen whose form could not be planned' };
        level = 'assumed';
        note(
          `transition ${JSON.stringify(transition.id)} planned as a redirect — the submit transition's screen has no planned form`,
        );
        rationale = 'submit transition whose screen carries no planned form; the route change is preserved as a redirect';
      } else {
        trigger = { kind: 'form-submit', formId: form.id };
        rationale = 'planned from the observed submit transition (the screen it leaves has a planned form)';
      }
    } else if (transition.trigger.type === 'action' && transition.trigger.action === 'click') {
      const inputStrings = collectInputStrings(transition.input);
      const links = (componentsByScreen.get(transition.fromScreenId) ?? []).filter(
        (component) => component.role === 'link',
      );
      const matches = links.filter((link) => {
        const testId = nonEmptyString(link.properties['testId']);
        const name = nonEmptyString(link.properties['name']);
        const href = nonEmptyString(link.properties['href']);
        return (
          (testId !== null && inputStrings.includes(testId)) ||
          (name !== null && inputStrings.includes(name)) ||
          (href !== null && inputStrings.includes(href))
        );
      });
      const element = matches.length === 1 ? elementByComponentId.get(matches[0]?.id as string) : undefined;
      if (inputStrings.length > 0 && matches.length === 1 && element !== undefined) {
        trigger = { kind: 'link', elementId: element.id };
        rationale = 'planned from the observed click transition, attributed to the unique link named by its input';
      } else {
        trigger = {
          kind: 'redirect',
          reason:
            inputStrings.length === 0
              ? 'click transition names no input that identifies the clicked element'
              : matches.length === 0
                ? 'click transition input names no link on the from-screen'
                : 'click transition input names more than one link on the from-screen',
        };
        level = 'assumed';
        note(
          `transition ${JSON.stringify(transition.id)} planned as a redirect — ${trigger.reason} (IR v0.1 records no element-level trigger for the click)`,
        );
        rationale = 'route change preserved; the element-level trigger could not be derived from the IR';
      }
    } else {
      const description =
        transition.trigger.type === 'action'
          ? `action ${JSON.stringify(transition.trigger.action)}`
          : `trigger type ${JSON.stringify(transition.trigger.type)}`;
      trigger = { kind: 'redirect', reason: `${description} has no element-level affordance planned in v0.1` };
      level = 'assumed';
      note(
        `transition ${JSON.stringify(transition.id)} planned as a redirect — ${description} has no element-level affordance planned in v0.1`,
      );
      rationale = 'route change preserved; the trigger has no element-level affordance in plan v0.1';
    }

    const navId = mint('navigation');
    navigation.push({
      id: navId,
      fromRouteId,
      toRouteId,
      trigger,
      sourceTransitionIds: [transition.id],
      provenance:
        level === 'derived'
          ? derivedProvenance(rationale, [transition.id], transitionRefs)
          : assumedProvenance(rationale, [transition.id], transitionRefs),
    });
    navIdByTransitionId.set(transition.id, navId);
  }

  // ---- data entities → storage bindings ------------------------------------------
  const storage: PlannedStorageBinding[] = [];
  for (const entity of model.data.entities) {
    for (const entry of entity.persistence) {
      const parsed = parsePersistence(entry);
      if (parsed === null) {
        note(
          `persistence entry ${JSON.stringify(entry)} of entity ${JSON.stringify(entity.name)} not mapped — expected "localStorage:key", "sessionStorage:key", or "cookie:name"`,
        );
        continue;
      }
      const writtenOnTransitionIds = model.state.transitions
        .filter((transition) =>
          transition.sideEffects.some(
            (sideEffect) =>
              (entity.name !== '' && sideEffect.includes(entity.name)) || sideEffect.includes(parsed.key),
          ),
        )
        .map((transition) => navIdByTransitionId.get(transition.id))
        .filter((navId): navId is string => navId !== undefined);
      storage.push({
        id: mint('storageBinding'),
        key: parsed.key,
        storage: parsed.storage,
        entityFieldNames: entity.fields.map((field) => field.name),
        writtenOn: writtenOnTransitionIds,
        sourceEntityIds: [entity.id],
        provenance: derivedProvenance(
          `storage binding planned from the entity's observed persistence entry ${JSON.stringify(entry)} (writtenOn lists the transitions whose side effects mention the entity or key — empty when unobserved, honest)`,
          [entity.id, ...writtenOnTransitionIds],
          collectRefs(entity.fields.map((field) => ({ provenance: field.provenance }))),
        ),
      });
    }
  }

  // ---- api operations → endpoints + mocks -----------------------------------------
  const endpoints: PlannedApiEndpoint[] = [];
  const mocks: MockResponse[] = [];
  const wsOps = model.api.operations.filter((operation) => operation.transport === 'websocket');
  if (wsOps.length > 0) {
    note(
      `${wsOps.length} websocket-transport api operation(s) not mapped to plan endpoints in v0.1 (${wsOps.map((operation) => `${operation.id} ${operation.urlPattern}`).join('; ')}) — websocket planning requires an ADR`,
    );
  }
  const methodlessHttpOps = model.api.operations.filter(
    (operation) => operation.transport === 'http' && nonEmptyString(operation.method) === null,
  );
  if (methodlessHttpOps.length > 0) {
    note(
      `${methodlessHttpOps.length} http-transport api operation(s) without a method not mapped to plan endpoints (${methodlessHttpOps.map((operation) => `${operation.id} ${operation.urlPattern}`).join('; ')})`,
    );
  }
  for (const operation of model.api.operations) {
    if (operation.transport !== 'http') continue;
    const method = nonEmptyString(operation.method);
    if (method === null) continue;
    const endpoint: PlannedApiEndpoint = {
      id: mint('apiEndpoint'),
      method,
      urlPattern: operation.urlPattern,
      ...(operation.requestSchema !== undefined ? { requestSchema: operation.requestSchema } : {}),
      ...(operation.responseSchema !== undefined ? { responseSchema: operation.responseSchema } : {}),
      ...(operation.errorSchema !== undefined ? { errorSchema: operation.errorSchema } : {}),
      sourceOperationIds: [operation.id],
      provenance: derivedProvenance(
        `endpoint planned from the observed http api operation ${JSON.stringify(operation.urlPattern)} (schemas passed through when observed)`,
        [operation.id],
        collectRefs([operation]),
      ),
    };
    endpoints.push(endpoint);
    if (operation.responseSchema !== undefined) {
      const body = sketchMockBody(operation.responseSchema);
      mocks.push({
        id: mint('mock'),
        endpointId: endpoint.id,
        statusCode: 200,
        ...(body !== undefined ? { bodyJson: body } : {}),
      });
    }
  }

  // ---- journeys → acceptance --------------------------------------------------------
  const acceptance: PlannedAcceptance[] = [];
  if (journeys.length === 0) {
    note(
      'no journey records were supplied — the acceptance section stays empty (acceptance entries are never fabricated)',
    );
  } else {
    for (const record of journeys) {
      const irJourney = model.journeys.find((journey) => journey.id === record.id);
      let purpose: string;
      let steps: string[];
      if (irJourney !== undefined) {
        purpose = irJourney.purpose;
        steps = [...irJourney.steps];
      } else {
        purpose = record.name;
        steps = record.actions.map(describeJourneyAction);
        note(
          `acceptance for journey ${JSON.stringify(record.id)} derived its purpose and steps from the journey record — the source model has no matching IrJourney`,
        );
      }

      const resolved: ResolvedTarget[] = [];
      const unresolvedTargets: TargetSelector[] = [];
      for (const action of record.actions) {
        if (action.type !== 'assert-visible') continue;
        const resolvedTarget = resolveTarget(action.target, pagesByRoute);
        if (resolvedTarget === null) unresolvedTargets.push(action.target);
        else resolved.push(resolvedTarget);
      }
      for (const target of unresolvedTargets) {
        note(
          `unresolved assert target (${describeTarget(target)}) in journey ${JSON.stringify(record.id)} — the element was not observed in the source model`,
        );
      }

      let expectedRoute: string | undefined = resolved[resolved.length - 1]?.routePath;
      if (expectedRoute === undefined) {
        const lastNavigate = [...record.actions].reverse().find((action) => action.type === 'navigate');
        const navigateRoute =
          lastNavigate !== undefined && lastNavigate.type === 'navigate'
            ? routeFromJourneyUrl(lastNavigate.url)
            : null;
        if (navigateRoute !== null && pageByRoutePath.has(navigateRoute)) {
          expectedRoute = navigateRoute;
          note(
            `expected route for journey ${JSON.stringify(record.id)} assumed from its final navigate action — no assert-visible target resolved`,
          );
        } else {
          const entrypoint = model.application.entrypoints.find((candidate) => pageByRoutePath.has(candidate));
          expectedRoute = entrypoint ?? routes[0]?.path;
          if (expectedRoute === undefined) {
            throw new PlanSynthesisError(
              `cannot plan acceptance for journey ${JSON.stringify(record.id)} — no route is plannable as its expected route`,
            );
          }
          note(
            `expected route for journey ${JSON.stringify(record.id)} assumed from the application entrypoint — no assert target or navigate action resolved to a served route`,
          );
        }
      }

      const expectedPage = pageByRoutePath.get(expectedRoute);
      if (expectedPage === undefined) {
        throw new PlanSynthesisError(
          `internal error: expected route ${JSON.stringify(expectedRoute)} has no planned page (journey ${JSON.stringify(record.id)})`,
        );
      }
      const mustSeeElementIds: string[] = [];
      for (const action of record.actions) {
        if (action.type !== 'assert-visible') continue;
        const element = resolveTargetOnPage(action.target, expectedPage);
        if (element !== null && !mustSeeElementIds.includes(element.id)) {
          mustSeeElementIds.push(element.id);
        }
      }

      acceptance.push({
        id: mint('acceptance'),
        journeyId: record.id,
        purpose,
        steps,
        expectedRoute,
        mustSeeElementIds,
        sourceJourneyIds: irJourney !== undefined ? [irJourney.id] : [],
        provenance: derivedProvenance(
          irJourney !== undefined
            ? 'acceptance planned from the journey record and its matching IrJourney summary (expected route and must-see elements resolved against planned elements)'
            : 'acceptance planned from the journey record (expected route and must-see elements resolved against planned elements; purpose/steps derived from the record)',
          irJourney !== undefined ? [irJourney.id] : [],
          irJourney !== undefined ? collectRefs([irJourney]) : [],
        ),
      });
    }
  }

  // ---- application + server ---------------------------------------------------------
  const server: PlannedServerSpec = {
    startCommand: 'bun run start',
    port: 4173,
    healthPath: '/',
  };

  const plan: SynthesisPlan = {
    planVersion: PLAN_VERSION,
    application: {
      id: mint('application'),
      name: `${model.application.name} (synth)`,
      platform: model.application.platform,
      sourceModelId: model.application.id,
      entrypoints: [...model.application.entrypoints],
    },
    routes,
    pages,
    navigation,
    storage,
    api: { endpoints, mocks },
    acceptance,
    server,
    assumptions,
    constraints: [...model.constraints],
  };

  // ---- self-check (a planner bug must throw, never leak an invalid plan) -------------
  const selfCheck = validateSynthesisPlanDetailed(plan);
  if (!selfCheck.valid) {
    throw new PlanSynthesisError(
      `planSynthesis self-check failed (${selfCheck.errors.length} violation(s)):\n${joinErrors(selfCheck.errors)}`,
    );
  }
  return plan;
}

/** Local alias so the level union stays tied to the contract. */
type PlanProvenanceLevelValue = PlanProvenance['level'];
