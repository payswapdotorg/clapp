import type { ArtifactId, EvidenceId, RunId } from './contract';

/**
 * Identifier helpers for the CLAPP core contract.
 *
 * All identifiers are prefixed uuid v4 strings so log lines, object-store
 * keys, and foreign keys are self-describing: `run_`, `art_`, `ev_`.
 */

/** Fresh `RunId`: `"run_" + uuid v4`. */
export function newRunId(): RunId {
  return `run_${crypto.randomUUID()}`;
}

/** Fresh `ArtifactId`: `"art_" + uuid v4`. */
export function newArtifactId(): ArtifactId {
  return `art_${crypto.randomUUID()}`;
}

/** Fresh `EvidenceId`: `"ev_" + uuid v4`. */
export function newEvidenceId(): EvidenceId {
  return `ev_${crypto.randomUUID()}`;
}
