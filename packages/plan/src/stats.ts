/**
 * @clapp/plan — section statistics for a Synthesis Plan (reports, completion
 * summaries, quick sanity checks).
 *
 * `planStats` is mechanical and defensive (the same discipline as
 * @clapp/ir's irModelStats): it counts what is actually present (non-arrays
 * are counted as 0 rather than throwing) and derives three breakdowns:
 *
 * - `elementsByKind` — element counts per contract kind (total over the
 *   closed kind vocabulary, zeros included, keys sorted);
 * - `provenanceByLevel` — counts of every provenance block by level (routes,
 *   pages, elements, forms, navigation, storage, endpoints, acceptance —
 *   total over the closed PlanProvenance vocabulary);
 * - `evidenceRefCitations` / `uniqueEvidenceRefs` — how many EvidenceRefs
 *   the plan cites in total and how many distinct evidenceIds that covers
 *   (the plan has no evidence catalog; uniqueness is by evidenceId).
 *
 * It does NOT validate; run `validateSynthesisPlanDetailed` first for
 * untrusted input.
 */

import type { PlanProvenanceLevel, SynthesisPlan } from './synthesis-contract';
import { PLAN_VERSION } from './synthesis-contract';

/** Section counts + derived breakdowns for one Synthesis Plan. */
export interface PlanStats {
  planVersion: string;
  routes: number;
  pages: number;
  elements: number;
  /** Element count per contract kind (closed vocabulary, zeros included). */
  elementsByKind: Record<string, number>;
  forms: number;
  fields: number;
  /** PlannedTransition count (the navigation graph). */
  transitions: number;
  storageBindings: number;
  endpoints: number;
  mocks: number;
  acceptance: number;
  assumptions: number;
  constraints: number;
  /** Provenance block count per level (closed vocabulary, zeros included). */
  provenanceByLevel: Record<PlanProvenanceLevel, number>;
  /** Total EvidenceRef occurrences across every provenance block. */
  evidenceRefCitations: number;
  /** Distinct evidenceIds among the cited refs. */
  uniqueEvidenceRefs: number;
}

const ELEMENT_KINDS: readonly string[] = ['heading', 'text', 'link', 'button', 'image', 'navigation', 'form', 'list', 'other'];
const PROVENANCE_LEVELS: readonly PlanProvenanceLevel[] = ['derived', 'planned', 'assumed'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Complete vocabulary-keyed record (zeros included), keys sorted. */
function vocabularyRecord(vocabulary: readonly string[], counts: Map<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of [...vocabulary, ...counts.keys()].sort()) {
    out[key] = counts.get(key) ?? 0;
  }
  return out;
}

function bump(counts: Map<string, number>, key: unknown): void {
  if (typeof key === 'string') counts.set(key, (counts.get(key) ?? 0) + 1);
}

function provenanceLevelOf(element: unknown): string | null {
  if (!isRecord(element)) return null;
  const provenance: unknown = element['provenance'];
  if (!isRecord(provenance)) return null;
  const level: unknown = provenance['level'];
  return typeof level === 'string' ? level : null;
}

/** Compute section statistics for `plan` (mechanical, never throws). */
export function planStats(plan: SynthesisPlan): PlanStats {
  const root: unknown = plan;
  const get = (key: string): unknown => (isRecord(root) ? root[key] : undefined);
  const nested = (outer: string, inner: string): unknown[] => {
    if (!isRecord(root)) return [];
    const container: unknown = root[outer];
    if (!isRecord(container)) return [];
    return asArray(container[inner]);
  };

  const routes = asArray(get('routes'));
  const pages = asArray(get('pages'));
  const navigation = asArray(get('navigation'));
  const storage = asArray(get('storage'));
  const endpoints = nested('api', 'endpoints');
  const mocks = nested('api', 'mocks');
  const acceptance = asArray(get('acceptance'));
  const assumptions = asArray(get('assumptions'));
  const constraints = asArray(get('constraints'));

  const elements: unknown[] = [];
  const forms: unknown[] = [];
  for (const page of pages) {
    if (!isRecord(page)) continue;
    elements.push(...asArray(page['elements']));
    forms.push(...asArray(page['forms']));
  }

  let fields = 0;
  for (const form of forms) {
    if (isRecord(form)) fields += asArray(form['fields']).length;
  }

  const kinds = new Map<string, number>();
  for (const element of elements) {
    if (isRecord(element)) bump(kinds, element['kind']);
  }

  const levels = new Map<string, number>();
  const levelCarriers: unknown[][] = [routes, pages, elements, forms, navigation, storage, endpoints, acceptance];
  for (const carriers of levelCarriers) {
    for (const element of carriers) {
      bump(levels, provenanceLevelOf(element));
    }
  }

  let evidenceRefCitations = 0;
  const uniqueEvidenceIds = new Set<string>();
  const collectRefs = (element: unknown): void => {
    if (!isRecord(element)) return;
    const provenance: unknown = element['provenance'];
    if (!isRecord(provenance)) return;
    for (const ref of asArray(provenance['evidenceRefs'])) {
      evidenceRefCitations += 1;
      if (isRecord(ref) && typeof ref['evidenceId'] === 'string') uniqueEvidenceIds.add(ref['evidenceId']);
    }
  };
  for (const carriers of levelCarriers) {
    for (const element of carriers) collectRefs(element);
  }

  const planVersion: unknown = get('planVersion');

  return {
    planVersion: typeof planVersion === 'string' ? planVersion : PLAN_VERSION,
    routes: routes.length,
    pages: pages.length,
    elements: elements.length,
    elementsByKind: vocabularyRecord(ELEMENT_KINDS, kinds),
    forms: forms.length,
    fields,
    transitions: navigation.length,
    storageBindings: storage.length,
    endpoints: endpoints.length,
    mocks: mocks.length,
    acceptance: acceptance.length,
    assumptions: assumptions.length,
    constraints: constraints.length,
    provenanceByLevel: vocabularyRecord(PROVENANCE_LEVELS, levels) as Record<PlanProvenanceLevel, number>,
    evidenceRefCitations,
    uniqueEvidenceRefs: uniqueEvidenceIds.size,
  };
}
