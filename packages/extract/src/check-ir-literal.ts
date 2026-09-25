/**
 * @clapp/extract — internal structural self-check (NOT exported from the
 * package index; imported by the colocated test battery and run inside
 * extractIrModel as a bug guard).
 *
 * Checks the invariants of the mirrored ir-contract for the subset this
 * package emits — plus this package's own emission policies where they are
 * STRICTER than the contract:
 *
 *   - ids unique per collection and correctly prefixed (app_, irev_,
 *     screen_, comp_, var_, trans_, ent_, op_, assume_);
 *   - provenance blocks present and well-formed everywhere the contract
 *     requires them; confidence in [0,1] with a non-empty rationale;
 *     empty evidenceRefs are legal ONLY for 'assumed' (contract note);
 *   - assumptions (this package's policy): level 'assumed' and confidence
 *     <= 0.5;
 *   - referential integrity: every EvidenceRef cited anywhere in the model
 *     (provenance blocks, observedExamples, treeRef, visualRef) resolves
 *     against the model's evidence catalog AND — when the manifest is
 *     given — against the sealed bundle's manifest.evidence list;
 *   - components belong to existing screens; transitions run between
 *     existing screens; api operations carry at least one observed
 *     example; replayability/trigger shapes conform to the unions;
 *   - the whole model is JSON-serializable and round-trip stable
 *     (design principle 7), and contains NO null anywhere (contract
 *     mapping note: optional fields stay ABSENT, never null).
 *
 * checkIrLiteral returns violation strings (empty = clean);
 * collectCitedEvidenceRefs is reused by extraction.ts for the
 * evidenceCited stat.
 */

import { isDeepStrictEqual } from 'node:util';
import { EVIDENCE_KINDS } from '@clapp/core';
import type { EvidenceRef } from '@clapp/core';
import type {
  IrAssumption,
  IrComponent,
  IrDataEntity,
  IrEvidenceEntry,
  IrIntegration,
  IrJourney,
  IrModel,
  IrApiOperation,
  IrScreen,
  IrStateVariable,
  IrTransition,
  Provenance,
} from './ir-contract';
import { IR_MODEL_VERSION } from './ir-contract';

const EVIDENCE_LEVELS = new Set(['observed', 'derived', 'inferred', 'assumed', 'unavailable']);
const REPLAYABILITY = new Set(['replayable', 'needs-auth', 'side-effects', 'unreproducible']);
const INTEGRATION_STATUSES = new Set(['observed', 'inferred', 'mocked', 'unreproducible']);
const SHA256_HEX = /^[0-9a-f]{64}$/;

interface CheckContext {
  violations: string[];
  catalog: Map<string, EvidenceRef>; // evidenceId → canonical ref
  manifest: Map<string, EvidenceRef>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEvidenceRef(value: unknown): value is EvidenceRef {
  return (
    isPlainObject(value) &&
    typeof value.evidenceId === 'string' &&
    value.evidenceId !== '' &&
    typeof value.kind === 'string' &&
    (EVIDENCE_KINDS as readonly string[]).includes(value.kind) &&
    typeof value.sha256 === 'string' &&
    SHA256_HEX.test(value.sha256)
  );
}

function refKey(ref: EvidenceRef): string {
  return `${ref.evidenceId}|${ref.kind}|${ref.sha256}`;
}

function checkNoNull(value: unknown, path: string, violations: string[]): void {
  if (value === null) {
    violations.push(`${path}: null is not allowed anywhere in the model (optional fields stay ABSENT, never null)`);
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      checkNoNull(value[i], `${path}[${i}]`, violations);
    }
    return;
  }
  if (isPlainObject(value)) {
    for (const key of Object.keys(value)) {
      checkNoNull(value[key], `${path}.${key}`, violations);
    }
  }
}

function checkRefResolves(ref: unknown, path: string, ctx: CheckContext): void {
  if (!isEvidenceRef(ref)) {
    ctx.violations.push(`${path}: not a well-formed EvidenceRef (evidenceId/kind/sha256): ${JSON.stringify(ref)}`);
    return;
  }
  const catalogRef = ctx.catalog.get(ref.evidenceId);
  if (catalogRef === undefined) {
    ctx.violations.push(`${path}: cited ref ${ref.evidenceId} does not resolve in the model's evidence catalog`);
    return;
  }
  if (refKey(catalogRef) !== refKey(ref)) {
    ctx.violations.push(`${path}: cited ref ${ref.evidenceId} differs from its catalog entry`);
  }
  const manifestRef = ctx.manifest.get(ref.evidenceId);
  if (manifestRef !== undefined && refKey(manifestRef) !== refKey(ref)) {
    ctx.violations.push(`${path}: cited ref ${ref.evidenceId} differs from the bundle manifest entry`);
  }
}

