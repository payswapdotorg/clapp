# @clapp/diff — paired differential runner + semantic/state diff (CLAPP-040)

The CLAPP Phase-4 differential-verification spine and the **CANONICAL OWNER**
of the Differential Verification contract v0.1 (`src/diff-contract.ts` — the
byte-identical tech-lead declaration; @clapp/diffext (CLAPP-041) and
@clapp/repair (CLAPP-042) carry mirrors; the tech lead byte-checks at
integration and freezes).

One journey, replayed against BOTH sides — the authorized original (left)
and the synthesized candidate (right) — with the SAME driver vocabulary
(@clapp/journey's `createDomApplier` / `createPlaywrightApplier`), captured
symmetrically per step, diffed on the SEMANTIC and STATE dimensions, and
rolled up into a `DiffReport` with computed counts and an honest verdict
(`'equivalent'` iff the critical count is zero).

```ts
import { createPairedRunner, serializeDiffReport, parseDiffReport } from '@clapp/diff';

const runner = createPairedRunner({
  journeys,                                     // @clapp/journey records (validated)
  left:  { side: 'left',  baseUrl: fixtureServer.url, targetId: 'bench/b01-static',  driver: 'replayer-dom' },
  right: { side: 'right', baseUrl: candidate.url,     targetId: plan.application.id, driver: 'replayer-dom' },
  candidateAppId: plan.application.id,           // "appsyn_" + uuid; must equal right.targetId
  baselineRootHash,                              // the left corpus's root hash (64-hex)
  plan,                                          // optional: state baseline + plan-id anchoring
  ids: createDeterministicDiffIdFactory(),       // optional: reproducible pipelines
  now: () => new Date('2026-09-27T00:00:00.000Z'),
});

const run = await runner.runPair(journey.id);    // PairedRun (contract v0.1)
const findings = await runner.diff(run);         // semantic + state DiffFindings
const report = await runner.report([run]);       // DiffReport: computed counts + verdict
const text = serializeDiffReport(report);        // canonical JSON (sorted keys, no whitespace)
const back = parseDiffReport(text);              // fully validated; byte-stable round-trip
```

## Public surface (frozen at integration)

- `src/diff-contract.ts` — **the CANONICAL contract** (re-exported from the
  index): `DIFF_VERSION`, `PairedTarget`, `SideRunResult`, `PairedRun`,
  `DiffDimension`, `DiffSeverity`, `DiffAnchor`, `DiffFinding`,
  `DiffReport`, `RepairDirective`/`RepairAttempt`/`RepairLoopResult`
  (declared for CLAPP-042; this package neither produces nor consumes
  them), and the `PairedRunner` interface.
- `createPairedRunner(options): PairedRunner` + `PairedRunnerOptions` —
  `runPair` / `diff` / `report`.
- `serializeDiffReport` / `parseDiffReport` (+ `DiffReportError`) —
  canonical serialization and total parse-time validation.
- `createDiffIdFactory` / `createDeterministicDiffIdFactory` (+ the
  `DiffIdFactory` type) — identity minting for reproducible pipelines.
- `DIFF_ADAPTER_INFO` (+ `DiffDriverCapabilities`) — the per-driver
  honesty summary (see below).
- `DiffRunnerError` — options/lookup failures (replay failures are honest
  `SideRunResult`s, never exceptions).

`src/golden-plan.ts` (the b01-shaped golden plan fixture, its corpus root
hash, and the storage-binding plan variants) and `src/test-support.ts`
(candidate spawn/mutation harnesses) are test-facing internals, not
exported from the index — the same discipline as @clapp/plan's test-utils.

## How the paired runner works

**Symmetric capture (principle 1).** Both sides run the SAME journey
through the SAME applier vocabulary, one action at a time, through a
per-side `CaptureCollector` (`src/capture.ts`):

- `replayer-dom` (always available): a fetch wrapper around
  `createDomApplier` records every HTTP transaction (method, url, status,
  and the diff-relevant response header subset: `content-type` /
  `set-cookie` / `location`) and the fetched document itself for HTML
  responses — that document is the step's page capture. Storage is
  inventoried post-run from observed `Set-Cookie` headers ONLY (recorded
  only when at least one cookie was observed).
- `replayer-playwright` (browser-backed, lazily imports playwright-core —
  importing this package never requires a browser): a page response
  listener records network entries; `page.content()` after every applied
  action captures the LIVE post-script DOM (the capture point is the
  settled post-action DOM: a bounded settle grace, the load state, then
  the read, with one bounded retry before an entry is honestly absent);
  a REAL post-run browser inventory (context cookies + in-page
  localStorage/sessionStorage reads) is sealed as the storage capture.

Every capture entry is a CaptureRecord-shaped `{ kind, ts, payload,
redacted: false }` whose `EvidenceRef.sha256` is the sha256 of its
canonical JSON bytes; the side bundle's root hash (sha256 of the canonical
manifest listing every entry ref) makes `SideRunResult.evidenceRef`
verifiable. Steps that captured nothing carry ABSENT entries — `undefined`
in memory, `null` in canonical JSON, never fabricated.

