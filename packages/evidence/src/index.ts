/**
 * @clapp/evidence — public API.
 *
 * CLAPP-011: evidence manifest & recording session. Turns live CaptureRecords
 * into tamper-evident, persisted, verifiable evidence:
 *
 * - {@link RecordingSession} implements the canonical EvidenceRecorder port
 *   (src/capture-contract.ts) over an injected RunStore + ArtifactStore.
 * - {@link buildBundle} seals a run's manifest; {@link verify} re-hashes it
 *   against the stores with a frozen tamper-code set.
 * - {@link saveBundle}/{@link loadBundle} persist sealed bundles to disk.
 *
 * Sibling packages must import `@clapp/evidence` and never reach into deeper
 * paths. The capture contract is CANONICAL here (see src/capture-contract.ts
 * header); @clapp/observe and @clapp/journey carry byte-identical mirrors.
 * Contract changes require an ADR (tech-lead freeze at integration).
 */

// ---- canonical capture contract (canonical owner: this package) ----------
export type { CaptureRecord, EvidenceRecorder } from './capture-contract';

// ---- canonical JSON -------------------------------------------------------
export {
  CanonicalJsonError,
  canonicalJson,
  canonicalJsonBytes,
  hashCanonicalJson,
  isCanonicalJsonSafe,
} from './canonical-json';

// ---- recording session ----------------------------------------------------
export {
  EVIDENCE_MEDIA_TYPE,
  EVIDENCE_TO_ARTIFACT_KIND,
  InvalidCaptureError,
  RecordingSession,
  SessionStateError,
  artifactKindForEvidence,
} from './recording-session';
export type { RecordingStores, StartRecordingOptions } from './recording-session';

// ---- bundle ---------------------------------------------------------------
export { MANIFEST_SCHEMA_VERSION, buildBundle, loadRunFromStores } from './bundle';
export type { EvidenceBundle, EvidenceManifest } from './bundle';

// ---- verification ---------------------------------------------------------
export { TAMPER_CODES, verify } from './verify';
export type { TamperCode, VerificationStores, VerifyResult } from './verify';

// ---- persistence ----------------------------------------------------------
export { EvidencePersistenceError, loadBundle, saveBundle } from './persist';
