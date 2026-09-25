/**
 * @clapp/ir — structural validation for the Behavioral IR model v0.1.
 *
 * Design notes (honest scope):
 * - Validation is STRUCTURAL + REFERENTIAL: it checks that a value matches
 *   the declared TypeScript shapes of ir-contract.ts so untrusted JSON can
 *   be narrowed safely, and that every intra-model reference resolves
 *   (component→screen, transition→screen, api-response trigger→operation,
 *   and every cited EvidenceRef→evidence catalog). It does not judge
 *   whether a model is semantically useful (an empty screens array is
 *   structurally valid).
 * - Extra properties beyond the declared fields are ALLOWED (forward
 *   compatibility with contract extensions); only declared fields are
 *   type-checked. Extra properties are still covered by the model-wide
 *   no-null and serializability rules below.
 * - NULL POLICY: `null` is not a valid value ANYWHERE in an IR model —
 *   optional fields must be ABSENT, never null ("unknown is a valid value"
 *   renders as absence). This is enforced (a) per declared field and
 *   (b) by a deep scan over the entire model tree, including opaque
 *   payloads (`input`, `outputs`, schemas, component `properties`) and
 *   extra properties. Observed null data therefore has to be encoded some
 *   other way (e.g. omitted) — a deliberate v0.1 strictness rule.
 * - SERIALIZABILITY: the model must be canonical-JSON serializable
 *   (principle 7). A probe pass rejects undefined, bigint, symbol,
 *   function, non-plain objects (Date/Map/Set/class instances), reference
 *   cycles, and non-finite numbers anywhere in the tree.
 * - VOCABULARIES: closed literal unions declared by the contract are
 *   enforced (EvidenceLevel, Replayability, IntegrationStatus, trigger
 *   `type`, EvidenceKind via @clapp/core). Vocabularies that exist only in
 *   COMMENTS (trigger action names, state-variable domains, component
 *   roles) are NOT enforced — the contract types them as plain `string`
 *   and native adapters may extend them; see README "Not enforced".
 * - IDENTIFIERS: every element id must match its declared prefix pattern
 *   (uuid-shaped hex, version/variant bits not pinned — same leniency as
 *   @clapp/journey's JOURNEY_ID_PATTERN) and be unique within its section.
 *   The evidence catalog additionally enforces unique `evidenceId`s: each
 *   evidence item is cataloged exactly once so citation by evidenceId is
 *   unambiguous.
 * - ROUTES: one screen per route in v0 — a duplicate route is a modeling
 *   error (two captures of the same route must be merged by the caller,
 *   not the builder).
 * - CATALOG RESOLUTION: every EvidenceRef cited anywhere in the model
 *   (screen treeRef/visualRef, api observedExamples, and every provenance
 *   block's confidence.evidenceRefs) must resolve against the evidence
 *   catalog — matching evidenceId AND kind AND sha256, because an
 *   EvidenceRef is self-describing (contract: "refs cited throughout the
 *   model resolve here").
 * - Empty `confidence.evidenceRefs` is legal ONLY for level 'assumed'.
 *   Note this also binds level 'unavailable': an 'unavailable' property
 *   must cite the observation attempts that failed to observe it.
 * - Errors are path-qualified (`screens[2].treeRef.sha256`) and de-duplicated
 *   (a null declared field is intentionally reported by both the field
 *   check and the deep scan with an identical message; dedupe collapses
 *   that to one entry).
 * - Both functions are TOTAL — they never throw, even on cyclic or exotic
 *   inputs (an internal try/catch converts any unexpected failure into an
 *   error entry).
 */

import { EVIDENCE_KINDS } from '@clapp/core';
import type { IrModel } from './ir-contract';
import { IR_MODEL_VERSION } from './ir-contract';
import { canonicalJson } from './canonical-json';
import { API_OPERATION_ID_PATTERN, SCREEN_ID_PATTERN, UUID_SHAPE_RE } from './ids';

/** Result of a detailed (non-predicate) IR model validation. */
export interface IrValidationResult {
  /** True iff `errors` is empty. */
  valid: boolean;
  /** Path-qualified human-readable messages; empty iff valid. */
  errors: string[];
}

// ---------------------------------------------------------------------------
// Vocabularies (closed literal unions declared by the contract)
// ---------------------------------------------------------------------------

const EVIDENCE_LEVELS = ['observed', 'derived', 'inferred', 'assumed', 'unavailable'] as const;
const REPLAYABILITIES = ['replayable', 'needs-auth', 'side-effects', 'unreproducible'] as const;
const INTEGRATION_STATUSES = ['observed', 'inferred', 'mocked', 'unreproducible'] as const;
const TRIGGER_TYPES = ['action', 'timer', 'background-event', 'api-response', 'websocket-message'] as const;

const EVIDENCE_LEVEL_SET = new Set<string>(EVIDENCE_LEVELS);
const REPLAYABILITY_SET = new Set<string>(REPLAYABILITIES);
const INTEGRATION_STATUS_SET = new Set<string>(INTEGRATION_STATUSES);
const TRIGGER_TYPE_SET = new Set<string>(TRIGGER_TYPES);
const EVIDENCE_KIND_SET = new Set<string>(EVIDENCE_KINDS);

