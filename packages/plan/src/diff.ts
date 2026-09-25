/**
 * @clapp/plan — id-stable diff between two Synthesis Plans.
 *
 * Same discipline as @clapp/ir's diffIrModels: identity per section is the
 * ELEMENT ID; an element present in both plans is `changed` iff its canonical
 * serialization differs, `unchanged` otherwise — position in the section
 * array is irrelevant, so REORDERING A SECTION ARRAY IS NOT A CHANGE.
 *
 * Sections (fixed order, PLAN_DIFF_SECTIONS):
 * - whole-value sections first: `planVersion`, `application`, `server`
 *   (changed carries the section name as the pseudo-id);
 * - the nine id-keyed sections in contract declaration order:
 *   `routes`, `pages`, `elements`, `forms`, `navigation`, `storage`,
 *   `api.endpoints`, `api.mocks`, `acceptance`;
 * - the string-set sections last: `assumptions`, `constraints` (added/removed
 *   as string sets — duplicates collapse, order is not semantic).
 *
 * Elements and forms are keyed by their plan-global ids (pages nest them, so
 * the sections are flattened for comparison). SET_SEMANTICS_PATHS is NOT
 * needed here (unlike the IR): every keyed section compares whole canonical
 * elements, and array order INSIDE an element (document order, journey step
 * order) is semantic in the plan by design.
 *
 * Honest scope notes:
 * - `diffSynthesisPlans` TRUSTS its typed inputs; it does not validate them.
 *   Run `validateSynthesisPlanDetailed` first when comparing untrusted JSON.
 * - Malformed elements (no usable string id) are identified by their full
 *   canonical content instead of being dropped, so nothing silently
 *   vanishes from a diff.
 * - `unchangedCount` counts elements present in both plans with identical
 *   canonical serialization; `identical` is true iff every section reports
 *   empty added/removed/changed.
 */

import { canonicalJson } from '@clapp/ir';
import type { SynthesisPlan } from './synthesis-contract';

/** One section's diff: element ids (or the section name / string entries). */
export interface PlanDiffSection {
  section: string;
  /** Ids present only in `b`. */
  added: string[];
  /** Ids present only in `a`. */
  removed: string[];
  /** Ids present in both but with different canonical serialization. */
  changed: string[];
  /** Elements present in both and byte-identical. */
  unchangedCount: number;
}

/** Whole-plan diff result. */
export interface PlanDiff {
  /** True iff every section has empty added/removed/changed. */
  identical: boolean;
  /** Deterministic section order (PLAN_DIFF_SECTIONS). */
  sections: PlanDiffSection[];
}

/** The canonical, deterministic section list (see module doc). */
export const PLAN_DIFF_SECTIONS = [
  'planVersion',
  'application',
  'server',
  'routes',
  'pages',
  'elements',
  'forms',
  'navigation',
  'storage',
  'api.endpoints',
  'api.mocks',
  'acceptance',
  'assumptions',
  'constraints',
] as const;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Element identity: its id, or (for malformed elements) its full canonical form. */
function elementIdentity(element: unknown): string {
  if (isPlainRecord(element) && typeof element['id'] === 'string' && element['id'] !== '') {
    return element['id'];
  }
  return `@${canonicalJson(element)}`;
}

function diffIdSection(section: string, aElements: readonly unknown[], bElements: readonly unknown[]): PlanDiffSection {
  const aById = new Map<string, string>();
  for (const element of aElements) {
    aById.set(elementIdentity(element), canonicalJson(element));
  }
  const bById = new Map<string, string>();
  for (const element of bElements) {
    bById.set(elementIdentity(element), canonicalJson(element));
  }

  const added: string[] = [];
  for (const id of bById.keys()) {
    if (!aById.has(id)) added.push(id);
  }
  const removed: string[] = [];
  const changed: string[] = [];
  let unchangedCount = 0;
  for (const [id, aCanonical] of aById) {
    const bCanonical = bById.get(id);
    if (bCanonical === undefined) {
      removed.push(id);
    } else if (aCanonical !== bCanonical) {
      changed.push(id);
    } else {
      unchangedCount += 1;
    }
  }
  return { section, added, removed, changed, unchangedCount };
}