function checkProvenance(path: string, provenance: Provenance | undefined, ctx: CheckContext): void {
  if (provenance === undefined) {
    ctx.violations.push(`${path}: provenance block is missing`);
    return;
  }
  if (!EVIDENCE_LEVELS.has(provenance.level)) {
    ctx.violations.push(`${path}.provenance.level '${provenance.level}' is outside the EvidenceLevel vocabulary`);
  }
  const confidence = provenance.confidence;
  if (!isPlainObject(confidence)) {
    ctx.violations.push(`${path}.provenance.confidence is not an object`);
    return;
  }
  if (typeof confidence.value !== 'number' || !Number.isFinite(confidence.value) || confidence.value < 0 || confidence.value > 1) {
    ctx.violations.push(`${path}.provenance.confidence.value must be a number in [0,1], observed ${JSON.stringify(confidence.value)}`);
  }
  if (typeof confidence.rationale !== 'string' || confidence.rationale === '') {
    ctx.violations.push(`${path}.provenance.confidence.rationale must be a non-empty string`);
  }
  if (!Array.isArray(confidence.evidenceRefs)) {
    ctx.violations.push(`${path}.provenance.confidence.evidenceRefs must be an array`);
    return;
  }
  confidence.evidenceRefs.forEach((ref, i) => {
    checkRefResolves(ref, `${path}.provenance.confidence.evidenceRefs[${i}]`, ctx);
  });
  if (provenance.level !== 'assumed' && confidence.evidenceRefs.length === 0) {
    ctx.violations.push(`${path}: level '${provenance.level}' requires at least one evidenceRef (empty is legal only for 'assumed')`);
  }
}

function checkId(id: string, prefix: string, path: string, seen: Set<string>, ctx: CheckContext): void {
  if (typeof id !== 'string' || !id.startsWith(`${prefix}_`)) {
    ctx.violations.push(`${path}.id must be "${prefix}_"-prefixed, observed ${JSON.stringify(id)}`);
    return;
  }
  if (seen.has(id)) {
    ctx.violations.push(`${path}.id ${id} is duplicated`);
  }
  seen.add(id);
}

function checkStringArray(value: unknown, path: string, ctx: CheckContext): void {
  if (!Array.isArray(value)) {
    ctx.violations.push(`${path} must be an array of strings`);
    return;
  }
  for (let i = 0; i < value.length; i++) {
    if (typeof value[i] !== 'string') {
      ctx.violations.push(`${path}[${i}] must be a string`);
    }
  }
}

/**
 * Structural self-check of an emitted model against the mirrored contract.
 * `manifestEvidence` (optional) cross-checks that every cited ref matches
 * the sealed bundle's evidence list byte-for-byte.
 */
