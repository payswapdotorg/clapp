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