**Semantic dimension (`src/semantic.ts`).** For each paired run:

1. *Run integrity* — the right side failing to complete is `critical` (a
   journey postcondition is contradicted on the candidate); the left side
   failing is `major` (the comparison loses its baseline).
2. *Navigation symmetry* — one side navigating where the other did not is
   `major`.
3. *Route agreement* — different landed paths at the same step is `major`.
4. *Structural agreement* — aligned page pairs (same step, both captured)
   are compared feature-group by feature-group (`src/page-features.ts`,
   compiled through @clapp/observe's `normalizeDomTree` + role/name
   vocabulary): page title, ordered headings (level + text), the
   data-testid surface, the landmark sequence (banner/main/contentinfo/
   complementary/article/region/navigation, explicit aria-label names),
   the journey-targetable surface (elements whose role is in observe's
   ACTIONABLE_ROLES plus img, named by the observe approximation,
   aria-hidden excluded), and form structure (action path, method, fields
   with name/type/label[for]/testId/select options). Severity is escalated
   to `critical` ONLY when the journey targets the divergent structure on
   that page (an assert-visible postcondition or a click/fill target);
   untargeted divergences stay `minor` (form-field divergences `major` —
   submission behavior).
5. *Selector resolution symmetry* — every attempted journey target is
   resolved against both sides' current trees with @clapp/observe's
   `resolveTarget`; asymmetric outcomes (one side only, or structurally
   different elements) are `major`. Symmetric non-resolution — e.g.
   label-named controls the observe approximation cannot name — is
   skipped: honesty about the vocabulary's limits, never a false positive.

`diff()` on a hand-constructed `PairedRun` (no captures) yields
run-integrity findings only; nothing is invented.

**State dimension (`src/state.ts`).** The plan's `PlannedStorageBinding[]`
is the CANDIDATE's baseline (the contract's own scope note):

- `cookie` — verified via the Set-Cookie headers the right side's captures
  observed on the writtenOn route (works under BOTH drivers). Observed as
  planned → an `info` entry recording the observation; visited but
  missing → `major`; never visited → `info` (not exercised).
- `localStorage` / `sessionStorage` — under `replayer-dom` an `info`
  limitation entry (the dom applier executes no page scripts; NO inventory
  is ever fabricated); under `replayer-playwright` the real browser
  inventory is checked (observed → `info`; visited but missing → `major`).
- `server` — `info` (not client-observable; the mock backend is stateless).
- No plan provided → no storage baseline → zero state findings (absence is
  honest, not an error).

**Report (`src/report.ts`).** Counts are COMPUTED from the findings; the
verdict is derived (`equivalent` iff `critical === 0`); `generatedAt` is
ISO-8601 UTC. `serializeDiffReport` validates the whole report against the
contract and emits canonical JSON (sorted keys, no whitespace, absent
entries as `null`); `parseDiffReport` validates every field — shapes,
vocabularies, id patterns, evidence refs, the arrays' attempted-step
lengths, counts-vs-findings consistency, verdict-vs-counts consistency,
`DIFF_VERSION` equality — and normalizes `null` array elements back to
`undefined`. Round-trips are byte-identical.

