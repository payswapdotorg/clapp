# @clapp/library — CLAPP Package Library, lane 1 (CLAPP-050)

The Phase-5 FIRST lane: the **PackageManifest v0.1 contract** (fail-closed
validator, canonical serialization, content-addressed `mintPackageId`) and
the **package extractor** over the frozen P4 synthesis/parity ports —
fail-closed `unverified-candidate` gate, deterministic, honest counting.

**Out of scope (later lanes):** registry, retrieval, promotion/replay gates
(CLAPP-052/054 — see `docs/ROADMAP.md` P5). The compatibility graph landed
(CLAPP-051, `buildCompatGraph`).

**Non-degeneracy rule (binding):** the extractor consumes contract-shaped
DATA only. `@clapp/plan`, `@clapp/codegen`, `@clapp/diff` and
`@clapp/repair` are devDependencies imported for TYPES ONLY (`import
type` — pinned by `test/imports.test.ts`); the runtime dependencies are
exactly `@clapp/core` (`sha256Hex` + `EvidenceRef`) and `@clapp/observe`
(`canonicalJson`). The frozen contract VERSION strings (`'0.1'` for both
the synthesis and diff contracts) are pinned in `src/extract.ts` — they
cannot be imported at runtime without importing the implementations.

```
extractPackages({ plan, app, parity: { report, repair } }, { generatedAt, version })
  ├─ malformed port (planVersion mismatch, empty app, missing counts, …)
  │      → { packages: [], gate: 'malformed', reason }        (results, never exceptions)
  ├─ verdict ≠ 'equivalent'  OR  counts.critical ≠ 0  OR  repair.converged ≠ true
  │      → { packages: [], gate: 'unverified-candidate', reason }   ← §8 contamination guard
  └─ verified → mint ONE PackageCandidate (stage 'candidate')
         manifest: PackageManifest v0.1, id = 'pkg_' + sha256Hex(canonical(manifest − id))
         extractionContext: { extractedBy: 'CLAPP-050', manifestSha256 }
```

## Public surface (`src/index.ts`)

| export | what it is |
| --- | --- |
| `PACKAGE_VERSION` | the manifest contract version (`'0.1'`) — mirrors `PLAN_VERSION` / `DIFF_CONTRACT_VERSION` style |
| `PACKAGE_ID_PATTERN` | the minted-id pattern: `pkg_` + 64 lowercase hex chars |
| `PackageManifest`, `PackageProvenance` | the §4 field list, TypeScript-shaped (the AUTHORITATIVE vocabulary is `docs/LEARNING_AND_LIBRARY.md` §4) |
| `validatePackageManifest(manifest)` | fail-closed, field-by-field validation: collects ALL errors, every error names its field |
| `canonicalPackageJson(manifest)` | `canonicalJson` over the manifest with `id` EXCLUDED — the minting input; byte-deterministic |
| `mintPackageId(manifest, sha256hex?)` | content-addressed identity: `'pkg_' + sha256Hex(canonicalPackageJson(manifest))`; injectable hash fn |
| `extractPackages(ports, options)` | the extractor (below); `options = { generatedAt, version }`, both CALLER-injected |
| `PackageCandidate`, `EXTRACTED_BY` | the §5 record: manifest + `stage: 'candidate'` + extraction context |
| `ExtractionPorts`, `ExtractionResult`, `ExtractOptions` | the extractor's data shapes |
| `EvidenceRef` (type re-export) | the frozen `@clapp/core` v0 evidence vocabulary the manifest's evidence entries use |

## The manifest contract (v0.1)

Exactly the §4 YAML field list: `packageVersion, id, version, category,
purpose, interface, capabilities, constraints, dependencies,
supportedTargets, provenance, evidence, tests, benchmark, examples,
failureModes, generatedAt`. Validation is fail-closed on all of them:
every field present with the right shape; `packageVersion ===
PACKAGE_VERSION`; `id` matches `PACKAGE_ID_PATTERN`; `interface`,
`capabilities`, `constraints` and `supportedTargets` are sorted in
canonical (lexicographic) order; `benchmark` is `string | null` — a
benchmark is a REFERENCE and a NUMBER IS NEVER FABRICATED; `generatedAt`
parses as RFC3339 (shape AND calendar validity); evidence entries conform
to the frozen `@clapp/core` v0 `EvidenceRef` (kind vocabulary included).

## The unverified-candidate gate (fail-closed)

