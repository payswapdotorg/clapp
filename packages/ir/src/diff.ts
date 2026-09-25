/**
 * @clapp/ir — id-stable diff between two IR models.
 *
 * Identity per section is the ELEMENT ID (screens/components/state.variables/
 * state.transitions/data.entities/api.operations/integrations/assumptions/
 * journeys/evidence): an element present in both models is `changed` iff its
 * canonical serialization differs, `unchanged` otherwise — position in the
 * section array is irrelevant, so REORDERING A SECTION ARRAY IS NOT A
 * CHANGE. Three extra sections compare whole values: `modelVersion`,
 * `application`, `environment` (changed carries the section name as the
 * pseudo-id); `constraints` diffs as a set of strings (added/removed).
 *
 * ARRAY-ORDER SEMANTICS INSIDE ELEMENTS (deliberate, tested, see README):
 * canonical serialization is order-preserving, so by default reordering an
 * array INSIDE an element (e.g. a journey's `steps`, which are sequential)
 * IS a change. The exceptions are arrays where the contract implies SET
 * semantics; those are normalized (sorted by canonical form) before
 * comparison, so reordering them is NOT a change:
 *
 *   - every provenance block:  provenance.confidence.evidenceRefs
 *   - application:             entrypoints
 *   - journeys:                preconditions            (steps stay ORDERED)
 *   - components:              events
 *   - transitions:             sideEffects
 *   - data entities:           persistence, fields (+ each field's
 *                              provenance.confidence.evidenceRefs)
 *   - api operations:          headersNeeded, observedExamples,
 *                              externalSideEffects
 *
 * Honest scope notes:
 * - `diffIrModels` TRUSTS its typed inputs; it does not validate them. Run
 *   `validateIrModelDetailed` first when comparing untrusted JSON. Malformed
 *   elements (no usable string id) are identified by their full canonical
 *   content instead of being dropped, so nothing silently vanishes from a
 *   diff.
 * - Set-semantics arrays are compared as MULTISETS in elements (duplicates
 *   preserved: ["a","a"] ≠ ["a"]); the top-level `constraints` section is
 *   compared as a SET (duplicates collapse) because it diffs bare strings.
 * - `unchangedCount` counts elements present in both models with identical
 *   (normalized) canonical serialization. `identical` is true iff every
 *   section reports empty added/removed/changed.
 * - Section order in the result is fixed (DIFF_SECTIONS) so consumers can
 *   index it positionally.
 */

import type { IrModel } from './ir-contract';
import { canonicalJson } from './canonical-json';

/** One section's diff: element ids (or the section name / constraint strings). */
export interface IrDiffSection {
  section: string;
  /** Ids present only in `b`. */
  added: string[];
  /** Ids present only in `a`. */
  removed: string[];
  /** Ids present in both but with different canonical serialization. */
  changed: string[];
  /** Elements present in both and byte-identical after normalization. */
  unchangedCount: number;
}

/** Whole-model diff result. */
export interface IrDiff {
  /** True iff every section has empty added/removed/changed. */
  identical: boolean;
  /** Deterministic section order (DIFF_SECTIONS). */
  sections: IrDiffSection[];
}

/**
 * The canonical, deterministic section list: whole-value sections first in
 * IrModel declaration order (modelVersion, application, environment), then
 * the id-keyed sections in the work-item declaration order, then
 * constraints last (matching IrModel's declaration order).
 */
export const DIFF_SECTIONS = [
  'modelVersion',
  'application',
  'environment',
  'screens',
  'components',
  'state.variables',
  'state.transitions',
  'data.entities',
  'api.operations',
  'integrations',
  'assumptions',
  'journeys',
  'evidence',
  'constraints',
] as const;

const PROVENANCE_REFS = 'provenance.confidence.evidenceRefs';
const FIELD_PROVENANCE_REFS = 'fields.provenance.confidence.evidenceRefs';

/**
 * Per-section arrays with SET semantics (normalized by sorting before
 * comparison). Everything not listed here is order-sensitive.
 */
