# @clapp/evidence

CLAPP-011 — evidence manifest & recording session. Turns live
`CaptureRecord`s into tamper-evident, persisted, verifiable evidence:

- **`RecordingSession`** implements the canonical `EvidenceRecorder` port
  (`src/capture-contract.ts` — the byte-identical tech-lead declaration;
  this package is the canonical owner) over an injected `RunStore` +
  `ArtifactStore` from `@clapp/store`.
- **`buildBundle`** seals a run into an `EvidenceBundle { manifest, rootHash }`.
- **`verify`** re-hashes every artifact and the manifest against the stores
  and reports the first failure with a machine-readable `TamperCode`.
- **`saveBundle` / `loadBundle`** persist sealed bundles to disk.

## Usage (10 lines)

```ts
import { FsArtifactStore, FsRunStore } from '@clapp/store';
import { RecordingSession, buildBundle, loadRunFromStores, saveBundle, loadBundle, verify } from '@clapp/evidence';

const runStore = new FsRunStore('./data');                        // 1
const artifactStore = new FsArtifactStore('./data');               // 2
const session = await RecordingSession.start({ runStore, artifactStore }, { targetId: 'bench/b01-static' }); // 3
await session.record({ kind: 'dom', ts: new Date().toISOString(), payload: { title: 'Home' }, redacted: false }); // 4
await session.complete();                                          // 5
const bundle = await buildBundle((await loadRunFromStores({ runStore, artifactStore }, session.runId))!); // 6
await saveBundle('./out/b01-run', bundle, artifactStore);          // 7
const loaded = await loadBundle('./out/b01-run');                  // 8
const result = await verify(loaded, { runStore, artifactStore });  // 9
console.log(result.ok ? `sealed: ${loaded.rootHash}` : `TAMPER ${result.code}: ${result.detail}`); // 10
```

## Modules

| module | contents |
| --- | --- |
| `src/capture-contract.ts` | CANONICAL capture contract v0 (byte-identical to the tech-lead declaration; pinned by a byte-exact test) |
| `src/canonical-json.ts` | `canonicalJson` / `canonicalJsonBytes` / `hashCanonicalJson` — sorted keys, stable escapes, compact; rejects non-plain values |
| `src/recording-session.ts` | `RecordingSession` (+ lifecycle `complete/fail/cancel`, `log`), `EVIDENCE_TO_ARTIFACT_KIND` mapping |
| `src/bundle.ts` | `EvidenceBundle`, `buildBundle`, `loadRunFromStores`, `MANIFEST_SCHEMA_VERSION` |
| `src/verify.ts` | `verify`, `TamperCode`, `TAMPER_CODES`, `VerifyResult` |
| `src/persist.ts` | `saveBundle`, `loadBundle`, `EvidencePersistenceError` |
| `src/manifest-shape.ts`, `src/inspect.ts` | internal shape validators / inspection helpers (not exported) |

## Manifest & bundle format

`EvidenceManifest` (schemaVersion 1):

- `run` — the full `RunMeta` as of build time.
- `events` — the full event stream, seq order.
- `evidence` — every `EvidenceRef` carried by any event, event order,
  deduped by `evidenceId`.
- `artifacts` — every `ArtifactRecord`, insertion order.

`rootHash = sha256(canonicalJson(manifest))`. `buildBundle` is a pure
function of the `LoadedRun` (no timestamps, no randomness): rebuilding an
unchanged run yields the identical root hash. The manifest you get back is
the `JSON.parse` of its own canonical serialization — detached and key-sorted.

Every capture is persisted as an artifact whose bytes are the canonical JSON
of the whole `CaptureRecord` (`mediaType: application/json`); the artifact
kind comes from `EVIDENCE_TO_ARTIFACT_KIND` (`dom→dom-snapshot`,
`runtime→trace`, `network→har`, `screenshot→screenshot`; `storage`, `static`
and `user` use the extensible tail of `ArtifactKind` — documented
package-level extensions).

## Persisted layout (saveBundle)

