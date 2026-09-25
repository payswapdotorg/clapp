/**
 * @clapp/ir — referentially-sound builder for IR models v0.1.
 *
 * The builder mints ids with the declared prefixes + uuid v4 and REJECTS
 * violations IMMEDIATELY at add time, so a model under construction can
 * never drift into an invalid state it silently carries to `finish()`:
 *
 * - Referential order is enforced: evidence must be cataloged
 *   (`addEvidenceEntry`) before any provenance block / treeRef / visualRef /
 *   observedExamples cites it; screens must exist before components and
 *   transitions point at them; api operations must exist before an
 *   `api-response` transition trigger references them.
 * - Structural shape is enforced with the SAME per-element check functions
 *   the model validator uses (imported from validate.ts) — builder and
 *   validator can never disagree about what a well-formed element is.
 * - `finish()` runs `validateIrModelDetailed` over the assembled model and
 *   throws on ANY violation. This is a real second gate, not decoration:
 *   add-time checks cover element shape + references + serializability, but
 *   the model-wide deep-null scan (e.g. a `null` buried inside an opaque
 *   `input` payload, component `properties`, or a schema descriptor) only
 *   runs at finish(). Fail fast where cheap, verify everything at the end.
 * - One screen per route in v0: a duplicate route is rejected with a clear
 *   error naming the existing screen. Two captures of the same route must
 *   be MERGED BY THE CALLER — the builder never merges.
 * - Journey ids are ACCEPTED, never minted (@clapp/journey owns them).
 *
 * Honest scope notes:
 * - The builder does not defensively copy `init.application` /
 *   `init.environment` or any input objects; treat them as transferred.
 *   `finish()` snapshots the section arrays, so later `add*` calls on the
 *   same builder cannot mutate an already-finished model.
 * - Empty sections are legal: `finish()` on a fresh builder produces a
 *   valid (if uninformative) model.
 * - Minted ids are fresh uuid v4 per call; callers needing stable ids
 *   across rebuilds capture the returned elements (the id is the identity).
 */

import type { EvidenceRef } from '@clapp/core';
import type {
  IntegrationStatus,
  IrApplication,
  IrAssumption,
  IrComponent,
  IrDataEntity,
  IrDataField,
  IrEnvironment,
  IrEvidenceEntry,
  IrIntegration,
  IrJourney,
  IrModel,
  IrApiOperation,
  IrScreen,
  IrStateVariable,
  IrTransition,
  IrTransitionTrigger,
  Provenance,
  Replayability,
} from './ir-contract';
import { IR_MODEL_VERSION } from './ir-contract';
import { canonicalJson } from './canonical-json';
import {
  apiOperationElementErrors,
  applicationErrors,
  assumptionElementErrors,
  componentElementErrors,
  dataEntityElementErrors,
  environmentErrors,
  evidenceEntryElementErrors,
  FirstSeen,
  integrationElementErrors,
  journeyElementErrors,
  screenElementErrors,
  stateVariableElementErrors,
  transitionElementErrors,
  validateIrModelDetailed,
  type CatalogEntry,
  type IrReferenceContext,
} from './validate';
import {
  newApiOperationId,
  newAssumptionId,
  newComponentId,
  newDataEntityId,
  newEvidenceEntryId,
  newIntegrationId,
  newScreenId,
  newStateVariableId,
  newTransitionId,
} from './ids';

/** Thrown by the builder on any rejected add (or a failed finish). */
export class IrBuilderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IrBuilderError';
  }
}

export interface AddScreenInput {
  route: string;
  provenance: Provenance;
  treeRef?: EvidenceRef;
  visualRef?: EvidenceRef;
}

export interface AddComponentInput {
  role: string;
  screenId: string;
  properties?: Record<string, unknown>;
  events?: string[];
  provenance: Provenance;
}

export interface AddStateVariableInput {
  name: string;
  domain: string;
  provenance: Provenance;
}

export interface AddTransitionInput {
  fromScreenId: string;
  toScreenId: string;
  trigger: IrTransitionTrigger;
  input?: unknown;
  outputs?: unknown[];
  sideEffects?: string[];
  provenance: Provenance;
}

export interface AddDataEntityInput {
  name: string;
  fields?: IrDataField[];
  persistence?: string[];
}

