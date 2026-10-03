# @clapp/learn — CLAPP Continuous Learning, lane 1 (CLAPP-060)

The Phase-6 FIRST lane: the **failure memory** — the failure-event store.

`docs/LEARNING_AND_LIBRARY.md` §7: *"Failures are first-class knowledge.
Record: failing package/version, target/context, error signature, expected
behavior, actual behavior, successful repair, whether repair generalized.
A repeated failure should produce a reusable guard, test, or package
correction."*

This package is the **RECORD + STORE** half of that law. The **guard/pattern
DERIVATION** ("a repeated failure should produce a reusable guard…") is
CLAPP-061's lane; this module records failure events honestly and mines
nothing.

**Out of scope (later lanes, per `docs/ROADMAP.md` P6):** repair pattern
mining (CLAPP-061), archetype detection (062), composition planning (063),
improvement benchmarks (064). Persistence for the in-memory store is a
later, tech-lead-declared lane — v0.1 stores nothing outside its closure.

**Non-degeneracy rule (binding):** the memory consumes contract-shaped DATA.
`@clapp/diff` and `@clapp/repair` are devDependencies imported for TYPES
ONLY (`import type` — pinned by the import-discipline test inside
`test/failure-memory.test.ts`); the runtime dependencies are exactly
`@clapp/core` (`sha256Hex`) and `@clapp/observe` (`canonicalJson`). The
frozen vocabulary's RUNTIME string values are pinned as literals in
`src/failure-memory.ts` — importing them at runtime would import the
implementations.

## The contract

```
createFailureMemory(): FailureMemory
  ├─ record(input, { observedAt })        → { ok: true, record } | { ok: false, errors[] }
  ├─ bySignature({ dimension, severity, summary }) → FailureRecord[]   (canonical order, deep copies)
  ├─ byPackage(packageId)                          → FailureRecord[]   (canonical order, deep copies)
  ├─ list()                                         → FailureRecord[]   (canonical order by id, deep copies)
  ├─ size()                                         → number            (measured, honest)
  └─ snapshot()                                     → 'fmem_' + sha256Hex(canonicalJson({ failureVersion, records sorted }))
```

One `FailureRecord` is one observed failure event (all values carried
VERBATIM from the frozen sources — never minted, never normalized):

| field | source | rule |
| --- | --- | --- |
| `failureVersion` | — | `'0.1'` (`FAILURE_VERSION`) |
| `id` | minted | `'fail_' + sha256Hex(canonicalJson(record minus id))` — content-addressed |
| `packageRef` | input | `{ id, version }` verbatim; `null` when the failure predates packaging |
| `target`, `context` | input | non-empty free-form strings |
| `signature` | finding | `dimension`/`severity` validated against the FROZEN diff-contract v0.1 vocabulary; `findingId` (the per-event anchor) and `summary` verbatim |
| `expected?`, `actual?` | finding | any JSON values, verbatim — absent keys stay absent (structural findings) |
| `repair` | input | `attempted`/`resolved` booleans; `resolvedFindingIds` sorted + deduped; `generalized` boolean or `null` (caller-judged, never fabricated) |
| `observedAt` | options | RFC3339, **caller-injected** — the memory never reads a clock |

## The admission gate (fail closed)

`record(input, options)` — the input is `{ finding, repair, packageRef?,
target, context }`:

