# @clapp/extract

CLAPP-021 — evidence-to-IR extraction. Turns a **sealed `EvidenceBundle`**
(plus a reader for the artifact bytes behind it) into a **Behavioral IR
model v0.1** whose every inferred element carries honest provenance citing
the bundle's refs. Degraded input degrades the model (warnings +
assumptions), never the extraction.

## Usage (10 lines)

```ts
import { extractIrModel } from '@clapp/extract';

const { model, warnings, stats } = await extractIrModel({          // 1-3
  bundle,                                                          // sealed EvidenceBundle
  readArtifact: (id) => artifactStore.readBytes(id),               // bytes by ArtifactId
});                                                                // → { model, warnings, stats }

model.screens;              // [{ id, route, treeRef, visualRef, provenance }]     // 4
model.components;           // actionable elements with role/name/attrs evidence  // 5
model.state.transitions;    // navigation transitions between distinct routes     // 6
model.api.operations;       // http/websocket ops with sketches + examples        // 7
model.data.entities;        // storage keys → entities; scalars → state variables // 8
model.assumptions;          // every degradation, confidence <= 0.5               // 9
model.evidence;             // catalog of EVERY manifest ref, cited ones resolve  // 10
```

## The shared contract

`src/ir-contract.ts` is a **byte-identical mirror** of the CLAPP Behavioral
IR contract v0.1 (canonical owner: `@clapp/ir`, CLAPP-020 — built in the
parallel wave; the tech lead verifies byte-equality at integration and
freezes). The mirror is re-exported from the package index and pinned by a
byte-exact test. Changes require an ADR.

## Modules

| module | contents |
| --- | --- |
| `src/ir-contract.ts` | CANONICAL-mirrored IR contract v0.1 (pinned by a byte-exact test) |
| `src/extraction.ts` | `extractIrModel`, `ExtractionInput/Result/Stats`, `EXTRACT_ADAPTER_INFO` |
| `src/capture-reader.ts` | manifest walk in event order → hash-verified `ConsumedCapture[]`; skips + counts degraded captures |
| `src/screens-extractor.ts` | dom-trees grouped by current document route → `IrScreen` + `IrComponent` (first capture wins, signature dedupe, screenshot attribution) |
| `src/api-extractor.ts` | request/response pairs by (url, method) → `IrApiOperation`; ws-frame groups → transport 'websocket' |
| `src/storage-extractor.ts` | storage inventories → `IrDataEntity` + scalar `IrStateVariable` (first appearance wins) |
| `src/transitions-extractor.ts` | consecutive distinct routes → navigation `IrTransition` |
| `src/assumptions.ts` | `AssumptionCollector` — degradations become `IrAssumption` (level assumed, confidence <= 0.5) |
| `src/route-timeline.ts` | document-request order → route runs + per-capture route attribution |
| `src/check-ir-literal.ts` | internal structural self-check (ids, provenance, referential integrity, no-null, JSON round-trip) — NOT exported |
| `src/payloads.ts` | (kind, subkind) interpretation vocabulary — type guards over @clapp/observe payload shapes (TYPE-only imports) |
| `src/component-semantics.ts` | local role/name/event vocabulary consistent with the @clapp/observe ROLE_TABLE |
| `src/url-pattern.ts`, `src/schema-sketch.ts`, `src/ids.ts` | route/pattern normalization, {type,keys,valueTypes} sketches, prefixed-uuid minters |

Runtime dependencies: `@clapp/core` only. `@clapp/evidence` /
`@clapp/store` are devDependencies (used at runtime by tests;
TYPE-only imports in runtime code). `@clapp/observe` is a devDependency
used TYPE-ONLY in runtime code and at runtime by the e2e battery. There is
NO dependency on `@clapp/ir` (parallel wave) or `@clapp/sandbox`
(runtime).

## Honesty model

- **Skips, never throws, on degraded evidence**: unreadable artifacts,
  hash mismatches (bytes that are not what the ref claims are not cited),
  non-JSON bytes, malformed records, and unknown (kind, subkind) combos
  are each skipped with a precise warning and counted in
  `stats.capturesSkipped`. One deduped summary warning per unknown combo.
- **The catalog describes the bundle, the model cites what it read**:
  `model.evidence` lists EVERY manifest ref; only refs the reader could
  actually parse and hash-verify are cited by inferred elements.
- **Provenance everywhere the contract requires it**: screens/components/
  variables/transitions/operations/assumptions carry level + confidence +
  evidenceRefs; empty `evidenceRefs` appear only on `assumed`-level blocks
  (asserted by tests and the internal self-check).
- **Every degradation is an assumption** (confidence <= 0.5) with a
  precise statement — truncated previews, unparsable schemas, unknown
  storage values — so the model never silently upgrades guesswork.
- **The self-check throws only on this package's own bugs**: the emitted
  model must satisfy `checkIrLiteral` (unique prefixed ids, referential
  integrity against the catalog AND the manifest, no `null` anywhere,
  JSON round-trip stability). Input degradation never throws.
- **Gross manifest violations throw** (`ManifestShapeError`): a manifest
  without `run`/`events`/`evidence`/`artifacts` arrays is not
  evidence-shaped at all. Tamper detection is `@clapp/evidence`'s
  `verify` job — extraction trusts a bundle that verifies.

## Extraction semantics (v0)

- **Route**: URL path, query/fragment stripped, trailing-slash
  insensitive; dom-tree captures are attributed to the route of the most
  recent document request (observation script order). A dom capture with
  no preceding document request cannot be attributed honestly — warning,
  no screen.
