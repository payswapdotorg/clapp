/**
 * @clapp/explore — Behavioral-IR emission (CLAPP-022).
 *
 * Turns one exploration walk into an IrModel fragment (ir-contract v0.1
 * mirror; canonical owner @clapp/ir). Every emitted element carries a
 * provenance block citing RECORDED evidence — no ref is ever invented:
 *
 * - screens: one per visited route, provenance 'derived' (the route is a
 *   deterministic normalization of the visited URL), treeRef = the route's
 *   dom capture;
 * - components: one per actionable per screen, provenance 'derived' from the
 *   owning screen's dom capture; `events` lists the journey-action verbs the
 *   frozen applier can execute against that role;
 * - journeys: one IrJourney summary per recorded Journey (purpose
 *   "reach <route>", one human-readable step per action), provenance
 *   'derived', citing the user captures of the journey's actions;
 * - transitions: every APPLIED action whose route changed (from ≠ to),
 *   trigger action vocabulary mapped from journey verbs (fill → 'type'),
 *   provenance 'observed' citing the action's user capture and the arrival
 *   screen's dom capture. Route-preserving actions become self-transitions
 *   ONLY when a state-relevant signal changed — a NEW storage key appearing
 *   in the run (tracked across storage-inventory checks, in order). Under
 *   the frozen applier surface no storage key can ever appear (the
 *   inventory is honestly empty), so v0 exploration emits NO self
 *   transitions — the mechanism exists and is unit-tested with hand-built
 *   records, but it does not fire on real walks.
 *
 * Sections the explorer cannot populate stay EMPTY (unknown is a valid
 * value; nothing is fabricated): environment detail, state variables, data
 * entities, api operations, integrations, assumptions, constraints. The
 * adapter declaration below states this honestly for IR consumers.
 *
 * `checkIrLiteral` is the internal (not re-exported from the package index)
 * structural self-check over the emitted subset — emitIrModel runs it on its
 * own output and throws loudly if any invariant is violated. The tech
 * lead's integration battery additionally runs @clapp/ir's
 * validateIrModelDetailed over exploration output; that is the
 * integration gate, not this check.
 */

import { randomUUID } from 'node:crypto';
import type { EvidenceRef } from '@clapp/core';
import type { Journey, JourneyAction } from '@clapp/journey';
import type {
  IrAdapterInfo,
  IrApplication,
  IrComponent,
  IrEvidenceEntry,
  IrJourney,
  IrModel,
  IrScreen,
  IrTransition,
  Provenance,
} from './ir-contract';
import { IR_MODEL_VERSION } from './ir-contract';
import type { ActionableElement } from './html-walker';
import type { ActionRecord } from './explorer';

/** Honest adapter declaration (ir-contract §8) for @clapp/explore output. */
export const EXPLORE_ADAPTER_INFO: IrAdapterInfo = {
  adapterId: '@clapp/explore',
  supportedModelVersions: [IR_MODEL_VERSION],
  emittedCapabilities: [
    'evidence (dom/user/storage captures as IrEvidenceEntry)',
    'journeys (IrJourney summaries of recorded Journeys)',
    'screens (visited routes, dom-capture backed)',
    'components (walker actionables per screen)',
    'state.transitions (evidence-cited edges between screens)',
  ],
  unsupportedConstructs: [
    'environment detail (no browser/OS observation during exploration)',
    'state.variables (no runtime state instrumentation)',
    'data.entities (extraction is @clapp/extract territory)',
    'api.operations (no network capture channel in exploration)',
    'integrations (none observed through the applier surface)',
    'assumptions (exploration makes no synthesis choices)',
    'self-transitions on storage signals (no storage channel is exposed; the mechanism is implemented and unit-tested but cannot fire in v0)',
  ],
  degradationBehavior:
    'unsupported sections stay empty and unknown optional fields stay absent — never null, never fabricated',
};