export function checkIrLiteral(model: IrModel, manifestEvidence: readonly EvidenceRef[]): string[] {
  const ctx: CheckContext = {
    violations: [],
    catalog: new Map(),
    manifest: new Map(),
  };

  // ---- top level ----
  if (!isPlainObject(model)) {
    return ['model: not an object'];
  }
  if (model.modelVersion !== IR_MODEL_VERSION) {
    ctx.violations.push(`model.modelVersion must equal IR_MODEL_VERSION ('${IR_MODEL_VERSION}'), observed ${JSON.stringify(model.modelVersion)}`);
  }

  // ---- application ----
  const app = model.application;
  if (!isPlainObject(app)) {
    ctx.violations.push('model.application: not an object');
  } else {
    checkId(app.id, 'app', 'model.application', new Set(), ctx);
    if (typeof app.name !== 'string' || app.name === '') {
      ctx.violations.push('model.application.name must be a non-empty string');
    }
    if (typeof app.platform !== 'string' || app.platform === '') {
      ctx.violations.push('model.application.platform must be a non-empty string');
    }
    checkStringArray(app.entrypoints, 'model.application.entrypoints', ctx);
  }

  // ---- environment ----
  const environment = model.environment;
  if (!isPlainObject(environment)) {
    ctx.violations.push('model.environment: not an object');
  } else {
    for (const key of ['browser', 'os', 'locale', 'timezone', 'network']) {
      const value = environment[key];
      if (value !== undefined && typeof value !== 'string') {
        ctx.violations.push(`model.environment.${key} must be a string when present`);
      }
    }
    const viewport = environment.viewport;
    if (viewport !== undefined) {
      if (!isPlainObject(viewport) || typeof viewport.width !== 'number' || typeof viewport.height !== 'number') {
        ctx.violations.push('model.environment.viewport must be { width: number, height: number }');
      }
    }
  }

  // ---- evidence catalog ----
  if (!Array.isArray(model.evidence)) {
    ctx.violations.push('model.evidence: not an array');
  } else {
    const seen = new Set<string>();
    model.evidence.forEach((entry: IrEvidenceEntry, i) => {
      const path = `model.evidence[${i}]`;
      checkId(entry.id, 'irev', path, seen, ctx);
      if (typeof entry.source !== 'string' || entry.source === '') {
        ctx.violations.push(`${path}.source must be a non-empty string`);
      }
      if (!isEvidenceRef(entry.ref)) {
        ctx.violations.push(`${path}.ref: not a well-formed EvidenceRef (evidenceId/kind/sha256): ${JSON.stringify(entry.ref)}`);
        return;
      }
      if (ctx.catalog.has(entry.ref.evidenceId)) {
        ctx.violations.push(`${path}: evidenceId ${entry.ref.evidenceId} appears twice in the catalog`);
      }
      ctx.catalog.set(entry.ref.evidenceId, entry.ref);
    });
  }
  for (const ref of manifestEvidence) {
    if (!isEvidenceRef(ref)) {
      ctx.violations.push(`manifest evidence entry ${JSON.stringify(ref)} is not a well-formed EvidenceRef`);
      continue;
    }
    ctx.manifest.set(ref.evidenceId, ref);
    const catalogRef = ctx.catalog.get(ref.evidenceId);
    if (catalogRef === undefined) {
      // every manifest ref must be cataloged for cited refs to resolve
      ctx.violations.push(`manifest evidence ${ref.evidenceId} is missing from the model's evidence catalog`);
    } else if (refKey(catalogRef) !== refKey(ref)) {
      ctx.violations.push(`catalog entry for ${ref.evidenceId} differs from the bundle manifest entry`);
    }
  }

  // ---- journeys ----
  if (!Array.isArray(model.journeys)) {
    ctx.violations.push('model.journeys: not an array');
  } else {
    const seen = new Set<string>();
    model.journeys.forEach((journey: IrJourney, i) => {
      const path = `model.journeys[${i}]`;
      checkId(journey.id, 'journey', path, seen, ctx);
      if (typeof journey.purpose !== 'string' || journey.purpose === '') {
        ctx.violations.push(`${path}.purpose must be a non-empty string`);
      }
      checkStringArray(journey.preconditions, `${path}.preconditions`, ctx);
      checkStringArray(journey.steps, `${path}.steps`, ctx);
      checkProvenance(`${path}`, journey.provenance, ctx);
    });
  }

  // ---- screens ----
  const screenIds = new Set<string>();
  if (!Array.isArray(model.screens)) {
    ctx.violations.push('model.screens: not an array');
  } else {
    model.screens.forEach((screen: IrScreen, i) => {
      const path = `model.screens[${i}]`;
      checkId(screen.id, 'screen', path, screenIds, ctx);
      if (typeof screen.route !== 'string' || screen.route === '') {
        ctx.violations.push(`${path}.route must be a non-empty string`);
      }
      checkProvenance(path, screen.provenance, ctx);
      if (screen.treeRef !== undefined) checkRefResolves(screen.treeRef, `${path}.treeRef`, ctx);
      if (screen.visualRef !== undefined) checkRefResolves(screen.visualRef, `${path}.visualRef`, ctx);
    });
  }

  // ---- components ----
  if (!Array.isArray(model.components)) {
    ctx.violations.push('model.components: not an array');
  } else {
    const seen = new Set<string>();
    model.components.forEach((component: IrComponent, i) => {
      const path = `model.components[${i}]`;
      checkId(component.id, 'comp', path, seen, ctx);
      if (typeof component.role !== 'string' || component.role === '') {
        ctx.violations.push(`${path}.role must be a non-empty string`);
      }
      if (!screenIds.has(component.screenId)) {
        ctx.violations.push(`${path}.screenId ${component.screenId} does not resolve to a screen`);
      }
      if (!isPlainObject(component.properties)) {
        ctx.violations.push(`${path}.properties must be a plain object`);
      }
      checkStringArray(component.events, `${path}.events`, ctx);
      checkProvenance(path, component.provenance, ctx);
    });
  }

  // ---- state.variables ----
  if (!isPlainObject(model.state) || !Array.isArray(model.state.variables)) {
    ctx.violations.push('model.state.variables: not an array');
  } else {
    const seen = new Set<string>();
    model.state.variables.forEach((variable: IrStateVariable, i) => {
      const path = `model.state.variables[${i}]`;
      checkId(variable.id, 'var', path, seen, ctx);
      if (typeof variable.name !== 'string' || variable.name === '') {
        ctx.violations.push(`${path}.name must be a non-empty string`);
      }
      if (typeof variable.domain !== 'string' || variable.domain === '') {
        ctx.violations.push(`${path}.domain must be a non-empty string`);
      }
      checkProvenance(path, variable.provenance, ctx);
    });
  }

  // ---- state.transitions ----
  if (!isPlainObject(model.state) || !Array.isArray(model.state.transitions)) {
    ctx.violations.push('model.state.transitions: not an array');
  } else {
    const seen = new Set<string>();
    model.state.transitions.forEach((transition: IrTransition, i) => {
      const path = `model.state.transitions[${i}]`;
      checkId(transition.id, 'trans', path, seen, ctx);
      if (!screenIds.has(transition.fromScreenId)) {
        ctx.violations.push(`${path}.fromScreenId ${transition.fromScreenId} does not resolve to a screen`);
      }
      if (!screenIds.has(transition.toScreenId)) {
        ctx.violations.push(`${path}.toScreenId ${transition.toScreenId} does not resolve to a screen`);
      }
      const trigger = transition.trigger;
      if (!isPlainObject(trigger) || typeof trigger.type !== 'string') {
        ctx.violations.push(`${path}.trigger must be a discriminated object`);
      } else if (trigger.type === 'action') {
        if (typeof trigger.action !== 'string' || trigger.action === '') {
          ctx.violations.push(`${path}.trigger.action must be a non-empty string`);
        }
      } else if (trigger.type === 'api-response') {
        if (typeof trigger.operationId !== 'string' || trigger.operationId === '') {
          ctx.violations.push(`${path}.trigger.operationId must be a non-empty string`);
        }
      }
      checkStringArray(transition.sideEffects, `${path}.sideEffects`, ctx);
      checkProvenance(path, transition.provenance, ctx);
    });
  }

  // ---- data.entities ----
  if (!isPlainObject(model.data) || !Array.isArray(model.data.entities)) {
    ctx.violations.push('model.data.entities: not an array');
  } else {
    const seen = new Set<string>();
    model.data.entities.forEach((entity: IrDataEntity, i) => {
      const path = `model.data.entities[${i}]`;
      checkId(entity.id, 'ent', path, seen, ctx);
      if (typeof entity.name !== 'string' || entity.name === '') {
        ctx.violations.push(`${path}.name must be a non-empty string`);
      }
      checkStringArray(entity.persistence, `${path}.persistence`, ctx);
      if (!Array.isArray(entity.fields)) {
        ctx.violations.push(`${path}.fields must be an array`);
      } else {
        entity.fields.forEach((field, j) => {
          const fieldPath = `${path}.fields[${j}]`;
          if (typeof field.name !== 'string' || field.name === '') {
            ctx.violations.push(`${fieldPath}.name must be a non-empty string`);
          }
          if (typeof field.domain !== 'string' || field.domain === '') {
            ctx.violations.push(`${fieldPath}.domain must be a non-empty string`);
          }
          checkProvenance(fieldPath, field.provenance, ctx);
        });
      }
    });
  }

  // ---- api.operations ----
  if (!isPlainObject(model.api) || !Array.isArray(model.api.operations)) {
    ctx.violations.push('model.api.operations: not an array');
  } else {
    const seen = new Set<string>();
    model.api.operations.forEach((operation: IrApiOperation, i) => {
      const path = `model.api.operations[${i}]`;
      checkId(operation.id, 'op', path, seen, ctx);
      if (typeof operation.transport !== 'string' || operation.transport === '') {
        ctx.violations.push(`${path}.transport must be a non-empty string`);
      }
      if (operation.method !== undefined && typeof operation.method !== 'string') {
        ctx.violations.push(`${path}.method must be a string when present`);
      }
      if (typeof operation.urlPattern !== 'string' || operation.urlPattern === '') {
        ctx.violations.push(`${path}.urlPattern must be a non-empty string`);
      }
      if (operation.headersNeeded !== undefined) checkStringArray(operation.headersNeeded, `${path}.headersNeeded`, ctx);
      if (!Array.isArray(operation.observedExamples) || operation.observedExamples.length === 0) {
        ctx.violations.push(`${path}.observedExamples must be a non-empty array (an operation without evidence must not exist)`);
      } else {
        operation.observedExamples.forEach((ref, j) => {
          checkRefResolves(ref, `${path}.observedExamples[${j}]`, ctx);
        });
      }
      if (!REPLAYABILITY.has(operation.replayability)) {
        ctx.violations.push(`${path}.replayability '${operation.replayability}' is outside the Replayability vocabulary`);
      }
      checkStringArray(operation.externalSideEffects, `${path}.externalSideEffects`, ctx);
      checkProvenance(path, operation.provenance, ctx);
    });
  }

  // ---- integrations ----
  if (!Array.isArray(model.integrations)) {
    ctx.violations.push('model.integrations: not an array');
  } else {
    const seen = new Set<string>();
    model.integrations.forEach((integration: IrIntegration, i) => {
      const path = `model.integrations[${i}]`;
      checkId(integration.id, 'integ', path, seen, ctx);
      if (typeof integration.capability !== 'string' || integration.capability === '') {
        ctx.violations.push(`${path}.capability must be a non-empty string`);
      }
      if (!INTEGRATION_STATUSES.has(integration.status)) {
        ctx.violations.push(`${path}.status '${integration.status}' is outside the IntegrationStatus vocabulary`);
      }
      checkProvenance(path, integration.provenance, ctx);
    });
  }

  // ---- assumptions (this package's emission policy: assumed, <= 0.5) ----
  if (!Array.isArray(model.assumptions)) {
    ctx.violations.push('model.assumptions: not an array');
  } else {
    const seen = new Set<string>();
    model.assumptions.forEach((assumption: IrAssumption, i) => {
      const path = `model.assumptions[${i}]`;
      checkId(assumption.id, 'assume', path, seen, ctx);
      if (typeof assumption.statement !== 'string' || assumption.statement === '') {
        ctx.violations.push(`${path}.statement must be a non-empty string`);
      }
      checkProvenance(path, assumption.provenance, ctx);
      if (assumption.provenance?.level !== 'assumed') {
        ctx.violations.push(`${path}: this package emits assumptions at level 'assumed' only`);
      }
      if (typeof assumption.provenance?.confidence.value === 'number' && assumption.provenance.confidence.value > 0.5) {
        ctx.violations.push(`${path}: assumption confidence must be <= 0.5`);
      }
    });
  }

  // ---- constraints ----
  checkStringArray(model.constraints, 'model.constraints', ctx);

  // ---- nulls + serializability (design principles / mapping note) ----
  checkNoNull(model, 'model', ctx.violations);
  let serialized: string;
  try {
    serialized = JSON.stringify(model);
  } catch {
    ctx.violations.push('model: JSON.stringify threw — not serializable');
    serialized = '';
  }
  if (serialized !== '') {
    try {
      const parsed = JSON.parse(serialized) as unknown;
      if (!isDeepStrictEqual(model, parsed)) {
        ctx.violations.push('model: not JSON round-trip stable (undefined-valued keys or non-JSON values present)');
      }
    } catch {
      ctx.violations.push('model: JSON round-trip parse failed');
    }
  }

  return ctx.violations;
}

