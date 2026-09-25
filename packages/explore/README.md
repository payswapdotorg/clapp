# @clapp/explore — exploration policy (CLAPP-022)

Budgeted walks of an authorized web app that **discover screens, record
journeys AND action-level evidence** through the frozen `@clapp/journey`
applier, and emit a **Behavioral-IR state-graph fragment** (ir-contract v0.1
mirror in `src/ir-contract.ts`; canonical owner `@clapp/ir`, CLAPP-020) whose
every transition cites recorded evidence. Exploration is the complement to
`@clapp/extract` (CLAPP-021): where extraction mines observation-run evidence
into IR, exploration *generates* the evidence — including the action-level
'user' captures that close the declared action-evidence gap of pure
observation runs.

## Public surface

```ts
import {
  createExplorationPolicy, explore, EXPLORE_ADAPTER_INFO,
  normalizeRoute, walkHtml, createPrng,
} from '@clapp/explore';
export * from './ir-contract'; // the byte-identical mirror, re-exported
```

- `createExplorationPolicy({ entrypoints, maxSteps, maxScreens,
  maxActionsPerScreen, seed })` → deterministic frontier policy
  (`nextAction(state): ExplorationDecision`).
- `explore({ baseUrl, applier, recorder, policy, application })` →
  `{ model: IrModel, journeys: Journey[], report: ExplorationReport, refs:
  EvidenceRef[] }`.
- `walkHtml(html)` → the zero-dep walker's output: the parse tree, the
  compact actionable list, and the `SerializedNode`-shaped capture form.
- `EXPLORE_ADAPTER_INFO` — the honest ir-contract §8 adapter declaration
  (emitted capabilities, unsupported constructs, degradation behavior).

## The loop

```
navigate → walk DOM → record 'dom' capture → enumerate actionables
        → policy picks → assert-visible probe → apply → record 'user' capture
        → new screen? → dom capture + extend the graph
```

Division of labor (declared design):

- **The policy owns budgets and choosing.** It issues a decision only when
  the decision's full action cost fits the remaining step budget (`act` =
  assert probe + apply = 2 actions; `navigate` = 1; `backtrack` = the
  journey-prefix length), so `maxSteps` can never be overshot. `maxScreens`
  halts all work conservatively once reached (clicks can navigate);
  `maxActionsPerScreen` caps act attempts per screen and is reported as the
  honest stop when it is all that blocks remaining work. Tie-breaks go
  through a seeded splitmix32 PRNG carried inside the policy — same seed +
  same decision-state sequence ⇒ identical decisions.
- **The applier is the executor of record.** Every navigate/click/fill is
  applied through the injected `ActionApplier`, and every act target is
  verified FIRST with an `assert-visible` action. Failed applies become
  `'skipped'`/`'assert-failed'` user captures; exploration never aborts on
  a failed action.
- **The walker only chooses.** The frozen applier does not expose its
  internal DOM state (enumeration through the public surface is impossible
  by design), so the explorer maintains its own DOM view: read-only GET
  fetches of the pages the applier navigates, parsed by the zero-dep
  `html-walker` (own parser: tags, attributes, text; comments, doctype,
  and script/style *content* are skipped by design — the same honesty bar
  as `@clapp/journey`'s minidom).
- **The route ledger mirrors the applier's documented navigation
  semantics** (URL resolution, fragment-only no-refetch, click-on-anchor,
  form submission with collected parameters) so the explorer knows where
  the applier is without the applier reporting it.

### Two role vocabularies (deliberate)

The frozen packages compute roles for different consumers, and the walker
mirrors both:

- `roleForCapture` mirrors **@clapp/observe's ROLE_TABLE** naming
  (`link/button/textbox/form/navigation/heading/...`) — used for the
  actionable list, IR components, and the dom-capture serialization, so
  exploration dom evidence is shape-identical to observation-run evidence.
- `journeyRole`/`journeyAccessibleName` mirror **@clapp/journey's a11y
  approximation exactly** (including its documented simplifications),
  because TargetSelectors must resolve against the applier's own role/name
  computation. `ActionableElement.target` is a pre-disambiguated
  (unambiguous, `nth`-carrying) selector; `ActionableElement.journeyRole`
  is the act-class signal (textbox/searchbox → fill, button → click).

Act priority within a screen: **fills before clicks** (filling form fields
before submitting them produces more faithful journeys). Links are never act
targets — they feed the frontier as navigate candidates. Comboboxes,
checkboxes and radios are listed by the walker but not actable through the
frozen applier's verbs (`fill` throws for them; clicking is a no-op).

### Route normalization

Screens are identified by a normalized route: query and hash dropped,
`/index.html` collapsed to `/`, trailing `.html` stripped, always
leading-`/`, never trailing-`/` except the root. The b01 corpus renders to
`/`, `/pricing`, `/features`, `/contact`, `/contact-success`,
`/newsletter-success`.

## Evidence discipline

- Every **visited screen** → one `'dom'` capture (first visit only), payload
  `{ subkind: 'dom-tree', root, nodeCount, truncated }` — the
  `SerializedNode`-shaped serialization of the walker's parse (TYPE-imported
  shape from `@clapp/observe`), with observe's serializer semantics mirrored
  (attribute allowlist + `aria-`/`data-` prefixes, password values never
  serialized, script/style/noscript/template text dropped, own text
  whitespace-collapsed, depth/node caps with flagged truncation).
- Every **applied action** (navigates, assert probes, fills, clicks, and
  backtrack prefix replays) → one `'user'` capture, payload
  `{ subkind: 'action', action, outcome, route, errorCode? }` with outcome
  `'applied' | 'assert-failed' | 'skipped'`.
