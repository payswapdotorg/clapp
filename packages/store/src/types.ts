// @clapp/store — public interface surface.
//
// The persisted record shapes (RunMeta, RunEvent, ArtifactRecord, ...) are
// frozen by the tech lead in @clapp/core (`src/contract.ts`). This module
// declares the store-facing interfaces that operate on those records; the
// concrete filesystem and in-memory implementations live in ./fs-store and
// ./memory-store and are re-exported from ./index.ts.

import type {
  ArtifactId,
  ArtifactKind,
  ArtifactRecord,
  RunEvent,
  RunId,
  RunMeta,
  RunStatus,
} from '@clapp/core';

/** Input to {@link ArtifactStore.put}: raw bytes plus the provenance the caller owns. */
export interface PutArtifactInput {
  runId: RunId;
  kind: ArtifactKind;
  mediaType: string;
  bytes: Uint8Array;
  /** default false — true if secrets were removed before persisting */
  redacted?: boolean;
}

/**
 * Content-addressed artifact store.
 *
 * `put` computes the sha256 of `bytes`; if a record with the same
 * (runId, sha256, kind) already exists it returns the EXISTING record and
 * writes nothing (idempotent — never a second copy). `storageKey` is a
 * deterministic, store-owned key derived from the content hash.
 */
export interface ArtifactStore {
  put(input: PutArtifactInput): Promise<ArtifactRecord>;
  get(id: ArtifactId): Promise<ArtifactRecord | null>;
  getBySha256(sha256: string, runId: RunId): Promise<ArtifactRecord | null>;
  /** bytes by record id; null when the record does not exist */
  readBytes(id: ArtifactId): Promise<Uint8Array | null>;
  list(runId: RunId): Promise<ArtifactRecord[]>;
}

/**
 * Run metadata + append-only event log.
 *
 * `appendEvent` validates seq monotonicity (first event must be seq 0; each
 * subsequent seq must be strictly greater — duplicates and out-of-order
 * appends throw) and never rewrites previously appended events.
 * `updateStatus` mutates only `status`/`endedAt`.
 */
export interface RunStore {
  createRun(meta: RunMeta): Promise<RunMeta>;
  /** append-only, seq-validated */
  appendEvent(event: RunEvent): Promise<void>;
  getRun(id: RunId): Promise<RunMeta | null>;
  /** ordered by seq (== insertion order; appends are validated monotonic) */
  listEvents(id: RunId): Promise<RunEvent[]>;
  updateStatus(id: RunId, status: RunStatus, endedAt?: string): Promise<RunMeta | null>;
}

/** A whole run loaded back from persistence, ready to replay. */
export interface LoadedRun {
  meta: RunMeta;
  /** seq order */
  events: RunEvent[];
  artifacts: ArtifactRecord[];
}
