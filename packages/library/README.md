# @clapp/library — CLAPP Package Library, lane 1 (CLAPP-050)

The Phase-5 FIRST lane: the **PackageManifest v0.1 contract** (fail-closed
validator, canonical serialization, content-addressed `mintPackageId`) and
the **package extractor** over the frozen P4 synthesis/parity ports —
fail-closed `unverified-candidate` gate, deterministic, honest counting.

**Out of scope (later lanes):** registry persistence (a later,
tech-lead-declared lane — see `docs/ROADMAP.md` P5). The compatibility
graph landed (CLAPP-051, `buildCompatGraph`); the package retrieval
landed (CLAPP-052, `retrievePackages`); the replay benchmark landed
(CLAPP-053, `replayCandidate`); the promotion gate landed (CLAPP-054,
`promoteCandidate`); the in-memory package registry landed (CLAPP-055,
`createRegistry`).

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
  packages and registry persistence are later lanes; the compatibility
  graph (CLAPP-051), retrieval (CLAPP-052), the replay benchmark
  (CLAPP-053), the promotion gate (CLAPP-054) and the in-memory registry
  (CLAPP-055) have landed.
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

## Retrieval (CLAPP-052)

P5 lane 3: `retrievePackages(manifests, query)` — the **deterministic,
honest ranked-candidate retrieval** over `PackageManifest` v0.1 entries,
shaped by `docs/LEARNING_AND_LIBRARY.md` §6 (the multi-signal retrieval
list, v0.1-shaped). One new module, `src/retrieval.ts`; runtime imports are
exactly `@clapp/core` (`sha256Hex`), `@clapp/observe` (`canonicalJson`) and
the local frozen `./package-contract` (same package — retrieval imports no
contract owner, and needs nothing from `./compat-graph` at runtime: v0.1
retrieval signals are all single-manifest facts).

### The retrieval contract (v0.1)

`RETRIEVAL_VERSION` is `'0.1'`. A `RetrievalQuery` is
`{ target, requiredCapabilities, optionalCapabilities?, purposeHint?,
maxResults? }` — unknown fields are a fail-closed typo guard (a mistyped
field name must never silently degrade the query). A manifest is a
CANDIDATE only when it passes the **candidacy gate**:

- `targetMatch` — `query.target` is among `manifest.supportedTargets`
  (the single-manifest reduction of the compat-graph target gate: a
  manifest not supporting the query target is never a candidate);
- `requiredCoverage === 1` — EVERY required capability is measured
  present. Partial coverage is NOT candidacy: excluded, never ranked.

The gate carries no dependency-compatibility check — the frozen v0.1
formula has no dependency signal, so nothing here can contradict the
graph's runtime-conflict rule. Every signal is MEASURED from the manifest:

| signal | derivation (all measured) |
| --- | --- |
| `targetMatch` | membership of `query.target` in `manifest.supportedTargets` |
| `requiredCoverage` | matched / required, over SET intersection — `1` when none required |
| `optionalCoverage` | matched / optional, over SET intersection — `0` when none requested (weighting, never gating) |
| `similarity` | Jaccard token overlap between `purposeHint` and `manifest.purpose` — the DOCUMENTED LEXICAL PLACEHOLDER, not semantic (embeddings are a later lane; nothing semantic is simulated) |
| `parityHistory` | `manifest.evidence.length` — the raw measured list length |
| `repairCost` | `manifest.failureModes.length` — the raw measured list length |
| `recencyRank` | 0-based rank over ALL considered manifests by `generatedAt` DESC (RFC3339 lexical compare), id ASC tie-break |

### The frozen composite (v0.1)

```
score = 40 * requiredCoverage
      + 15 * optionalCoverage
      + 15 * similarity
      + 10 * min(parityHistory, 5) / 5
      -  6 * min(repairCost, 5) / 5
      +  6 * (1 / (1 + recencyRank))
```

The weights are FROZEN — re-weighting is a contract version bump, never a
quiet tune. Ranking is score DESCENDING with a deterministic id-ASCENDING
tie-break; `maxResults` (a positive integer) truncates AFTER ranking, and
the truncation is reported in the result reasons (`truncated to k of n
ranked candidates by maxResults k`) — never silently. `considered` /
`excluded` count gate facts only (truncation is not exclusion). The caps
(`min(…, 5)`) live in the formula alone: the components always report the
RAW measured lengths, and the candidate reasons say so.