A package is minted ONLY when `parity.report.verdict === 'equivalent'`
AND `parity.report.counts.critical === 0` AND `parity.repair.converged
=== true` — the three conditions are checked INDEPENDENTLY, so a lying
verdict cannot sneak a critical-laden build past the count check. Any
failure returns `{ packages: [], gate: 'unverified-candidate' }` with the
reason naming the failed condition (the actual observed value included).
A structurally malformed port (planVersion mismatch, empty app, missing
counts, non-boolean `converged`, …) returns gate `'malformed'` with the
reason naming the offending field. These outcomes are RESULTS, never
exceptions — and the extractor additionally self-validates the manifest
it mints (`validatePackageManifest`) before packaging it: if the minted
manifest were ever invalid, nothing is packaged.

## The id proposal (`pkg_`)

`mintPackageId` returns `'pkg_' + sha256Hex(canonicalPackageJson(manifest))`
— the same prefixed-id discipline as `diffr_` / `diff_` / `ev_` /
`cap_` in `@clapp/diff`'s `ids.ts` and `repd_` in `@clapp/repair`. The
serialization EXCLUDES the `id` field (the digest is the minting input),
so the same manifest bytes always mint the same id, and any field change
(capability, constraint, provenance digest, …) mints a different id.
`canonicalPackageJson` is byte-stable across key insertion order
(`canonicalJson` sorts keys at every level). The record digest
(`extractionContext.manifestSha256`) is a DIFFERENT, complementary hash:
`sha256Hex(canonicalJson(manifest))` WITH the id — the digest of the
complete stored record.

## Determinism discipline

Same ports + same options → byte-identical candidates (proven by
`test/extract.test.ts`): the extractor never reads the clock
(`generatedAt` is caller-injected), never reads randomness, never reads
the network; every derived array is sorted and deduped; the only hash
input is the canonical serialization of the ports themselves
(`planSha256`, `appManifestSha256`). `version` (the immutable package
version) is caller-supplied per the worker acceptance rules — extraction
never invents one. IDs are content-addressed, not counter-based, so no
injectable id factory is needed; the hash function behind
`mintPackageId` is injectable for deterministic consumers.

## Honest derivation vocabulary (v0.1)

| field | derivation |
| --- | --- |
| `category` | `'application'` — v0.1 extraction packages the WHOLE verified candidate app; the §3 component taxonomy arrives with finer-grained lanes |
| `purpose` | one sentence from `plan.application` facts (platform, name) + surface counts (routes, API endpoints, acceptance journeys) |
| `interface` | `app.manifest.routePaths` + `app.manifest.apiEndpoints`, sorted + deduped |
| `capabilities` | NAMED plan surfaces, never counts: `route`, `navigation`, `form`, `storage:<kind>` (per distinct binding kind), `api-mock` |
| `constraints` | `plan.constraints` verbatim + one derived fact per storage binding (`writes storage key "<key>" (<storage>)`), sorted + deduped |
| `dependencies` | the start command's leading token when it names a known JS runtime (`bun`, `node`, …); `[]` otherwise — honest, may be `[]` |
| `supportedTargets` | `['web']` — the only synthesized target today (frozen v0.1 declaration) |
| `evidence` | the parity report's evidence entries (run evidenceRefs + finding-anchor refs), deduped by `evidenceId`, sorted; plan-side evidence never leaks in |
| `tests` | the plan's acceptance entry ids — `[]` when the plan names none (the generated suite itself is not a v0.1 port; nothing is fabricated) |
| `benchmark` | `null` in v0.1 — never fabricated |
| `examples` | the acceptance entries' journey ids, sorted + deduped |
| `failureModes` | `repair.attempts[].resolvedFindingIds`, deduped + sorted — `[]` when repair never fired |

## Dependencies

- **runtime:** `@clapp/core` (`sha256Hex`, `EVIDENCE_KINDS`, `EvidenceRef`),
  `@clapp/observe` (`canonicalJson`).
- **dev (TYPES ONLY):** `@clapp/plan`, `@clapp/codegen`, `@clapp/diff`,
  `@clapp/repair` — the frozen contract type sources for the ports and
  the test fixtures; the extractor never imports their behavior.

## Tests (`bun test` from the repo root)

- `test/package-contract.test.ts` — the validator (well-formed ok + every
  malformed class by field, all errors collected), content-addressed id
  stability, canonical byte-stability + round-trip.
- `test/extract.test.ts` — the fail-closed gate (three killer fixtures),
  determinism, honest derivation (exact expected metadata, no
  fabrication), honest counting + zero-package reasons.
- `test/imports.test.ts` — the frozen-contract import discipline
  (contract owners are `import type` only; runtime imports are exactly
  `@clapp/core` + `@clapp/observe`; no non-workspace package).

## Honest limitations