export interface AddApiOperationInput {
  transport: string;
  urlPattern: string;
  method?: string;
  headersNeeded?: string[];
  requestSchema?: unknown;
  responseSchema?: unknown;
  errorSchema?: unknown;
  authDependency?: string;
  observedExamples?: EvidenceRef[];
  replayability: Replayability;
  externalSideEffects?: string[];
  provenance: Provenance;
}

export interface AddIntegrationInput {
  capability: string;
  status: IntegrationStatus;
  provenance: Provenance;
}

export interface AddAssumptionInput {
  statement: string;
  provenance: Provenance;
}

/** Fluent, referentially-sound IR model builder (see module doc). */
export interface IrModelBuilder {
  addEvidenceEntry(ref: EvidenceRef, source: string): IrEvidenceEntry;
  addScreen(input: AddScreenInput): IrScreen;
  addComponent(input: AddComponentInput): IrComponent;
  addStateVariable(input: AddStateVariableInput): IrStateVariable;
  addTransition(input: AddTransitionInput): IrTransition;
  addDataEntity(input: AddDataEntityInput): IrDataEntity;
  addApiOperation(input: AddApiOperationInput): IrApiOperation;
  addIntegration(input: AddIntegrationInput): IrIntegration;
  addAssumption(input: AddAssumptionInput): IrAssumption;
  /** Accepts a complete journey (id owned by @clapp/journey, never minted). */
  addJourney(journey: IrJourney): IrJourney;
  addConstraint(text: string): string;
  /** Validate the assembled model and return it; throws on any violation. */
  finish(): IrModel;
}

export interface CreateIrModelBuilderInit {
  application: IrApplication;
  environment?: IrEnvironment;
}

class Builder implements IrModelBuilder {
  private readonly application: IrApplication;
  private readonly environment: IrEnvironment;
  private readonly evidence: IrEvidenceEntry[] = [];
  private readonly catalog = new Map<string, CatalogEntry>();
  private readonly journeys: IrJourney[] = [];
  private readonly journeyIds = new Set<string>();
  private readonly screens: IrScreen[] = [];
  private readonly routes = new Map<string, string>();
  private readonly screenIds = new Set<string>();
  private readonly components: IrComponent[] = [];
  private readonly stateVariables: IrStateVariable[] = [];
  private readonly transitions: IrTransition[] = [];
  private readonly dataEntities: IrDataEntity[] = [];
  private readonly apiOperations: IrApiOperation[] = [];
  private readonly operationIds = new Set<string>();
  private readonly integrations: IrIntegration[] = [];
  private readonly assumptions: IrAssumption[] = [];
  private readonly constraints: string[] = [];

  constructor(init: CreateIrModelBuilderInit) {
    const applicationProblems = applicationErrors(init?.application);
    if (applicationProblems.length > 0) {
      throw new IrBuilderError(`createIrModelBuilder: ${applicationProblems.join('; ')}`);
    }
    if (init?.environment !== undefined) {
      const environmentProblems = environmentErrors(init.environment);
      if (environmentProblems.length > 0) {
        throw new IrBuilderError(`createIrModelBuilder: ${environmentProblems.join('; ')}`);
      }
    }
    this.application = init.application;
    this.environment = init.environment ?? {};
  }

  private ctx(): IrReferenceContext {
    return {
      screenIds: this.screenIds,
      screensUsable: true,
      operationIds: this.operationIds,
      operationsUsable: true,
      catalog: this.catalog,
      catalogUsable: true,
    };
  }

  private reject(method: string, errors: readonly string[]): never {
    throw new IrBuilderError(`${method}: ${errors.join('; ')}`);
  }

  private assertSerializable(element: unknown, method: string): void {
    try {
      canonicalJson(element);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new IrBuilderError(`${method}: element is not canonical-JSON serializable: ${message}`);
    }
  }

