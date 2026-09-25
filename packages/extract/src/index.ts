/**
 * @clapp/extract — public API (CLAPP-021).
 *
 * Evidence-to-IR extraction: turns a sealed @clapp/evidence bundle plus a
 * reader for its artifact bytes into a Behavioral IR model (v0.1) whose
 * every inferred element carries honest provenance citing the bundle's
 * refs. Degraded input degrades the model (warnings + assumptions), never
 * the extraction.
 *
 * Composition:
 *
 *   import { extractIrModel } from '@clapp/extract';
 *
 *   const { model, warnings, stats } = await extractIrModel({
 *     bundle,                                     // sealed EvidenceBundle
 *     readArtifact: (id) => artifactStore.readBytes(id),
 *   });
 *
 * The ir-contract types are carried as a byte-identical mirror
 * (src/ir-contract.ts; canonical owner @clapp/ir, CLAPP-020 — the tech
 * lead verifies byte-equality at integration and freezes). Contract
 * changes require an ADR.
 */

// ---- shared contract mirror (canonical owner: @clapp/ir) -------------------
export * from './ir-contract';

// ---- extraction ------------------------------------------------------------
export { EXTRACT_ADAPTER_INFO, extractIrModel } from './extraction';
export type { ExtractionInput, ExtractionResult, ExtractionStats } from './extraction';
