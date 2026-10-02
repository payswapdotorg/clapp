/**
 * @clapp/library — public API (CLAPP-050).
 *
 * The CLAPP Package Library's FIRST lane (P5, the first two roadmap
 * checkboxes: "package schema" + "extraction"): the PackageManifest v0.1
 * contract (fail-closed validator, canonical serialization,
 * content-addressed mintPackageId) and the package extractor over the
 * frozen P4 synthesis/parity ports — fail-closed unverified-candidate
 * gate, deterministic, honest counting.
 *
 * The package compatibility graph landed with CLAPP-051; the package
 * retrieval landed with CLAPP-052; the package replay benchmark landed
 * with CLAPP-053. Registry and the promotion gate are LATER lanes
 * (CLAPP-054) — NOT in this package.
 *
 * Quick start:
 *
 *   import { extractPackages, validatePackageManifest } from '@clapp/library';
 *
 *   const result = await extractPackages(
 *     { plan, app, parity: { report, repair } },
 *     { generatedAt: '2026-10-02T12:00:00Z', version: '1.0.0' },
 *   );
 *   // result.gate === 'verified'             ⇔ verdict 'equivalent' + 0 critical + repair converged
 *   // result.gate === 'unverified-candidate' ⇔ the fail-closed §8 gate refused to package
 *   // result.gate === 'malformed'            ⇔ a port violated its frozen contract shape
 *   // result.packages — zero or one PackageCandidate (stage 'candidate'), counted honestly
 *
 * Sibling packages must import `@clapp/library` and never reach into
 * deeper paths. The extractor consumes contract-shaped DATA: @clapp/plan,
 * @clapp/codegen, @clapp/diff and @clapp/repair are devDependencies
 * imported for TYPES ONLY (pinned by test/imports.test.ts); the runtime
 * dependencies are exactly @clapp/core and @clapp/observe.
 */

// ---- the package contract v0.1 (canonical owner: this package) ------------------
export {
  PACKAGE_ID_PATTERN,
  PACKAGE_VERSION,
  canonicalPackageJson,
  mintPackageId,
  validatePackageManifest,
} from './package-contract';
export type {
  PackageIdHashFn,
  PackageManifest,
  PackageProvenance,
  PackageValidationResult,
} from './package-contract';

// ---- the frozen @clapp/core v0 evidence vocabulary the manifest's evidence uses --
export type { EvidenceRef } from '@clapp/core';

// ---- the candidate record (§5 stage 'candidate' — extraction mints ONLY candidates) --
export { EXTRACTED_BY } from './record';
export type { PackageCandidate, PackageStage } from './record';

// ---- the extractor ----------------------------------------------------------------
export { extractPackages } from './extract';
export type { ExtractionPorts, ExtractionResult, ExtractOptions } from './extract';

// ---- the package compatibility graph (CLAPP-051 — P5 lane 2) ----------------------
export { GRAPH_VERSION, buildCompatGraph } from './compat-graph';
export type {
  CompatGraph,
  CompatEdge,
  CompatNode,
  CompatGraphResult,
  CompatibilityVerdict,
} from './compat-graph';

// ---- the package retrieval (CLAPP-052 — P5 lane 3) --------------------------------
export { RETRIEVAL_VERSION, retrievePackages } from './retrieval';
export type {
  RetrievalQuery,
  RetrievalResult,
  RetrieveResult,
  ScoredCandidate,
  RetrievalScoreComponents,
} from './retrieval';

// ---- the package replay benchmark (CLAPP-053 — P5 lane 4) ------------------------
export { REPLAY_VERSION, replayCandidate } from './replay-benchmark';
export type { ReplayPorts, ReplayBenchmarkRecord, ReplayResult } from './replay-benchmark';

// ---- the promotion gate (CLAPP-054 — the tech lead's lane) -------------------------
export { PROMOTED_BY, PROMOTION_VERSION, promoteCandidate } from './promotion';
export type {
  PackagePromotionRecord,
  PromotionEvidence,
  PromotionOptions,
  PromotionResult,
  PromotedStage,
} from './promotion';
