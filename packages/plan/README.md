# @clapp/plan

CLAPP-030 — the architecture planner and **canonical owner of the shared
`synthesis-contract` v0.1** (`src/synthesis-contract.ts`, the byte-identical
tech-lead declaration; @clapp/codegen (CLAPP-031) and @clapp/gentests
(CLAPP-032) carry mirrors; the tech lead verifies byte-equality at integration
and freezes; changes require an ADR).

The SynthesisPlan is the intermediate artifact between the Behavioral IR
(frozen at P2, @clapp/ir) and the synthesized candidate web app: the PLANNER
(this package) derives it from a validated IrModel; the CODEGEN renders it
into runnable app source + mock backend; the TEST GENERATOR renders it into
a generated acceptance suite. All three speak ONLY through the contract.

Runtime dependencies are deliberately minimal: **@clapp/core** (EvidenceRef),
**@clapp/ir** (model validation, canonicalJson, the IrAdapterInfo shape),
**@clapp/journey** (the Journey record type + validation). The e2e battery
additionally uses @clapp/explore / @clapp/evidence / @clapp/store (dev
dependencies). The plan NEVER depends on @clapp/codegen or @clapp/gentests —
they are parallel P3 workers.

## Public surface

- **Contract** — `src/synthesis-contract.ts` re-exported from the root: every
  `Planned*` type, `PlanProvenance`, `PlanProvenanceLevel`, `MockResponse`,
  `PlannedServerSpec`, `SynthesisPlan`, and `PLAN_VERSION` (`'0.1'`).
- **Ids** — prefix patterns (`ROUTE_ID_PATTERN`, …), minters (`newRouteId`,
  `newPageId`, `newElementId`, `newFormId`, `newNavId`, `newStorageBindingId`,
  `newApiEndpointId`, `newMockId`, `newAcceptanceId`,
  `newPlannedApplicationId`), `mintPlanId`, `planIdPatternFor`,
  `PLAN_ID_PREFIXES`. There is deliberately **no** `newJourneyId`: journey ids
  are owned by @clapp/journey; the plan locates journey records BY id.
- **Validation** — `validateSynthesisPlan(plan): plan is SynthesisPlan`
  (total, never throws) and `validateSynthesisPlanDetailed(plan):
  PlanValidationResult` (`{ valid, errors }`, path-qualified messages like
  `pages[3].elements[7].kind: expected one of heading|…, got "textbox"`).
- **Serialization** — `serializeSynthesisPlan` (validates first; refuses to
  serialize an invalid plan) and `parseSynthesisPlan` (JSON.parse + validate;
  throws ONE `PlanSerializationError` joining every path-qualified
  violation). Canonical JSON is @clapp/ir's `canonicalJson` — REUSED, not
  reimplemented (the packet-declared platform semantics). Round-trip is
  byte-stable: `serialize(parse(serialize(p))) === serialize(p)`.
- **Planner** — `planSynthesis(model, options?): SynthesisPlan` (see below).
  `PlanOptions`: `{ journeys?: Journey[]; idFactory?: (kind) => string }`.
- **Diff** — `diffSynthesisPlans(a, b): PlanDiff` with `{ identical, sections }`;
  `PlanDiffSection = { section, added, removed, changed, unchangedCount }`;
  `PLAN_DIFF_SECTIONS` is the fixed section order.
- **Stats** — `planStats(plan): PlanStats` (section counts + `elementsByKind`
  + `provenanceByLevel` + evidence-ref totals).
- **Adapter honesty** — `PLAN_ADAPTER_INFO` (IrAdapterInfo-shaped) and
  `describePlanAdapter(info): string`.

## Usage (10 lines)

```ts
import { planSynthesis, serializeSynthesisPlan, validateSynthesisPlanDetailed } from '@clapp/plan';

const plan = planSynthesis(validatedIrModel, { journeys: seededJourneys });           // 1
const check = validateSynthesisPlanDetailed(plan);                                    // 2
if (!check.valid) throw new Error(check.errors.join('\n'));                           // 3
const text = serializeSynthesisPlan(plan);                                           // 4
const back = parseSynthesisPlan(text);                                               // 5
console.log(plan.routes.map((route) => route.path));                                 // 6
console.log(plan.pages.flatMap((page) => page.elements.map((el) => el.testId)));     // 7
console.log(plan.acceptance.map((entry) => [entry.journeyId, entry.expectedRoute])); // 8
console.log(diffSynthesisPlans(plan, back).identical);                               // 9 — true
console.log(planStats(plan).elementsByKind);                                         // 10
```

## Derivation rules (binding; each unit-tested)

