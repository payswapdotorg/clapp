# @clapp/repair — CLAPP Autonomous Repair Loop (CLAPP-042)

The Phase-4 repair package: consumes a **DiffReport** (diff-contract v0.1
MIRROR shape — canonical owner `@clapp/diff`, CLAPP-040), clusters its
critical/major findings into scoped **RepairDirectives**, applies
**bounded, evidence-driven edits** to the candidate app's files as git
commits with hard scope enforcement, and iterates against a re-run
oracle within a max-iterations budget.

**Non-degeneracy rule (binding):** the loop NEVER reads a SynthesisPlan.
Repairs derive from the findings' `expected`/`actual` values and the
candidate's files only. The anchor→file mapping below is pure
file-layout knowledge about the @clapp/codegen output tree, never plan
knowledge. The loop consumes contract-shaped DATA; it has **no
dependency on `@clapp/diff` or `@clapp/diffext`** (parallel workers) —
reports arrive as plain literals conforming to the MIRROR types.

```
clusterFindings(report) → RepairDirective[]        (scoped work orders)
runRepairLoop({report, candidateRoot, rerun, maxIterations, idFactory})
   └─ for each directive (deterministic order, ≤ budget):
        applyDirective(directive, root, findings)  (edits + ONE git commit)
        rerun(candidateRoot) → verdict              (the oracle decides)
        record RepairAttempt                        (baseSha/changedPaths/
                                                    verdict/resolved ids)
      stop on 'equivalent' (converged) or budget exhaustion
```

## Public surface (`src/index.ts`)

| export | what it is |
| --- | --- |
| `./diff-contract` (re-exported) | the byte-identical MIRROR of the tech-lead diff-contract v0.1 declaration (canonical owner @clapp/diff, CLAPP-040; pinned by `test/mirror.test.ts`; the tech lead byte-diffs it at integration) |
| `clusterFindings(report, {idFactory?})` | critical+major findings → one directive per derived target file (see mapping below); deterministic order |
| `applyDirective(directive, candidateRoot, findings, {iteration?})` | the bounded edit engine: strategy selection, scope enforcement (twice), edits, one git commit, local post-verification |
| `runRepairLoop(options)` | the budgeted loop; `options.rerun: (candidateRoot) => Promise<'equivalent'\|'divergent'\|'worse'\|'error'>` is the verification oracle |
| `RepairLoopOptions`, `RerunVerdict` | option types (`RerunVerdict` is the contract's verdict vocabulary, factored for the oracle callback — declared in `loop.ts`, NOT in the mirror) |
| payload vocabulary | `TextPayload` / `TestidPayload` / `MockPayload` + guards + `pageModulePathForRoute` / `payloadTargetPath` / `findingTargetPath` / `acceptanceClause` |
| strategies | `applyTextRestore` / `applyAttributeRestore` / `applyMockRestore` / `applyStrategy` / `selectStrategy` / `verifyFinding` (pure content transforms) |
| ids | `newDirectiveId` (default `repd_` + uuid v4), `countingDirectiveIdFactory` (determinism), `DirectiveIdFactory` |
| git plumbing | `git` / `gitHead` / `gitStatusPorcelain` / `gitCommitPaths` / `gitChangedPaths` / `gitResetHard` (self-contained identity; never throw) |
| `REPAIR_ADAPTER_INFO` | the honesty summary: strategy table, scope enforcement, budget, non-degeneracy, degradation behavior |

## The finding payload vocabulary

The diff contract leaves `DiffFinding.expected`/`actual` as
dimension-specific `unknown`. These are the shapes the strategies
understand (plain JSON; optional fields ABSENT, never null):

```ts
// text-restore (dimension 'semantic'):
expected: { kind: 'text', route: string, text: string }
actual:   { kind: 'text', route: string, text: string }
// two different strings observed on the same route.

// attribute-restore (dimension 'semantic'):
expected: { kind: 'testid', route: string, testId: string,
            tag?: string, text?: string, matchIndex?: number }
actual:   { kind: 'testid', route: string, testId?: string, … }
// expected names the testid the LEFT side proves; actual omits it
// (missing) or carries a different one (renamed). tag/text/matchIndex
// locate the element in document order (left-side derived).

// mock-restore (dimension 'network'):
expected: { kind: 'mock', method: string, urlPattern: string,
            statusCode: number, bodyJson?: unknown }
actual:   { kind: 'mock', … }
// a mock backend response that diverged in status and/or body.
```

Anything else — including fully **structural** findings where
`expected`/`actual` stay ABSENT — carries no derivable target file: the
finding clusters into a directive with an empty scope and honestly
aborts as unrepairable. Never a forced repair.

## The anchor→file mapping (scope derivation)

Pure candidate-layout knowledge (mirrors @clapp/codegen's output
conventions; re-implemented, not imported — codegen is a devDependency
reserved for tests):

- a `text`/`testid` payload with `route` R → `pages/<slug>.html.ts`
  (`/` → `pages/index.html.ts`, `/features.html` →
  `pages/features.html.ts`, `/docs/guide` → `pages/docs/guide.html.ts`);
- a `mock` payload → `server.ts` (the generated mock backend lives in
  the server source);
- no locatable payload → no scope path (unrepairable, solo directive).

`clusterFindings` groups findings that derive the SAME target file into
one directive (shared scope, shared commit, one acceptance sentence);
scopePaths is the sorted, deduped set. Directives are ordered by
(severity rank: critical before major, then scope path, then minimum
step index, then minimum finding id) — a pure function of the report.

## The strategies (bounded, byte-precise)

Every strategy is a pure `(fileContent, finding) → StrategyResult`
transform. Strategies never guess: when the evidence cannot locate the
edit uniquely, they abstain (null) and the attempt records an abort.

1. **text-restore** — the actual text must appear EXACTLY ONCE in the
   scoped page module (any of its three byte-forms: template-escaped
   HTML, HTML-escaped, raw); it is replaced by the same byte-form of the
   expected text. Byte-perfect restoration of ordinary payloads.
2. **attribute-restore** — missing: locate the element by
   `tag`+`text`+`matchIndex` and insert ` data-testid="…"` at the
   candidate layout's canonical slot (headings: immediately after the
   tag name; links/buttons/images/landmarks: after their prefix
   attributes; inputs/textareas/selects: last), so a successful restore
   is byte-identical to the pristine generated file. Renamed: a unique
   `data-testid="old"` value is rewritten in place. `<p>`/`<label>` have
   no testid slot in the generated layout — honest abstention.
