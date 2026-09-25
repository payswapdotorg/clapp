/**
 * @clapp/extract — storage extractor: inventories → data entities + state
 * variables.
 *
 * Every storage KEY observed in a storage-inventory capture becomes ONE
 * IrDataEntity (name = the key, persistence like 'localStorage:<key>'),
 * with fields derived from the JSON-parsable value:
 *
 *   - JSON object → one IrDataField per top-level key (domain by typeof);
 *   - JSON scalar / array → a single 'value' field with the mapped domain;
 *   - non-JSON (truncated or redacted preview) → a 'value' field with
 *     domain 'unknown' + an assumption (fields stay honestly unknown);
 *
 * JSON SCALAR values additionally become IrStateVariables (name
 * '<area>:<key>' — a namespaced dotted-path form; domain mapped from the
 * scalar type; 'unknown' when the preview is not parsable). Repeated keys
 * across inventories are first-appearance-wins (observed facts are
 * immutable; a later inventory showing the same key does not rewrite the
 * first observation — keys that appear only later are emitted then).
 *
 * cookies → entities with persistence 'cookie:<name>' (values are
 * wholesale-redacted by the observe channel, so their value field is
 * 'unknown' + assumption — never an invented domain). indexedDB
 * databases → entities with persistence 'indexeddb:<name>' and one
 * 'unknown'-domain field per object store. serviceWorker registrations
 * and Cache Storage contents are NOT data entities in ir-contract v0.1
 * (no persistence slot models them) — documented in the README, not
 * silently dropped from the evidence: their captures stay in the catalog.
 *
 * Provenance: 'derived' from the inventory capture that first showed the
 * key (fields 0.7-0.8; variables 0.8; 'unavailable' 0.3 for unknown
 * domains).
 */

import type { EvidenceRef } from '@clapp/core';
import type { IrDataEntity, IrDataField, IrStateVariable } from './ir-contract';
import type { AssumptionCollector } from './assumptions';
import type { ConsumedCapture, StorageInventoryCapture } from './capture-reader';
import { newEntityId, newStateVariableId } from './ids';
import { sketchJsonText } from './schema-sketch';
import type { CookieInventoryEntry, IndexedDbInventoryEntry, StorageEntryPreview } from '@clapp/observe';

export interface StorageExtraction {
  entities: IrDataEntity[];
  stateVariables: IrStateVariable[];
  warnings: string[];
}

const SCALAR_DOMAINS: Record<string, string> = {
  string: 'text',
  number: 'count',
  boolean: 'boolean',
};

/** Maps a coarse JSON type to the ir-contract domain vocabulary. */
function jsonDomain(coarseType: string): string {
  if (SCALAR_DOMAINS[coarseType] !== undefined) return SCALAR_DOMAINS[coarseType]!;
  return coarseType === 'null' ? 'unknown' : 'json';
}

function fieldProvenance(ref: EvidenceRef, level: 'derived' | 'unavailable', value: number, rationale: string): IrDataField['provenance'] {
  return {
    level,
    confidence: {
      value,
      rationale,
      evidenceRefs: [{ ...ref }],
    },
  };
}

export function extractStorage(
  captures: readonly ConsumedCapture[],
  collector: AssumptionCollector,
): StorageExtraction {
  const warnings: string[] = [];
  const entities: IrDataEntity[] = [];
  const stateVariables: IrStateVariable[] = [];
  const entitiesByPersistence = new Map<string, IrDataEntity>();
  const variablesByName = new Map<string, IrStateVariable>();

  const inventories = captures.filter((capture): capture is StorageInventoryCapture => capture.kind === 'storage');
  for (const inventory of inventories) {
    const ref = inventory.ref;

    const entry = (area: string, item: StorageEntryPreview): void => {
      if (typeof item?.key !== 'string' || item.key === '') {
        warnings.push(`storage inventory ${ref.evidenceId} contains a malformed ${area} entry — skipped`);
        return;
      }
      const persistence = `${area}:${item.key}`;
      if (entitiesByPersistence.has(persistence)) return; // first appearance wins
      const fields: IrDataField[] = [];
      let scalarDomain: string | undefined;
      let scalarLevel: 'derived' | 'unavailable' = 'derived';
      let scalarConfidence = 0.8;

      const outcome = sketchJsonText(item.valuePreview);
      if (outcome.ok && outcome.sketch.type === 'object' && outcome.sketch.keys !== undefined) {
        for (const key of outcome.sketch.keys) {
          const domain = jsonDomain(outcome.sketch.valueTypes?.[key] ?? 'unknown');
          fields.push({
            name: key,
            domain,
            provenance: fieldProvenance(ref, 'derived', 0.7, `field name and domain derived from the JSON-parsable ${area} value`),
          });
        }
      } else if (outcome.ok) {
        scalarDomain = jsonDomain(outcome.sketch.type);
        fields.push({
          name: 'value',
          domain: scalarDomain,
          provenance: fieldProvenance(ref, 'derived', 0.8, `value domain derived from the JSON-parsable ${area} value`),
        });
      } else {
        const reason = outcome.reason === 'truncated' ? 'truncated' : outcome.reason === 'empty' ? 'empty' : 'not JSON-parsable (truncated or redacted preview)';
        collector.note(`the ${persistence} value is ${reason}, so its fields stay unknown`, {
          confidence: 0.3,
          evidenceRefs: [ref],
        });
        scalarDomain = 'unknown';
        scalarLevel = 'unavailable';
        scalarConfidence = 0.3;
        fields.push({
          name: 'value',
          domain: 'unknown',
          provenance: fieldProvenance(ref, 'unavailable', 0.3, `the ${area} value preview is not parsable, so the value field's domain is unknown`),
        });
      }

      const entity: IrDataEntity = {
        id: newEntityId(),
        name: item.key,
        fields,
        persistence: [persistence],
      };
      entitiesByPersistence.set(persistence, entity);
      entities.push(entity);

      // IrStateVariable entries for scalar values (work item). Object values
      // are modeled by their entity fields instead; non-JSON previews become
      // 'unknown'-domain variables (the key was observed, the type was not).
      if (scalarDomain !== undefined) {
        const variableName = persistence;
        if (!variablesByName.has(variableName)) {
          const variable: IrStateVariable = {
            id: newStateVariableId(),
            name: variableName,
            domain: scalarDomain,
            provenance: {
              level: scalarLevel,
              confidence: {
                value: scalarConfidence,
                rationale: scalarLevel === 'derived'
                  ? `name and domain derived deterministically from a storage inventory capture (${area})`
                  : `the ${area} value preview is not parsable, so only the variable's existence is derivable`,
                evidenceRefs: [{ ...ref }],
              },
            },
          };
          variablesByName.set(variableName, variable);
          stateVariables.push(variable);
        }
      }
    };

    for (const item of inventory.payload.localStorage) {
      entry('localStorage', item);
    }
    for (const item of inventory.payload.sessionStorage) {
      entry('sessionStorage', item);
    }
    for (const cookie of inventory.payload.cookies) {
      cookieEntity(cookie, ref, collector, entitiesByPersistence, entities, warnings);
    }
    for (const database of inventory.payload.indexedDB) {
      indexedDbEntity(database, ref, entitiesByPersistence, entities, warnings);
    }
  }

  return { entities, stateVariables, warnings };
}

