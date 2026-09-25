# @clapp/ir

CLAPP-020 — the Behavioral IR package and **canonical owner of the shared
`ir-contract` v0.1** (`src/ir-contract.ts`, the byte-identical tech-lead
declaration; @clapp/extract and @clapp/explore carry mirrors; the tech lead
verifies byte-equality at integration and freezes; changes require an ADR).

The IR is deliberately framework-independent (docs/BEHAVIORAL_IR.md §1
principles 5/6): it depends only on **@clapp/core** (EvidenceRef is the only
evidence type it needs) and never on @clapp/evidence / @clapp/journey /
@clapp/observe / @clapp/store / @clapp/sandbox.

## Public surface

- **Contract** — `src/ir-contract.ts` re-exported from the root: every
  `Ir*` type, `Provenance`, `Confidence`, `EvidenceLevel`, `Replayability`,
  `IntegrationStatus`, `IrAdapterInfo`, and `IR_MODEL_VERSION` (`'0.1'`).
- **Validation** — `validateIrModel(model): model is IrModel` (total,
  never throws) and `validateIrModelDetailed(model): IrValidationResult`
  (`{ valid, errors }`, path-qualified messages like
  `components[0].events[1]: expected a string, got number`).
- **Canonical JSON** — `canonicalJson` / `canonicalJsonBytes` /
  `isCanonicalJsonSafe` / `CanonicalJsonError`. This package's OWN
  implementation (sorted keys, stable escapes, compact, order-preserving
  arrays, rejects undefined / non-finite / bigint / symbol / function /
  non-plain objects / cycles) — same semantics the platform standardized
  on, independently implemented so the IR never depends on
  @clapp/evidence.
- **Serialization** — `serializeIrModel` (validates first; refuses to
  serialize an invalid model), `parseIrModel` (JSON.parse + validate;
  throws ONE error joining every path-qualified violation),
  `saveIrModel`/`loadIrModel` (UTF-8 fs persistence, temp-sibling + rename
  atomic write, overwrite allowed — models are living artifacts).
- **Diff** — `diffIrModels(a, b): IrDiff` with `{ identical, sections }`;
  `IrDiffSection = { section, added, removed, changed, unchangedCount }`;
  `DIFF_SECTIONS` is the fixed section order.
- **Builder** — `createIrModelBuilder({ application, environment? })` with
  `addEvidenceEntry` / `addScreen` / `addComponent` / `addStateVariable` /
  `addTransition` / `addDataEntity` / `addApiOperation` / `addIntegration` /
  `addAssumption` / `addJourney` / `addConstraint` / `finish`.
- **Stats** — `irModelStats(model): IrModelStats` (section counts +
  componentsByRole + provenanceByLevel + evidenceByKind, the latter two
  total over their closed vocabularies).
- **Adapter honesty** — `describeIrAdapter(info): string` echoes every
  `unsupportedConstructs` entry and the `degradationBehavior` VERBATIM and
  appends an explicit NOTE when the adapter does not declare support for
  the current IR_MODEL_VERSION. Malformed declarations throw
  `IrAdapterError`.
- **Ids** — prefix patterns (`SCREEN_ID_PATTERN`, …) and minters
  (`newScreenId`, …). There is deliberately **no** `newJourneyId`:
  journey ids are owned by @clapp/journey; the IR accepts them from
  callers.

## Usage (10 lines)

```ts
import { createIrModelBuilder, diffIrModels, irModelStats, serializeIrModel, validateIrModel } from '@clapp/ir';

const builder = createIrModelBuilder({ application: { id: 'app_…', name: 'Nimbus Notes', platform: 'web', entrypoints: ['/'] } }); // 1
const dom = builder.addEvidenceEntry({ evidenceId: 'ev_…', kind: 'dom', sha256: '…64 hex…' }, 'run:run_…:dom');                   // 2
const home = builder.addScreen({ route: '/', provenance: { level: 'observed', confidence: { value: 1, rationale: 'dom capture', evidenceRefs: [dom.ref] } }, treeRef: dom.ref }); // 3
const cta  = builder.addComponent({ role: 'button', screenId: home.id, events: ['click'], provenance: { level: 'observed', confidence: { value: 0.9, rationale: 'read from DOM', evidenceRefs: [dom.ref] } } }); // 4
builder.addTransition({ fromScreenId: home.id, toScreenId: home.id, trigger: { type: 'action', action: 'click' }, provenance: { level: 'observed', confidence: { value: 0.9, rationale: 'click observed', evidenceRefs: [dom.ref] } } }); // 5
const model = builder.finish();                    // 6 — runs validateIrModelDetailed, throws on any violation
console.log(validateIrModel(model), irModelStats(model).screens);   // 7
const text = serializeIrModel(model);              // 8 — canonical JSON
const next = JSON.parse(text) as typeof model;     // 9 — (parseIrModel for untrusted text)
console.log(diffIrModels(model, next).identical);  // 10 — true
```

## Design decisions (binding on this package; tested)

### Validation scope