- One candidate per verified extraction (the whole app). Finer-grained
  packages, the registry, retrieval, compatibility and promotion are
  later lanes (CLAPP-051/052/054).
- `canonicalPackageJson` throws `CanonicalJsonError` on
  non-canonicalizable manifests (the observe discipline — loud, not
  silently mangled); `extractPackages` catches it and reports
  `malformed`.
- The malformed vocabulary covers the fields the extractor strictly
  reads; deep list traversal (runs/findings interior structure) is
  defensive — malformed interior entries contribute no evidence rather
  than failing the port, and the gate conditions remain the packaging
  authority.
- `failureModes` references finding ids as recorded by the repair
  attempts; the extractor does not re-verify the resolutions (the
  parity verdict + convergence already carry that guarantee).

## Compatibility graph (CLAPP-051)

P5 lane 2: `buildCompatGraph(manifests)` — the **deterministic,
content-addressed pairwise-compatibility graph** over `PackageManifest`
v0.1 entries. This is the structural substrate the future retrieval lane
(CLAPP-052) consumes for its target-compatibility +
dependency-compatibility signals (docs/LEARNING_AND_LIBRARY.md §6). One
new module, `src/compat-graph.ts`; runtime imports are exactly
`@clapp/core` (`sha256Hex`), `@clapp/observe` (`canonicalJson`) and the
local frozen `./package-contract` (same package — the graph imports no
contract owner at all).

### The graph contract (v0.1)

`GRAPH_VERSION` is `'0.1'`. Every VALIDATED input manifest becomes one
`CompatNode` (`id`, `version`, `category`, `capabilities`,
`supportedTargets`, `dependencies` — the compatibility-relevant manifest
facts, verbatim). EVERY unordered pair of nodes becomes exactly one
`CompatEdge`:

| verdict | when | why |
| --- | --- | --- |
| `'unrelated'` | the pair shares NO supported target | the target gate — target-disjoint packages never compose; the reason names both target sets |
| `'conflict'` | both name a runtime executable and the executables differ | alternative runtimes never compose in v0.1 (`bun` vs `node`, …); the reason names both runtimes |
| `'compatible'` | everything else | shared targets + no runtime clash; the reasons name the measured overlaps |

Every edge carries the MEASURED intersections — `sharedTargets` and
`sharedCapabilities` (sorted sets; the capability overlap is reported even
on `'unrelated'` edges: a measured fact, never a compatibility claim) —
and `reasons`: honest, deterministic strings that name the facts, with
overlap counts measured from the actual intersections, never asserted.
`left` is ALWAYS the lexicographically smaller id, `right` the larger,
regardless of input order; edges are sorted canonically (by `left`, then
`right`); `reasons` are sorted and deduped.

### Fail-closed validation

`buildCompatGraph` never throws for bad input. Every entry must pass the
frozen `validatePackageManifest` (runtime import from
`./package-contract` — same package); duplicate minted ids are an error
(`duplicate package id <id> at indexes <i> and <j>`). ALL errors are
collected — each names the offending index and field — into
`{ ok: false, errors }`. An EMPTY input is a valid, honest graph: zero
nodes, zero edges, still content-addressed.

### The id proposal (`cgraph_`)

`graphSha256 = 'cgraph_' + sha256Hex(canonicalJson({ graphVersion,
nodes, edges }))` — the digest field itself is EXCLUDED from the minting
input (the same discipline as `pkg_` / `mintPackageId`: ids are minted
FROM the serialization). Identical manifests in ANY input order mint the
identical `graphSha256` (nodes and edges are sorted canonically before
hashing — the input order never leaks). The `'cgraph_'` prefix is this
packet's frozen proposal; changing it changes every minted graph id and
requires a graph contract version bump.

### Compatibility-graph determinism discipline

Same manifests (any input order) → byte-identical canonical graph and
`graphSha256` (proven by `test/compat-graph.test.ts`): no clock, no
randomness, no network, no filesystem reads; every ordering is sorted;
the module never mutates its inputs (pure derivation — node arrays are
copied, never aliased). v0.1 dependency semantics: manifests carry at
most one dependency entry (the start command's leading executable), so
the conflict rule compares the leading entries; multi-entry dependency
semantics arrive with a future contract version.

### Compatibility-graph tests

- `test/compat-graph.test.ts` — eight named tests: determinism across
  input permutations (byte-identical canonical records), fail-closed
  malformed + duplicate-id handling (never an exception, all errors
  collected), the three verdict semantics with measured overlaps, the
  canonical edge structure (every unordered pair exactly once; the empty
  graph is valid and content-addressed), and content-addressed identity
  (any input change moves the digest; unchanged pair-edges stay
  byte-stable).