function diffWholeValueSection(section: string, a: unknown, b: unknown): PlanDiffSection {
  const same = canonicalJson(a) === canonicalJson(b);
  return {
    section,
    added: [],
    removed: [],
    changed: same ? [] : [section],
    unchangedCount: same ? 1 : 0,
  };
}

function diffStringSetSection(section: string, a: readonly string[], b: readonly string[]): PlanDiffSection {
  const aSet = new Set(a);
  const bSet = new Set(b);
  const added: string[] = [];
  for (const entry of bSet) {
    if (!aSet.has(entry)) added.push(entry);
  }
  const removed: string[] = [];
  let unchangedCount = 0;
  for (const entry of aSet) {
    if (!bSet.has(entry)) removed.push(entry);
    else unchangedCount += 1;
  }
  return { section, added, removed, changed: [], unchangedCount };
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function flattenPages(plan: unknown, field: 'elements' | 'forms'): readonly unknown[] {
  if (!isPlainRecord(plan)) return [];
  const out: unknown[] = [];
  for (const page of asArray(plan['pages'])) {
    if (isPlainRecord(page)) out.push(...asArray(page[field]));
  }
  return out;
}

function nested(plan: unknown, outer: string, inner: string): readonly unknown[] {
  if (!isPlainRecord(plan)) return [];
  const container = plan[outer];
  if (!isPlainRecord(container)) return [];
  return asArray(container[inner]);
}

/**
 * Diff two Synthesis Plans. Section order is fixed (PLAN_DIFF_SECTIONS);
 * identity per id-keyed section is the element id; whole-value sections
 * compare their entire value; assumptions/constraints diff as string sets.
 * See the module doc for the exact semantics.
 */
export function diffSynthesisPlans(a: SynthesisPlan, b: SynthesisPlan): PlanDiff {
  const aPlan = a as unknown;
  const bPlan = b as unknown;
  const get = (plan: unknown, key: string): unknown => (isPlainRecord(plan) ? plan[key] : undefined);

  const sections: PlanDiffSection[] = [
    diffWholeValueSection('planVersion', get(aPlan, 'planVersion'), get(bPlan, 'planVersion')),
    diffWholeValueSection('application', get(aPlan, 'application'), get(bPlan, 'application')),
    diffWholeValueSection('server', get(aPlan, 'server'), get(bPlan, 'server')),
    diffIdSection('routes', asArray(get(aPlan, 'routes')), asArray(get(bPlan, 'routes'))),
    diffIdSection('pages', asArray(get(aPlan, 'pages')), asArray(get(bPlan, 'pages'))),
    diffIdSection('elements', flattenPages(aPlan, 'elements'), flattenPages(bPlan, 'elements')),
    diffIdSection('forms', flattenPages(aPlan, 'forms'), flattenPages(bPlan, 'forms')),
    diffIdSection('navigation', asArray(get(aPlan, 'navigation')), asArray(get(bPlan, 'navigation'))),
    diffIdSection('storage', asArray(get(aPlan, 'storage')), asArray(get(bPlan, 'storage'))),
    diffIdSection('api.endpoints', nested(aPlan, 'api', 'endpoints'), nested(bPlan, 'api', 'endpoints')),
    diffIdSection('api.mocks', nested(aPlan, 'api', 'mocks'), nested(bPlan, 'api', 'mocks')),
    diffIdSection('acceptance', asArray(get(aPlan, 'acceptance')), asArray(get(bPlan, 'acceptance'))),
    diffStringSetSection('assumptions', asArray(get(aPlan, 'assumptions')) as string[], asArray(get(bPlan, 'assumptions')) as string[]),
    diffStringSetSection('constraints', asArray(get(aPlan, 'constraints')) as string[], asArray(get(bPlan, 'constraints')) as string[]),
  ];

  const identical = sections.every(
    (section) => section.added.length === 0 && section.removed.length === 0 && section.changed.length === 0,
  );
  return { identical, sections };
}