  addEvidenceEntry(ref: EvidenceRef, source: string): IrEvidenceEntry {
    const entry: IrEvidenceEntry = { id: newEvidenceEntryId(), ref, source };
    const errors: string[] = [];
    const shape = evidenceEntryElementErrors(entry, 'evidence', new FirstSeen(errors));
    if (shape.length > 0) this.reject('addEvidenceEntry', shape);
    const evidenceId = entry.ref.evidenceId;
    const existing = this.catalog.get(evidenceId);
    if (existing !== undefined) {
      this.reject('addEvidenceEntry', [
        `evidence "${evidenceId}" is already cataloged as ${existing.entryId} — catalog each evidence item exactly once`,
      ]);
    }
    this.assertSerializable(entry, 'addEvidenceEntry');
    this.catalog.set(evidenceId, {
      index: this.evidence.length,
      entryId: entry.id,
      ref: { evidenceId, kind: entry.ref.kind, sha256: entry.ref.sha256 },
    });
    this.evidence.push(entry);
    return entry;
  }

  addScreen(input: AddScreenInput): IrScreen {
    const route: unknown = (input as unknown as Record<string, unknown> | null | undefined)?.['route'];
    if (typeof route === 'string') {
      const existing = this.routes.get(route);
      if (existing !== undefined) {
        this.reject('addScreen', [
          `route "${route}" is already claimed by screen ${existing} — one screen per route in v0; merge captures of the same route yourself`,
        ]);
      }
    }
    const screen: IrScreen = {
      id: newScreenId(),
      route: input.route,
      provenance: input.provenance,
      ...(input?.treeRef !== undefined ? { treeRef: input.treeRef } : {}),
      ...(input?.visualRef !== undefined ? { visualRef: input.visualRef } : {}),
    };
    const errors = screenElementErrors(screen, 'screen', new FirstSeen([]), this.ctx());
    if (errors.length > 0) this.reject('addScreen', errors);
    this.assertSerializable(screen, 'addScreen');
    this.routes.set(screen.route, screen.id);
    this.screenIds.add(screen.id);
    this.screens.push(screen);
    return screen;
  }

  addComponent(input: AddComponentInput): IrComponent {
    const component: IrComponent = {
      id: newComponentId(),
      role: input.role,
      screenId: input.screenId,
      properties: input.properties ?? {},
      events: input.events ?? [],
      provenance: input.provenance,
    };
    const errors = componentElementErrors(component, 'component', new FirstSeen([]), this.ctx());
    if (errors.length > 0) this.reject('addComponent', errors);
    this.assertSerializable(component, 'addComponent');
    this.components.push(component);
    return component;
  }

  addStateVariable(input: AddStateVariableInput): IrStateVariable {
    const variable: IrStateVariable = {
      id: newStateVariableId(),
      name: input.name,
      domain: input.domain,
      provenance: input.provenance,
    };
    const errors = stateVariableElementErrors(variable, 'stateVariable', new FirstSeen([]), this.ctx());
    if (errors.length > 0) this.reject('addStateVariable', errors);
    this.assertSerializable(variable, 'addStateVariable');
    this.stateVariables.push(variable);
    return variable;
  }

  addTransition(input: AddTransitionInput): IrTransition {
    const transition: IrTransition = {
      id: newTransitionId(),
      fromScreenId: input.fromScreenId,
      toScreenId: input.toScreenId,
      trigger: input.trigger,
      ...(input?.input !== undefined ? { input: input.input } : {}),
      ...(input?.outputs !== undefined ? { outputs: input.outputs } : {}),
      sideEffects: input.sideEffects ?? [],
      provenance: input.provenance,
    };
    const errors = transitionElementErrors(transition, 'transition', new FirstSeen([]), this.ctx());
    if (errors.length > 0) this.reject('addTransition', errors);
    this.assertSerializable(transition, 'addTransition');
    this.transitions.push(transition);
    return transition;
  }

  addDataEntity(input: AddDataEntityInput): IrDataEntity {
    const entity: IrDataEntity = {
      id: newDataEntityId(),
      name: input.name,
      fields: input.fields ?? [],
      persistence: input.persistence ?? [],
    };
    const errors = dataEntityElementErrors(entity, 'dataEntity', new FirstSeen([]), this.ctx());
    if (errors.length > 0) this.reject('addDataEntity', errors);
    this.assertSerializable(entity, 'addDataEntity');
    this.dataEntities.push(entity);
    return entity;
  }