### Fail-closed validation

`retrievePackages` never throws for bad input: a non-array manifest list,
ANY invalid manifest entry (the frozen `validatePackageManifest`, every
error prefixed with its index), a duplicate minted id (the graph lane's
discipline — ranking one package twice would be dishonest counting), or an
invalid query (missing/empty `target`, non-array capability lists,
non-positive-integer `maxResults`, an unknown field) returns
`{ ok: false, errors }` with every error collected and NAMED. An EMPTY
corpus with a valid query is a legal, honest retrieval: zero candidates,
`considered 0`, still digested and reasoned.

### The id proposal (`rq_`)

`queryDigest = 'rq_' + sha256Hex(canonicalJson(normalizedQuery))` — the
normalized query omits absent optional fields (never nulls) and
canonicalizes capability arrays (sorted, deduped — array order is caller
presentation, not query semantics, so `['form','route']` and
`['route','form']` mint the SAME digest). The `'rq_'` prefix is this
packet's frozen proposal (the same id discipline as `pkg_` / `cgraph_`);
changing it changes every minted query digest and requires a contract
version bump.

### Retrieval determinism discipline

Same manifests (ANY input order) + same query → deep-equal result (proven
by `test/retrieval.test.ts`): no clock, no randomness, no network, no
filesystem reads; the module never mutates its inputs; every derived list
is sorted and deduped; reasons are canonical (sorted, deduped) with every
number measured from the actual data. Honest limitation: `generatedAt`
comparison is LEXICAL over the RFC3339 text — correct for same-offset
(e.g. all-UTC `Z`) timestamps, which is the shape the extractor emits and
the corpus discipline keeps; a mixed-offset ordering refinement arrives
with a future contract wave, never a silent reinterpretation.

### Retrieval tests

- `test/retrieval.test.ts` — eight named tests: determinism (identical
  inputs, any manifest input order, canonical digests, change
  sensitivity), fail-closed malformed manifests + queries (never an
  exception, all errors named, the unknown-field typo guard, duplicate
  ids), the candidacy gate (target mismatch + partial coverage excluded
  honestly with measured per-exclusion reasons; the empty required set),
  the frozen composite (every signal recomputed INDEPENDENTLY from the
  fixture facts and fed through the formula — bit-exact — with a real
  score TIE broken by id ASC), the lexical similarity placeholder (exact
  Jaccard values; token-set semantics — word order contributes nothing;
  semantically adjacent text with zero token overlap scores 0), parity
  history + repair cost (raw measured lengths; the caps live in the
  formula only), optional capabilities + maxResults (weighting never
  gating; truncation applied after ranking and reported honestly),
  satisfiability (every required capability set satisfiable from the
  fixture corpus or reported empty with reasons — including the empty
  corpus).

## Replay benchmark (CLAPP-053)