function cookieEntity(
  cookie: CookieInventoryEntry,
  ref: EvidenceRef,
  collector: AssumptionCollector,
  entitiesByPersistence: Map<string, IrDataEntity>,
  entities: IrDataEntity[],
  warnings: string[],
): void {
  if (typeof cookie?.name !== 'string' || cookie.name === '') {
    warnings.push(`storage inventory ${ref.evidenceId} contains a malformed cookie entry — skipped`);
    return;
  }
  const persistence = `cookie:${cookie.name}`;
  if (entitiesByPersistence.has(persistence)) return;
  const outcome = sketchJsonText(typeof cookie.value === 'string' ? cookie.value : undefined);
  let domain: string;
  let level: 'derived' | 'unavailable';
  let confidence: number;
  if (outcome.ok && outcome.sketch.type !== 'object') {
    domain = SCALAR_DOMAINS[outcome.sketch.type] ?? 'json';
    level = 'derived';
    confidence = 0.8;
  } else {
    // The observe channel wholesale-replaces cookie values per policy, so
    // the honest domain is 'unknown' plus an assumption.
    collector.note(`the ${persistence} value is redacted or not JSON-parsable, so its fields stay unknown`, {
      confidence: 0.3,
      evidenceRefs: [ref],
    });
    domain = 'unknown';
    level = 'unavailable';
    confidence = 0.3;
  }
  const entity: IrDataEntity = {
    id: newEntityId(),
    name: cookie.name,
    fields: [
      {
        name: 'value',
        domain,
        provenance: fieldProvenance(ref, level, confidence, level === 'derived' ? 'value domain derived from the JSON-parsable cookie value' : 'the cookie value is redacted or unparsable, so the value field domain is unknown'),
      },
    ],
    persistence: [persistence],
  };
  entitiesByPersistence.set(persistence, entity);
  entities.push(entity);
}

function indexedDbEntity(
  database: IndexedDbInventoryEntry,
  ref: EvidenceRef,
  entitiesByPersistence: Map<string, IrDataEntity>,
  entities: IrDataEntity[],
  warnings: string[],
): void {
  if (typeof database?.name !== 'string' || database.name === '') {
    warnings.push(`storage inventory ${ref.evidenceId} contains a malformed indexedDB entry — skipped`);
    return;
  }
  const persistence = `indexeddb:${database.name}`;
  if (entitiesByPersistence.has(persistence)) return;
  const fields: IrDataField[] = (Array.isArray(database.objectStores) ? database.objectStores : [])
    .filter((store): store is string => typeof store === 'string' && store !== '')
    .map((store) => ({
      name: store,
      domain: 'unknown', // store record shape is not observable from the inventory
      provenance: fieldProvenance(ref, 'unavailable', 0.3, 'the object store name is observed but its record shape is not'),
    }));
  if (typeof database.version === 'number') {
    fields.push({
      name: 'version',
      domain: 'count',
      provenance: fieldProvenance(ref, 'derived', 0.8, 'database version observed in the storage inventory'),
    });
  }
  const entity: IrDataEntity = {
    id: newEntityId(),
    name: database.name,
    fields,
    persistence: [persistence],
  };
  entitiesByPersistence.set(persistence, entity);
  entities.push(entity);
}