- `finding` must be **DiffFinding-shaped**: an object with a non-empty
  `id`, a `dimension` in the frozen vocabulary
  (`'semantic' | 'visual' | 'network' | 'state'`), a `severity` in the
  frozen vocabulary (`'critical' | 'major' | 'minor' | 'info'`), a
  non-empty `summary`, and an `anchors` **array** (entries may be any
  shape — the anchors' internals are the diff contract's business, not the
  memory's; they are validated as an array and **not stored**).
- `repair` must be an object with boolean `attempted`, boolean `resolved`,
  a `resolvedFindingIds` array of non-empty strings, and `generalized` a
  boolean or `null`.
- `packageRef`, when present, must be exactly `{ id: non-empty string,
  version: non-empty string }` (extra keys are refused — they would leak
  into the event identity); `null`/absent is legal (the failure predates
  packaging).
- `target` and `context` must be non-empty strings.
- `expected`/`actual` carry **VERBATIM** (any JSON value; absent keys stay
  absent — an explicitly-`undefined` value is refused with a named error,
  never silently rewritten).
- `options` must be `{ observedAt: string }` with `observedAt` RFC3339
  **calendar-valid** (the house helper discipline: `Date.parse` is
  deliberately not used — it accepts rollover dates such as
  `2026-02-30`, which the memory refuses).

Every error is **collected** (never just the first) with the field named —
`{ ok: false, errors }` results, **never an exception**; a rejected
admission stores nothing.

## The event-identity rule

The record's `id` is content-addressed over the canonical serialization of
the record **minus its id** (`@clapp/observe` `canonicalJson` + `@clapp/core`
`sha256Hex`): same id ⇔ identical canonical event bytes. Therefore:

- **Duplicates are refused.** Registering an event whose id already exists
  is a collected, named error:
  `duplicate failure event <id> — the exact event (finding <findingId> at <observedAt>) is already recorded`.
  The memory is insert-only — nothing is ever overwritten or rewritten.
- **Recurrences are distinct.** The same finding re-observed at a
  DIFFERENT `observedAt`, or the same signature from a different finding
  id, is a DISTINCT event with a distinct id. Recurrences are exactly what
  CLAPP-061 will mine; the memory stores them all honestly.

## Prefix proposals (frozen for v0.1)

This lane's frozen proposals, in the repo's `pkg_` / `cgraph_` / `rq_` /
`creg_` content-addressing discipline:

- `fail_` — event ids: `'fail_' + 64 lowercase hex chars`
  (`sha256Hex(canonicalJson(record minus id))`).
- `fmem_` — snapshot digests: `'fmem_' + sha256Hex(canonicalJson({ failureVersion, records sorted }))`.

Changing either changes every minted id and requires a contract version
bump (only via a tech-lead declaration wave).

## Determinism + honesty laws

- **No clock, no randomness, no network, no filesystem.** `observedAt` is
  caller-injected per admission (RFC3339, calendar-valid).
- **Input-order independence.** The same events in ANY admission order
  produce the identical snapshot (records are canonically sorted by id
  before hashing).
- **The memory never mutates its inputs.** The record's `repair` facts and
  `signature` are fresh objects; `resolvedFindingIds` is sorted + deduped
  in a fresh array; `packageRef`, `expected`, `actual` are stored verbatim
  (referenced, never rewritten).
- **Listings are defensively copied.** `list()` / `bySignature()` /
  `byPackage()` return deep copies — the caller can never mutate memory
  state through a listing. `record()` returns the stored record itself —
  an **alias by construction** (the caller already supplied every
  verbatim-carried object it references; the CLAPP-055 registry's
  documented query-handle policy).
- **Counts are measured, never asserted.** `size()` counts admissions.
- **Queries never error.** Non-string/non-object query arguments and
  misses return `[]` (honest misses — a query is never an error).

## Import discipline

`src/**` may import `@clapp/core` + `@clapp/observe` at RUNTIME, and
`@clapp/diff` + `@clapp/repair` for TYPES ONLY; nothing else. Test
fixtures may import the frozen contract types. Pinned by the
import-discipline test (`test/failure-memory.test.ts`, the
`@clapp/library` `test/imports.test.ts` pattern, adapted).

## Battery

```bash
bun run typecheck   # 0 errors (the root program covers packages/*/src)
bun run lint        # 0 problems
bun test            # the 8 named tests in test/failure-memory.test.ts
```

## Repair pattern mining (CLAPP-061)

The P6 SECOND lane (Worker 2 — the learning-records owner): the
**DERIVATION** half of the §7 law. The 060 store records failure events
honestly and mines nothing; the miner derives what the store recorded —

> "A repeated failure should produce a reusable guard, test, or package
> correction."

— into repair-pattern **CANDIDATES**, minted only from REAL recorded
evidence (the §8 contamination-guard spirit: nothing is guessed; every
support number is MEASURED from the events given).

### The contract

```
mineRepairPatterns(events: unknown): Promise<MiningResult>
  ├─ { ok: true, patterns: RepairPattern[] }   // zero or more — counted honestly
  └─ { ok: false, errors: string[] }           // fail-closed — results, never exceptions

RepairPattern:
  ├─ patternVersion   // '0.1' (PATTERN_VERSION)
  ├─ id               // 'rpat_' + sha256Hex(canonicalJson(pattern minus id))
  ├─ signature        // { dimension, severity, summary } — VERBATIM from the events
  ├─ support          // { total, resolved, generalized } — MEASURED
  ├─ status           // 'repair-pattern' | 'insufficient-evidence' | 'unresolved-dominant'
  ├─ anchors          // { resolvedFindingIds } — the resolved union, sorted + deduped
  └─ reasons          // honest, sorted, deduped; each names a measured fact
```

### The grouping key

Groups are keyed by the signature TRIPLE — dimension + severity + summary.
The `findingId` is the per-event ANCHOR, never a key: recurrences across
finding ids share a signature (a re-run mints fresh finding ids for the
same divergence — the 060 event-identity rule). Every group yields
exactly ONE candidate entry, emitted in canonical signature order
(dimension, then severity, then summary).

### The three statuses (fail-closed, checked in order)

The anchor mints the pattern; the honest resolved/total split rides in
the measured support:

1. **'repair-pattern'** — `total >= 2` AND at least one event resolved AND
   the resolved events carry at least one `resolvedFindingId` (the
   reusable anchor exists). Minted WITH the measured support and the
   anchor union.
2. **'insufficient-evidence'** — `total < 2` (a single event never becomes
   a pattern — no generalization from one example), OR `total >= 2` with
   `resolved === 0` (recurrence with no repair success anywhere — the
   recurrence itself is knowledge; 064's benchmarks will weigh it;
   `anchors.resolvedFindingIds` is `[]`, honestly), OR every event
   resolved but zero `resolvedFindingIds` recorded anywhere (resolution
   with nothing reusable to anchor a guard on — the exhaustive closure of
   the three-status contract; never a guessed pattern).
3. **'unresolved-dominant'** — `total >= 2` AND `resolved >= 1` AND
   `resolved < total` AND no `resolvedFindingId` on any resolved event:
   the repair sometimes works, and the unresolved class dominates the
   verdict. The reasons name the measured ratio ("3 of 5 events
   resolved").

### Prefix proposal (frozen for v0.1)

- `rpat_` — pattern ids: `'rpat_' + 64 lowercase hex chars`
  (`sha256Hex(canonicalJson(pattern minus id))`), THIS lane's proposal in
  the repo's `pkg_` / `cgraph_` / `rq_` / `creg_` / `fail_` / `fmem_`
  content-addressing discipline. Changing it changes every minted id and
  requires a contract version bump (only via a tech-lead declaration
  wave).

### Determinism + honesty laws

- **No clock, no randomness, no network, no filesystem** — nothing but
  the events enters (§9: v0.1 mines patterns only, no policy; repair-
  policy learning is future model improvement).
- **Input-order independence.** The same events in ANY input order
  produce a deep-equal patterns array (canonical signature order) with
  identical ids.
- **The miner never mutates its inputs**; every pattern field is a fresh
  value (the anchor union is a fresh sorted array over the RESOLVED
  events only — an unresolved event's partial fixes never anchor).
- **Fail closed.** A non-array input or ANY invalid entry (checked
  against the frozen `FAILURE_VERSION`, the `fail_` id prefix, the frozen
  vocabulary, the repair-facts shapes, and calendar-valid RFC3339) is a
  collected error naming its index and field — ALL errors, never just
  the first; nothing is mined from partial data. Empty input is legal:
  `{ ok: true, patterns: [] }` — zero groups, counted honestly.
- **Counts are measured, never asserted.** total/resolved/generalized and
  the anchors union are measured from the events given.
- **Candidates, not guards.** The miner mines and reports; deciding which
  patterns become guards, tests, or package corrections is the tech
  lead's and later lanes' call (062 archetypes, 063 composition planning,
  064 improvement benchmarks).