## Determinism

A report is a pure function of its inputs plus the id/time factories that
minted it:

- `createPairedRunner({ ids, now })` — inject `createDeterministicDiffIdFactory()`
  (a counter rendered as uuid-v4-shaped placeholders) and a fixed clock;
- sides run sequentially (left, then right) so the factory sequence is stable;
- capture payloads contain only deterministic data (URLs, statuses, the
  header subset, page bytes — no wall-clock headers are captured).

Same inputs (same servers) + same factories → **byte-identical**
serialized reports. (The default factory uses `crypto.randomUUID()` and
the real clock — every report identity is genuinely fresh.)

## The b01 golden fixture (`src/golden-plan.ts`)

The killer-acceptance fixture — this package's OWN plan literal, same
corpus truth as @clapp/journey's frozen fixtures (never imported from a
sibling): the exact 6 routes, page titles, ordered headings, data-testid
surface, landmark sequence (incl. the pricing `Plans` region and the
home/pricing `<article>` cards), journey-targetable surface (incl. the
duplicate Features/Pricing/Contact links the seeded nth-selectors
exercise), and the contact + newsletter GET forms. It passes
`validateSynthesisPlanDetailed`; its 'derived' provenance cites the corpus
pages by their REAL sha256; `b01CorpusRootHash()` is the honest corpus
root (sha256 over the canonical manifest of the six pages' hashes). Plan
ids are deterministic uuid-v4-shaped placeholders (the uuid convention is
the planner's runtime concern — documented fixture honesty). The
newsletter form appears on every corpus page footer; the plan contract's
global form-id uniqueness makes each page carry its OWN instance (same
fields, distinct ids) — the honest v0.1 encoding of a shared footer form.
Storage-binding variants (`withCookieBinding`, `withLocalStorageBinding`)
supply the state-dimension tests.

## DIFF_ADAPTER_INFO (the honesty summary)

Exported from the index: the owned dimensions (`semantic`, `state`), the
per-driver capture/limitation matrices (see "How the paired runner
works"), the ownership boundaries (visual + network are @clapp/diffext
CLAPP-041; the repair loop is @clapp/repair CLAPP-042 — this package only
declares those contract types), and the degradation behavior (absent
never null; incomplete sides are findings, never assumptions; foreign
runs diff structurally only; the verdict is computed, never asserted).

## Known limitations (honest)

- The semantic comparison is STRUCTURAL: nesting, styling, classes, and
  asset bytes are out of scope (the visual/network dimensions are
  CLAPP-041's).
- The dom driver executes no page scripts and has no layout engine:
  localStorage/sessionStorage writes are unverifiable there (an honest
  info limitation, never a fabricated inventory), and visibility follows
  the dom applier's approximation.
- The playwright driver's network captures record headers, not response
  bodies; the page DOM (`page.content()`) is the document evidence.
- IR-predicted-state verification is limited to recording and citing the
  provided `transitionIds` anchor — the IR model is not a runner input;
  ids are cited, never re-derived.
- `RepairDirective` / `RepairAttempt` / `RepairLoopResult` are declared by
  the contract for the repair loop; this package neither produces nor
  consumes them.
- The browser-gated bonus test (`playwright-pair.test.ts`) runs the
  SHORTEST seeded journey to keep its concurrent browser footprint minimal
  on small machines; the guaranteed battery coverage is the dom-driver
  path (the @clapp/journey replayer-playwright precedent).

## Dependencies

Runtime (frozen): `@clapp/core` (EvidenceRef, sha256Hex), `@clapp/journey`
(appliers, fixture server, seeded journeys, validation), `@clapp/observe`
(canonicalJson, normalizeDomTree, role/name vocabulary, ACTIONABLE_ROLES),
`@clapp/plan` (SynthesisPlan types, validation, id patterns). Dev:
`@clapp/codegen` (the tests generate the candidate app), `@clapp/evidence`
(bundle-hash cross-verification in tests), `playwright-core` (lazily
imported by the browser-backed driver — browser-optional). No dependency
on @clapp/diffext or @clapp/repair (parallel P4 workers).