  addApiOperation(input: AddApiOperationInput): IrApiOperation {
    const operation: IrApiOperation = {
      id: newApiOperationId(),
      transport: input.transport,
      ...(input?.method !== undefined ? { method: input.method } : {}),
      urlPattern: input.urlPattern,
      ...(input?.headersNeeded !== undefined ? { headersNeeded: input.headersNeeded } : {}),
      ...(input?.requestSchema !== undefined ? { requestSchema: input.requestSchema } : {}),
      ...(input?.responseSchema !== undefined ? { responseSchema: input.responseSchema } : {}),
      ...(input?.errorSchema !== undefined ? { errorSchema: input.errorSchema } : {}),
      ...(input?.authDependency !== undefined ? { authDependency: input.authDependency } : {}),
      observedExamples: input.observedExamples ?? [],
      replayability: input.replayability,
      externalSideEffects: input.externalSideEffects ?? [],
      provenance: input.provenance,
    };
    const errors = apiOperationElementErrors(operation, 'apiOperation', new FirstSeen([]), this.ctx());
    if (errors.length > 0) this.reject('addApiOperation', errors);
    this.assertSerializable(operation, 'addApiOperation');
    this.operationIds.add(operation.id);
    this.apiOperations.push(operation);
    return operation;
  }

  addIntegration(input: AddIntegrationInput): IrIntegration {
    const integration: IrIntegration = {
      id: newIntegrationId(),
      capability: input.capability,
      status: input.status,
      provenance: input.provenance,
    };
    const errors = integrationElementErrors(integration, 'integration', new FirstSeen([]), this.ctx());
    if (errors.length > 0) this.reject('addIntegration', errors);
    this.assertSerializable(integration, 'addIntegration');
    this.integrations.push(integration);
    return integration;
  }

  addAssumption(input: AddAssumptionInput): IrAssumption {
    const assumption: IrAssumption = {
      id: newAssumptionId(),
      statement: input.statement,
      provenance: input.provenance,
    };
    const errors = assumptionElementErrors(assumption, 'assumption', new FirstSeen([]), this.ctx());
    if (errors.length > 0) this.reject('addAssumption', errors);
    this.assertSerializable(assumption, 'addAssumption');
    this.assumptions.push(assumption);
    return assumption;
  }

  addJourney(journey: IrJourney): IrJourney {
    const journeyId: unknown = (journey as unknown as Record<string, unknown> | null | undefined)?.['id'];
    if (typeof journeyId === 'string' && this.journeyIds.has(journeyId)) {
      this.reject('addJourney', [`duplicate journey id "${journeyId}" — each journey is added exactly once`]);
    }
    const errors = journeyElementErrors(journey, 'journey', new FirstSeen([]), this.ctx());
    if (errors.length > 0) this.reject('addJourney', errors);
    this.assertSerializable(journey, 'addJourney');
    this.journeyIds.add(journey.id);
    this.journeys.push(journey);
    return journey;
  }

  addConstraint(text: string): string {
    if (typeof text !== 'string' || text.trim() === '') {
      this.reject('addConstraint', [`expected a non-empty string, got ${JSON.stringify(text ?? null)}`]);
    }
    this.constraints.push(text);
    return text;
  }

  finish(): IrModel {
    const model: IrModel = {
      modelVersion: IR_MODEL_VERSION,
      application: this.application,
      environment: this.environment,
      evidence: [...this.evidence],
      journeys: [...this.journeys],
      screens: [...this.screens],
      components: [...this.components],
      state: { variables: [...this.stateVariables], transitions: [...this.transitions] },
      data: { entities: [...this.dataEntities] },
      api: { operations: [...this.apiOperations] },
      integrations: [...this.integrations],
      assumptions: [...this.assumptions],
      constraints: [...this.constraints],
    };
    const result = validateIrModelDetailed(model);
    if (!result.valid) {
      throw new IrBuilderError(
        `finish(): assembled model failed validation (${result.errors.length} error(s)):\n${result.errors
          .map((error) => `- ${error}`)
          .join('\n')}`,
      );
    }
    return model;
  }
}

/**
 * Create a builder for one application. `init.application` must be a
 * well-formed IrApplication (validated immediately); `init.environment`
 * defaults to `{}` (nothing captured — every IrEnvironment field is
 * optional and absence means unknown).
 */
export function createIrModelBuilder(init: CreateIrModelBuilderInit): IrModelBuilder {
  return new Builder(init);
}
