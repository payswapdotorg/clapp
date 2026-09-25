/**
 * @clapp/plan — structural validation for the Synthesis Plan v0.1.
 *
 * Design notes (honest scope — the same discipline as @clapp/ir's validator):
 * - Validation is STRUCTURAL + REFERENTIAL: it checks that a value matches
 *   the declared TypeScript shapes of synthesis-contract.ts so untrusted JSON
 *   can be narrowed safely, and that every intra-plan reference resolves
 *   (route.pageId→page, page.routeId→route, element.formId→form on the SAME
 *   page, navigation from/to route ids + trigger element/form ids on the
 *   from-route's page, storage writtenOn→navigation ids, mock endpointId→
 *   endpoint, acceptance journeyId shape + mustSeeElementIds→elements on the
 *   expectedRoute's page, entrypoints→served route paths).
 * - The route↔page mapping is enforced BIJECTIVE: one page per route, one
 *   route per page, no orphans on either side (a page no route renders can
 *   never be served by the candidate; a route rendering two pages is
 *   ambiguous). Documented in README "Enforced".
 * - NULL POLICY: `null` is not a valid value ANYWHERE in a plan — optional
 *   fields must be ABSENT, never null ("unknown is a valid value" renders as
 *   absence). Enforced per declared field AND by a deep scan over the whole
 *   tree (including opaque schema descriptors and mock bodies).
 * - SERIALIZABILITY: the plan must be canonical-JSON serializable
 *   (principle 4); a probe pass rejects undefined, bigint, symbol, function,
 *   non-plain objects, reference cycles, and non-finite numbers anywhere.
 * - VOCABULARIES: closed literal unions declared by the contract are
 *   enforced (PlanProvenanceLevel, element kinds, storage kinds, form
 *   methods, PlannedTransition trigger kinds). Comment-only vocabularies
 *   (PlannedField.type, element `role` names, platform) are NOT enforced —
 *   the contract types them as plain `string`.
 * - IDENTIFIERS: every planned-element id must match its declared prefix
 *   pattern (uuid-shaped hex, version/variant bits not pinned — same
 *   leniency as @clapp/ir) and be unique within its section (element ids
 *   and form ids are unique ACROSS pages: they are plan-global identities).
 *   Cross-contract references carry their IR-side patterns: sourceModelId
 *   ("app_"), sourceTransitionIds ("trans_"), sourceEntityIds ("ent_"),
 *   sourceOperationIds ("op_"), journeyId/sourceJourneyIds ("journey_").
 * - PROVENANCE BLOCKS are checked for SHAPE ONLY: level vocabulary,
 *   non-empty rationale, non-empty-string sourceIds, well-formed
 *   evidenceRefs. Emptiness rules are deliberately NOT enforced — the
 *   contract's comment ("empty is legal for 'planned'") is read as an
 *   example, not an exhaustive constraint, because an 'assumed' choice is
 *   by definition not evidence-established; the planner's discipline of
 *   citing every derivable ref is enforced by the planner's own tests, not
 *   by this validator. See README "Not enforced".
 * - Errors are path-qualified (`pages[3].elements[7].kind`) and de-duplicated.
 * - Both functions are TOTAL — they never throw, even on cyclic or exotic
 *   inputs (an internal try/catch converts any unexpected failure into an
 *   error entry).
 */

import { EVIDENCE_KINDS } from '@clapp/core';
import { canonicalJson } from '@clapp/ir';
import type { SynthesisPlan } from './synthesis-contract';
import { PLAN_VERSION } from './synthesis-contract';
import {
  ACCEPTANCE_ID_PATTERN,
  API_ENDPOINT_ID_PATTERN,
  ELEMENT_ID_PATTERN,
  FORM_ID_PATTERN,
  MOCK_ID_PATTERN,
  NAV_ID_PATTERN,
  PAGE_ID_PATTERN,
  PLANNED_APPLICATION_ID_PATTERN,
  ROUTE_ID_PATTERN,
  STORAGE_BINDING_ID_PATTERN,
} from './ids';

/** Result of a detailed (non-predicate) plan validation. */
export interface PlanValidationResult {
  /** True iff `errors` is empty. */
  valid: boolean;
  /** Path-qualified human-readable messages; empty iff valid. */
  errors: string[];
}

// ---------------------------------------------------------------------------
// Vocabularies (closed literal unions declared by the contract)
// ---------------------------------------------------------------------------

const PLAN_PROVENANCE_LEVELS = ['derived', 'planned', 'assumed'] as const;
const ELEMENT_KINDS = ['heading', 'text', 'link', 'button', 'image', 'navigation', 'form', 'list', 'other'] as const;
const STORAGE_KINDS = ['localStorage', 'sessionStorage', 'cookie', 'server'] as const;
const FORM_METHODS = ['get', 'post'] as const;
const TRIGGER_KINDS = ['link', 'form-submit', 'redirect'] as const;

const PLAN_PROVENANCE_LEVEL_SET = new Set<string>(PLAN_PROVENANCE_LEVELS);
const ELEMENT_KIND_SET = new Set<string>(ELEMENT_KINDS);
const STORAGE_KIND_SET = new Set<string>(STORAGE_KINDS);
const FORM_METHOD_SET = new Set<string>(FORM_METHODS);
const TRIGGER_KIND_SET = new Set<string>(TRIGGER_KINDS);
const EVIDENCE_KIND_SET = new Set<string>(EVIDENCE_KINDS);

/** `"ev_" + uuid` — EvidenceId shape from the frozen @clapp/core contract. */
export const EVIDENCE_ID_PATTERN = /^ev_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 64-char lowercase hex sha256 (same convention as @clapp/evidence). */
export const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

// ---- IR-side id patterns (cross-contract references) ------------------------