export const SET_SEMANTICS_PATHS: Readonly<Record<string, readonly string[]>> = {
  application: ['entrypoints'],
  screens: [PROVENANCE_REFS],
  components: [PROVENANCE_REFS, 'events'],
  'state.variables': [PROVENANCE_REFS],
  'state.transitions': [PROVENANCE_REFS, 'sideEffects'],
  'data.entities': ['persistence', 'fields', FIELD_PROVENANCE_REFS],
  'api.operations': [PROVENANCE_REFS, 'headersNeeded', 'observedExamples', 'externalSideEffects'],
  integrations: [PROVENANCE_REFS],
  assumptions: [PROVENANCE_REFS],
  journeys: [PROVENANCE_REFS, 'preconditions'],
  evidence: [],
  environment: [],
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function compareCanonical(a: unknown, b: unknown): number {
  const left = canonicalJson(a);
  const right = canonicalJson(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Recursively normalize `value` for diff comparison: sort the arrays at the
 * designated set-semantics key paths (dot-joined, array indices skipped —
 * so `fields.provenance.confidence.evidenceRefs` reaches refs inside each
 * field). Returns a structurally equal, order-canonicalized copy.
 */
function normalizeForDiff(value: unknown, keyPath: readonly string[], setPaths: ReadonlySet<string>): unknown {
  if (Array.isArray(value)) {
    const normalized = value.map((item) => normalizeForDiff(item, keyPath, setPaths));
    if (setPaths.has(keyPath.join('.'))) {
      return [...normalized].sort(compareCanonical);
    }
    return normalized;
  }
  if (isPlainRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = normalizeForDiff(value[key], [...keyPath, key], setPaths);
    }
    return out;
  }
  return value;
}

/** Canonical, order-canonicalized serialization of one element. */
function elementFingerprint(element: unknown, setPaths: ReadonlySet<string>): string {
  return canonicalJson(normalizeForDiff(element, [], setPaths));
}

/** Element identity: its id, or (for malformed elements) its full fingerprint. */
function elementIdentity(element: unknown, fingerprint: string): string {
  if (isPlainRecord(element) && typeof element['id'] === 'string' && element['id'] !== '') {
    return element['id'];
  }
  return `@${fingerprint}`;
}

function diffIdSection(
  section: string,
  aElements: readonly unknown[],
  bElements: readonly unknown[],
  setPaths: readonly string[],
): IrDiffSection {
  const paths = new Set<string>(setPaths);
  const aById = new Map<string, { fingerprint: string }>();
  for (const element of aElements) {
    const fingerprint = elementFingerprint(element, paths);
    aById.set(elementIdentity(element, fingerprint), { fingerprint });
  }
  const bById = new Map<string, { fingerprint: string }>();
  for (const element of bElements) {
    const fingerprint = elementFingerprint(element, paths);
    bById.set(elementIdentity(element, fingerprint), { fingerprint });
  }

  const added: string[] = [];
  for (const id of bById.keys()) {
    if (!aById.has(id)) added.push(id);
  }
  const removed: string[] = [];
  const changed: string[] = [];
  let unchangedCount = 0;
  for (const [id, aEntry] of aById) {
    const bEntry = bById.get(id);
    if (bEntry === undefined) {
      removed.push(id);
    } else if (aEntry.fingerprint !== bEntry.fingerprint) {
      changed.push(id);
    } else {
      unchangedCount += 1;
    }
  }
  return { section, added, removed, changed, unchangedCount };
}

function diffWholeValueSection(section: string, a: unknown, b: unknown, setPaths: readonly string[]): IrDiffSection {
  const paths = new Set<string>(setPaths);
  const same = canonicalJson(normalizeForDiff(a, [], paths)) === canonicalJson(normalizeForDiff(b, [], paths));
  return {
    section,
    added: [],
    removed: [],
    changed: same ? [] : [section],
    unchangedCount: same ? 1 : 0,
  };
}

function diffConstraintsSection(a: readonly string[], b: readonly string[]): IrDiffSection {
  const aSet = new Set(a);
  const bSet = new Set(b);
  const added: string[] = [];
  for (const constraint of bSet) {
    if (!aSet.has(constraint)) added.push(constraint);
  }
  const removed: string[] = [];
  let unchangedCount = 0;
  for (const constraint of aSet) {
    if (!bSet.has(constraint)) removed.push(constraint);
    else unchangedCount += 1;
  }
  return { section: 'constraints', added, removed, changed: [], unchangedCount };
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function nested(model: unknown, outer: string, inner: string): readonly unknown[] {
  if (!isPlainRecord(model)) return [];
  const container = model[outer];
  if (!isPlainRecord(container)) return [];
  return asArray(container[inner]);
}

/**
 * Diff two IR models. Section order is fixed (DIFF_SECTIONS); identity per
 * id-keyed section is the element id; whole-value sections compare their
 * entire (normalized) value; constraints diff as a string set. See the
 * module doc for the array-order semantics.
 */
export function diffIrModels(a: IrModel, b: IrModel): IrDiff {
  const aModel = a as unknown;
  const bModel = b as unknown;
  const get = (model: unknown, key: string): unknown =>
    isPlainRecord(model) ? model[key] : undefined;

  const sections: IrDiffSection[] = [
    diffWholeValueSection('modelVersion', get(aModel, 'modelVersion'), get(bModel, 'modelVersion'), []),
    diffWholeValueSection('application', get(aModel, 'application'), get(bModel, 'application'), SET_SEMANTICS_PATHS['application'] ?? []),
    diffWholeValueSection('environment', get(aModel, 'environment'), get(bModel, 'environment'), SET_SEMANTICS_PATHS['environment'] ?? []),
    diffIdSection('screens', asArray(get(aModel, 'screens')), asArray(get(bModel, 'screens')), SET_SEMANTICS_PATHS['screens'] ?? []),
    diffIdSection('components', asArray(get(aModel, 'components')), asArray(get(bModel, 'components')), SET_SEMANTICS_PATHS['components'] ?? []),
    diffIdSection('state.variables', nested(aModel, 'state', 'variables'), nested(bModel, 'state', 'variables'), SET_SEMANTICS_PATHS['state.variables'] ?? []),
    diffIdSection('state.transitions', nested(aModel, 'state', 'transitions'), nested(bModel, 'state', 'transitions'), SET_SEMANTICS_PATHS['state.transitions'] ?? []),
    diffIdSection('data.entities', nested(aModel, 'data', 'entities'), nested(bModel, 'data', 'entities'), SET_SEMANTICS_PATHS['data.entities'] ?? []),
    diffIdSection('api.operations', nested(aModel, 'api', 'operations'), nested(bModel, 'api', 'operations'), SET_SEMANTICS_PATHS['api.operations'] ?? []),
    diffIdSection('integrations', asArray(get(aModel, 'integrations')), asArray(get(bModel, 'integrations')), SET_SEMANTICS_PATHS['integrations'] ?? []),
    diffIdSection('assumptions', asArray(get(aModel, 'assumptions')), asArray(get(bModel, 'assumptions')), SET_SEMANTICS_PATHS['assumptions'] ?? []),
    diffIdSection('journeys', asArray(get(aModel, 'journeys')), asArray(get(bModel, 'journeys')), SET_SEMANTICS_PATHS['journeys'] ?? []),
    diffIdSection('evidence', asArray(get(aModel, 'evidence')), asArray(get(bModel, 'evidence')), SET_SEMANTICS_PATHS['evidence'] ?? []),
    diffConstraintsSection(asArray(get(aModel, 'constraints')) as string[], asArray(get(bModel, 'constraints')) as string[]),
  ];

  const identical = sections.every(
    (section) => section.added.length === 0 && section.removed.length === 0 && section.changed.length === 0,
  );
  return { identical, sections };
}