```
<dir>/bundle.json                 pretty JSON { manifest, rootHash } (commit marker, written last)
<dir>/blobs/<aa>/<bb>/<sha256>    byte-identical copies of every manifest artifact blob
```

Write-once like the store: identical re-saves are no-ops; divergent
overwrites throw. `loadBundle` is a mechanical parse — tamper detection is
`verify`'s job (a tampered `bundle.json` loads fine and then fails
`ROOT_HASH_MISMATCH`).

## Tamper codes (FROZEN — extend-only, never rename)

`BUNDLE_MALFORMED`, `MANIFEST_MALFORMED`, `ROOT_HASH_MISMATCH`,
`RUN_META_MISMATCH`, `EVENT_SEQ_INVALID`, `EVENT_MISSING`,
`ARTIFACT_MISSING`, `MANIFEST_HASH_MISMATCH`, `ARTIFACT_HASH_MISMATCH`,
`REF_UNKNOWN`, `REF_KIND_MISMATCH`.

`verify` checks phases in a fixed order and reports the FIRST failure:
wrapper shape → manifest shape → root hash → run identity (status/endedAt
excluded — mutable by design) → event stream ordering (manifest then store)
→ manifest events ⊆ store events verbatim → per artifact: exists → record
agrees → bytes re-hash → per evidence ref: event-backed → artifact-backed →
kind-consistent. Re-sealing a tampered manifest (recomputing rootHash)
defeats only the root-hash phase — store cross-checks still catch it.

## Known limitations (honest)

- **Concurrency**: single-writer assumption. `RecordingSession` owns seq
  assignment for its run; the fs stores have no locking, so concurrent
  appends from another process can interleave (the store's monotonicity
  check throws on collisions instead of corrupting). No cross-process
  session coordination exists in v0.
- **readBytes error mapping**: the frozen store surface signals a missing
  blob by THROWING (only a missing record returns null). `verify` maps
  thrown errors to `ARTIFACT_MISSING` vs `ARTIFACT_HASH_MISMATCH` by the
  store's message wording ("is missing"); a store with different wording
  would surface as `ARTIFACT_HASH_MISMATCH`. Documented wart, honest
  failure either way.
- **Saved bundles are not standalone-verifiable**: `verify` requires the
  original stores. The `blobs/` export exists so a future bundle-side
  verifier (extension point, NOT implemented) can re-hash without the store.
- **Extra store state is allowed**: events appended to the store AFTER the
  bundle was built (and artifacts put after) do not fail verification —
  bundles are point-in-time seals; the manifest must be a subset of the
  store, never the reverse.
- **Canonical JSON strictness**: `undefined`, `bigint`, `symbol`,
  `function`, `Date`/`Map`/`Set`/class instances, non-finite numbers and
  cycles are rejected (a run whose `environment` contains such values —
  possible with in-memory stores — cannot be sealed; fs-reloaded runs are
  always plain JSON). Silent-drop semantics (`{a: undefined}` → `{}`) are
  deliberately NOT used: hashing must be lossless.
- **No secret scanning**: the recorder persists exactly what a channel
  sends and copies the `redacted` flag; redaction happens upstream
  (channels), by contract.
- **Evidence artifacts are JSON**: captures are stored as canonical JSON
  bytes (screenshots ride inside payloads, e.g. base64). Binary-native
  artifact encodings are future work.
- **Dedup scope**: `record()` dedupes byte-identical captures within one
  session; a second session recording identical bytes mints a new
  evidenceId/event (honest: a new observation).
- **fs layout stability**: the manifest validator checks `storageKey`
  against the `objects/<aa>/<bb>/<sha256>` shape both shipped stores
  produce; a future store with a different key scheme would need a schema
  bump.

## Contract ownership

`src/capture-contract.ts` is the CANONICAL copy of the shared P1
declaration (header names this package as owner). `@clapp/observe`
(CLAPP-010) implements capture channels against this port; changes require
an ADR and a tech-lead freeze.
