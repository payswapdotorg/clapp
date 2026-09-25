/**
 * @clapp/extract — evidence-to-IR extraction (CLAPP-021).
 *
 * extractIrModel turns a sealed EvidenceBundle plus the artifact bytes
 * behind it into a Behavioral IR model (ir-contract v0.1) whose every
 * inferred element carries honest provenance citing the bundle's refs.
 *
 * Pipeline (each stage is a pure function of the walked captures):
 *
 *   bundle.manifest ──walkCaptures──▶ ConsumedCapture[]  (event order,
 *        │                              hash-verified, degraded skips only)
 *        ├──▶ route timeline          (document requests → route runs)
 *        ├──▶ screens + components    (dom-tree grouped by current route)
 *        ├──▶ api operations          (request/response pairs by url+method)
 *        ├──▶ data entities + state variables (storage inventories)
 *        ├──▶ navigation transitions  (consecutive distinct routes)
 *        └──▶ assumptions             (every degradation, confidence <= 0.5)
 *
 * Honesty model:
 *   - unreadable / tampered / unparseable / unknown-subkind captures are
 *     skipped with warnings, never fatal;
 *   - the evidence catalog lists EVERY manifest ref (even unreadable ones —
 *     the catalog describes the bundle, the model cites only what it could
 *     actually read);
 *   - the self-check (check-ir-literal) runs on the finished model and
 *     THROWS on violation — that is a bug guard on this package's own
 *     emissions, not input degradation;
 *   - a grossly malformed manifest throws (it is not evidence-shaped at
 *     all); use @clapp/evidence's verify for tamper detection — extraction
 *     trusts a bundle that verifies.
 *
 * Application identity honesty: name = run.targetId (the only name the
 * evidence carries), platform 'web' (derived from web-shaped evidence
 * channels), entrypoints = the first document route observed (where the
 * observation entered the app). Documented in the README.
 */

import type { RunMeta } from '@clapp/core';
import type { EvidenceBundle, EvidenceManifest } from '@clapp/evidence';
import type { IrApplication, IrAssumption, IrEnvironment, IrEvidenceEntry, IrModel } from './ir-contract';
import { IR_MODEL_VERSION } from './ir-contract';
import { AssumptionCollector } from './assumptions';
import { assertManifestShape, walkCaptures, type ReadArtifact } from './capture-reader';
import { checkIrLiteral, collectCitedEvidenceRefs } from './check-ir-literal';
import { extractApiOperations } from './api-extractor';
import { extractScreens } from './screens-extractor';
import { extractStorage } from './storage-extractor';
import { extractTransitions } from './transitions-extractor';
import { buildRouteTimeline } from './route-timeline';
import { newApplicationId, newIrEvidenceEntryId } from './ids';

/** The input contract: a sealed bundle + a reader for its artifact bytes. */
export interface ExtractionInput {
  bundle: EvidenceBundle;
  readArtifact: ReadArtifact;
}

export interface ExtractionStats {
  /** captures read, hash-verified, parsed, and dispatched to an extractor. */
  capturesParsed: number;
  /** captures skipped (unreadable / tampered / unparseable / unknown subkind). */
  capturesSkipped: number;
  /** distinct evidence refs cited by the emitted model. */
  evidenceCited: number;
  screensEmitted: number;
  operationsEmitted: number;
  transitionsEmitted: number;
}

export interface ExtractionResult {
  model: IrModel;
  /** every degradation, precise and honest (empty on a clean run). */
  warnings: string[];
  stats: ExtractionStats;
}

/** This package's honest adapter declaration (ir-contract doc §8). */
export const EXTRACT_ADAPTER_INFO = {
  adapterId: '@clapp/extract',
  supportedModelVersions: [IR_MODEL_VERSION],
  emittedCapabilities: [
    'application',
    'environment',
    'evidence',
    'screens',
    'components',
    'state.variables',
    'state.transitions',
    'data.entities',
    'api.operations',
    'assumptions',
    'constraints',
  ],
  unsupportedConstructs: [
    "journeys (full journey records are @clapp/journey's domain; v0 extraction does not derive them)",
    'integrations (no third-party integration detection from passive evidence)',
    'action-level state transitions (observation runs emit no captures for action steps — exploration, CLAPP-022, owns that)',
    'runtime console / static asset / service-worker / cache evidence (cataloged but not modeled in ir-contract v0.1)',
  ],
  degradationBehavior:
    'unreadable, tampered, unparseable, or unknown-subkind captures are skipped with warnings and (where guesswork would otherwise creep in) assumptions with confidence <= 0.5; extraction never fails on degraded input',
} as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function environmentFromRun(run: RunMeta): IrEnvironment {
  const source = run.environment ?? {};
  const environment: IrEnvironment = {};
  for (const key of ['browser', 'os', 'locale', 'timezone', 'network'] as const) {
    const value = source[key];
    if (typeof value === 'string') {
      environment[key] = value;
    }
  }
  const viewport = source['viewport'];
  if (isPlainObject(viewport) && typeof viewport['width'] === 'number' && typeof viewport['height'] === 'number') {
    environment.viewport = { width: viewport['width'], height: viewport['height'] };
  }
  return environment;
}