P5 lane 4: `replayCandidate(candidate, ports)` — the **honest, measured
replay benchmark** that re-verifies a packaged candidate and produces the
evidence the promotion gate (CLAPP-054 — the tech lead's lane) will
consume. Replay NEVER promotes: the record documents what was replayed,
the candidate's manifest is read and never rewritten, and no stage is
minted here. One new module, `src/replay-benchmark.ts`; runtime imports
are exactly `@clapp/core` (`sha256Hex`), `@clapp/observe`
(`canonicalJson`) and the local frozen `./package-contract` (the manifest
validator) — `@clapp/diff` and `@clapp/repair` are devDependency
TYPE-ONLY imports (the established discipline, pinned by
`test/imports.test.ts`).

### The replay contract (v0.1)

`REPLAY_VERSION` is `'0.1'`. The candidate input is a
`PackageCandidate`-shaped object, validated fail-closed FIRST (results,
never exceptions, ALL errors collected): `manifest` must pass the frozen
`validatePackageManifest`; `stage`, when present, must be `'candidate'`
(replay accepts candidate-stage records ONLY — anything else is an error
naming the observed value; promotion is CLAPP-054's lane);
`extractionContext.manifestSha256`, when present, must be 64 lowercase
hex chars. The PORTS must be an object with callable `recomputeParity`
and `now` — a non-function is an error naming the field.

### The replay gate (fail-closed, extraction-consistent)

`t0 = ports.now()` → `await ports.recomputeParity(manifest)` →
`t1 = ports.now()`; `durationMs = t1 − t0` is MEASURED from the injected
clock — the module never reads a wall clock, and every duration in the
record (and in the benchmark reference) is this measured delta, never an
assertion. The gate then asserts the SAME three conditions as the
extractor's unverified-candidate gate (CLAPP-050), in the same order,
over the RECOMPUTED parity:

- `recomputed.report.verdict === 'equivalent'`
- `recomputed.report.counts.critical === 0`
- `recomputed.repair.converged === true`

ALL three hold → outcome `'replayed'`. ANY fails → outcome `'diverged'`
with reasons naming the failed condition AND its observed value (the
extractor's refusal discipline — the conditions are checked
independently, so a lying verdict cannot sneak a critical-laden replay
past the count check). A malformed `recomputeParity` return (not an
object, missing report/repair, non-finite critical count) is outcome
`'malformed'` with field-naming reasons — the replay never guesses and
never throws for these.

### Provenance is compared, not trusted

`provenanceCheck` records `manifest.provenance.diffReportId` (as
recorded) against the RECOMPUTED `report.id`, with the measured
`matches` boolean. A moved evidence chain (`matches === false`) is
DISCLOSED in reasons ("…the evidence chain moved") but does NOT flip
the outcome — the gate is over the recomputed conditions (what replay
re-proved); the provenance comparison is an honest disclosure the
promotion gate (CLAPP-054) will weigh. The record's `manifestSha256` is
likewise RECOMPUTED at replay time (`sha256Hex(canonicalJson(manifest))`
— WITH the id, the record-digest discipline) and any drift from the
candidate's recorded `extractionContext.manifestSha256` is disclosed in
reasons — recorded digests are never silently trusted.

### The benchmark REFERENCE (never a bare number)

On outcome `'replayed'` ONLY:

```
replay:0.1:<manifest.id>:<manifest.version>:ok:<durationMs>ms:attempts:1
```

The duration inside the reference is the MEASURED value; `attempts` is
v0.1's honest count of recomputes (exactly 1 — the single
`recomputeParity` invocation in the code path). On
`'diverged'`/`'malformed'` the reference is `null` — no reference is
minted from a failed replay. The manifest's `benchmark` field stays
`string | null` by contract: the promotion gate (054) decides later
whether to lift a reference into a manifest; nothing here fabricates a
score.

### The loud-harness boundary

An exception THROWN by a port (`recomputeParity` or `now`) propagates
loudly — `replayCandidate` REJECTS with that error. A broken harness is
the caller's failure, never swallowed and never converted into a
synthetic `'malformed'` record. Symmetrically, a clock returning
non-numeric values is a harness contract violation — `ReplayPorts.now`
is typed `() => number`; the measured delta is reported exactly as
computed, never sanitized into a plausible number.

### Replay-benchmark determinism discipline

Same candidate + same ports → deep-equal record (proven by
`test/replay-benchmark.test.ts`): no clock, no randomness, no network,
no filesystem reads — every measured number enters through the ports;
reasons are sorted and deduped; the module never mutates its inputs
(the candidate is read, never rewritten — stage is NEVER promoted
here).

### Replay-benchmark tests

- `test/replay-benchmark.test.ts` — eight named tests: determinism
  under injected ports (identical inputs → identical records AND
  identical benchmark references; inputs never mutated), fail-closed
  malformed candidates AND ports (never an exception, every error
  naming its field — non-object candidate, frozen-validator failure,
  stage `'verified'`, ports missing `now`), the extraction-consistent
  gate (three killer recomputed parities, each reason naming the failed
  condition and its observed value), the honest successful record
  (measured duration — the test recomputes the expected clock delta
  independently — and the benchmark REFERENCE in its exact format: a
  string, never a bare number), the provenance comparison (a moved
  evidence chain disclosed without flipping the outcome, the reason
  naming both ids), the measured-clock discipline (a known sequence →
  the exact delta, embedded consistently in the reference), the
  recomputed manifest digest with honest drift disclosure (both digests
  reported, no silent trust), and the loud-harness boundary (a throwing
  `recomputeParity` rejects with the thrown error itself — never a
  synthetic `'malformed'` record).

## Promotion gate (CLAPP-054)

P5's closing lane — owned and implemented by the **tech lead** (the
integration authority): promotion is never a worker's call, and this module
is that rejection machinery, executable. `promoteCandidate(candidate,
evidence, options)` mints a `PackagePromotionRecord` — a NEW stage document
(`'replayed'`, v0.1's only promotion) — ONLY when every landed evidence
class is green:

| condition | source |
| --- | --- |
| the candidate is a valid candidate-stage record | the frozen manifest validator + stage `'candidate'` |
| the replay record is green | outcome `'replayed'`, `replayVersion` matching `REPLAY_VERSION`, `packageId` matching the manifest's minted id |
| the digests agree | `manifestSha256` recomputed AT PROMOTION TIME (`sha256Hex(canonicalJson(manifest))`) — compared against the replay's digest AND the candidate's recorded `extractionContext.manifestSha256` (no drift anywhere) |
| the evidence chain is intact | `provenanceCheck.matches === true` — the replay module DISCLOSES a moved chain without flipping its outcome; the promotion gate WEIGHS that disclosure and REFUSES |
| a benchmark reference exists | the green replay's measured `benchmarkRef`, carried verbatim |

The manifest is **immutable** (the worker-handoff acceptance rule): the
promotion record carries it VERBATIM; no field is rewritten (`benchmark`
stays exactly as extracted — lifting a reference INTO a manifest is a
separate, future, tech-lead-gated operation). `promotedAt` is
caller-injected RFC3339 (validated; the gate never reads a clock); the
evidence digest is content-addressed over the replay record. §5's later
stages (`'stable'`, `'preferred'`) arrive with later evidence classes via
contract version bumps — never by quietly widening this gate. Every
refusal is a collected, named error with its observed value (results,
never exceptions); a malformed input class is a refusal, and nothing about
the inputs is ever mutated.

## Registry (CLAPP-055)

The W2 registry lane — the last open P5 checkbox. `createRegistry()`
(`src/registry.ts`, `REGISTRY_VERSION '0.1'`) builds an **empty, in-memory,
deterministic, fail-closed** store of package records at their CURRENT
stage, and nothing else: every admitted package becomes one
`RegistryRecord` — `{ manifest, stage, registeredAt, registeredBy }`.

### The admission gate (fail-closed — the §8 contamination guard)

`register(input, options)` admits exactly two shapes, both validated before
anything is stored:

| admission shape | requirements | `registeredBy` source |
| --- | --- | --- |
| candidate-shaped | an object whose `manifest` passes the frozen `validatePackageManifest`; `stage`, when present, must be `'candidate'` | `extractionContext.extractedBy` |
| promotion-shaped | a `PackagePromotionRecord` — `promotionVersion === PROMOTION_VERSION`, `manifest` passing the frozen validator, `stage === 'replayed'`, `promotionContext.promotedAt` RFC3339 | `promotionContext.promotedBy` |

`options` is `{ registeredAt }` — an RFC3339 timestamp **caller-injected**
per registration: the registry never reads a clock (there is no clock to
read). Every rejection is a collected, field-named error in a
`{ ok: false, errors }` result — results, never exceptions — and a rejected
admission stores nothing.

### Immutability (the worker-handoff acceptance rule)

The `(manifest.id, manifest.version)` pair is the registry key. A pair
already present is refused with a named error carrying the existing stage —
versions are immutable, the registry never overwrites, and two different
versions of the same id are legal siblings. The stored manifest is kept
VERBATIM (the caller's own object, never rewritten); `register` and `get`
return the stored record itself (the caller holds an alias to the manifest
by construction — that is what verbatim storage means), while `list`
returns deep copies so no mutation channel is added through a listing.

### Queries

`get(id, version)` returns the record, or `null` for non-string arguments
and misses — a query is never an error. `list({ stage })` returns records
in canonical `(id, version)` order, filtered by exact stage match.
`size()` / `entries()` report the measured count.

### The snapshot digest (`creg_`)

`snapshot()` returns `'creg_' + sha256Hex(canonicalJson({ registryVersion,
records }))` over the records in canonical order — the `creg_` prefix is
this lane's frozen proposal in the `pkg_` / `cgraph_` / `rq_` prefix
discipline. Identical contents produce identical snapshots, any admission
moves the digest, and the input order of registrations never leaks into it
(records are canonically sorted before hashing). The empty registry has a
valid, stable snapshot of its own.

### Registry determinism discipline

No clock, no randomness, no network, no filesystem. The same set of
registrations produces the same snapshot in any order; two registries
built from identical inputs and options are indistinguishable through the
public surface. In-memory v0.1 — **persistence is a later,
tech-lead-declared lane**; promotion decisions stay test-gated and are
never the registry's call (the registry never promotes or demotes a
stage).