1. **screens → routes+pages** — every IrScreen becomes a PlannedRoute
   (path = screen.route, served verbatim) + PlannedPage. The page title comes
   from the screen's lowest-level (smallest hN) heading component with usable
   text (accessible name, else observed text); a screen without one falls
   back to the route basename WITH an assumption — text is never fabricated.
2. **components → elements** — every IrComponent becomes a PlannedElement.
   Kind mapping: link→`link`, button→`button`, navigation→`navigation`,
   heading→`heading` (level from the observed tag), image→`image` (alt
   preserved), list→`list`, form→`form`, every other role (textbox,
   searchbox, combobox, checkbox, radio, slider, spinbutton, …)→`other`
   with the role preserved verbatim. role/name/testId/text/href/alt are
   carried verbatim when observed.
3. **forms** — textbox-role components on a screen + the screen's button
   components group into a PlannedForm ONLY when an outgoing IrTransition
   with trigger `{type:'action', action:'submit'}` exists on that screen:
   action = the transition's toScreen route; method `'get'` (never observable
   in IR v0.1 — every form carries a `'get'` assumption); fields from the
   textbox components (name from `properties.name`, else testId + assumption
   — a textbox with neither is skipped + assumption; label = the accessible
   name; type from `properties.type`, else `'text'` + assumption; required
   from `properties.required`); submitLabel/submitTestId from the FIRST
   button component (`'Submit'` + assumption when the screen has no named
   button). Screens without submit transitions carry NO forms — their
   textboxes stay plain elements (honest, documented).
4. **transitions → navigation** — every IrTransition whose from/to screens
   resolve becomes a PlannedTransition (self-transitions legal; one per IR
   transition). Trigger derivation: action `submit` → `{kind:'form-submit'}`;
   action `click` when the transition's `input` string values name (by
   href/name/testId equality) EXACTLY ONE link-role component on the
   from-screen → `{kind:'link', elementId}`; otherwise — no input, no match,
   ambiguous match, non-action triggers (timer/background-event/api-response/
   websocket-message), non-click/submit actions — `{kind:'redirect', reason}`
   with an assumption entry and 'assumed' provenance (never silent).
5. **data entities → storage bindings** — every persistence entry
   (`localStorage:key` | `sessionStorage:key` | `cookie:name`) becomes a
   PlannedStorageBinding (storage + key parsed; entityFieldNames from the
   entity's fields; writtenOn = planned transitions whose sideEffects
   mention the entity or key name — empty when unobserved, honest).
   Unparseable entries (e.g. `server:*` in v0.1) are skipped WITH an
   assumption.
6. **api operations → endpoints** — every http-transport IrApiOperation with
   a method becomes a PlannedApiEndpoint (schemas passed through when
   present). WebSocket ops are NOT mapped — one plan assumption lists every
   skipped op (id + urlPattern). Methodless http ops are skipped with an
   assumption too. Endpoints WITH a responseSchema get one MockResponse
   (statusCode 200; bodyJson deterministically sketched: string→`"mock"`,
   number/integer→`0`, boolean→`false`, array→`[]`, object→recursive over
   the descriptor's keys/valueTypes, null-typed keys omitted, null-typed top
   level → empty body). Mock bodies are 'planned' placeholders, never
   observed data.
7. **journeys → acceptance** — each input Journey record yields an entry:
   journeyId = the record's id; purpose/steps from the matching IrJourney
   when present, else derived from the record (purpose = name, steps = one
   `describeJourneyAction` summary per action) + assumption. expectedRoute =
   the owning page's route of the LAST resolved assert-visible target
   (resolved by testId first, then role+name; `nth` selects among matches;
   a journey with no resolved assert falls back to its final navigate URL —
   normalized like explore's `normalizeRoute` — then to a served entrypoint,
   each with an assumption). mustSeeElementIds = the journey's assert
   targets re-resolved against the expected page. Every unresolved target →
   exactly one assumption entry (never dropped silently). Absent/empty
   journeys → acceptance stays EMPTY with one assumption (never fabricated).
8. **application** — id minted `appsyn_`+uuid v4; name = the IR application
   name + `" (synth)"`; sourceModelId = the IR application id; entrypoints =
   the IR application entrypoints (the validator enforces they are served
   routes — a model whose entrypoints have no screens cannot be planned and
   `planSynthesis` throws rather than fabricating routes).
9. **server spec** — `bun run start` / port 4173 / healthPath `/` (v0
   'planned' constants — @clapp/codegen materializes them).

