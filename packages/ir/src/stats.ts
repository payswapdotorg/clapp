/**
 * @clapp/ir — section statistics for an IR model (reports, completion
 * summaries, quick sanity checks).
 *
 * `irModelStats` is mechanical and defensive: it counts what is actually
 * present (non-arrays are counted as 0 rather than throwing) and derives
 * three breakdowns that reports have repeatedly needed:
 *
 * - `componentsByRole` — component counts per semantic role;
 * - `provenanceByLevel` — counts of every Provenance block in the model by
 *   EvidenceLevel (journeys, screens, components, state variables,
 *   transitions, data fields, api operations, integrations, assumptions —
 *   exactly the elements the contract gives a provenance block);
 * - `evidenceByKind` — evidence catalog entries by EvidenceKind.
 *
 * It does NOT validate; run `validateIrModelDetailed` first for untrusted
 * input. Record keys are sorted in the output so canonical serialization
 * of the stats object is deterministic.
 */

import type { EvidenceKind } from '@clapp/core';
import { EVIDENCE_KINDS } from '@clapp/core';
import type { EvidenceLevel, IrModel } from './ir-contract';
import { IR_MODEL_VERSION } from './ir-contract';

/** Section counts + derived breakdowns for one IR model. */
export interface IrModelStats {
  modelVersion: string;
  screens: number;
  components: number;
  stateVariables: number;
  transitions: number;
  dataEntities: number;
  dataFields: number;
  apiOperations: number;
  integrations: number;
  assumptions: number;
  journeys: number;
  evidenceEntries: number;
  constraints: number;
  /** Component count per role (sorted keys). */
  componentsByRole: Record<string, number>;
  /** Provenance block count per EvidenceLevel (sorted keys). */
  provenanceByLevel: Record<EvidenceLevel, number>;
  /** Evidence catalog entries per EvidenceKind (sorted keys). */
  evidenceByKind: Record<EvidenceKind, number>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Every declared EvidenceLevel, at 0 — the breakdown is total over the vocabulary. */
const EVIDENCE_LEVELS: readonly EvidenceLevel[] = ['observed', 'derived', 'inferred', 'assumed', 'unavailable'];

/** Sorted, zeros-free record over the keys actually observed (open vocabularies). */
function sortedRecord(counts: Map<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of [...counts.keys()].sort()) {
    out[key] = counts.get(key) ?? 0;
  }
  return out;
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

/** Compute section statistics for `model` (mechanical, never throws). */
export function irModelStats(model: IrModel): IrModelStats {
  const root: unknown = model;
  const get = (key: string): unknown => (isRecord(root) ? root[key] : undefined);
  const nested = (outer: string, inner: string): unknown[] => {
    if (!isRecord(root)) return [];
    const container: unknown = root[outer];
    if (!isRecord(container)) return [];
    return asArray(container[inner]);
  };

  const screens = asArray(get('screens'));
  const components = asArray(get('components'));
  const variables = nested('state', 'variables');
  const transitions = nested('state', 'transitions');
  const entities = nested('data', 'entities');
  const operations = nested('api', 'operations');
  const integrations = asArray(get('integrations'));
  const assumptions = asArray(get('assumptions'));
  const journeys = asArray(get('journeys'));
  const evidence = asArray(get('evidence'));
  const constraints = asArray(get('constraints'));

  const roles = new Map<string, number>();
  for (const component of components) {
    if (isRecord(component)) bump(roles, component['role']);
  }

  const levels = new Map<string, number>();
  for (const level of EVIDENCE_LEVELS) levels.set(level, 0);
  const levelCarriers: unknown[][] = [
    journeys,
    screens,
    components,
    variables,
    transitions,
    operations,
    integrations,
    assumptions,
  ];
  let dataFields = 0;
  for (const entity of entities) {
    if (!isRecord(entity)) continue;
    const fields = asArray(entity['fields']);
    dataFields += fields.length;
    for (const field of fields) {
      bump(levels, provenanceLevelOf(field));
    }
  }
  for (const carriers of levelCarriers) {
    for (const element of carriers) {
      bump(levels, provenanceLevelOf(element));
    }
  }

  const kinds = new Map<string, number>();
  for (const kind of EVIDENCE_KINDS) kinds.set(kind, 0);
  for (const entry of evidence) {
    if (!isRecord(entry)) continue;
    const ref: unknown = entry['ref'];
    if (isRecord(ref)) bump(kinds, ref['kind']);
  }

  const modelVersion: unknown = get('modelVersion');

  return {
    modelVersion: typeof modelVersion === 'string' ? modelVersion : IR_MODEL_VERSION,
    screens: screens.length,
    components: components.length,
    stateVariables: variables.length,
    transitions: transitions.length,
    dataEntities: entities.length,
    dataFields,
    apiOperations: operations.length,
    integrations: integrations.length,
    assumptions: assumptions.length,
    journeys: journeys.length,
    evidenceEntries: evidence.length,
    constraints: constraints.length,
    componentsByRole: sortedRecord(roles),
    provenanceByLevel: vocabularyRecord(EVIDENCE_LEVELS, levels) as Record<EvidenceLevel, number>,
    evidenceByKind: vocabularyRecord(EVIDENCE_KINDS, kinds) as Record<EvidenceKind, number>,
  };
}
