# @clapp/factory

CLAPP factory (**CLAPP-085**, the P9 opener — Worker 1, Observation and
Platform Adapters, per `docs/WORKER_HANDOFFS.md`; this worker owns the
factory lane): the factory's FIRST component — **target
classification**, the entry contract that turns a build request into a
classified target. The five factory items (target classification →
adaptive exploration budgets → package-graph synthesis → multi-pass
repair → human release gate) are declared in `docs/WORK_ITEMS.md` P9;
this package delivers the first, and only the first.

> **THE NO-FORK LAW (P9, verbatim from `docs/WORK_ITEMS.md`):**
> "The factory turns a build request into a classified target, explores
> within adaptive budgets, synthesizes the package graph, repairs
> multi-pass, and holds the release for the human gate. The five frozen
> platform contracts (P8) and the learn lane's frozen archetypes are its
> inputs. Do not fork the core Behavioral IR."
>
> This package **consumes** the frozen contracts — `@clapp/core`
> (`sha256Hex`) and `@clapp/observe` (`canonicalJson`) at RUNTIME, and
> `@clapp/learn`'s `ArchetypeClassification` TYPE-ONLY (a devDependency
> — the compile-time binding pin) — and produces **contract-shaped
> DATA**. It never redefines, rewrites, or forks any contract type.
> `test/target-classification.test.ts`'s import-discipline test pins
> this.

## The component (the P9 opener)

| # | Component | Module | Surface |
|---|-----------|--------|---------|
| 1 | target classification | `src/target-classification.ts` | `classifyTarget`, `TargetRequest`, `TargetClassification`, `TargetClassificationResult`, `TARGET_CLASS_VERSION`, `ARCHETYPE_BINDING_VERSION`, `TARGET_PLATFORMS`, `BUDGET_TIERS` |

`src/index.ts` re-exports the classifier's contracts + vocabularies
(the house style). The public surface re-exports ONLY this package's
own contracts — the consumed learn shapes are referenced TYPE-ONLY
inside `src/target-classification.ts`.

## The P8 platform binding

`TARGET_PLATFORMS` is the five frozen P8 platform literals —
`android`, `linux`, `windows`, `macos`, `ios` — the completed
CLAPP-080..084 sequence. A request's `platform` must be one of the
five; **a sixth is a named error, never a guess** (an observed `'web'`
refuses with the observed value named). The binding is the platform
*literal* vocabulary; each platform's five-component adapter contracts
(`@clapp/android` … `@clapp/ios`) are the P8 lanes' own frozen
surfaces — this package never re-declares them.

## The learn archetype binding (consumed as DATA, never forked)

The request's `classification` is the learn lane's frozen
`ArchetypeClassification` v0.1 (`@clapp/learn`, CLAPP-062) — consumed
**as DATA**: duck-validated on exactly the fields this lane uses
(`archetypeVersion`, `outcome`, `matches[].name`), with a named error
for every malformation. The shape is referenced TYPE-ONLY via the
compile-time `LearnArchetypeBinding` assertion in
`src/target-classification.ts` — a real learn classification fits
`TargetRequest['classification']` as-is, and if the learn lane ever
breaks its frozen v0.1 shape, that line stops compiling. `@clapp/learn`
is a devDependency precisely because only its *types* are consumed.

- `archetypeVersion` must equal `ARCHETYPE_BINDING_VERSION` (`'0.1'`)
  — a mismatch is a named error, never a guess.
- `outcome` must be `'classified'` or `'unclassified'` — the learn
  lane's frozen outcome vocabulary.
- `matches` must be an array of objects with non-empty `name` strings,
  in the learn table's canonical order.

## The honest-agreement law

The classification's `outcome` and its `matches` **MUST AGREE**:
outcome `'classified'` with zero matches, or `'unclassified'` with
matches present, is a **NAMED inconsistency error**. A classified
target is derived from measured matches — never guessed, never
inferred from a disagreeing input.

## Frozen vocabularies (v0.1)

- `TARGET_CLASS_VERSION` = `'0.1'`
- `ARCHETYPE_BINDING_VERSION` = `'0.1'` (the bound learn contract version)
- `TARGET_PLATFORMS` (the five frozen P8 platform literals):
  `android`, `linux`, `windows`, `macos`, `ios`
- `BUDGET_TIERS` (the frozen exploration-budget tier vocabulary):
  `minimal`, `standard`, `extended`

## The derived law and the measured facts

On success the classification is **derived, never guessed**:

- `primaryArchetype` = `matches[0].name` — the learn table's canonical
  FIRST match, positional — or `'unclassified'` when nothing matched;
- `matchCount` = `matches.length` — **MEASURED**, never asserted from
  the input's shape;
- `outcome` is carried **VERBATIM** from the learn classification.

## The prefix discipline

Classification ids are minted **content-derived**:
`'tcls_' + sha256Hex(canonicalJson(classification minus id minus
classifiedAt))` — deterministic, no uuid, no clock, no randomness (the
content-addressed-identity house law; `tcls_` is this lane's prefix,
the way `arch_` is the learn lane's and `idev_` the iOS lane's). Every
measured field of the classification rides inside the identity, so any
change (the platform, the primary archetype, the match count, the
tier, the outcome) moves the id.

## The determinism discipline

No clock, no randomness, no network, no filesystem, no global state.
`classifiedAt` is **CALLER-injected** — the classifier never reads a
clock — and is **excluded from the minting body**, so classifying the
same request twice yields deep-equal results with identical ids, and a
different caller clock never changes the id. `canonicalJson` sorts
keys at every level; `sha256Hex` (WebCrypto) hashes the same bytes
identically forever. Fail-closed everywhere: every malformation is a
named error with the observed value; results, never exceptions —
except `canonicalJson`'s deliberate throw on non-canonicalizable
payloads, which the classifier converts into a named error (the last
line of defense, inherited from the 060/061/062 precedent).

## Honest scope (v0.1)

- The **tiers are tags here**: `budgetTier` is validated against the
  frozen vocabulary and carried verbatim — the exploration budget a
  tier *spends* is **CLAPP-086's** later lane, never this package's.
- The later factory lanes — adaptive exploration budgets (CLAPP-086),
  package-graph synthesis (CLAPP-087), multi-pass repair (CLAPP-088),
  the human release gate (CLAPP-089) — are out of scope.
- No evidence emission in this lane (the core's `EvidenceRef` is not
  consumed — later factory lanes own evidence); no Behavioral IR
  construction, ever (the no-fork law).
- `classifiedAt` is validated as a non-empty caller-injected string
  and carried verbatim; the RFC3339 calendar law is the learn lane's
  own validator discipline for its timestamps — the factory trusts the
  caller's clock as data.

## Battery

From the repository root: `bun run typecheck`, `bun run lint`,
`bun test` — the same battery every package answers (see root
`README.md`). Per-package: `bun run typecheck` inside
`packages/factory` additionally covers `test/` and `test/fixtures/`.