- **Screens**: first capture per route mints the screen (`treeRef` = that
  capture's ref); later captures for the same route only append
  components, deduped by the role+name+attrs signature. Screenshots attach
  as `visualRef` (first wins; pre-dom screenshots attach when the screen
  is minted; unattributable ones warn and stay uncited).
- **Components**: nodes whose role is in the local vocabulary (the roles
  `a/button/input/form/select/textarea` map to per the observe ROLE_TABLE:
  link, button, textbox, combobox, checkbox, radio, spinbutton, slider,
  form). `properties` = `{ tag, name, text?, attrs? }` where `name` is the
  observe accessible-name approximation (aria-label > subtree text > alt >
  title > placeholder). `events` = role-derived DOM-standard events.
- **API operations**: one per distinct (url, method) group — pairs
  (request + response) are `derived` (GET/HEAD/OPTIONS `replayable`,
  mutating methods conservatively `side-effects`); request-only /
  response-only / failed groups are `unavailable` + `unreproducible`.
  `urlPattern` parameterizes all-digit/uuid segments to `:id`, query
  stripped. Schemas are `{type, keys, valueTypes}` sketches; `errorSchema`
  from the first >= 400 response. `headersNeeded`/`authDependency` carry
  header NAMES only (authorization/cookie) — values never enter the model.
  ws-frame groups by URL → transport `websocket` (no method), sent/received
  frame sketches on each side.
- **Storage**: every key in localStorage/sessionStorage becomes an entity
  (persistence `<area>:<key>`); JSON object values → per-key fields; JSON
  scalars → a `value` field AND an `IrStateVariable` (domain text/count/
  boolean); non-JSON (truncated/redacted) → `unknown` domain + assumption.
  Cookies → entities (`cookie:<name>`); indexedDB databases → entities
  (`indexeddb:<name>`) with object-store fields (record shape honestly
  `unknown`). First appearance wins across inventories.
- **Transitions**: consecutive DISTINCT document routes →
  `{type: 'action', action: 'navigate'}` transitions; `input` = the
  observed target URL; `outputs` = the paired document response's
  `{status, mimeType}`; `sideEffects` = `[]` (nothing observable).
  A route without a screen skips its transitions with a warning.
- **Application identity**: `name` = `run.targetId` (the only name the
  evidence carries), `platform` = `'web'` (web-shaped evidence channels),
  `entrypoints` = the first document route observed.

## Known limitations (honest)

- **Action-level transitions are not derivable from observation evidence**
  (action steps emit no captures — declared gap; exploration CLAPP-022
  owns them). The model carries this as a constraint string and
  `EXTRACT_ADAPTER_INFO.unsupportedConstructs`.
- **No journeys / integrations** are derived (`[]` — journey records are
  @clapp/journey's domain; no third-party detection from passive
  evidence).
- **runtime console / static asset / service-worker / cache evidence is
  cataloged but not modeled** (no ir-contract v0.1 slots) — warned per
  combo, declared in the adapter info.
- **Component `events` are role-derived defaults**, not observed listeners
  (not observable from serialized DOM). Same for `externalSideEffects: []`.
- **Replayability is a labeling POLICY**: safe-method pairs are
  `replayable` by HTTP semantics; mutating-method pairs are conservatively
  `side-effects`; both documented in the op's confidence rationale —
  neither claim is server-side knowledge.
- **Id-parameterized operations are NOT merged** across different ids
  (`/api/items/123` and `/api/items/456` produce two operations with the
  same `/api/items/:id` pattern — matching is by exact url+method per the
  work item; merging is a v0.2 refinement).
- **Entity-level provenance is not representable** in ir-contract v0.1
  (`IrDataEntity` has no provenance block); field-level provenance carries
  it, and non-parsable values carry an `unknown` field at level
  `unavailable` plus an assumption.
- **Extraction does not re-verify the bundle seal** — run
  `@clapp/evidence`'s `verify` first if tamper state matters (individual
  artifact hash mismatches ARE caught per capture and skipped honestly).
- **e2e concurrency budget**: this sandbox (2 CPUs, no swap) sustains at
  most four browser e2e sessions across the whole `bun test` battery
  (CLAPP-010's suites run three). CLAPP-021's e2e therefore runs ONE full
  extraction session (over `startFixtureServer(b01)`, with all required
  assertions) and exercises `launchServerInSandbox` with the same
  machinery 010's e2e used (executor + budget + readyPath + stopPath +
  graceful close) via HTTP probes instead of a second browser session — a
  second full session was measured to make the shared battery flaky for
  010's suites. Extraction over a sandboxed server is additionally covered
  by the direct session's identical HTTP contract.
- **`scripts/inspect-e2e.ts`** is a manual debugging aid (not part of the
  public surface or the test battery).

## Test battery

- `src/*.test.ts` — unit tests over synthetic bundles built through a REAL
  `RecordingSession` + `MemoryStores` + `buildBundle` (the landed
  @clapp/evidence pipeline): reader degradation, screen grouping/dedupe/
  attribution, url parameterization, pair matching, schema degradation,
  ws operations, storage entities/variables, transition pairing, honest
  warnings, empty-evidence refs only on 'assumed', structural self-check
  (positive + negative controls), shape stability.
- `src/ir-contract.mirror.test.ts` — pins the mirror byte-for-byte against
  the frozen tech-lead declaration.
- `src/e2e/extraction.e2e.test.ts` — browser-gated (`describe.skipIf`):
  `startFixtureServer(b01)` → `ObservationRunner` (3 routes, capture-dom +
  screenshots) → `RecordingSession` → `buildBundle` → `extractIrModel` →
  3 screens, `treeRef`/`visualRef` set, transitions in nav order, every
  cited ref resolves in the bundle manifest; plus the
  `launchServerInSandbox` flavor over the b01 corpus. Skips cleanly when
  no browser binary exists.