/** Every EvidenceRef cited anywhere in the model, in walk order, deduped by evidenceId. */
export function collectCitedEvidenceRefs(model: IrModel): EvidenceRef[] {
  const out: EvidenceRef[] = [];
  const seen = new Set<string>();
  const push = (ref: unknown): void => {
    if (!isEvidenceRef(ref)) return;
    if (seen.has(ref.evidenceId)) return;
    seen.add(ref.evidenceId);
    out.push({ ...ref });
  };

  for (const screen of model.screens) {
    push(screen.treeRef);
    push(screen.visualRef);
    pushRefs(screen.provenance, push);
  }
  for (const component of model.components) {
    pushRefs(component.provenance, push);
  }
  for (const journey of model.journeys) {
    pushRefs(journey.provenance, push);
  }
  for (const variable of model.state.variables) {
    pushRefs(variable.provenance, push);
  }
  for (const transition of model.state.transitions) {
    pushRefs(transition.provenance, push);
  }
  for (const entity of model.data.entities) {
    for (const field of entity.fields) {
      pushRefs(field.provenance, push);
    }
  }
  for (const operation of model.api.operations) {
    for (const ref of operation.observedExamples) push(ref);
    pushRefs(operation.provenance, push);
  }
  for (const integration of model.integrations) {
    pushRefs(integration.provenance, push);
  }
  for (const assumption of model.assumptions) {
    pushRefs(assumption.provenance, push);
  }
  return out;
}

function pushRefs(provenance: Provenance | undefined, push: (ref: unknown) => void): void {
  if (provenance === undefined) return;
  for (const ref of provenance.confidence.evidenceRefs) {
    push(ref);
  }
}