/** `"ev_" + uuid` — EvidenceId shape from the frozen @clapp/core contract. */
export const EVIDENCE_ID_PATTERN = /^ev_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 64-char lowercase hex sha256 (same convention as @clapp/evidence). */
export const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

// ---------------------------------------------------------------------------
// Small message helpers
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
  // Strings are quoted so message readers can tell "" from null from undefined.
  // Non-finite numbers stringify explicitly (JSON would render them as null).
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
  return `${path}: null is not a valid IR value — omit the field instead (absent, never null)`;
}

function expectedOneOf(path: string, vocabulary: readonly string[], value: unknown): string {
  return `${path}: expected one of ${vocabulary.join('|')}, got ${preview(value)}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// Field-shape helpers (each appends path-qualified messages to `errors`)
// ---------------------------------------------------------------------------

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

/** Required non-empty string field. */
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

/** Optional string field — must be absent (never null) when unknown. */
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

/** Required array-of-non-empty-strings field. */
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

/** Optional array-of-non-empty-strings field — absent (never null) when unknown. */
function requireOptionalStringArray(
  container: Record<string, unknown>,
  field: string,
  path: string,
  errors: string[],
): void {
  const at = fieldPath(path, field);
  const value = container[field];
  if (value === undefined) return;
  if (value === null) {
    errors.push(nullErrorMessage(at));
    return;
  }
  if (!Array.isArray(value)) {
    errors.push(`${at}: expected an array or absent, got ${kindOf(value)}`);
    return;
  }
  stringArrayEntriesErrors(value, at, errors);
}

// ---------------------------------------------------------------------------
// EvidenceRef + Provenance (shared with the builder — exported, internal API)
// ---------------------------------------------------------------------------

/**
 * Structural errors for one EvidenceRef at `path` (paths like
 * `evidence[0].ref` or `screens[1].treeRef`). Internal shared helper — NOT
 * re-exported from the package root; used by validate.ts and builder.ts so
 * the two can never disagree about what a well-formed ref is.
 */
export function evidenceRefErrors(ref: unknown, path: string): string[] {
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

/**
 * Structural errors for one Provenance block at `path` (paths like
 * `screens[0].provenance`). Internal shared helper — see evidenceRefErrors.
 */
export function provenanceBlockErrors(provenance: unknown, path: string): string[] {
  const errors: string[] = [];
  if (!isObject(provenance)) {
    errors.push(`${path}: expected a non-null object, got ${kindOf(provenance)}`);
    return errors;
  }
  const at = (field: string): string => fieldPath(path, field);

  const level: unknown = provenance['level'];
  if (level === null) {
    errors.push(nullErrorMessage(at('level')));
  } else if (typeof level !== 'string' || !EVIDENCE_LEVEL_SET.has(level)) {
    errors.push(expectedOneOf(at('level'), EVIDENCE_LEVELS, level));
  }

  const confidence: unknown = provenance['confidence'];
  if (!isObject(confidence)) {
    errors.push(`${at('confidence')}: expected a non-null object, got ${kindOf(confidence)}`);
    return errors;
  }
  const value: unknown = confidence['value'];
  if (value === null) {
    errors.push(nullErrorMessage(at('confidence.value')));
  } else if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    errors.push(`${at('confidence.value')}: expected a finite number in [0, 1], got ${preview(value)}`);
  }
  requireString(confidence, 'rationale', at('confidence'), errors, { nonEmpty: true });

  const refs: unknown = confidence['evidenceRefs'];
  if (refs === null) {
    errors.push(nullErrorMessage(at('confidence.evidenceRefs')));
  } else if (!Array.isArray(refs)) {
    errors.push(`${at('confidence.evidenceRefs')}: expected an array, got ${kindOf(refs)}`);
  } else {
    for (let index = 0; index < refs.length; index += 1) {
      errors.push(...evidenceRefErrors(refs[index], `${at('confidence.evidenceRefs')}[${index}]`));
    }
    if (
      refs.length === 0 &&
      typeof level === 'string' &&
      EVIDENCE_LEVEL_SET.has(level) &&
      level !== 'assumed'
    ) {
      errors.push(
        `${at('confidence.evidenceRefs')}: must not be empty for level "${level}" (empty evidenceRefs are legal only for level "assumed")`,
      );
    }
  }
  return errors;
}

/**
 * Structural errors for a prefixed element id at `path` (e.g.
 * `application.id` with prefix "app_"). Internal shared helper.
 */
export function prefixedIdErrors(id: unknown, prefix: string, path: string): string[] {
  if (id === null) {
    return [nullErrorMessage(path)];
  }
  if (typeof id !== 'string' || !UUID_SHAPE_RE.test(id.startsWith(prefix) ? id.slice(prefix.length) : '')) {
    return [
      `${path}: expected a "${prefix}"-prefixed uuid v4 string ("${prefix}" + 8-4-4-4-12 hex), got ${preview(id)}`,
    ];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Referential context (tolerant pre-scan of raw sections)
// ---------------------------------------------------------------------------

/** Internal shape shared by the model pass and the builder (not re-exported from the package root). */
export interface CatalogEntry {
  index: number;
  entryId: string;
  ref: { evidenceId: string; kind: string; sha256: string };
}

export interface IrReferenceContext {
  /** screen ids seen in `screens` (usable only when the section parsed as an array). */
  screenIds: Set<string>;
  screensUsable: boolean;
  /** api operation ids seen in `api.operations`. */
  operationIds: Set<string>;
  operationsUsable: boolean;
  /** evidenceId → catalog entry (usable only when `evidence` parsed as an array). */
  catalog: Map<string, CatalogEntry>;
  catalogUsable: boolean;
}

function tolerantEntries(model: unknown, section: string): { array: unknown[] | null; entries: unknown[] } {
  if (!isObject(model)) return { array: null, entries: [] };
  const raw: unknown = model[section];
  if (!Array.isArray(raw)) return { array: null, entries: [] };
  return { array: raw, entries: raw };
}

function nestedTolerantEntries(model: unknown, outer: string, inner: string): { array: unknown[] | null; entries: unknown[] } {
  if (!isObject(model)) return { array: null, entries: [] };
  const container: unknown = model[outer];
  if (!isObject(container)) return { array: null, entries: [] };
  const raw: unknown = container[inner];
  if (!Array.isArray(raw)) return { array: null, entries: [] };
  return { array: raw, entries: raw };
}

function collectIdSet(entries: unknown[], pattern: RegExp): Set<string> {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (isObject(entry)) {
      const id: unknown = entry['id'];
      if (typeof id === 'string' && pattern.test(id)) ids.add(id);
    }
  }
  return ids;
}

function buildCatalog(entries: unknown[]): Map<string, CatalogEntry> {
  const catalog = new Map<string, CatalogEntry>();
  for (let index = 0; index < entries.length; index += 1) {
    const entry: unknown = entries[index];
    if (!isObject(entry)) continue;
    const id: unknown = entry['id'];
    const ref: unknown = entry['ref'];
    if (typeof id !== 'string' || !isObject(ref)) continue;
    const evidenceId: unknown = ref['evidenceId'];
    const kind: unknown = ref['kind'];
    const sha256: unknown = ref['sha256'];
    if (
      typeof evidenceId === 'string' && EVIDENCE_ID_PATTERN.test(evidenceId) &&
      typeof kind === 'string' && typeof sha256 === 'string'
    ) {
      if (!catalog.has(evidenceId)) {
        catalog.set(evidenceId, { index, entryId: id, ref: { evidenceId, kind, sha256 } });
      }
    }
  }
  return catalog;
}

/** Resolve a shape-valid cited ref against the catalog; null when it resolves. */
function catalogResolutionError(ref: unknown, path: string, ctx: IrReferenceContext): string | null {
  if (!ctx.catalogUsable || !isObject(ref)) return null;
  const evidenceId = ref['evidenceId'];
  if (typeof evidenceId !== 'string') return null; // shape errors already reported
  const entry = ctx.catalog.get(evidenceId);
  if (entry === undefined) {
    return `${path}: evidence "${evidenceId}" is not in the evidence catalog (add an IrEvidenceEntry for it first)`;
  }
  const kind = ref['kind'];
  const sha256 = ref['sha256'];
  if (kind !== entry.ref.kind || sha256 !== entry.ref.sha256) {
    return `${path}: evidence ref for "${evidenceId}" does not match its catalog entry ${entry.entryId} (kind/sha256 differ — an EvidenceRef is self-describing)`;
  }
  return null;
}

/** Cited-ref catalog resolution for every ref in a provenance block. */
function provenanceCatalogErrors(provenance: unknown, path: string, ctx: IrReferenceContext): string[] {
  if (!ctx.catalogUsable || !isObject(provenance)) return [];
  const confidence: unknown = provenance['confidence'];
  if (!isObject(confidence)) return [];
  const refs: unknown = confidence['evidenceRefs'];
  if (!Array.isArray(refs)) return [];
  const errors: string[] = [];
  for (let index = 0; index < refs.length; index += 1) {
    const resolution = catalogResolutionError(refs[index], `${path}.confidence.evidenceRefs[${index}]`, ctx);
    if (resolution !== null) errors.push(resolution);
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Per-element checks (shared by the model pass and the builder)
// ---------------------------------------------------------------------------

/** Uniqueness tracker: first occurrence path per id (or route). Internal. */
export class FirstSeen {
  private readonly seen = new Map<string, string>();
  constructor(private readonly errors: string[]) {}
  check(kind: string, key: string, path: string, note: string): void {
    const existing = this.seen.get(key);
    if (existing !== undefined) {
      this.errors.push(`${path}: duplicate ${kind} "${key}" (also at ${existing})${note}`);
    } else {
      this.seen.set(key, path);
    }
  }
}

export function applicationErrors(application: unknown): string[] {
  const errors: string[] = [];
  if (!requireObject(application, 'application', errors)) return errors;
  errors.push(...prefixedIdErrors(application['id'], 'app_', 'application.id'));
  requireString(application, 'name', 'application', errors, { nonEmpty: true });
  requireString(application, 'platform', 'application', errors, { nonEmpty: true });
  requireStringArray(application, 'entrypoints', 'application', errors);
  return errors;
}

export function environmentErrors(environment: unknown): string[] {
  const errors: string[] = [];
  if (!requireObject(environment, 'environment', errors)) return errors;
  for (const field of ['browser', 'os', 'locale', 'timezone', 'network'] as const) {
    requireOptionalString(environment, field, 'environment', errors, { nonEmpty: true });
  }
  const viewport: unknown = environment['viewport'];
  if (viewport !== undefined) {
    if (viewport === null) {
      errors.push(nullErrorMessage('environment.viewport'));
    } else if (!isObject(viewport)) {
      errors.push(`environment.viewport: expected a non-null object or absent, got ${kindOf(viewport)}`);
    } else {
      for (const dimension of ['width', 'height'] as const) {
        const value: unknown = viewport[dimension];
        if (value === null) {
          errors.push(nullErrorMessage(`environment.viewport.${dimension}`));
        } else if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
          errors.push(`environment.viewport.${dimension}: expected a positive integer, got ${preview(value)}`);
        }
      }
    }
  }
  return errors;
}

export function evidenceEntryElementErrors(entry: unknown, path: string, seen: FirstSeen): string[] {
  const errors: string[] = [];
  if (!requireObject(entry, path, errors)) return errors;
  errors.push(...prefixedIdErrors(entry['id'], 'irev_', `${path}.id`));
  if (typeof entry['id'] === 'string') seen.check('id', entry['id'], `${path}.id`, '');
  errors.push(...evidenceRefErrors(entry['ref'], `${path}.ref`));
  requireString(entry, 'source', path, errors, { nonEmpty: true });
  return errors;
}

export function journeyElementErrors(journey: unknown, path: string, seen: FirstSeen, ctx: IrReferenceContext): string[] {
  const errors: string[] = [];
  if (!requireObject(journey, path, errors)) return errors;
  const id: unknown = journey['id'];
  const idMessages = prefixedIdErrors(id, 'journey_', `${path}.id`);
  errors.push(...idMessages);
  if (idMessages.length === 0 && typeof id === 'string') seen.check('id', id, `${path}.id`, '');
  requireString(journey, 'purpose', path, errors, { nonEmpty: true });
  requireStringArray(journey, 'preconditions', path, errors);
  requireStringArray(journey, 'steps', path, errors);
  errors.push(...provenanceBlockErrors(journey['provenance'], `${path}.provenance`));
  errors.push(...provenanceCatalogErrors(journey['provenance'], `${path}.provenance`, ctx));
  return errors;
}

export function screenElementErrors(screen: unknown, path: string, seen: FirstSeen, ctx: IrReferenceContext): string[] {
  const errors: string[] = [];
  if (!requireObject(screen, path, errors)) return errors;
  errors.push(...prefixedIdErrors(screen['id'], 'screen_', `${path}.id`));
  if (typeof screen['id'] === 'string') seen.check('id', screen['id'], `${path}.id`, '');
  requireString(screen, 'route', path, errors, { nonEmpty: true });
  if (typeof screen['route'] === 'string' && screen['route'].trim() !== '') {
    seen.check('route', screen['route'], `${path}.route`, ' — one screen per route in v0; merge captures of the same route before building the model');
  }
  errors.push(...provenanceBlockErrors(screen['provenance'], `${path}.provenance`));
  errors.push(...provenanceCatalogErrors(screen['provenance'], `${path}.provenance`, ctx));
  for (const field of ['treeRef', 'visualRef'] as const) {
    const ref: unknown = screen[field];
    if (ref === undefined) continue;
    if (ref === null) {
      errors.push(nullErrorMessage(`${path}.${field}`));
      continue;
    }
    errors.push(...evidenceRefErrors(ref, `${path}.${field}`));
    const resolution = catalogResolutionError(ref, `${path}.${field}`, ctx);
    if (resolution !== null) errors.push(resolution);
  }
  return errors;
}

export function componentElementErrors(component: unknown, path: string, seen: FirstSeen, ctx: IrReferenceContext): string[] {
  const errors: string[] = [];
  if (!requireObject(component, path, errors)) return errors;
  errors.push(...prefixedIdErrors(component['id'], 'comp_', `${path}.id`));
  if (typeof component['id'] === 'string') seen.check('id', component['id'], `${path}.id`, '');
  requireString(component, 'role', path, errors, { nonEmpty: true });
  const screenId: unknown = component['screenId'];
  if (screenId === null) {
    errors.push(nullErrorMessage(`${path}.screenId`));
  } else if (typeof screenId !== 'string') {
    errors.push(`${path}.screenId: expected a string, got ${kindOf(screenId)}`);
  } else if (ctx.screensUsable && !ctx.screenIds.has(screenId)) {
    errors.push(`${path}.screenId: no screen with id "${screenId}" (declare the screen in screens first)`);
  }
  const properties: unknown = component['properties'];
  if (properties === null) {
    errors.push(nullErrorMessage(`${path}.properties`));
  } else if (!isObject(properties)) {
    errors.push(`${path}.properties: expected a non-null object, got ${kindOf(properties)}`);
  }
  requireStringArray(component, 'events', path, errors);
  errors.push(...provenanceBlockErrors(component['provenance'], `${path}.provenance`));
  errors.push(...provenanceCatalogErrors(component['provenance'], `${path}.provenance`, ctx));
  return errors;
}

export function stateVariableElementErrors(variable: unknown, path: string, seen: FirstSeen, ctx: IrReferenceContext): string[] {
  const errors: string[] = [];
  if (!requireObject(variable, path, errors)) return errors;
  errors.push(...prefixedIdErrors(variable['id'], 'var_', `${path}.id`));
  if (typeof variable['id'] === 'string') seen.check('id', variable['id'], `${path}.id`, '');
  requireString(variable, 'name', path, errors, { nonEmpty: true });
  requireString(variable, 'domain', path, errors, { nonEmpty: true });
  errors.push(...provenanceBlockErrors(variable['provenance'], `${path}.provenance`));
  errors.push(...provenanceCatalogErrors(variable['provenance'], `${path}.provenance`, ctx));
  return errors;
}

function transitionTriggerErrors(trigger: unknown, path: string, ctx: IrReferenceContext): string[] {
  const errors: string[] = [];
  if (!requireObject(trigger, path, errors)) return errors;
  const type: unknown = trigger['type'];
  if (type === null) {
    errors.push(nullErrorMessage(`${path}.type`));
    return errors;
  }
  if (typeof type !== 'string' || !TRIGGER_TYPE_SET.has(type)) {
    errors.push(expectedOneOf(`${path}.type`, TRIGGER_TYPES, type));
    return errors;
  }
  switch (type) {
    case 'action':
      requireString(trigger, 'action', path, errors, { nonEmpty: true });
      break;
    case 'timer':
    case 'background-event':
    case 'websocket-message':
      requireOptionalString(trigger, 'label', path, errors, { nonEmpty: true });
      break;
    case 'api-response': {
      const operationId: unknown = trigger['operationId'];
      const messages = prefixedIdErrors(operationId, 'op_', `${path}.operationId`);
      errors.push(...messages);
      if (
        messages.length === 0 && typeof operationId === 'string' &&
        ctx.operationsUsable && !ctx.operationIds.has(operationId)
      ) {
        errors.push(`${path}.operationId: no api operation with id "${operationId}" (declare the operation in api.operations first)`);
      }
      break;
    }
  }
  return errors;
}

export function transitionElementErrors(transition: unknown, path: string, seen: FirstSeen, ctx: IrReferenceContext): string[] {
  const errors: string[] = [];
  if (!requireObject(transition, path, errors)) return errors;
  errors.push(...prefixedIdErrors(transition['id'], 'trans_', `${path}.id`));
  if (typeof transition['id'] === 'string') seen.check('id', transition['id'], `${path}.id`, '');
  for (const field of ['fromScreenId', 'toScreenId'] as const) {
    const screenId: unknown = transition[field];
    if (screenId === null) {
      errors.push(nullErrorMessage(`${path}.${field}`));
    } else if (typeof screenId !== 'string') {
      errors.push(`${path}.${field}: expected a string, got ${kindOf(screenId)}`);
    } else if (ctx.screensUsable && !ctx.screenIds.has(screenId)) {
      errors.push(`${path}.${field}: no screen with id "${screenId}" (declare the screen in screens first)`);
    }
  }
  errors.push(...transitionTriggerErrors(transition['trigger'], `${path}.trigger`, ctx));
  if (transition['input'] === null) {
    errors.push(nullErrorMessage(`${path}.input`));
  }
  const outputs: unknown = transition['outputs'];
  if (outputs !== undefined) {
    if (outputs === null) {
      errors.push(nullErrorMessage(`${path}.outputs`));
    } else if (!Array.isArray(outputs)) {
      errors.push(`${path}.outputs: expected an array or absent, got ${kindOf(outputs)}`);
    }
  }
  requireStringArray(transition, 'sideEffects', path, errors);
  errors.push(...provenanceBlockErrors(transition['provenance'], `${path}.provenance`));
  errors.push(...provenanceCatalogErrors(transition['provenance'], `${path}.provenance`, ctx));
  return errors;
}

export function dataEntityElementErrors(entity: unknown, path: string, seen: FirstSeen, ctx: IrReferenceContext): string[] {
  const errors: string[] = [];
  if (!requireObject(entity, path, errors)) return errors;
  errors.push(...prefixedIdErrors(entity['id'], 'ent_', `${path}.id`));
  if (typeof entity['id'] === 'string') seen.check('id', entity['id'], `${path}.id`, '');
  requireString(entity, 'name', path, errors, { nonEmpty: true });
  const fields: unknown = entity['fields'];
  if (fields === null) {
    errors.push(nullErrorMessage(`${path}.fields`));
  } else if (!Array.isArray(fields)) {
    errors.push(`${path}.fields: expected an array, got ${kindOf(fields)}`);
  } else {
    for (let index = 0; index < fields.length; index += 1) {
      const field: unknown = fields[index];
      const fieldPath = `${path}.fields[${index}]`;
      if (!requireObject(field, fieldPath, errors)) continue;
      requireString(field, 'name', fieldPath, errors, { nonEmpty: true });
      requireString(field, 'domain', fieldPath, errors, { nonEmpty: true });
      errors.push(...provenanceBlockErrors(field['provenance'], `${fieldPath}.provenance`));
      errors.push(...provenanceCatalogErrors(field['provenance'], `${fieldPath}.provenance`, ctx));
    }
  }
  requireStringArray(entity, 'persistence', path, errors);
  return errors;
}

export function apiOperationElementErrors(operation: unknown, path: string, seen: FirstSeen, ctx: IrReferenceContext): string[] {
  const errors: string[] = [];
  if (!requireObject(operation, path, errors)) return errors;
  errors.push(...prefixedIdErrors(operation['id'], 'op_', `${path}.id`));
  if (typeof operation['id'] === 'string') seen.check('id', operation['id'], `${path}.id`, '');
  requireString(operation, 'transport', path, errors, { nonEmpty: true });
  requireOptionalString(operation, 'method', path, errors, { nonEmpty: true });
  requireString(operation, 'urlPattern', path, errors, { nonEmpty: true });
  requireOptionalStringArray(operation, 'headersNeeded', path, errors);
  for (const field of ['requestSchema', 'responseSchema', 'errorSchema'] as const) {
    if (operation[field] === null) {
      errors.push(nullErrorMessage(`${path}.${field}`));
    }
  }
  requireOptionalString(operation, 'authDependency', path, errors, { nonEmpty: true });
  const examples: unknown = operation['observedExamples'];
  if (examples === null) {
    errors.push(nullErrorMessage(`${path}.observedExamples`));
  } else if (!Array.isArray(examples)) {
    errors.push(`${path}.observedExamples: expected an array, got ${kindOf(examples)}`);
  } else {
    for (let index = 0; index < examples.length; index += 1) {
      const examplePath = `${path}.observedExamples[${index}]`;
      errors.push(...evidenceRefErrors(examples[index], examplePath));
      const resolution = catalogResolutionError(examples[index], examplePath, ctx);
      if (resolution !== null) errors.push(resolution);
    }
  }
  const replayability: unknown = operation['replayability'];
  if (replayability === null) {
    errors.push(nullErrorMessage(`${path}.replayability`));
  } else if (typeof replayability !== 'string' || !REPLAYABILITY_SET.has(replayability)) {
    errors.push(expectedOneOf(`${path}.replayability`, REPLAYABILITIES, replayability));
  }
  requireStringArray(operation, 'externalSideEffects', path, errors);
  errors.push(...provenanceBlockErrors(operation['provenance'], `${path}.provenance`));
  errors.push(...provenanceCatalogErrors(operation['provenance'], `${path}.provenance`, ctx));
  return errors;
}

export function integrationElementErrors(integration: unknown, path: string, seen: FirstSeen, ctx: IrReferenceContext): string[] {
  const errors: string[] = [];
  if (!requireObject(integration, path, errors)) return errors;
  errors.push(...prefixedIdErrors(integration['id'], 'integ_', `${path}.id`));
  if (typeof integration['id'] === 'string') seen.check('id', integration['id'], `${path}.id`, '');
  requireString(integration, 'capability', path, errors, { nonEmpty: true });
  const status: unknown = integration['status'];
  if (status === null) {
    errors.push(nullErrorMessage(`${path}.status`));
  } else if (typeof status !== 'string' || !INTEGRATION_STATUS_SET.has(status)) {
    errors.push(expectedOneOf(`${path}.status`, INTEGRATION_STATUSES, status));
  }
  errors.push(...provenanceBlockErrors(integration['provenance'], `${path}.provenance`));
  errors.push(...provenanceCatalogErrors(integration['provenance'], `${path}.provenance`, ctx));
  return errors;
}

export function assumptionElementErrors(assumption: unknown, path: string, seen: FirstSeen, ctx: IrReferenceContext): string[] {
  const errors: string[] = [];
  if (!requireObject(assumption, path, errors)) return errors;
  errors.push(...prefixedIdErrors(assumption['id'], 'assume_', `${path}.id`));
  if (typeof assumption['id'] === 'string') seen.check('id', assumption['id'], `${path}.id`, '');
  requireString(assumption, 'statement', path, errors, { nonEmpty: true });
  errors.push(...provenanceBlockErrors(assumption['provenance'], `${path}.provenance`));
  errors.push(...provenanceCatalogErrors(assumption['provenance'], `${path}.provenance`, ctx));
  return errors;
}

// ---------------------------------------------------------------------------
// Deep null scan + serializability probe
// ---------------------------------------------------------------------------

/**
 * Deep scan for `null` anywhere in the model tree (declared fields, opaque
 * payloads, extra properties), with cycle protection. Paths are
 * model-rooted (`screens[0].treeRef`).
 */
export function nullValueErrors(value: unknown, path: string): string[] {
  const errors: string[] = [];
  scanForNulls(value, path, [], errors);
  return errors;
}

function scanForNulls(value: unknown, path: string, inProgress: object[], errors: string[]): void {
  if (value === null) {
    errors.push(nullErrorMessage(path));
    return;
  }
  if (Array.isArray(value)) {
    if (inProgress.includes(value)) {
      errors.push(`${path}: reference cycle detected (the IR model must be a tree)`);
      return;
    }
    inProgress.push(value);
    for (let index = 0; index < value.length; index += 1) {
      scanForNulls(value[index], `${path}[${index}]`, inProgress, errors);
    }
    inProgress.pop();
    return;
  }
  if (typeof value === 'object' && value !== null) {
    if (inProgress.includes(value)) {
      errors.push(`${path}: reference cycle detected (the IR model must be a tree)`);
      return;
    }
    inProgress.push(value);
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      scanForNulls(record[key], path === '' ? key : `${path}.${key}`, inProgress, errors);
    }
    inProgress.pop();
  }
}

// ---------------------------------------------------------------------------
// Model-level validation
// ---------------------------------------------------------------------------

/**
 * Detailed structural validation of an IR model. Total — never throws.
 * Returns every path-qualified violation found (de-duplicated, in section
 * declaration order).
 */
export function validateIrModelDetailed(model: unknown): IrValidationResult {
  const errors: string[] = [];
  try {
    collectModelErrors(model, errors);
  } catch (error) {
    errors.push(`model: validator internal error (please report): ${errorMessage(error)}`);
  }
  const unique = [...new Set(errors)];
  return { valid: unique.length === 0, errors: unique };
}

/**
 * Total predicate form of {@link validateIrModelDetailed}: narrows `model`
 * to `IrModel` when it is structurally valid. Never throws.
 */
export function validateIrModel(model: unknown): model is IrModel {
  return validateIrModelDetailed(model).valid;
}

function collectModelErrors(model: unknown, errors: string[]): void {
  if (!requireObject(model, 'model', errors)) return;

  // --- modelVersion -------------------------------------------------------
  const modelVersion: unknown = model['modelVersion'];
  if (modelVersion === null) {
    errors.push(nullErrorMessage('modelVersion'));
  } else if (modelVersion !== IR_MODEL_VERSION) {
    errors.push(`modelVersion: expected "${IR_MODEL_VERSION}", got ${preview(modelVersion)}`);
  }

  // --- tolerant pre-scan for referential id sets --------------------------
  const evidenceScan = tolerantEntries(model, 'evidence');
  const screensScan = tolerantEntries(model, 'screens');
  const operationsScan = nestedTolerantEntries(model, 'api', 'operations');
  const ctx: IrReferenceContext = {
    screenIds: collectIdSet(screensScan.entries, SCREEN_ID_PATTERN),
    screensUsable: screensScan.array !== null,
    operationIds: collectIdSet(operationsScan.entries, API_OPERATION_ID_PATTERN),
    operationsUsable: operationsScan.array !== null,
    catalog: buildCatalog(evidenceScan.entries),
    catalogUsable: evidenceScan.array !== null,
  };

  // --- application / environment -------------------------------------------
  errors.push(...applicationErrors(model['application']));
  errors.push(...environmentErrors(model['environment']));

  // --- evidence catalog -----------------------------------------------------
  const evidenceArray: unknown = model['evidence'];
  if (evidenceArray === null) {
    errors.push(nullErrorMessage('evidence'));
  } else if (!Array.isArray(evidenceArray)) {
    errors.push(`evidence: expected an array, got ${kindOf(evidenceArray)}`);
  } else {
    const seen = new FirstSeen(errors);
    const evidenceIds = new FirstSeen(errors);
    for (let index = 0; index < evidenceArray.length; index += 1) {
      const entry: unknown = evidenceArray[index];
      errors.push(...evidenceEntryElementErrors(entry, `evidence[${index}]`, seen));
      if (isObject(entry) && isObject(entry['ref'])) {
        const evidenceId: unknown = (entry['ref'] as Record<string, unknown>)['evidenceId'];
        if (typeof evidenceId === 'string') {
          evidenceIds.check(
            'catalog evidenceId',
            evidenceId,
            `evidence[${index}].ref.evidenceId`,
            ' — catalog each evidence item exactly once so citation is unambiguous',
          );
        }
      }
    }
  }

  // --- journeys --------------------------------------------------------------
  const journeys: unknown = model['journeys'];
  if (journeys === null) {
    errors.push(nullErrorMessage('journeys'));
  } else if (!Array.isArray(journeys)) {
    errors.push(`journeys: expected an array, got ${kindOf(journeys)}`);
  } else {
    const seen = new FirstSeen(errors);
    for (let index = 0; index < journeys.length; index += 1) {
      errors.push(...journeyElementErrors(journeys[index], `journeys[${index}]`, seen, ctx));
    }
  }

  // --- screens ---------------------------------------------------------------
  const screens: unknown = model['screens'];
  if (screens === null) {
    errors.push(nullErrorMessage('screens'));
  } else if (!Array.isArray(screens)) {
    errors.push(`screens: expected an array, got ${kindOf(screens)}`);
  } else {
    const seen = new FirstSeen(errors);
    for (let index = 0; index < screens.length; index += 1) {
      errors.push(...screenElementErrors(screens[index], `screens[${index}]`, seen, ctx));
    }
  }

  // --- components ------------------------------------------------------------
  const components: unknown = model['components'];
  if (components === null) {
    errors.push(nullErrorMessage('components'));
  } else if (!Array.isArray(components)) {
    errors.push(`components: expected an array, got ${kindOf(components)}`);
  } else {
    const seen = new FirstSeen(errors);
    for (let index = 0; index < components.length; index += 1) {
      errors.push(...componentElementErrors(components[index], `components[${index}]`, seen, ctx));
    }
  }

  // --- state (variables + transitions) ---------------------------------------
  const state: unknown = model['state'];
  if (state === null) {
    errors.push(nullErrorMessage('state'));
  } else if (!isObject(state)) {
    errors.push(`state: expected a non-null object, got ${kindOf(state)}`);
  } else {
    const variables: unknown = state['variables'];
    if (variables === null) {
      errors.push(nullErrorMessage('state.variables'));
    } else if (!Array.isArray(variables)) {
      errors.push(`state.variables: expected an array, got ${kindOf(variables)}`);
    } else {
      const seen = new FirstSeen(errors);
      for (let index = 0; index < variables.length; index += 1) {
        errors.push(...stateVariableElementErrors(variables[index], `state.variables[${index}]`, seen, ctx));
      }
    }
    const transitions: unknown = state['transitions'];
    if (transitions === null) {
      errors.push(nullErrorMessage('state.transitions'));
    } else if (!Array.isArray(transitions)) {
      errors.push(`state.transitions: expected an array, got ${kindOf(transitions)}`);
    } else {
      const seen = new FirstSeen(errors);
      for (let index = 0; index < transitions.length; index += 1) {
        errors.push(...transitionElementErrors(transitions[index], `state.transitions[${index}]`, seen, ctx));
      }
    }
  }

  // --- data (entities) ---------------------------------------------------------
  const data: unknown = model['data'];
  if (data === null) {
    errors.push(nullErrorMessage('data'));
  } else if (!isObject(data)) {
    errors.push(`data: expected a non-null object, got ${kindOf(data)}`);
  } else {
    const entities: unknown = data['entities'];
    if (entities === null) {
      errors.push(nullErrorMessage('data.entities'));
    } else if (!Array.isArray(entities)) {
      errors.push(`data.entities: expected an array, got ${kindOf(entities)}`);
    } else {
      const seen = new FirstSeen(errors);
      for (let index = 0; index < entities.length; index += 1) {
        errors.push(...dataEntityElementErrors(entities[index], `data.entities[${index}]`, seen, ctx));
      }
    }
  }

  // --- api (operations) ---------------------------------------------------------
  const api: unknown = model['api'];
  if (api === null) {
    errors.push(nullErrorMessage('api'));
  } else if (!isObject(api)) {
    errors.push(`api: expected a non-null object, got ${kindOf(api)}`);
  } else {
    const operations: unknown = api['operations'];
    if (operations === null) {
      errors.push(nullErrorMessage('api.operations'));
    } else if (!Array.isArray(operations)) {
      errors.push(`api.operations: expected an array, got ${kindOf(operations)}`);
    } else {
      const seen = new FirstSeen(errors);
      for (let index = 0; index < operations.length; index += 1) {
        errors.push(...apiOperationElementErrors(operations[index], `api.operations[${index}]`, seen, ctx));
      }
    }
  }

  // --- integrations / assumptions / constraints ---------------------------------
  const integrations: unknown = model['integrations'];
  if (integrations === null) {
    errors.push(nullErrorMessage('integrations'));
  } else if (!Array.isArray(integrations)) {
    errors.push(`integrations: expected an array, got ${kindOf(integrations)}`);
  } else {
    const seen = new FirstSeen(errors);
    for (let index = 0; index < integrations.length; index += 1) {
      errors.push(...integrationElementErrors(integrations[index], `integrations[${index}]`, seen, ctx));
    }
  }

  const assumptions: unknown = model['assumptions'];
  if (assumptions === null) {
    errors.push(nullErrorMessage('assumptions'));
  } else if (!Array.isArray(assumptions)) {
    errors.push(`assumptions: expected an array, got ${kindOf(assumptions)}`);
  } else {
    const seen = new FirstSeen(errors);
    for (let index = 0; index < assumptions.length; index += 1) {
      errors.push(...assumptionElementErrors(assumptions[index], `assumptions[${index}]`, seen, ctx));
    }
  }

  const constraints: unknown = model['constraints'];
  if (constraints === null) {
    errors.push(nullErrorMessage('constraints'));
  } else if (!Array.isArray(constraints)) {
    errors.push(`constraints: expected an array, got ${kindOf(constraints)}`);
  } else {
    stringArrayEntriesErrors(constraints, 'constraints', errors);
  }

  // --- model-wide passes: deep null scan + serializability ----------------------
  errors.push(...nullValueErrors(model, ''));
  try {
    canonicalJson(model);
  } catch (error) {
    errors.push(`model: not canonical-JSON serializable — ${errorMessage(error)}`);
  }
}