3. **mock-restore** — locate the generated server's mock entry by
   `method` + `segments` (the urlPattern split), then restore the
   divergent `statusCode:` (and `bodyJson:` when divergent) inside that
   entry's `mocks: [ … ]` block. Unique-occurrence or abstain.

All strategies are IDEMPOTENT: if the finding's expected fact already
holds (duplicate findings of one defect, re-runs), they report a
resolved no-op instead of a second edit.

## Scope enforcement (twice)

`changedPaths` must be ⊆ `directive.scopePaths`:

1. **Pre-edit:** every strategy's target path is checked against the
   scope before any byte is touched. A violation ABORTS the whole
   attempt — verdict `'error'`, no edits, `changedPaths: []`.
2. **Post-edit:** after writing, `git status --porcelain` may only show
   scoped paths. A violation hard-resets to `baseSha` (the attempt is
   voided, verdict `'error'`).

The engine also refuses to start on a dirty tree, so repair commits
contain only their own work, and each attempt stages ONLY the files it
edited.

## Verdict + convergence semantics (honest)

- `applyDirective` cannot verify behavior (no oracle), so its returned
  attempt's `rerunVerdict` is PROVISIONAL: `'error'` when the attempt
  aborted (scope violation, no matching strategy, dirty tree, missing
  target file, git failure), `'divergent'` when edits were committed.
  `runRepairLoop` OVERWRITES the provisional verdict of every
  non-aborted attempt with the oracle's verdict. Aborted attempts keep
  `'error'` and the oracle is not consulted (nothing changed).
- `iteration` is likewise loop-assigned (0 from `applyDirective` unless
  passed via options).
- `resolvedFindingIds` = findings whose strategy applied AND whose
  expected fact now verifiably holds in the file (local post-edit
  verification — `verifyFinding`). Behavioral equivalence is the
  oracle's call.
- **One directive per iteration** (one commit, one oracle re-run); the
  directive's findings are all attempted in that one pass.
- `converged` follows the frozen contract's literal iff:
  `true` **iff** `remainingCriticalFindings` is empty. On an
  `'equivalent'` re-run (or a report with no criticals) the list is
  empty; otherwise it lists the report's criticals that no attempt
  resolved. **Honest corner, documented:** if every critical is
  edit-resolved but the oracle never said `'equivalent'` (e.g. a
  major-only defect outlives the budget), the contract's iff still
  yields `converged: true` with an empty remaining list — the attempts
  honestly record the divergent verdicts, so this is always detectable
  from the result's own record, never hidden.
- **One report per run:** the oracle returns a verdict, not new
  findings. Production composition: the orchestrator re-runs the paired
  runner (CLAPP-040), rebuilds the report, and re-invokes the loop —
  each invocation is one bounded repair round.

