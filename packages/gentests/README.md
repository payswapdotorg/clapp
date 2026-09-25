# @clapp/gentests — CLAPP-032

Renders a **SynthesisPlan** (contract v0.1 mirror, canonical owner
`@clapp/plan` / CLAPP-030) into an **executable bun-test suite** that a
candidate app conforming to the plan must pass, plus the minimal reference
**conforming server** used to self-verify the generated suite without
`@clapp/codegen` (built in parallel by CLAPP-031).

## Public surface

```ts
import {
  GENTESTS_ADAPTER_INFO,     // IrAdapterInfo-shaped honesty summary
  createConformingServer,    // (plan, { port? }) → { url, close() }
  generateTestSuite,          // (plan, opts) → { files, manifest }
  writeSuite,                // (suite, targetDir) → root path
} from '@clapp/gentests';
```

- `src/synthesis-contract.ts` — the contract MIRROR (byte-identical file;
  canonical owner `@clapp/plan`; pinned by `synthesis-contract.mirror.test.ts`).
- `generateTestSuite(plan, opts)`:
  - `opts.suiteName` — describe() labels (default: `plan.application.name`).
  - `opts.baseUrl` — overrides the plan's server spec in the generated tests
    (the integration gate points the suite at ANY conforming server).
  - `opts.journeyRecords` — full `Journey` records located BY
    `acceptance.journeyId`; each is validated with `validateJourney` at
    generation time (invalid or duplicate records throw). Records not
    referenced by any acceptance entry are ignored.
- `GeneratedTestSuite = { files: GeneratedFile[]; manifest: SuiteManifest }`
  with `SuiteManifest = { testCount, routeTestCount, apiTestCount,
  acceptanceTestCount, skippedAcceptanceIds }`.

## Generated groups

| group | file | tests |
|---|---|---|
| ROUTE | `routes.test.ts` | one per planned route (GET path → 200 + `text/html` + body contains every element testId, every heading text, every form field label declared on the page) **plus one server-health test** (GET `plan.server.healthPath` → 200). `routeTestCount` counts both. |
| API | `api.test.ts` | one per planned endpoint. Mocked endpoints: the planned method is requested **once per mock, in declaration order**, each answer checked for statusCode + exact JSON body. Unmocked endpoints: one request → **501** with an error body naming the endpoint (contract v0.1 declares no per-endpoint error status). |
| ACCEPTANCE | `acceptance.test.ts` | one per `PlannedAcceptance`. With a supplied record: replays the **extended journey** (record actions + one appended `assert-visible` per must-see element — testId selector first, else role+name) through `createDomApplier` + `replayJourney`; asserts `validateJourney(extended) === true`, `actionsApplied === record actions + appended assert-visibles`, and the **final route** (the LAST URL the applier fetched — the v0 `ReplaySummary` exposes no current-URL field, so the generated test injects a fetch-level echo) lands on `expectedRoute`. Without a record: `it.skip`, plan id listed in `skippedAcceptanceIds` — honest, never fabricated. |

Determinism: generation is a pure function of `(plan, options)` — no
timestamps, no randomness, no hidden global state (pinned by tests).

## Running a generated suite

The generated files import ONLY `bun:test` (bun stdlib) and
`@clapp/journey`. **Resolution requirement:** run `bun test` from a
directory where `@clapp/journey` resolves — any directory inside the clapp
workspace, or with `@clapp/journey` installed next to the suite.

```ts
const server = await createConformingServer(plan, { port: 0 });
const suite = generateTestSuite(plan, { baseUrl: server.url, journeyRecords });
const root = await writeSuite(suite, '.scratch-suite'); // inside the workspace
const result = await runSubprocess('bun', ['test'], { cwd: root });
await server.close();
```

## The conforming server

`createConformingServer(plan)` is a zero-dependency (node:http) reference
candidate: every planned route serves minimal conforming HTML (semantic
tags per element kind, every testId as `data-testid`, every heading text,
every form with action/method/fields/labels/submit label), mock endpoints
answer per the semantics above, the health path answers 200, unknown routes
answer 404 (HTML with `data-testid="not-found"`), a wrong method on an API
endpoint answers 405, and routes additionally accept POST (a plan may point
a form's action at a route path). **Port override honored** via
`{ port }`.

## Test battery (bun test)

- `synthesis-contract.mirror.test.ts` — pins the mirror byte-identical to
  the frozen declaration.
- `generate.test.ts` — determinism (two calls → byte-identical files),
  manifest counts exact for the coverage plan, honest skip behavior,
  input validation, and the coverage suite RUNNING clean (6 pass / 1 skip /
  0 fail) against its conforming server as a subprocess.
- `conforming-server.test.ts` — breadth: unknown route 404, wrong method
  405 (endpoint + route), mock sequencing (declaration order, last
  repeats), 501 semantics, health path, POST-to-route, PORT override.
- `acceptance-extension.test.ts` — must-see elements without a testId
  generate the role+name assert-visible; the extended journey validates
  (`validateJourney`) and REPLAYS against a live server; a non-conforming
  page fails the replay.
- `hygiene.test.ts` — imports only `bun:test` + `@clapp/journey`, no
  eval/Function/require/process.env, no origin beyond BASE_URL, and both
  suites compile strict-clean under `bun x tsc --noEmit` (0 errors).
- `killer-acceptance.test.ts` — the end-to-end proof: b01-shaped golden
  plan + the 4 SEEDED b01 journey records → generated suite written to a
  scratch dir inside this package → `bun test` subprocess against the
  conforming server → **13 pass / 0 fail / 0 skip** (7 route + 2 api +
  4 acceptance).

## Known limitations (honest)

- `plan.storage` bindings generate NO assertions: the journey applier
  executes no page scripts, so storage writes are unverifiable here (they
  are declared for the P4 paired runner).
- `plan.navigation` transitions are exercised only indirectly via the
  acceptance replays; no dedicated transition tests are generated.
- A must-see element with neither a testId nor a role cannot become a
  `TargetSelector`: no assert-visible is appended and the generated file
  carries a comment naming the gap (same for unknown must-see element
  ids).
- Multi-mock ordering pins the conforming server's documented semantics
  (sequential consumption, last repeats); `@clapp/codegen` must match it.
- Final-route verification relies on the fetch-level echo (the frozen
  `@clapp/journey` v0 surface exposes no current-URL on the applier or
  its summary).
- The conforming server renders elements FLAT in document order (the plan
  contract has no containment model; fields are nested inside their owning
  form, which is what the journey mechanics require) and interpolates
  texts without HTML escaping — keep plan texts plain.
- `actionsApplied` for acceptance replays equals the record's actions PLUS
  the appended must-see assert-visibles (the packet's "record's action
  count" interpreted with the appended asserts made explicit).
- Fixture plans use readable ids instead of uuid v4 (the contract types
  are plain strings; the uuid convention is the planner's runtime concern).

See `GENTESTS_ADAPTER_INFO` (src/adapter-info.ts) for the machine-readable
honesty summary.