`planSynthesis` validates the input model first (throws on invalid input),
validates journey records (throws), and self-checks the assembled plan with
`validateSynthesisPlanDetailed` before returning (a planner bug throws
instead of leaking an invalid plan). It is deterministic modulo minted ids
(pinned by determinism.test.ts); `idFactory` makes it fully deterministic.

## Validation scope

Enforced: planVersion = `PLAN_VERSION`; application shape + appsyn_/app_ id
patterns + entrypoints ⊆ served route paths; per-section id patterns and
uniqueness (element and form ids are unique ACROSS pages — they are
plan-global); the route↔page mapping is BIJECTIVE (one page per route, one
route per page, no orphans on either side); page titles / element
kinds+levels / storage kinds / form methods / trigger discriminated unions /
server spec sanity (non-empty command, integer port 1-65535, healthPath
starting with `/`); formId→form on the SAME page; navigation from/to route
ids + link-element / form ids on the from-route's page; storage writtenOn→
navigation ids; mock endpointId→endpoint + statusCode 100-599; acceptance
journeyId shape + expectedRoute ∈ served paths + mustSeeElementIds→elements
on the expectedRoute's page; cross-contract IR id patterns (sourceModelId
`app_`, sourceTransitionIds `trans_`, sourceEntityIds `ent_`,
sourceOperationIds `op_`, journey ids `journey_`); provenance block shape
(level vocabulary, non-empty rationale, non-empty-string sourceIds,
well-formed EvidenceRefs); no `null` anywhere (per-field + deep scan);
whole-plan canonical-JSON serializability.

Not enforced (honest list):

- Comment-only vocabularies: `PlannedField.type` values, element `role`
  names, `application.platform` — the contract types them as plain strings.
- Provenance `evidenceRefs` EMPTINESS per level — the contract's comment
  ("empty is legal for 'planned'") is read as an example, not an exhaustive
  constraint; an 'assumed' choice is by definition not evidence-established.
  The planner's own discipline (citing every derivable ref) is enforced by
  its tests, not by the validator.
- Semantic quality: an empty plan (no routes, no pages, empty sections) is
  structurally valid.
- `sourceIds` prefix patterns (open vocabulary of IR element ids).
- fs persistence (deliberately absent in v0.1 — see serialize.ts).

## Known limitations (honest)

- **Click attribution is input-gated.** Explore-produced IR transitions
  carry `input` only for form submissions, so ordinary link clicks plan as
  `redirect` + assumption. Proposed ADR: enrich IrTransition with the act
  target (or its input) so the planner can emit `{kind:'link'}` triggers
  for observed clicks.
- **Form methods are never observable** in IR v0.1 (the serialized-DOM
  attribute allowlist has no `method`/`action`), so every form is planned
  `get` with an assumption.
- **Form fields are textbox-role only** (the binding rule's letter);
  combobox/checkbox/radio/slider/spinbutton/searchbox components become
  plain elements. Proposed ADR if the contact-form `select` should become a
  `select`-typed field.
- **Non-actionable structure is invisible to the plan.** The frozen
  exploration surface enumerates only ACTIONABLE_CAPTURE_ROLES (img,
  contentinfo, plain text are deliberately excluded by @clapp/explore), so
  plans derived from explore models carry no image/landmark elements and
  seeded-journey assert targets naming them resolve to assumption entries,
  not must-see elements. This is the documented root cause of the e2e ratio
  gate below.
- **`href` passes through verbatim** (e.g. `features.html` as observed, not
  normalized to `/features`); codegen renders as-is per the contract
  comment. Route normalization is only applied to journey `navigate` URLs
  for expected-route fallback.
- **must-see `nth` is plan-global** in the whole-plan resolution pass
  (documented approximation of the applier's per-page semantics; exact for
  unique targets, which is what acceptance uses).
- **Mock bodies are placeholders** derived from schema sketches, not
  observed payloads.
- **e2e ratio gate.** The work item targeted ≥90% seeded-journey assert
  resolution; the honest ceiling for the b01 corpus from the frozen
  exploration surface is 11/15 ≈ 73% (img ×3 + contentinfo ×1 cannot
  resolve). The e2e pins the achievable gate (≥70%) plus the compensating
  discipline (exactly one assumption per unresolved target). Proposed ADR:
  either extend exploration's actionable vocabulary with `img` and
  landmark roles, or re-baseline the gate for explore-produced models.

## Battery

`bun install && bun run typecheck && bun run lint && bun test` from the
repo root (the plan package contributes 128 tests across 7 files: contract,
validator defect battery, serialize round-trips, derivation rules,
determinism, diff+stats, and the b01 e2e — real exploration → plan).
