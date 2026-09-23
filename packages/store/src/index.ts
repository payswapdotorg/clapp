/**
 * @clapp/store — CLAPP persistence & artifact layer (v0).
 *
 * Semantics guaranteed by every implementation (see
 * docs/ACCEPTANCE_TESTS.md §A2 "Artifact provenance"):
 *
 * - **Content addressing**: `put` hashes bytes with sha256; the blob lives at
 *   a deterministic `objects/<aa>/<bb>/<sha256>` key and
 *   `ArtifactRecord.sha256` is that hash. `getBySha256` retrieves by content
 *   hash; `readBytes` re-verifies the hash on every read (fs), so tampered
 *   evidence fails loudly instead of replaying silently.
 * - **Immutability**: putting the same bytes (same run + kind) twice returns
 *   the ONE canonical record — no duplicate copy is ever written. Blobs are
 *   write-once: divergent content under an existing hash is an integrity
 *   error, never an overwrite. `createRun` is idempotent for identical meta
 *   and throws on divergent re-creation. Event logs are append-only.
 * - **Append-only events**: the first event of a run must have `seq` 0; each
 *   subsequent `seq` must be strictly greater (duplicate or out-of-order
 *   appends throw; gaps are tolerated — still strictly increasing).
 *   `updateStatus` rewrites only `status`/`endedAt`, never history.
 * - **Provenance is never invented**: records carry exactly the run id,
 *   kind, media type, redaction flag and timestamps they were given.
 *
 * Filesystem layout (FsArtifactStore/FsRunStore share one rootDir):
 *
 * ```
 * objects/<aa>/<bb>/<sha256>          content-addressed blobs (write-once)
 * runs/<runId>.json                    run metadata (only status/endedAt mutate)
 * events/<runId>.jsonl                 append-only run event log (JSONL)
 * artifacts/by-id/<artifactId>.json    artifact records (write-once)
 * artifacts/by-run/<runId>.jsonl       append-only per-run artifact manifest
 * ```
 *
 * Known v0 limits (honest failure modes): no Postgres adapter yet — the
 * interfaces above are engine-agnostic so one can slot in later; the fs
 * layout is NOT safe for concurrent writers from multiple processes (no
 * locking); event logs are re-read per append (O(n) per append, fine at
 * run scale); listEvents/getBySha256 dedupe ordering is insertion order.
 */

export type { ArtifactStore, LoadedRun, PutArtifactInput, RunStore } from './types';
export { FsArtifactStore, FsRunStore, loadRun } from './fs-store';
export { MemoryArtifactStore, MemoryRunStore } from './memory-store';