/** Capture outcome vocabulary (mirrors the canonical capture contract kinds). */
export type ActionOutcome = 'applied' | 'assert-failed' | 'skipped';

/** One visited screen, as the emitter receives it from the explorer. */
export interface ScreenRecord {
  route: string;
  /** Dom-capture ref from the first visit (null only if registration could
   * not record — the explorer never does that in practice). */
  treeRef: EvidenceRef | null;
  actionables: ActionableElement[];
}

/** One recorded journey + the user-capture refs of its actions. */
export interface JourneyRecord {
  route: string;
  journey: Journey;
  actionRefs: EvidenceRef[];
}

/** Everything emitIrModel needs (plain data; tests hand-build this too). */
export interface EmitIrModelInput {
  application: IrApplication;
  /** Every ref exploration recorded, in record order. */
  refs: EvidenceRef[];
  screens: ScreenRecord[];
  /** Every applied-or-failed action, in execution order. */
  actions: ActionRecord[];
  journeys: JourneyRecord[];
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function newId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

function derivedProvenance(rationale: string, evidenceRefs: EvidenceRef[]): Provenance {
  return {
    level: 'derived',
    confidence: { value: 1, rationale, evidenceRefs: evidenceRefs.map((ref) => ({ ...ref })) },
  };
}

function observedProvenance(rationale: string, evidenceRefs: EvidenceRef[]): Provenance {
  return {
    level: 'observed',
    confidence: { value: 1, rationale, evidenceRefs: evidenceRefs.map((ref) => ({ ...ref })) },
  };
}

/** Journey-action verbs the applier can execute per role (events field). */
const ROLE_EVENTS: Readonly<Record<string, string[]>> = {
  link: ['click'],
  button: ['click'],
  textbox: ['fill'],
  searchbox: ['fill'],
  combobox: [],
  checkbox: [],
  radio: [],
  slider: [],
  spinbutton: [],
  form: ['submit'],
  navigation: [],
  heading: [],
};

/** One human-readable step line per action (IrJourney.steps). */
export function describeAction(action: JourneyAction): string {
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

function describeTarget(target: { role?: string; name?: string; testId?: string; nth?: number }): string {
  const parts: string[] = [];
  if (target.testId !== undefined) parts.push(`testId=${target.testId}`);
  if (target.role !== undefined) parts.push(`role=${target.role}`);
  if (target.name !== undefined) parts.push(`name=${JSON.stringify(target.name)}`);
  if (target.nth !== undefined) parts.push(`nth=${String(target.nth)}`);
  return parts.length > 0 ? parts.join(' ') : '(empty selector)';
}

/** journey verb → IR trigger action vocabulary (fill renders as 'type'). */
function triggerActionOf(actionType: string): string {
  if (actionType === 'fill') return 'type';
  return actionType;
}

// ---------------------------------------------------------------------------
// Emission
// ---------------------------------------------------------------------------

/**
 * Builds the IrModel fragment for one exploration walk and self-checks it
 * with {@link checkIrLiteral} before returning. Pure apart from uuid
 * generation (model element ids — the determinism contract compares
 * structure modulo ids).
 */
export function emitIrModel(input: EmitIrModelInput): IrModel {
  // Dedupe by evidenceId (the recording session may return an existing ref
  // for a byte-identical retry capture) — the catalog lists each ref once.
  const refById = new Map<string, EvidenceRef>();
  const uniqueRefs: EvidenceRef[] = [];
  for (const ref of input.refs) {
    if (refById.has(ref.evidenceId)) continue;
    refById.set(ref.evidenceId, ref);
    uniqueRefs.push(ref);
  }

  // ---- evidence catalog -----------------------------------------------------
  const evidence: IrEvidenceEntry[] = uniqueRefs.map((ref) => ({
    id: newId('irev'),
    ref: { ...ref },
    source: 'exploration',
  }));

  // ---- screens ----------------------------------------------------------------
  const screenIdByRoute = new Map<string, string>();
  const screens: IrScreen[] = input.screens.map((screen) => {
    const id = newId('screen');
    screenIdByRoute.set(screen.route, id);
    const treeRefs = screen.treeRef !== null ? [{ ...screen.treeRef }] : [];
    return {
      id,
      route: screen.route,
      provenance: derivedProvenance(
        'route visited and dom-captured during exploration (normalized from the visited URL)',
        treeRefs,
      ),
      ...(screen.treeRef !== null ? { treeRef: { ...screen.treeRef } } : {}),
      // visualRef stays absent: exploration captures no screenshots (honest).
    };
  });

  // ---- components ---------------------------------------------------------------
  const components: IrComponent[] = [];
  for (const screen of input.screens) {
    const screenId = screenIdByRoute.get(screen.route);
    if (screenId === undefined) continue;
    const treeRefs = screen.treeRef !== null ? [{ ...screen.treeRef }] : [];
    for (const actionable of screen.actionables) {
      components.push({
        id: newId('comp'),
        role: actionable.role,
        screenId,
        properties: {
          tag: actionable.tag,
          path: actionable.path,
          name: actionable.name,
          ...(actionable.testId !== undefined ? { testId: actionable.testId } : {}),
          ...(actionable.href !== undefined ? { href: actionable.href } : {}),
          ...(actionable.form !== undefined ? { form: actionable.form } : {}),
        },
        events: [...(ROLE_EVENTS[actionable.role] ?? [])],
        provenance: derivedProvenance(
          'enumerated from the screen dom capture by the exploration walker',
          treeRefs,
        ),
      });
    }
  }

  // ---- journeys --------------------------------------------------------------------
  const journeys: IrJourney[] = input.journeys.map((record) => ({
    id: record.journey.id,
    purpose: `reach ${record.route}`,
    preconditions: [],
    steps: record.journey.actions.map(describeAction),
    provenance: derivedProvenance(
      'action prefix applied through the frozen applier during exploration; each action cites its user capture',
      record.actionRefs.map((ref) => ({ ...ref })),
    ),
  }));

  // ---- transitions --------------------------------------------------------------------
  const transitions: IrTransition[] = [];
  const knownStorageKeys = new Set<string>();
  for (const record of input.actions) {
    if (record.outcome !== 'applied') continue;
    // Storage keys are tracked in execution order so "a NEW key appeared" is
    // decidable exactly when the inventory was taken.
    let newStorageKeys: string[] = [];
    if (record.storageKeysAfter !== undefined) {
      newStorageKeys = record.storageKeysAfter.filter((key) => !knownStorageKeys.has(key));
      for (const key of record.storageKeysAfter) knownStorageKeys.add(key);
    }
    const routeChanged = record.routeBefore !== record.routeAfter;
    if (routeChanged) {
      if (record.action.type === 'assert-visible' || record.action.type === 'wait') continue;
      const fromScreenId = screenIdByRoute.get(record.routeBefore);
      const toScreenId = screenIdByRoute.get(record.routeAfter);
      if (fromScreenId === undefined || toScreenId === undefined) continue;
      const refs: EvidenceRef[] = [];
      if (record.ref !== null) refs.push({ ...record.ref });
      const arrival = input.screens.find((screen) => screen.route === record.routeAfter);
      if (arrival !== undefined && arrival.treeRef !== null) refs.push({ ...arrival.treeRef });
      transitions.push({
        id: newId('trans'),
        fromScreenId,
        toScreenId,
        trigger: { type: 'action', action: triggerActionOf(record.action.type) },
        ...(record.submitParams !== undefined
          ? { input: Object.fromEntries(record.submitParams) }
          : {}),
        sideEffects:
          record.submittedForm !== undefined ? [`submits form ${record.submittedForm}`] : [],
        provenance: observedProvenance(
          'action applied through the frozen applier during exploration; the route change is recorded in the exploration ledger',
          refs,
        ),
      });
      continue;
    }
    // Route-preserving applied action: a self-transition ONLY when a
    // state-relevant signal changed — a storage key newly appearing in the
    // run at this point. The empty-inventory reality of v0 means this never
    // fires on real walks (honest; see module doc).
    if (newStorageKeys.length > 0 && record.action.type !== 'assert-visible' && record.action.type !== 'wait') {
      const screenId = screenIdByRoute.get(record.routeBefore);
      if (screenId !== undefined && record.ref !== null) {
        transitions.push({
          id: newId('trans'),
          fromScreenId: screenId,
          toScreenId: screenId,
          trigger: { type: 'action', action: triggerActionOf(record.action.type) },
          sideEffects: [`storage keys appeared: ${newStorageKeys.join(', ')}`],
          provenance: observedProvenance(
            'route-preserving action applied during exploration while new storage keys appeared in the inventory',
            [{ ...record.ref }],
          ),
        });
      }
    }
  }

  const model: IrModel = {
    modelVersion: IR_MODEL_VERSION,
    application: { ...input.application, entrypoints: [...input.application.entrypoints] },
    environment: {}, // all fields absent — unknown is a valid value
    evidence,
    journeys,
    screens,
    components,
    state: {
      variables: [], // no runtime state instrumentation in exploration
      transitions,
    },
    data: {
      entities: [], // evidence-to-IR extraction is @clapp/extract territory
    },
    api: {
      operations: [], // no network capture channel in exploration
    },
    integrations: [],
    assumptions: [],
    constraints: [],
  };

  const violations = checkIrLiteral(model);
  if (violations.length > 0) {
    throw new Error(`emitIrModel: self-check failed (${violations.length} violations): ${violations.join('; ')}`);
  }
  return model;
}

// ---------------------------------------------------------------------------
// Internal structural self-check (NOT exported from the package index)
// ---------------------------------------------------------------------------

const UUIDISH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function idViolations(prefix: string, id: string): string[] {
  const rest = id.startsWith(`${prefix}_`) ? id.slice(prefix.length + 1) : null;
  if (rest === null || !UUIDISH.test(rest)) {
    return [`${prefix} id must be "${prefix}_"+uuid, observed ${JSON.stringify(id)}`];
  }
  return [];
}

function provenanceViolations(where: string, provenance: Provenance, refIds: Set<string>): string[] {
  const errors: string[] = [];
  const levels = ['observed', 'derived', 'inferred', 'assumed', 'unavailable'];
  if (!levels.includes(provenance.level)) {
    errors.push(`${where}: unknown evidence level ${JSON.stringify(provenance.level)}`);
  }
  const confidence = provenance.confidence;
  if (typeof confidence.value !== 'number' || !Number.isFinite(confidence.value) || confidence.value < 0 || confidence.value > 1) {
    errors.push(`${where}: confidence.value must be within 0..1, observed ${String(confidence.value)}`);
  }
  if (typeof confidence.rationale !== 'string' || confidence.rationale.trim() === '') {
    errors.push(`${where}: confidence.rationale must be a non-empty sentence`);
  }
  if (!Array.isArray(confidence.evidenceRefs)) {
    errors.push(`${where}: confidence.evidenceRefs must be an array`);
    return errors;
  }
  if (provenance.level !== 'assumed' && confidence.evidenceRefs.length === 0) {
    errors.push(`${where}: non-assumed provenance must cite at least one evidence ref`);
  }
  for (const ref of confidence.evidenceRefs) {
    if (!refIds.has(ref.evidenceId)) {
      errors.push(`${where}: cited ref ${ref.evidenceId} does not resolve to the evidence catalog`);
    }
  }
  return errors;
}

/**
 * Structural invariant check over the explorer's emitted subset: id shapes,
 * provenance completeness, evidence-catalog resolution, cross-references
 * (screenId/fromScreenId/toScreenId), model version. Internal — exported
 * from this module for the colocated test battery only, NOT re-exported
 * from the package index (it is not part of the frozen public surface).
 */
export function checkIrLiteral(model: IrModel): string[] {
  const errors: string[] = [];
  if (model.modelVersion !== IR_MODEL_VERSION) {
    errors.push(`modelVersion must equal '${IR_MODEL_VERSION}', observed ${JSON.stringify(model.modelVersion)}`);
  }
  const refIds = new Set(model.evidence.map((entry) => entry.ref.evidenceId));
  for (const entry of model.evidence) {
    errors.push(...idViolations('irev', entry.id));
    if (typeof entry.source !== 'string' || entry.source.trim() === '') {
      errors.push(`evidence entry ${entry.id}: source must be a non-empty string`);
    }
    if (!refIds.has(entry.ref.evidenceId)) {
      errors.push(`evidence entry ${entry.id}: self-inconsistency (ref not in catalog id set)`);
    }
  }
  const screenIds = new Set<string>();
  for (const screen of model.screens) {
    errors.push(...idViolations('screen', screen.id));
    screenIds.add(screen.id);
    if (typeof screen.route !== 'string' || screen.route === '') {
      errors.push(`screen ${screen.id}: route must be a non-empty string`);
    }
    errors.push(...provenanceViolations(`screen ${screen.id}`, screen.provenance, refIds));
    if (screen.treeRef !== undefined && !refIds.has(screen.treeRef.evidenceId)) {
      errors.push(`screen ${screen.id}: treeRef ${screen.treeRef.evidenceId} does not resolve to the catalog`);
    }
  }
  for (const component of model.components) {
    errors.push(...idViolations('comp', component.id));
    if (!screenIds.has(component.screenId)) {
      errors.push(`component ${component.id}: screenId ${component.screenId} does not resolve to a screen`);
    }
    if (typeof component.role !== 'string' || component.role === '') {
      errors.push(`component ${component.id}: role must be a non-empty string`);
    }
    if (!Array.isArray(component.events)) {
      errors.push(`component ${component.id}: events must be an array`);
    }
    errors.push(...provenanceViolations(`component ${component.id}`, component.provenance, refIds));
  }
  const journeyIds = new Set<string>();
  for (const journey of model.journeys) {
    if (!journey.id.startsWith('journey_')) {
      errors.push(`journey id must start with "journey_", observed ${JSON.stringify(journey.id)}`);
    }
    journeyIds.add(journey.id);
    if (typeof journey.purpose !== 'string' || journey.purpose === '') {
      errors.push(`journey ${journey.id}: purpose must be a non-empty string`);
    }
    if (!Array.isArray(journey.preconditions) || !Array.isArray(journey.steps)) {
      errors.push(`journey ${journey.id}: preconditions and steps must be arrays`);
    }
    errors.push(...provenanceViolations(`journey ${journey.id}`, journey.provenance, refIds));
  }
  for (const transition of model.state.transitions) {
    errors.push(...idViolations('trans', transition.id));
    if (!screenIds.has(transition.fromScreenId)) {
      errors.push(`transition ${transition.id}: fromScreenId does not resolve to a screen`);
    }
    if (!screenIds.has(transition.toScreenId)) {
      errors.push(`transition ${transition.id}: toScreenId does not resolve to a screen`);
    }
    if (transition.trigger.type !== 'action' || typeof transition.trigger.action !== 'string') {
      errors.push(`transition ${transition.id}: v0 exploration emits action triggers only`);
    }
    if (!Array.isArray(transition.sideEffects)) {
      errors.push(`transition ${transition.id}: sideEffects must be an array`);
    }
    errors.push(...provenanceViolations(`transition ${transition.id}`, transition.provenance, refIds));
    if (transition.provenance.confidence.evidenceRefs.length === 0) {
      errors.push(`transition ${transition.id}: every transition must cite at least one recorded ref`);
    }
  }
  return errors;
}
