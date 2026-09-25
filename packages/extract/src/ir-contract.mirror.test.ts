// The ir-contract mirror must stay byte-identical to the tech-lead
// declaration (canonical owner @clapp/ir, CLAPP-020 — built in the
// parallel wave). This test pins the mirror against the frozen text
// verbatim so accidental drift fails loudly; the tech lead additionally
// diffs it against the canonical copy at integration.

import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { IR_MODEL_VERSION } from './ir-contract';
import type { IrModel } from './ir-contract';

const FROZEN_CONTRACT = `// ================= SHARED CONTRACT: ir-contract.ts =================
// CLAPP Behavioral IR contract v0.1 — declared by the tech lead (P2 wave,
// 2026-09-25). Canonical owner: @clapp/ir (CLAPP-020). Byte-identical
// mirrors are carried by every package that needs the types (@clapp/extract
// CLAPP-021, @clapp/explore CLAPP-022); the tech lead verifies byte-equality
// at integration and freezes. Changes require an ADR.
//
// Rendering of docs/BEHAVIORAL_IR.md v0.1 into TypeScript. Mapping notes:
// the doc's \`evidence[]\` entries become IrEvidenceEntry (the id-bearing
// catalog); every other section cites EvidenceRef objects directly — they
// are self-describing (evidenceId + kind + sha256) and match the sealed
// EvidenceBundle refs. The doc's \`data.persistence\` folds into
// IrDataEntity.persistence. The doc's transition (state_before + action +
// input + environment -> state_after + outputs + side_effects) renders with
// SCREENS as the v0 state nodes (web adapter: screen == state; declared
// simplification, revisit for native adapters). Unknown is a valid value:
// optional fields stay ABSENT, never null, when unknown.
//
// Design principles (docs/BEHAVIORAL_IR.md §1, binding on all sections):
//   1. Evidence and inference are separate.       2. Observed facts are immutable.
//   3. Every inferred property links to evidence. 4. Unknown is a valid value.
//   5. Implementations differ, behavior stays comparable.
//   6. Web and future native adapters.           7. Serializable, diffable, versioned.

import type { EvidenceRef } from '@clapp/core';

// ---- provenance (every inferred property carries one) ---------------------

/** How a model element's truth status was established (doc §3). */
export type EvidenceLevel =
  | 'observed'     // directly captured
  | 'derived'      // deterministic transformation of observations
  | 'inferred'     // hypothesis supported by observations
  | 'assumed'      // synthesis choice not established by evidence
  | 'unavailable'; // behavior could not be observed

/** Confidence on any inferred/assumed property (doc §7). */
export interface Confidence {
  /** 0..1 inclusive. */
  value: number;
  /** why this value — one honest sentence. */
  rationale: string;
  /** evidence supporting the claim (empty is legal only for 'assumed'). */
  evidenceRefs: EvidenceRef[];
}

/** Provenance block carried by every non-evidence model element. */
export interface Provenance {
  level: EvidenceLevel;
  confidence: Confidence;
}

// ---- model identity --------------------------------------------------------

/** IR model version this contract renders (doc §8: the IR is versioned). */
export const IR_MODEL_VERSION = '0.1';

export interface IrApplication {
  id: string;             // "app_" + uuid v4
  name: string;
  platform: 'web' | 'native' | (string & {});
  /** routes/URLs journeys may start from. */
  entrypoints: string[];
}

export interface IrEnvironment {
  browser?: string;
  os?: string;
  viewport?: { width: number; height: number };
  locale?: string;
  timezone?: string;
  /** coarse posture label, e.g. 'deny-all' | 'allow-all' | 'unknown'. */
  network?: string;
}

// ---- evidence catalog ------------------------------------------------------

/** One cataloged evidence item with its source note (doc §2 evidence[]). */
export interface IrEvidenceEntry {
  id: string;             // "irev_" + uuid v4 — stable catalog identity
  /** the self-describing ref (matches a sealed EvidenceBundle ref). */
  ref: EvidenceRef;
  /** channel/run that produced it, e.g. "run:run_...:dom" | "exploration". */
  source: string;
}

// ---- journeys (summary form; full records live in @clapp/journey) ---------

export interface IrJourney {
  /** "journey_" + uuid v4 — the id IS the locator of the full record. */
  id: string;
  purpose: string;
  /** state invariants required before start. */
  preconditions: string[];
  /** human-readable step summaries, one per action. */
  steps: string[];
  provenance: Provenance;
}

// ---- screens & components (doc §6: semantic structure over pixels) --------

export interface IrScreen {
  id: string;             // "screen_" + uuid v4
  /** normalized route/URL pattern, e.g. "/pricing". */
  route: string;
  provenance: Provenance;
  /** DOM capture evidence backing structure. */
  treeRef?: EvidenceRef;
  /** screenshot evidence. */
  visualRef?: EvidenceRef;
}

export interface IrComponent {
  id: string;             // "comp_" + uuid v4
  /** semantic role from the shared role table. */
  role: string;
  /** owning screen. */
  screenId: string;
  properties: Record<string, unknown>;
  /** event names the component emits/accepts, e.g. ["click","focus"]. */
  events: string[];
  provenance: Provenance;
}

// ---- state machine (doc §4; screens are the v0 state nodes) ---------------

export interface IrStateVariable {
  id: string;             // "var_" + uuid v4
  /** dotted path, e.g. "cart.itemCount". */
  name: string;
  /** 'boolean' | 'count' | 'enum' | 'text' | 'json' | 'unknown'. */
  domain: string;
  provenance: Provenance;
}

export type IrTransitionTrigger =
  | { type: 'action'; action: string }             // click|type|submit|drag|scroll|navigate|upload|download
  | { type: 'timer'; label?: string }
  | { type: 'background-event'; label?: string }
  | { type: 'api-response'; operationId: string }  // "op_" + uuid v4
  | { type: 'websocket-message'; label?: string };

export interface IrTransition {
  id: string;             // "trans_" + uuid v4
  /** state_before screen. */
  fromScreenId: string;   // "screen_" + uuid v4
  /** state_after screen; self-transition is legal. */
  toScreenId: string;     // "screen_" + uuid v4
  trigger: IrTransitionTrigger;
  /** observed input payload (canonical-JSON safe). */
  input?: unknown;
  /** observed outputs. */
  outputs?: unknown[];
  /** declared side-effect labels, e.g. "persists cart". */
  sideEffects: string[];
  provenance: Provenance;
}

// ---- data & API ------------------------------------------------------------

export interface IrDataField {
  name: string;
  domain: string;
  provenance: Provenance;
}

export interface IrDataEntity {
  id: string;             // "ent_" + uuid v4
  name: string;
  fields: IrDataField[];
  /** storage locations, e.g. ["localStorage:newsletter-email"]. */
  persistence: string[];
}

/** Doc §5 replayability — external contract only; never claim server internals. */
export type Replayability =
  | 'replayable'          // deterministic, side-effect-free on observation
  | 'needs-auth'          // replay requires credentials
  | 'side-effects'        // external state mutates on replay
  | 'unreproducible';     // could not be observed

export interface IrApiOperation {
  id: string;             // "op_" + uuid v4
  transport: 'http' | 'websocket' | (string & {});
  /** http verb; absent for non-http transports. */
  method?: string;
  /** normalized, parameterized, e.g. "/api/items/:id". */
  urlPattern: string;
  /** header NAMES required for the call to succeed (never values). */
  headersNeeded?: string[];
  /** canonical-JSON-safe schema descriptors; absent when unknown. */
  requestSchema?: unknown;
  responseSchema?: unknown;
  errorSchema?: unknown;
  /** auth dependency label, e.g. "session-cookie". */
  authDependency?: string;
  observedExamples: EvidenceRef[];
  replayability: Replayability;
  externalSideEffects: string[];
  provenance: Provenance;
}

// ---- integrations, assumptions, constraints --------------------------------

/** Doc §2 integrations status vocabulary. */
export type IntegrationStatus = 'observed' | 'inferred' | 'mocked' | 'unreproducible';

export interface IrIntegration {
  id: string;             // "integ_" + uuid v4
  capability: string;
  status: IntegrationStatus;
  provenance: Provenance;
}

export interface IrAssumption {
  id: string;             // "assume_" + uuid v4
  statement: string;
  provenance: Provenance;
}

// ---- the model -------------------------------------------------------------

/** The Behavioral IR model — the whole canonical artifact (doc §2). */
export interface IrModel {
  modelVersion: string;   // MUST equal IR_MODEL_VERSION ('0.1') in v0
  application: IrApplication;
  environment: IrEnvironment;
  /** evidence catalog; refs cited throughout the model resolve here. */
  evidence: IrEvidenceEntry[];
  journeys: IrJourney[];
  screens: IrScreen[];
  components: IrComponent[];
  state: {
    variables: IrStateVariable[];
    transitions: IrTransition[];
  };
  data: {
    entities: IrDataEntity[];
  };
  api: {
    operations: IrApiOperation[];
  };
  integrations: IrIntegration[];
  assumptions: IrAssumption[];
  constraints: string[];
}

// ---- adapter compatibility declaration (doc §8) ----------------------------

/** Every IR producer/consumer adapter declares its support honestly. */
export interface IrAdapterInfo {
  adapterId: string;
  supportedModelVersions: string[];
  /** top-level model sections this adapter populates/reads. */
  emittedCapabilities: string[];
  /** constructs declared unsupported — never silently dropped. */
  unsupportedConstructs: string[];
  /** what happens when an unsupported construct is encountered. */
  degradationBehavior: string;
}
`;