- Every **applied form submission** → one `'storage'` inventory capture
  `{ subkind: 'storage-inventory', keys }`. HONEST LIMITATION: the frozen
  applier surface exposes no storage channel, so the observable inventory is
  always empty; no storage key can ever "appear in the run", and therefore
  no route-preserving action ever emits a self-transition. The mechanism is
  implemented (the emitter emits a self-transition iff a NEW storage key
  appears, tracked across inventories in execution order) and unit-tested
  with hand-built records — it simply cannot fire on real v0 walks.

Journeys: every discovered screen gets ≥1 journey — the action prefix that
first reached it, built with `@clapp/journey`'s `createRecorder` and
validated with `validateJourneyDetailed` before inclusion. Every journey is
self-contained (it begins with an absolute navigate) and is replayable via
`replayJourney` against a fresh server — the acceptance battery proves it.

## The emitted IrModel fragment

`emitIrModel` (internal, exercised through `explore()`) renders:

- `evidence` — every recorded ref as an `IrEvidenceEntry` (source
  `'exploration'`), deduplicated by evidenceId.
- `screens` — one per visited route, provenance `derived`, `treeRef` = the
  route's dom capture; `visualRef` stays absent (no screenshots — honest).
- `components` — one per actionable per screen with role, stable properties,
  and `events` = the journey-action verbs the frozen applier can execute
  against that role.
- `journeys` — `IrJourney` summaries (purpose `reach <route>`, one
  human-readable step per action), provenance `derived`, citing the user
  captures of the journey's actions.
- `state.transitions` — every APPLIED action whose route changed; trigger
  action vocabulary mapped from journey verbs (`fill` renders as `type`);
  submit-clicks carry the observed form parameters as `input` and
  `submits form <identity>` as a side-effect label; provenance `observed`
  citing the action's user capture and the arrival screen's dom capture.
- Everything the explorer cannot populate stays **empty** (unknown is a
  valid value): environment detail, state variables, data entities, api
  operations, integrations, assumptions, constraints — see
  `EXPLORE_ADAPTER_INFO`.

`checkIrLiteral` (internal — module-level export for the colocated test
battery only, NOT re-exported from the package index) is the structural
self-check over the emitted subset: id shapes, provenance completeness,
evidence-catalog resolution, cross-references, model version.
`emitIrModel` runs it on its own output and throws loudly on any violation.
The tech lead's integration battery runs `@clapp/ir`'s
`validateIrModelDetailed` over exploration output — that is the integration
gate, not this check.

## Budget + report semantics

- `stepsUsed` counts **every action attempted through the applier**
  (navigates, assert probes, fills, clicks, backtrack replays — applied or
  failed).
- `actionsApplied` / `actionsSkipped` count **act decisions** by whether the
  state-changing action applied (assert-failed and failed applies are both
  "skipped").
- `budgetStops` relays the policy's terminating stops verbatim
  (`'max-steps' | 'max-screens' | 'max-actions-per-screen'`).
- `frontierExhausted` is true iff exploration ended with no work remaining
  (frontier empty AND no untried act candidates on any visited screen).
- `duplicateScreensSkipped` counts non-backtrack arrivals at
  already-visited routes (deliberate backtrack replays are excluded).

## Known limitations (honest)

- **No script execution, no layout** — inherited from the frozen applier;
  the explorer sees static HTML only. Client-side routing (hash/history
  APIs driven by JS) is invisible.
- **Deterministic-server assumption** — the explorer's DOM view is its own
  GET of the URL the applier navigated. A server returning different bytes
  per request would desync the route ledger from the applier's actual state;
  the assert-visible probes verify every acted-upon target against the
  applier's own parse, so target drift fails loudly rather than silently.
- **POST arrivals are walked via GET** of the action URL (the applier POSTs
  the params as a body); a server rendering POST responses differently from
  GET would show the GET view in the dom capture.
- **No storage observability** — see above; storage inventories are
  honestly empty and self-transitions never fire in v0.
- **Links are followed only by direct navigation** (the frontier); a link
  whose href is only reachable through click handlers (JS) is not exercised
  as a click. External (cross-origin) links are never navigated
  (deny-all posture). Non-HTML link targets (e.g. asset files) would be
  parsed as HTML — b01 contains none.
- **Backtrack replays are minimal** — a screen's journey prefix is the
  FIRST path that reached it; fills made during a later visit are not part
  of it, so a submit clicked after a backtrack can honestly carry empty
  fields (pinned explicitly in the b01 acceptance test).
- **maxScreens halts conservatively** — once the screen budget is reached
  the policy stops all work (clicks can navigate); fill-only continuation
  under a screen cap is a possible refinement.
- **`summary`/`option`/`disclosure`/`img` and other roles are not listed**
  as actionables (the compact vocabulary is interactive + structural
  anchors); they are still present in the serialized dom capture.
- **Deep nesting truncates the capture** at depth 48 / 20 000 nodes,
  flagged honestly (`truncated: true`), never silently.

## Colocated battery

`test/` (70 tests): walker parsing/actionables/selectors/capture-form +
applier alignment; policy determinism + budget stops; the b01 acceptance
(full 6-route coverage, dom-capture-backed screens, evidence-cited
transitions, ≥6 valid journeys each replayable against a FRESH fixture
server, bundle sealing, budget honesty); end-to-end same-seed determinism;
failure resilience (dead links, self-submits, duplicate arrivals); and the
ir-emitter rules + `checkIrLiteral` negative cases. The per-package
`tsconfig.json` typechecks `src/` AND `test/` (the root program covers
`packages/*/src` only — its include glob is frozen).