function applicationFromRun(run: RunMeta, firstRoute: string | undefined): IrApplication {
  return {
    id: newApplicationId(),
    name: run.targetId,
    platform: 'web',
    entrypoints: firstRoute !== undefined ? [firstRoute] : [],
  };
}

export async function extractIrModel(input: ExtractionInput): Promise<ExtractionResult> {
  if (!isPlainObject(input) || !isPlainObject(input.bundle)) {
    throw new TypeError('extractIrModel: input must be { bundle, readArtifact }');
  }
  if (typeof input.readArtifact !== 'function') {
    throw new TypeError('extractIrModel: input.readArtifact must be a function (id: ArtifactId) => Promise<Uint8Array | null>');
  }
  const manifest: EvidenceManifest = input.bundle.manifest;
  assertManifestShape(manifest);

  // ---- walk the manifest (never fatal on degraded captures) ----
  const walk = await walkCaptures(manifest, input.readArtifact);

  // ---- evidence catalog: EVERY manifest ref (catalog describes the
  // bundle; the model cites only refs it could actually read) ----
  const evidence: IrEvidenceEntry[] = manifest.evidence.map((ref) => ({
    id: newIrEvidenceEntryId(),
    ref: { evidenceId: ref.evidenceId, kind: ref.kind, sha256: ref.sha256 },
    source: `run:${manifest.run.id}:${ref.kind}`,
  }));

  // ---- extraction stages ----
  const collector = new AssumptionCollector();
  const timeline = buildRouteTimeline(walk.captures);
  const screens = extractScreens(walk.captures, timeline, collector);
  const api = extractApiOperations(walk.captures, collector);
  const storage = extractStorage(walk.captures, collector);
  const transitions = extractTransitions(walk.captures, timeline, screens.recordsByRoute);
  const assumptions: IrAssumption[] = collector.list();

  const firstRoute = timeline.runs[0]?.route;
  const model: IrModel = {
    modelVersion: IR_MODEL_VERSION,
    application: applicationFromRun(manifest.run, firstRoute),
    environment: environmentFromRun(manifest.run),
    evidence,
    journeys: [],
    screens: screens.screens,
    components: screens.components,
    state: {
      variables: storage.stateVariables,
      transitions: transitions.transitions,
    },
    data: {
      entities: storage.entities,
    },
    api: {
      operations: api.operations,
    },
    integrations: [],
    assumptions,
    constraints: [
      'action-level state transitions are not derivable from this evidence set; only document-navigation transitions are modeled (exploration, CLAPP-022, owns action-level transitions)',
      `model derived from a single sealed evidence bundle (run ${manifest.run.id}): ${walk.stats.capturesParsed} captures parsed, ${walk.stats.capturesSkipped} skipped, ${evidence.length} cataloged`,
    ],
  };

  // ---- self-check: bug guard on THIS package's emissions ----
  const violations = checkIrLiteral(model, manifest.evidence);
  if (violations.length > 0) {
    throw new Error(`extractIrModel: emitted model violates the ir-contract invariants (internal bug): ${violations.join('; ')}`);
  }

  const stats: ExtractionStats = {
    capturesParsed: walk.stats.capturesParsed,
    capturesSkipped: walk.stats.capturesSkipped,
    evidenceCited: collectCitedEvidenceRefs(model).length,
    screensEmitted: model.screens.length,
    operationsEmitted: model.api.operations.length,
    transitionsEmitted: model.state.transitions.length,
  };

  const warnings = [
    ...walk.warnings,
    ...screens.warnings,
    ...api.warnings,
    ...storage.warnings,
    ...transitions.warnings,
  ];

  return { model, warnings, stats };
}