/** `"app_" + uuid` — IrApplication.id (the plan's sourceModelId). */
export const IR_APPLICATION_ID_PATTERN = /^app_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `"trans_" + uuid` — IrTransition.id (sourceTransitionIds). */
export const IR_TRANSITION_ID_PATTERN = /^trans_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `"ent_" + uuid` — IrDataEntity.id (sourceEntityIds). */
export const IR_ENTITY_ID_PATTERN = /^ent_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `"op_" + uuid` — IrApiOperation.id (sourceOperationIds). */
export const IR_OPERATION_ID_PATTERN = /^op_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `"journey_" + uuid` — journey record / IrJourney id (acceptance entries). */
export const JOURNEY_ID_PATTERN = /^journey_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Small message helpers (same conventions as @clapp/ir's validator)
// ---------------------------------------------------------------------------

const MAX_PREVIEW_CHARS = 60;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function kindOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function preview(value: unknown): string {
  let text: string;
  if (typeof value === 'string') {
    text = JSON.stringify(value);
  } else if (typeof value === 'number' && !Number.isFinite(value)) {
    text = String(value);
  } else {
    text = JSON.stringify(value) ?? String(value);
  }
  return text.length > MAX_PREVIEW_CHARS ? `${text.slice(0, MAX_PREVIEW_CHARS)}...` : text;
}

function nullErrorMessage(path: string): string {
  return `${path}: null is not a valid plan value — omit the field instead (absent, never null)`;
}

function expectedOneOf(path: string, vocabulary: readonly string[], value: unknown): string {
  return `${path}: expected one of ${vocabulary.join('|')}, got ${preview(value)}`;
}

function fieldPath(path: string, field: string): string {
  return path === '' ? field : `${path}.${field}`;
}

function requireObject(value: unknown, path: string, errors: string[]): value is Record<string, unknown> {
  if (!isObject(value)) {
    errors.push(`${path}: expected a non-null object, got ${kindOf(value)}`);
    return false;
  }
  return true;
}

function requireString(
  container: Record<string, unknown>,
  field: string,
  path: string,
  errors: string[],
  options: { nonEmpty?: boolean } = {},
): void {
  const at = fieldPath(path, field);
  const value = container[field];
  if (value === null) {
    errors.push(nullErrorMessage(at));
    return;
  }
  if (typeof value !== 'string') {
    errors.push(`${at}: expected a string, got ${kindOf(value)}`);
    return;
  }
  if (options.nonEmpty === true && value.trim() === '') {
    errors.push(`${at}: expected a non-empty string, got ${preview(value)}`);
  }
}

function requireOptionalString(
  container: Record<string, unknown>,
  field: string,
  path: string,
  errors: string[],
  options: { nonEmpty?: boolean } = {},
): void {
  const at = fieldPath(path, field);
  const value = container[field];
  if (value === undefined) return;
  if (value === null) {
    errors.push(nullErrorMessage(at));
    return;
  }
  if (typeof value !== 'string') {
    errors.push(`${at}: expected a string or absent, got ${kindOf(value)}`);
    return;
  }
  if (options.nonEmpty === true && value.trim() === '') {
    errors.push(`${at}: expected a non-empty string or absent, got ${preview(value)}`);
  }
}

function stringArrayEntriesErrors(values: unknown[], at: string, errors: string[]): void {
  for (let index = 0; index < values.length; index += 1) {
    const entry: unknown = values[index];
    if (entry === null) {
      errors.push(nullErrorMessage(`${at}[${index}]`));
    } else if (typeof entry !== 'string') {
      errors.push(`${at}[${index}]: expected a string, got ${kindOf(entry)}`);
    } else if (entry.trim() === '') {
      errors.push(`${at}[${index}]: expected a non-empty string, got ${preview(entry)}`);
    }
  }
}

function requireStringArray(container: Record<string, unknown>, field: string, path: string, errors: string[]): void {
  const at = fieldPath(path, field);
  const value = container[field];
  if (value === null) {
    errors.push(nullErrorMessage(at));
    return;
  }
  if (!Array.isArray(value)) {
    errors.push(`${at}: expected an array, got ${kindOf(value)}`);
    return;
  }
  stringArrayEntriesErrors(value, at, errors);
}

/** Prefixed-id check against a plan or IR pattern (message mirrors @clapp/ir). */
function prefixedIdErrors(id: unknown, pattern: RegExp, prefix: string, path: string, errors: string[]): void {
  if (id === null) {
    errors.push(nullErrorMessage(path));
    return;
  }
  if (typeof id !== 'string' || !pattern.test(id)) {
    errors.push(
      `${path}: expected a "${prefix}"-prefixed uuid v4 string ("${prefix}" + 8-4-4-4-12 hex), got ${preview(id)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// EvidenceRef + PlanProvenance
// ---------------------------------------------------------------------------

function evidenceRefErrors(ref: unknown, path: string): string[] {
  const errors: string[] = [];
  if (!isObject(ref)) {
    errors.push(`${path}: expected a non-null object, got ${kindOf(ref)}`);
    return errors;
  }
  const evidenceId: unknown = ref['evidenceId'];
  if (evidenceId === null) {
    errors.push(nullErrorMessage(fieldPath(path, 'evidenceId')));
  } else if (typeof evidenceId !== 'string' || !EVIDENCE_ID_PATTERN.test(evidenceId)) {
    errors.push(
      `${fieldPath(path, 'evidenceId')}: expected an "ev_"-prefixed uuid v4 string ("ev_" + 8-4-4-4-12 hex), got ${preview(evidenceId)}`,
    );
  }
  const kind: unknown = ref['kind'];
  if (kind === null) {
    errors.push(nullErrorMessage(fieldPath(path, 'kind')));
  } else if (typeof kind !== 'string' || !EVIDENCE_KIND_SET.has(kind)) {
    errors.push(expectedOneOf(fieldPath(path, 'kind'), EVIDENCE_KINDS, kind));
  }
  const sha256: unknown = ref['sha256'];
  if (sha256 === null) {
    errors.push(nullErrorMessage(fieldPath(path, 'sha256')));
  } else if (typeof sha256 !== 'string' || !SHA256_HEX_RE.test(sha256)) {
    errors.push(`${fieldPath(path, 'sha256')}: expected 64 lowercase hex characters, got ${preview(sha256)}`);
  }
  return errors;
}

/** Shape-only provenance check (see module doc for the emptiness policy). */
function provenanceBlockErrors(provenance: unknown, path: string): string[] {
  const errors: string[] = [];
  if (!isObject(provenance)) {
    errors.push(`${path}: expected a non-null object, got ${kindOf(provenance)}`);
    return errors;
  }
  const level: unknown = provenance['level'];
  if (level === null) {
    errors.push(nullErrorMessage(fieldPath(path, 'level')));
  } else if (typeof level !== 'string' || !PLAN_PROVENANCE_LEVEL_SET.has(level)) {
    errors.push(expectedOneOf(fieldPath(path, 'level'), PLAN_PROVENANCE_LEVELS, level));
  }
  requireString(provenance, 'rationale', path, errors, { nonEmpty: true });
  requireStringArray(provenance, 'sourceIds', path, errors);
  const refs: unknown = provenance['evidenceRefs'];
  if (refs === null) {
    errors.push(nullErrorMessage(fieldPath(path, 'evidenceRefs')));
  } else if (!Array.isArray(refs)) {
    errors.push(`${fieldPath(path, 'evidenceRefs')}: expected an array, got ${kindOf(refs)}`);
  } else {
    for (let index = 0; index < refs.length; index += 1) {
      errors.push(...evidenceRefErrors(refs[index], `${fieldPath(path, 'evidenceRefs')}[${index}]`));
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Tolerant reference context (pre-scan of raw sections)
// ---------------------------------------------------------------------------

interface PlanReferenceContext {
  routeIds: Set<string>;
  routePaths: Set<string>;
  /** routePath → page (first route wins in the raw scan). */
  pageByRoutePath: Map<string, Record<string, unknown>>;
  /** routeId → page (tolerant — first resolvable route/page pair wins). */
  pageByRouteId: Map<string, Record<string, unknown>>;
  pageIds: Set<string>;
  navIds: Set<string>;
  endpointIds: Set<string>;
  /** pageId → the page record (for SAME-page form/element resolution). */
  pageById: Map<string, Record<string, unknown>>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function buildReferenceContext(plan: unknown): PlanReferenceContext {
  const context: PlanReferenceContext = {
    routeIds: new Set<string>(),
    routePaths: new Set<string>(),
    pageByRoutePath: new Map<string, Record<string, unknown>>(),
    pageByRouteId: new Map<string, Record<string, unknown>>(),
    pageIds: new Set<string>(),
    navIds: new Set<string>(),
    endpointIds: new Set<string>(),
    pageById: new Map<string, Record<string, unknown>>(),
  };
  const root = isObject(plan) ? plan : {};
  for (const route of asArray(root['routes'])) {
    if (!isObject(route)) continue;
    const id: unknown = route['id'];
    const path: unknown = route['path'];
    if (typeof id === 'string' && ROUTE_ID_PATTERN.test(id)) context.routeIds.add(id);
    if (typeof path === 'string' && path !== '' && !context.routePaths.has(path)) context.routePaths.add(path);
  }
  for (const page of asArray(root['pages'])) {
    if (!isObject(page)) continue;
    const id: unknown = page['id'];
    if (typeof id === 'string' && PAGE_ID_PATTERN.test(id)) {
      context.pageIds.add(id);
      context.pageById.set(id, page);
    }
  }
  for (const route of asArray(root['routes'])) {
    if (!isObject(route)) continue;
    const path: unknown = route['path'];
    const pageId: unknown = route['pageId'];
    const id: unknown = route['id'];
    if (
      typeof path === 'string' && path !== '' &&
      typeof pageId === 'string' && context.pageById.has(pageId) &&
      !context.pageByRoutePath.has(path)
    ) {
      context.pageByRoutePath.set(path, context.pageById.get(pageId) as Record<string, unknown>);
    }
    if (
      typeof id === 'string' && ROUTE_ID_PATTERN.test(id) &&
      typeof pageId === 'string' && context.pageById.has(pageId) &&
      !context.pageByRouteId.has(id)
    ) {
      context.pageByRouteId.set(id, context.pageById.get(pageId) as Record<string, unknown>);
    }
  }
  for (const nav of asArray(root['navigation'])) {
    if (!isObject(nav)) continue;
    const id: unknown = nav['id'];
    if (typeof id === 'string' && NAV_ID_PATTERN.test(id)) context.navIds.add(id);
  }
  const api = isObject(root['api']) ? root['api'] : {};
  for (const endpoint of asArray(api['endpoints'])) {
    if (!isObject(endpoint)) continue;
    const id: unknown = endpoint['id'];
    if (typeof id === 'string' && API_ENDPOINT_ID_PATTERN.test(id)) context.endpointIds.add(id);
  }
  return context;
}

/** Form ids declared on one page record (tolerant). */
function formIdsOfPage(page: Record<string, unknown>): Set<string> {
  const ids = new Set<string>();
  for (const form of asArray(page['forms'])) {
    if (isObject(form) && typeof form['id'] === 'string') ids.add(form['id']);
  }
  return ids;
}

/** Element ids declared on one page record (tolerant). */
function elementIdsOfPage(page: Record<string, unknown>): Set<string> {
  const ids = new Set<string>();
  for (const element of asArray(page['elements'])) {
    if (isObject(element) && typeof element['id'] === 'string') ids.add(element['id']);
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Field-shape checks per section
// ---------------------------------------------------------------------------

function elementErrors(element: unknown, path: string, errors: string[], samePageFormIds: ReadonlySet<string>): void {
  if (!requireObject(element, path, errors)) return;
  prefixedIdErrors(element['id'], ELEMENT_ID_PATTERN, 'el_', fieldPath(path, 'id'), errors);
  const kind: unknown = element['kind'];
  if (kind === null) {
    errors.push(nullErrorMessage(fieldPath(path, 'kind')));
  } else if (typeof kind !== 'string' || !ELEMENT_KIND_SET.has(kind)) {
    errors.push(expectedOneOf(fieldPath(path, 'kind'), ELEMENT_KINDS, kind));
  }
  requireOptionalString(element, 'testId', path, errors, { nonEmpty: true });
  requireOptionalString(element, 'role', path, errors, { nonEmpty: true });
  requireOptionalString(element, 'name', path, errors, { nonEmpty: true });
  requireOptionalString(element, 'text', path, errors, { nonEmpty: true });
  requireOptionalString(element, 'href', path, errors, { nonEmpty: true });
  requireOptionalString(element, 'alt', path, errors, { nonEmpty: true });
  requireOptionalString(element, 'formId', path, errors, { nonEmpty: true });
  const formId: unknown = element['formId'];
  if (typeof formId === 'string' && formId !== '' && !samePageFormIds.has(formId)) {
    errors.push(
      `${fieldPath(path, 'formId')}: ${preview(formId)} does not resolve to a form declared on the SAME page (element formId must reference a PlannedForm on the element's own page)`,
    );
  }
  const level: unknown = element['level'];
  if (level !== undefined) {
    if (level === null) {
      errors.push(nullErrorMessage(fieldPath(path, 'level')));
    } else if (typeof level !== 'number' || !Number.isInteger(level) || level < 1 || level > 6) {
      errors.push(`${fieldPath(path, 'level')}: expected an integer 1-6, got ${preview(level)}`);
    } else if (element['kind'] !== 'heading') {
      errors.push(`${fieldPath(path, 'level')}: heading level is legal only on kind "heading" elements (kind is ${preview(element['kind'])})`);
    }
  }
  errors.push(...provenanceBlockErrors(element['provenance'], fieldPath(path, 'provenance')));
}

function fieldErrors(field: unknown, path: string, errors: string[]): void {
  if (!requireObject(field, path, errors)) return;
  requireString(field, 'name', path, errors, { nonEmpty: true });
  requireString(field, 'type', path, errors, { nonEmpty: true });
  requireString(field, 'label', path, errors, { nonEmpty: true });
  requireOptionalString(field, 'testId', path, errors, { nonEmpty: true });
  if (field['required'] !== undefined && typeof field['required'] !== 'boolean') {
    errors.push(`${fieldPath(path, 'required')}: expected a boolean or absent, got ${kindOf(field['required'])}`);
  }
  requireOptionalString(field, 'placeholder', path, errors, { nonEmpty: true });
  const options: unknown = field['options'];
  if (options === undefined) return;
  if (options === null) {
    errors.push(nullErrorMessage(fieldPath(path, 'options')));
    return;
  }
  if (!Array.isArray(options)) {
    errors.push(`${fieldPath(path, 'options')}: expected an array or absent, got ${kindOf(options)}`);
    return;
  }
  for (let index = 0; index < options.length; index += 1) {
    const option: unknown = options[index];
    const at = `${fieldPath(path, 'options')}[${index}]`;
    if (!isObject(option)) {
      errors.push(`${at}: expected a non-null object, got ${kindOf(option)}`);
      continue;
    }
    requireString(option, 'value', at, errors, { nonEmpty: true });
    requireString(option, 'label', at, errors, { nonEmpty: true });
  }
}

function formErrors(form: unknown, path: string, errors: string[]): void {
  if (!requireObject(form, path, errors)) return;
  prefixedIdErrors(form['id'], FORM_ID_PATTERN, 'form_', fieldPath(path, 'id'), errors);
  requireString(form, 'action', path, errors, { nonEmpty: true });
  const method: unknown = form['method'];
  if (method === null) {
    errors.push(nullErrorMessage(fieldPath(path, 'method')));
  } else if (typeof method !== 'string' || !FORM_METHOD_SET.has(method)) {
    errors.push(expectedOneOf(fieldPath(path, 'method'), FORM_METHODS, method));
  }
  const fields: unknown = form['fields'];
  if (fields === null) {
    errors.push(nullErrorMessage(fieldPath(path, 'fields')));
  } else if (!Array.isArray(fields)) {
    errors.push(`${fieldPath(path, 'fields')}: expected an array, got ${kindOf(fields)}`);
  } else {
    for (let index = 0; index < fields.length; index += 1) {
      fieldErrors(fields[index], `${fieldPath(path, 'fields')}[${index}]`, errors);
    }
  }
  requireString(form, 'submitLabel', path, errors, { nonEmpty: true });
  requireOptionalString(form, 'submitTestId', path, errors, { nonEmpty: true });
  errors.push(...provenanceBlockErrors(form['provenance'], fieldPath(path, 'provenance')));
}

function pageErrors(page: unknown, path: string, errors: string[], context: PlanReferenceContext, seenPageIds: Set<string>, seenRouteIdsByPage: Map<string, string>): void {
  if (!requireObject(page, path, errors)) return;
  const id: unknown = page['id'];
  prefixedIdErrors(id, PAGE_ID_PATTERN, 'page_', fieldPath(path, 'id'), errors);
  if (typeof id === 'string' && PAGE_ID_PATTERN.test(id)) {
    if (seenPageIds.has(id)) {
      errors.push(`${fieldPath(path, 'id')}: duplicate page id ${preview(id)} (page ids must be unique across the plan)`);
    } else {
      seenPageIds.add(id);
    }
  }
  const routeId: unknown = page['routeId'];
  if (routeId === null) {
    errors.push(nullErrorMessage(fieldPath(path, 'routeId')));
  } else if (typeof routeId !== 'string' || !context.routeIds.has(routeId)) {
    errors.push(
      `${fieldPath(path, 'routeId')}: ${preview(routeId)} does not resolve to a PlannedRoute id (routeId→route must resolve)`,
    );
  } else if (seenRouteIdsByPage.has(routeId)) {
    errors.push(
      `${fieldPath(path, 'routeId')}: route ${preview(routeId)} is already rendered by page ${preview(seenRouteIdsByPage.get(routeId))} (the route↔page mapping must be bijective — one page per route)`,
    );
  } else {
    seenRouteIdsByPage.set(routeId, typeof id === 'string' ? id : '(unknown)');
  }
  requireString(page, 'title', path, errors, { nonEmpty: true });
  const elements: unknown = page['elements'];
  if (elements === null) {
    errors.push(nullErrorMessage(fieldPath(path, 'elements')));
  } else if (!Array.isArray(elements)) {
    errors.push(`${fieldPath(path, 'elements')}: expected an array, got ${kindOf(elements)}`);
  } else {
    const samePageFormIds = isObject(page) ? formIdsOfPage(page) : new Set<string>();
    for (let index = 0; index < elements.length; index += 1) {
      elementErrors(elements[index], `${fieldPath(path, 'elements')}[${index}]`, errors, samePageFormIds);
    }
  }
  const forms: unknown = page['forms'];
  if (forms === null) {
    errors.push(nullErrorMessage(fieldPath(path, 'forms')));
  } else if (!Array.isArray(forms)) {
    errors.push(`${fieldPath(path, 'forms')}: expected an array, got ${kindOf(forms)}`);
  } else {
    for (let index = 0; index < forms.length; index += 1) {
      formErrors(forms[index], `${fieldPath(path, 'forms')}[${index}]`, errors);
    }
  }
  errors.push(...provenanceBlockErrors(page['provenance'], fieldPath(path, 'provenance')));
}

function transitionErrors(
  transition: unknown,
  path: string,
  errors: string[],
  context: PlanReferenceContext,
): void {
  if (!requireObject(transition, path, errors)) return;
  prefixedIdErrors(transition['id'], NAV_ID_PATTERN, 'nav_', fieldPath(path, 'id'), errors);
  for (const field of ['fromRouteId', 'toRouteId'] as const) {
    const value: unknown = transition[field];
    if (value === null) {
      errors.push(nullErrorMessage(fieldPath(path, field)));
    } else if (typeof value !== 'string' || !context.routeIds.has(value)) {
      errors.push(`${fieldPath(path, field)}: ${preview(value)} does not resolve to a PlannedRoute id`);
    }
  }
  const fromRouteId: unknown = transition['fromRouteId'];
  const trigger: unknown = transition['trigger'];
  const triggerAt = fieldPath(path, 'trigger');
  if (!requireObject(trigger, triggerAt, errors)) {
    // trigger shape errors already recorded
  } else {
    const kind: unknown = trigger['kind'];
    if (kind === null) {
      errors.push(nullErrorMessage(fieldPath(triggerAt, 'kind')));
    } else if (typeof kind !== 'string' || !TRIGGER_KIND_SET.has(kind)) {
      errors.push(expectedOneOf(fieldPath(triggerAt, 'kind'), TRIGGER_KINDS, kind));
    } else if (kind === 'link') {
      requireString(trigger, 'elementId', triggerAt, errors, { nonEmpty: true });
      const elementId: unknown = trigger['elementId'];
      const page = typeof fromRouteId === 'string' ? pageOfRoute(fromRouteId, context) : undefined;
      if (typeof elementId === 'string' && elementId !== '') {
        if (page === undefined) {
          if (context.pageIds.size > 0) {
            errors.push(
              `${fieldPath(triggerAt, 'elementId')}: cannot check link trigger — the from-route's page is not resolvable`,
            );
          }
        } else if (!elementIdsOfPage(page).has(elementId)) {
          errors.push(
            `${fieldPath(triggerAt, 'elementId')}: ${preview(elementId)} does not resolve to a PlannedElement on the from-route's page`,
          );
        }
      }
    } else if (kind === 'form-submit') {
      requireString(trigger, 'formId', triggerAt, errors, { nonEmpty: true });
      const formId: unknown = trigger['formId'];
      const page = typeof fromRouteId === 'string' ? pageOfRoute(fromRouteId, context) : undefined;
      if (typeof formId === 'string' && formId !== '') {
        if (page === undefined) {
          if (context.pageIds.size > 0) {
            errors.push(
              `${fieldPath(triggerAt, 'formId')}: cannot check form-submit trigger — the from-route's page is not resolvable`,
            );
          }
        } else if (!formIdsOfPage(page).has(formId)) {
          errors.push(
            `${fieldPath(triggerAt, 'formId')}: ${preview(formId)} does not resolve to a PlannedForm on the from-route's page`,
          );
        }
      }
    } else {
      requireString(trigger, 'reason', triggerAt, errors, { nonEmpty: true });
    }
  }
  requireStringArray(transition, 'sourceTransitionIds', path, errors);
  for (let index = 0; index < asArray(transition['sourceTransitionIds']).length; index += 1) {
    const entry: unknown = asArray(transition['sourceTransitionIds'])[index];
    if (typeof entry === 'string' && !IR_TRANSITION_ID_PATTERN.test(entry)) {
      errors.push(
        `${fieldPath(path, 'sourceTransitionIds')}[${index}]: expected a "trans_"-prefixed uuid v4 string (IR transition id), got ${preview(entry)}`,
      );
    }
  }
  errors.push(...provenanceBlockErrors(transition['provenance'], fieldPath(path, 'provenance')));
}

function pageOfRoute(routeId: string, context: PlanReferenceContext): Record<string, unknown> | undefined {
  return context.pageByRouteId.get(routeId);
}

function storageErrors(
  binding: unknown,
  path: string,
  errors: string[],
  context: PlanReferenceContext,
): void {
  if (!requireObject(binding, path, errors)) return;
  prefixedIdErrors(binding['id'], STORAGE_BINDING_ID_PATTERN, 'store_', fieldPath(path, 'id'), errors);
  requireString(binding, 'key', path, errors, { nonEmpty: true });
  const storage: unknown = binding['storage'];
  if (storage === null) {
    errors.push(nullErrorMessage(fieldPath(path, 'storage')));
  } else if (typeof storage !== 'string' || !STORAGE_KIND_SET.has(storage)) {
    errors.push(expectedOneOf(fieldPath(path, 'storage'), STORAGE_KINDS, storage));
  }
  requireStringArray(binding, 'entityFieldNames', path, errors);
  requireStringArray(binding, 'writtenOn', path, errors);
  for (let index = 0; index < asArray(binding['writtenOn']).length; index += 1) {
    const entry: unknown = asArray(binding['writtenOn'])[index];
    if (typeof entry === 'string' && !context.navIds.has(entry)) {
      errors.push(
        `${fieldPath(path, 'writtenOn')}[${index}]: ${preview(entry)} does not resolve to a PlannedTransition id`,
      );
    }
  }
  requireStringArray(binding, 'sourceEntityIds', path, errors);
  for (let index = 0; index < asArray(binding['sourceEntityIds']).length; index += 1) {
    const entry: unknown = asArray(binding['sourceEntityIds'])[index];
    if (typeof entry === 'string' && !IR_ENTITY_ID_PATTERN.test(entry)) {
      errors.push(
        `${fieldPath(path, 'sourceEntityIds')}[${index}]: expected an "ent_"-prefixed uuid v4 string (IR data-entity id), got ${preview(entry)}`,
      );
    }
  }
  errors.push(...provenanceBlockErrors(binding['provenance'], fieldPath(path, 'provenance')));
}

function endpointErrors(endpoint: unknown, path: string, errors: string[]): void {
  if (!requireObject(endpoint, path, errors)) return;
  prefixedIdErrors(endpoint['id'], API_ENDPOINT_ID_PATTERN, 'api_', fieldPath(path, 'id'), errors);
  requireString(endpoint, 'method', path, errors, { nonEmpty: true });
  requireString(endpoint, 'urlPattern', path, errors, { nonEmpty: true });
  // schemas are opaque descriptors: the deep serializability/no-null pass
  // covers them; nothing further is structurally enforceable in v0.1.
  requireStringArray(endpoint, 'sourceOperationIds', path, errors);
  for (let index = 0; index < asArray(endpoint['sourceOperationIds']).length; index += 1) {
    const entry: unknown = asArray(endpoint['sourceOperationIds'])[index];
    if (typeof entry === 'string' && !IR_OPERATION_ID_PATTERN.test(entry)) {
      errors.push(
        `${fieldPath(path, 'sourceOperationIds')}[${index}]: expected an "op_"-prefixed uuid v4 string (IR api-operation id), got ${preview(entry)}`,
      );
    }
  }
  errors.push(...provenanceBlockErrors(endpoint['provenance'], fieldPath(path, 'provenance')));
}

function mockErrors(mock: unknown, path: string, errors: string[], context: PlanReferenceContext): void {
  if (!requireObject(mock, path, errors)) return;
  prefixedIdErrors(mock['id'], MOCK_ID_PATTERN, 'mock_', fieldPath(path, 'id'), errors);
  const endpointId: unknown = mock['endpointId'];
  if (endpointId === null) {
    errors.push(nullErrorMessage(fieldPath(path, 'endpointId')));
  } else if (typeof endpointId !== 'string' || !context.endpointIds.has(endpointId)) {
    errors.push(
      `${fieldPath(path, 'endpointId')}: ${preview(endpointId)} does not resolve to a PlannedApiEndpoint id`,
    );
  }
  const statusCode: unknown = mock['statusCode'];
  if (statusCode === null) {
    errors.push(nullErrorMessage(fieldPath(path, 'statusCode')));
  } else if (typeof statusCode !== 'number' || !Number.isInteger(statusCode) || statusCode < 100 || statusCode > 599) {
    errors.push(`${fieldPath(path, 'statusCode')}: expected an integer 100-599, got ${preview(statusCode)}`);
  }
  // bodyJson is an opaque descriptor: covered by the deep serializability
  // and no-null pass.
}

function acceptanceErrors(
  acceptance: unknown,
  path: string,
  errors: string[],
  context: PlanReferenceContext,
): void {
  if (!requireObject(acceptance, path, errors)) return;
  prefixedIdErrors(acceptance['id'], ACCEPTANCE_ID_PATTERN, 'acc_', fieldPath(path, 'id'), errors);
  prefixedIdErrors(acceptance['journeyId'], JOURNEY_ID_PATTERN, 'journey_', fieldPath(path, 'journeyId'), errors);
  requireString(acceptance, 'purpose', path, errors, { nonEmpty: true });
  requireStringArray(acceptance, 'steps', path, errors);
  const expectedRoute: unknown = acceptance['expectedRoute'];
  if (expectedRoute === null) {
    errors.push(nullErrorMessage(fieldPath(path, 'expectedRoute')));
  } else if (typeof expectedRoute !== 'string' || !context.routePaths.has(expectedRoute)) {
    errors.push(
      `${fieldPath(path, 'expectedRoute')}: ${preview(expectedRoute)} is not a served route path (expectedRoute must name a PlannedRoute path)`,
    );
  }
  requireStringArray(acceptance, 'mustSeeElementIds', path, errors);
  const page = typeof expectedRoute === 'string' ? context.pageByRoutePath.get(expectedRoute) : undefined;
  for (let index = 0; index < asArray(acceptance['mustSeeElementIds']).length; index += 1) {
    const entry: unknown = asArray(acceptance['mustSeeElementIds'])[index];
    const at = `${fieldPath(path, 'mustSeeElementIds')}[${index}]`;
    if (typeof entry !== 'string' || entry === '') continue; // string-shape covered above
    if (page === undefined) {
      errors.push(`${at}: cannot check must-see element — the expectedRoute's page is not resolvable`);
    } else if (!elementIdsOfPage(page).has(entry)) {
      errors.push(
        `${at}: ${preview(entry)} does not resolve to a PlannedElement on the expectedRoute's page (must-see elements must live on the page the replay ends on)`,
      );
    }
  }
  requireStringArray(acceptance, 'sourceJourneyIds', path, errors);
  for (let index = 0; index < asArray(acceptance['sourceJourneyIds']).length; index += 1) {
    const entry: unknown = asArray(acceptance['sourceJourneyIds'])[index];
    if (typeof entry === 'string' && !JOURNEY_ID_PATTERN.test(entry)) {
      errors.push(
        `${fieldPath(path, 'sourceJourneyIds')}[${index}]: expected a "journey_"-prefixed uuid v4 string (IR journey id), got ${preview(entry)}`,
      );
    }
  }
  errors.push(...provenanceBlockErrors(acceptance['provenance'], fieldPath(path, 'provenance')));
}

function serverErrors(server: unknown, path: string, errors: string[]): void {
  if (!requireObject(server, path, errors)) return;
  requireString(server, 'startCommand', path, errors, { nonEmpty: true });
  const port: unknown = server['port'];
  if (port === null) {
    errors.push(nullErrorMessage(fieldPath(path, 'port')));
  } else if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
    errors.push(`${fieldPath(path, 'port')}: expected an integer 1-65535, got ${preview(port)}`);
  }
  const healthPath: unknown = server['healthPath'];
  if (healthPath === null) {
    errors.push(nullErrorMessage(fieldPath(path, 'healthPath')));
  } else if (typeof healthPath !== 'string' || healthPath === '' || !healthPath.startsWith('/')) {
    errors.push(`${fieldPath(path, 'healthPath')}: expected a non-empty path starting with "/", got ${preview(healthPath)}`);
  }
}

function applicationErrors(
  application: unknown,
  path: string,
  errors: string[],
  context: PlanReferenceContext,
): void {
  if (!requireObject(application, path, errors)) return;
  prefixedIdErrors(application['id'], PLANNED_APPLICATION_ID_PATTERN, 'appsyn_', fieldPath(path, 'id'), errors);
  requireString(application, 'name', path, errors, { nonEmpty: true });
  requireString(application, 'platform', path, errors, { nonEmpty: true });
  prefixedIdErrors(application['sourceModelId'], IR_APPLICATION_ID_PATTERN, 'app_', fieldPath(path, 'sourceModelId'), errors);
  requireStringArray(application, 'entrypoints', path, errors);
  for (let index = 0; index < asArray(application['entrypoints']).length; index += 1) {
    const entry: unknown = asArray(application['entrypoints'])[index];
    if (typeof entry === 'string' && !context.routePaths.has(entry)) {
      errors.push(
        `${fieldPath(path, 'entrypoints')}[${index}]: ${preview(entry)} is not a served route path (entrypoints must be routes the candidate serves)`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Deep no-null scan + serializability probe
// ---------------------------------------------------------------------------

function deepScanErrors(value: unknown, path: string, errors: string[], inProgress: Set<object>): void {
  if (value === null) {
    errors.push(nullErrorMessage(path));
    return;
  }
  if (Array.isArray(value)) {
    if (inProgress.has(value)) return; // cycles surface via the serializability probe
    inProgress.add(value);
    for (let index = 0; index < value.length; index += 1) {
      deepScanErrors(value[index], `${path}[${index}]`, errors, inProgress);
    }
    inProgress.delete(value);
    return;
  }
  if (isObject(value)) {
    if (inProgress.has(value)) return;
    inProgress.add(value);
    for (const key of Object.keys(value)) {
      deepScanErrors(value[key], `${path}.${key}`, errors, inProgress);
    }
    inProgress.delete(value);
  }
}

function serializabilityErrors(plan: unknown, errors: string[]): void {
  try {
    canonicalJson(plan);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`plan: not canonical-JSON serializable — ${message}`);
  }
}

// ---------------------------------------------------------------------------
// The validator
// ---------------------------------------------------------------------------

/**
 * Structural + referential validation of `plan` (total — never throws).
 * Returns every path-qualified violation; `valid` is true iff `errors` is
 * empty. See the module doc for the exact enforcement scope.
 */
export function validateSynthesisPlanDetailed(plan: unknown): PlanValidationResult {
  const errors: string[] = [];
  try {
    if (!requireObject(plan, 'plan', errors)) {
      return { valid: false, errors: [...new Set(errors)] };
    }
    const context = buildReferenceContext(plan);

    // ---- planVersion ---------------------------------------------------------
    if (plan['planVersion'] === null) {
      errors.push(nullErrorMessage('plan.planVersion'));
    } else if (plan['planVersion'] !== PLAN_VERSION) {
      errors.push(
        `plan.planVersion: expected ${JSON.stringify(PLAN_VERSION)} (PLAN_VERSION), got ${preview(plan['planVersion'])}`,
      );
    }

    // ---- application -----------------------------------------------------------
    applicationErrors(plan['application'], 'plan.application', errors, context);

    // ---- routes ------------------------------------------------------------------
    const seenRouteIds = new Set<string>();
    const seenRoutePaths = new Map<string, string>();
    const pagesTargetedByRoutes = new Set<string>();
    for (let index = 0; index < asArray(plan['routes']).length; index += 1) {
      const route = asArray(plan['routes'])[index];
      const at = `plan.routes[${index}]`;
      if (!requireObject(route, at, errors)) continue;
      prefixedIdErrors(route['id'], ROUTE_ID_PATTERN, 'route_', `${at}.id`, errors);
      const id: unknown = route['id'];
      if (typeof id === 'string' && ROUTE_ID_PATTERN.test(id)) {
        if (seenRouteIds.has(id)) {
          errors.push(`${at}.id: duplicate route id ${preview(id)} (route ids must be unique)`);
        } else {
          seenRouteIds.add(id);
        }
      }
      requireString(route, 'path', at, errors, { nonEmpty: true });
      const path: unknown = route['path'];
      if (typeof path === 'string' && path !== '') {
        if (seenRoutePaths.has(path)) {
          errors.push(
            `${at}.path: duplicate route path ${preview(path)} (one route per path — two captures of the same route must be merged upstream)`,
          );
        } else {
          seenRoutePaths.set(path, typeof id === 'string' ? id : '(unknown)');
        }
      }
      const pageId: unknown = route['pageId'];
      if (pageId === null) {
        errors.push(nullErrorMessage(`${at}.pageId`));
      } else if (typeof pageId !== 'string' || !context.pageIds.has(pageId)) {
        errors.push(`${at}.pageId: ${preview(pageId)} does not resolve to a PlannedPage id (pageId→page must resolve)`);
      } else {
        if (pagesTargetedByRoutes.has(pageId)) {
          errors.push(
            `${at}.pageId: page ${preview(pageId)} is already rendered by another route (the route↔page mapping must be bijective — one route per page)`,
          );
        } else {
          pagesTargetedByRoutes.add(pageId);
        }
      }
      errors.push(...provenanceBlockErrors(route['provenance'], `${at}.provenance`));
    }

    // ---- pages ---------------------------------------------------------------------
    const seenPageIds = new Set<string>();
    const seenRouteIdsByPage = new Map<string, string>();
    for (let index = 0; index < asArray(plan['pages']).length; index += 1) {
      const page = asArray(plan['pages'])[index];
      pageErrors(page, `plan.pages[${index}]`, errors, context, seenPageIds, seenRouteIdsByPage);
      if (isObject(page)) {
        const id: unknown = page['id'];
        if (typeof id === 'string' && PAGE_ID_PATTERN.test(id) && !pagesTargetedByRoutes.has(id)) {
          errors.push(
            `plan.pages[${index}].id: page ${preview(id)} is not rendered by any route (every page must be the pageId target of exactly one route)`,
          );
        }
      }
    }

    // ---- element + form id uniqueness ACROSS pages -------------------------------------
    const seenElementIds = new Set<string>();
    const seenFormIds = new Set<string>();
    for (let pageIndex = 0; pageIndex < asArray(plan['pages']).length; pageIndex += 1) {
      const page = asArray(plan['pages'])[pageIndex];
      if (!isObject(page)) continue;
      for (const element of asArray(page['elements'])) {
        if (!isObject(element)) continue;
        const id: unknown = element['id'];
        if (typeof id === 'string' && ELEMENT_ID_PATTERN.test(id)) {
          if (seenElementIds.has(id)) {
            errors.push(`plan.pages[${pageIndex}].elements: duplicate element id ${preview(id)} (element ids must be unique across the whole plan)`);
          } else {
            seenElementIds.add(id);
          }
        }
      }
      for (const form of asArray(page['forms'])) {
        if (!isObject(form)) continue;
        const id: unknown = form['id'];
        if (typeof id === 'string' && FORM_ID_PATTERN.test(id)) {
          if (seenFormIds.has(id)) {
            errors.push(`plan.pages[${pageIndex}].forms: duplicate form id ${preview(id)} (form ids must be unique across the whole plan)`);
          } else {
            seenFormIds.add(id);
          }
        }
      }
    }

    // ---- navigation -----------------------------------------------------------------------
    const seenNavIds = new Set<string>();
    for (let index = 0; index < asArray(plan['navigation']).length; index += 1) {
      const transition = asArray(plan['navigation'])[index];
      const at = `plan.navigation[${index}]`;
      if (!requireObject(transition, at, errors)) continue;
      prefixedIdErrors(transition['id'], NAV_ID_PATTERN, 'nav_', `${at}.id`, errors);
      const id: unknown = transition['id'];
      if (typeof id === 'string' && NAV_ID_PATTERN.test(id)) {
        if (seenNavIds.has(id)) {
          errors.push(`${at}.id: duplicate navigation id ${preview(id)} (navigation ids must be unique)`);
        } else {
          seenNavIds.add(id);
        }
      }
      transitionErrors(transition, at, errors, context);
    }

    // ---- storage -----------------------------------------------------------------------
    const seenStorageIds = new Set<string>();
    for (let index = 0; index < asArray(plan['storage']).length; index += 1) {
      const binding = asArray(plan['storage'])[index];
      const at = `plan.storage[${index}]`;
      if (!requireObject(binding, at, errors)) continue;
      prefixedIdErrors(binding['id'], STORAGE_BINDING_ID_PATTERN, 'store_', `${at}.id`, errors);
      const id: unknown = binding['id'];
      if (typeof id === 'string' && STORAGE_BINDING_ID_PATTERN.test(id)) {
        if (seenStorageIds.has(id)) {
          errors.push(`${at}.id: duplicate storage-binding id ${preview(id)} (storage-binding ids must be unique)`);
        } else {
          seenStorageIds.add(id);
        }
      }
      storageErrors(binding, at, errors, context);
    }

    // ---- api ------------------------------------------------------------------------------
    const api: unknown = plan['api'];
    if (!requireObject(api, 'plan.api', errors)) {
      // section-shape error recorded; continue with empty scans
    } else {
      const seenEndpointIds = new Set<string>();
      for (let index = 0; index < asArray(api['endpoints']).length; index += 1) {
        const endpoint = asArray(api['endpoints'])[index];
        const at = `plan.api.endpoints[${index}]`;
        if (!requireObject(endpoint, at, errors)) continue;
        prefixedIdErrors(endpoint['id'], API_ENDPOINT_ID_PATTERN, 'api_', `${at}.id`, errors);
        const id: unknown = endpoint['id'];
        if (typeof id === 'string' && API_ENDPOINT_ID_PATTERN.test(id)) {
          if (seenEndpointIds.has(id)) {
            errors.push(`${at}.id: duplicate endpoint id ${preview(id)} (endpoint ids must be unique)`);
          } else {
            seenEndpointIds.add(id);
          }
        }
        endpointErrors(endpoint, at, errors);
      }
      const seenMockIds = new Set<string>();
      for (let index = 0; index < asArray(api['mocks']).length; index += 1) {
        const mock = asArray(api['mocks'])[index];
        const at = `plan.api.mocks[${index}]`;
        if (!requireObject(mock, at, errors)) continue;
        prefixedIdErrors(mock['id'], MOCK_ID_PATTERN, 'mock_', `${at}.id`, errors);
        const id: unknown = mock['id'];
        if (typeof id === 'string' && MOCK_ID_PATTERN.test(id)) {
          if (seenMockIds.has(id)) {
            errors.push(`${at}.id: duplicate mock id ${preview(id)} (mock ids must be unique)`);
          } else {
            seenMockIds.add(id);
          }
        }
        mockErrors(mock, at, errors, context);
      }
    }

    // ---- acceptance -------------------------------------------------------------------------
    const seenAcceptanceIds = new Set<string>();
    for (let index = 0; index < asArray(plan['acceptance']).length; index += 1) {
      const acceptance = asArray(plan['acceptance'])[index];
      const at = `plan.acceptance[${index}]`;
      if (!requireObject(acceptance, at, errors)) continue;
      prefixedIdErrors(acceptance['id'], ACCEPTANCE_ID_PATTERN, 'acc_', `${at}.id`, errors);
      const id: unknown = acceptance['id'];
      if (typeof id === 'string' && ACCEPTANCE_ID_PATTERN.test(id)) {
        if (seenAcceptanceIds.has(id)) {
          errors.push(`${at}.id: duplicate acceptance id ${preview(id)} (acceptance ids must be unique)`);
        } else {
          seenAcceptanceIds.add(id);
        }
      }
      acceptanceErrors(acceptance, at, errors, context);
    }

    // ---- server ------------------------------------------------------------------------------
    serverErrors(plan['server'], 'plan.server', errors);

    // ---- assumptions + constraints ------------------------------------------------------------
    requireStringArray(plan, 'assumptions', 'plan', errors);
    requireStringArray(plan, 'constraints', 'plan', errors);

    // ---- model-wide deep scan + serializability -------------------------------------------------
    deepScanErrors(plan, 'plan', errors, new Set<object>());
    serializabilityErrors(plan, errors);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`plan: validator failed unexpectedly — ${message}`);
  }

  const deduped = [...new Set(errors)];
  return { valid: deduped.length === 0, errors: deduped };
}

/** Total predicate form of {@link validateSynthesisPlanDetailed}. */
export function validateSynthesisPlan(plan: unknown): plan is SynthesisPlan {
  return validateSynthesisPlanDetailed(plan).valid;
}