describe('ir-contract mirror (src/ir-contract.ts)', () => {
  test('is byte-identical to the frozen tech-lead declaration', async () => {
    const text = await readFile(new URL('./ir-contract.ts', import.meta.url), 'utf8');
    expect(text).toBe(FROZEN_CONTRACT);
  });

  test('header declares @clapp/ir as the canonical owner', async () => {
    const text = await readFile(new URL('./ir-contract.ts', import.meta.url), 'utf8');
    expect(text).toContain('Canonical owner: @clapp/ir (CLAPP-020)');
  });

  test('IR_MODEL_VERSION is 0.1', () => {
    expect(IR_MODEL_VERSION).toBe('0.1');
  });

  test('the mirror satisfies the structural needs of an emitted model (compile-time shape)', () => {
    // Compile-time shape probe: a literal conforming to the mirror types
    // (the same form the extractors construct at runtime).
    const model: IrModel = {
      modelVersion: IR_MODEL_VERSION,
      application: { id: 'app_00000000-0000-4000-8000-000000000000', name: 'probe', platform: 'web', entrypoints: [] },
      environment: { browser: 'probe' },
      evidence: [],
      journeys: [],
      screens: [],
      components: [],
      state: { variables: [], transitions: [] },
      data: { entities: [] },
      api: { operations: [] },
      integrations: [],
      assumptions: [],
      constraints: [],
    };
    expect(model.modelVersion).toBe('0.1');
  });
});