Enforced: model version; application/environment shapes; id prefix
patterns (uuid-shaped hex, version/variant bits not pinned — same
leniency as @clapp/journey) and per-section uniqueness; provenance blocks
(level vocabulary, confidence ∈ [0, 1], non-empty rationale, well-formed
evidenceRefs, empty refs legal ONLY for level `'assumed'`); referential
integrity (component→screen, transition→screens, api-response
trigger→operation, EVERY cited EvidenceRef→evidence catalog by
evidenceId+kind+sha256); one screen per route; no `null` anywhere; the
whole model canonical-JSON serializable.

Not enforced (honest list):

- Comment-only vocabularies: trigger `action` names, state-variable
  `domain` values, component `role` names are plain `string` in the
  contract — any non-empty string is accepted.
- Duplicate strings inside set-semantics arrays (e.g.
  `events: ["click","click"]`) — diff compares them as multisets, so the
  redundancy is visible there instead.
- Field-name uniqueness within a data entity; entity/name uniqueness
  generally (ids are the identity).
- Empty arrays that the contract types as required (journeys, steps,
  preconditions, entrypoints, observedExamples, events, …) are legal.
- Extra properties beyond declared fields are ALLOWED (forward
  compatibility) but are covered by the no-null and serializability rules.
- uuid v4 version/variant bits (uuid-shaped hex accepted), and the id
  patterns match their prefix case-insensitively (the `/i` convention of
  the frozen `JOURNEY_ID_PATTERN`).

### Null policy

`null` is not a valid value ANYWHERE in an IR model — optional fields are
absent, never null ("unknown is a valid value" renders as absence). This
is enforced per declared field AND by a deep scan over the entire tree,
including opaque payloads (`input`, `outputs`, schemas, component
`properties`) and extra properties. Observed null data must be encoded
otherwise (e.g. omitted) — a deliberate v0.1 strictness rule; relaxing it
is an ADR away.

### Evidence catalog resolution

Every EvidenceRef cited anywhere in the model (screen `treeRef` /
`visualRef`, api `observedExamples`, and every provenance block's
`confidence.evidenceRefs`) must resolve against the evidence catalog,
matching evidenceId AND kind AND sha256 (an EvidenceRef is
self-describing). The catalog lists each evidence item exactly once
(unique `evidenceId`s) so citation is unambiguous.

### Builder ordering & the finish() gate

Referential order is enforced at add time: evidence first, then screens,
then components/transitions (api operations before `api-response`
triggers). Add-time checks cover element shape + references +
canonical-JSON serializability. The model-wide deep-null scan runs in
`finish()`'s validation pass — a real second gate, not decoration: a
`null` buried inside an opaque payload passes add-time checks and fails
`finish()`. One screen per route: duplicate routes are rejected naming
the existing screen; captures of the same route must be merged by the
caller.

### Diff semantics

Section list (fixed order, `DIFF_SECTIONS`): `modelVersion`,
`application`, `environment`, `screens`, `components`, `state.variables`,
`state.transitions`, `data.entities`, `api.operations`, `integrations`,
`assumptions`, `journeys`, `evidence`, `constraints`. Identity in the
id-keyed sections is the element id — reordering a SECTION array is not a
change. `modelVersion` / `application` / `environment` compare whole
values; `constraints` diffs as a string set. Inside elements, array order
is semantic (canonical serialization is order-preserving — e.g. journey
`steps` are sequential) EXCEPT the set-semantics arrays, which are
normalized (sorted by canonical form) before comparison:

| Section / element        | Set-semantics arrays (reorder ≠ change) |
| ------------------------ | --------------------------------------- |
| every provenance block   | `provenance.confidence.evidenceRefs`    |
| application (whole-value)| `entrypoints`                            |
| journeys                 | `preconditions` (steps stay ORDERED)    |
| components               | `events`                                 |
| transitions              | `sideEffects`                            |
| data entities            | `persistence`, `fields` (+ each field's provenance refs) |
| api operations           | `headersNeeded`, `observedExamples`, `externalSideEffects` |

Note: `application` is a whole-value section ADDITION beyond the work
item's named list — without it, two models differing only in application
would diff as `identical`, which is wrong; flagged for the tech lead's
freeze review. Set-semantics arrays compare as MULTISETS inside elements
(duplicates visible); the top-level `constraints` section compares as a
SET (duplicates collapse).

`diffIrModels` trusts its typed inputs (it does not validate); malformed
elements are identified by their full canonical content instead of being
dropped.

## Testing

`bun test` from the repo root runs this package's battery alongside the
workspace: canonical-JSON golden strings and every rejection class; id
minting/patterns; the valid b01 reference model (`/`, `/pricing`,
`/features` screens, components, one navigate transition, one synthesized
api operation with honest `'assumed'` provenance, the real seeded b01-nav
journey id) plus ~45 malformed mutations each asserting the exact
path-qualified error; totality on garbage/cyclic input; serialization
determinism (serialize→parse→serialize byte-identical, insertion-order
independence) and tmp-dir save/load with atomic-write checks; diff
add/remove/change/reorder semantics including the set-semantics table;
builder rejection paths + the finish() gate; stats counts; adapter
honesty summaries. No network, no browser, tmp dirs only.