## Determinism + id factories

Directive ids are minted from an injectable factory
(`clusterFindings`'s and `runRepairLoop`'s `idFactory` option; default
`newDirectiveId` = `repd_` + uuid v4 via WebCrypto). For deterministic
runs supply `countingDirectiveIdFactory()` (repd_000001, repd_000002, …).
Given the same report and fresh counting factories, clustering and the
final tree are byte-identical (proven by `test/determinism.test.ts`;
commit SHAs may differ — timestamps — but the TREE is the claim).
Commit messages are derived from the directive + finding ids (no
timestamps).

## Dependencies

- **runtime:** `@clapp/core` (EvidenceRef in the mirror),
  `@clapp/journey` (the verification vocabulary used by the test-side
  oracle/synthesis; the shipped strategies/loop need no journey imports).
- **dev:** `@clapp/codegen` (tests generate the candidate app),
  `@clapp/plan` (canonical plan literal types for the fixture).
- **NOT dependencies:** `@clapp/diff`, `@clapp/diffext` (parallel P4
  workers) — the mirror is the only shared surface.

## Tests (`bun test` from the repo root)

- `test/mirror.test.ts` — the MIRROR is byte-identical to the frozen
  v0.1 declaration (pinned verbatim; the TL byte-diffs at integration).
- `test/directives.test.ts` — clustering: severity focus, per-file
  grouping, structural solo directives, ordering, determinism.
- `test/strategies.test.ts` — the three strategies against the REAL
  generated golden app: byte-perfect inversions, idempotence,
  abstentions, dispatch.
- `test/killer-acceptance.test.ts` — **THE KILLER**: golden plan →
  codegen → pristine commit → three mutations (heading text, removed
  testid, mock status) → mutation commit → paired servers → report
  synthesized from seeded-journey replays + the network probe →
  `runRepairLoop` (maxIterations 5) → CONVERGES with every attempt
  committed (baseSha/changedPaths/verdict/resolved ids recorded) and
  `git diff pristine..HEAD` EMPTY — the repairs are exactly the inverse
  of the mutations.
- `test/unrepairable.test.ts` — element deletion (structural finding via
  the full synthesis) and page-file deletion (the packet's named
  example; handcrafted report because the generated server imports all
  page modules at boot — a deleted module prevents the candidate from
  starting, so the paired synthesis cannot run): abort verdicts
  `'error'`, `converged: false`, remaining criticals listed, never a
  fake convergence.
- `test/scope-enforcement.test.ts` — a mis-scoped directive aborts
  before editing; the untouched file keeps its bytes; git status clean.
- `test/budget.test.ts` — three critical defects whose convergence
  requires iteration 3, run with maxIterations 2: honest
  non-convergence, partial progress recorded; budget 3 converges.
- `test/determinism.test.ts` — same report + same candidate bytes →
  identical directives, identical attempt records (minus SHAs),
  byte-identical final trees.
- `test/shape-conformance.test.ts` — runtime validators over consumed
  reports / produced attempts / results: optional fields ABSENT never
  null, honest counts, converged iff; the scenario tests run the same
  validators over their live objects.

Test-side report synthesis (`test/helpers/synth.ts`) is the stand-in
for CLAPP-040's PairedRunner: both sides replay the same seeded
journeys through `createDomApplier`; every failed
postcondition/assert-visible becomes a contract-shaped finding
(expected = the corpus-side truth, actual = the candidate-side
observation, from the ReplaySummary/JourneyReplayError + the fetched
HTML), plus the network probe against the plan's mock spec (the plan is
consulted on the runner side only — never by the loop). The rerun
oracle (`test/helpers/oracle.ts`) re-spawns the candidate server fresh
per rerun (the generated server imports page modules at startup),
replays, re-synthesizes, and judges: 0 findings → `equivalent`, more
than the baseline → `worse`, otherwise `divergent`, spawn/synthesis
failure → `error`.

## Honest limitations

- The strategy table covers exactly the three required shapes; visual
  diffs, state/storage divergences, structural deletions, and any
  foreign payload shape are honestly unrepairable (abort `'error'`).
- Element location is line-based (the generated pages are single-line
  elements); deeply nested or multi-line elements would need a real
  parser.
- `applyDirective` requires the candidate root to be a git repo with a
  clean tree (the loop commits only its own work); a dirty tree aborts.
- 'worse' verdicts are recorded but NOT rolled back (the contract has
  no rollback field; a future ADR could add one).
- The oracle contract returns a verdict, not findings; resolution
  tracking within one loop run is edit-verified (local), with the final
  `'equivalent'` verdict providing the behavioral guarantee.
