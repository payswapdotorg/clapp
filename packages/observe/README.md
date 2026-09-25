# @clapp/observe — CLAPP browser runner (CLAPP-010)

Runs an authorized web app under observation and funnels every capture
channel through the `EvidenceRecorder` port (capture-contract v0, canonical
owner `@clapp/evidence` / CLAPP-011) as typed, redacted, canonical-JSON
`CaptureRecords` — provenance-ready evidence for the Behavioral IR.

```ts
import { chromium } from 'playwright';
import { ProcessSandboxExecutor } from '@clapp/sandbox';
import {
  ObservationRunner,
  createPlaywrightDriverFactory,
  launchServerInSandbox,
} from '@clapp/observe';

// 1. serve the authorized target inside an isolated execution profile
const server = await launchServerInSandbox(new ProcessSandboxExecutor(), {
  command: 'bun',
  args: ['server.ts'],
  fixtures: { 'server.ts': serverSource, 'public/index.html': html },
  budget: { maxDurationMs: 120_000 },        // REQUIRED — the reaper bound
  readyPath: '/',
  stopPath: '/__clapp/stop',                 // cooperative stop → graceful close
});

// 2. observe it (recorder: your @clapp/evidence implementation)
const runner = new ObservationRunner({
  recorder,
  sessionFactory: createPlaywrightDriverFactory({ browser }),
  script: {
    targetId: 'bench/b01-static',
    steps: [
      { type: 'navigate', url: server.baseUrl },
      { type: 'settle', ms: 1_000 },
      { type: 'capture-dom' },
      { type: 'capture-storage' },
      { type: 'capture-static' },
      { type: 'screenshot' },
      { type: 'action', action: { type: 'click', target: { testId: 'load-data' } } },
      { type: 'settle', ms: 400 },
      { type: 'flush' },
    ],
  },
});
const result = await runner.run();   // EvidenceRef[] + per-step outcomes + stats
await server.close();                // graceful (stop route) → completed/0
```

## Module map

Pure core (zero Playwright imports — unit-testable anywhere):

| module | owns |
| --- | --- |
| `src/canonical-json.ts` | deterministic JSON (sorted keys, stable escapes, rejection of non-plain values), `pruneUndefined` |
| `src/redaction.ts` | secret-shaped value/key scrubbing (emails, JWTs, bearer, hex blobs, URL userinfo/query secrets, cookie values), configurable flags |
| `src/dom-serializer.ts` | raw DOM tree → compact `{tag, role, text, attrs, children}` (attr subset, password values dropped, script/style text skipped, depth/node caps) |
| `src/dom-semantics.ts` | `ROLE_TABLE` (tags/ARIA/input-types → roles), actionable-role set, unique-target resolution for journey `TargetSelector`s (exact name matching, ambiguity is an error) |
| `src/logs/runtime.ts` | console/pageerror/browser-log payload shapes, console-arg sanitizer, reducer |
| `src/logs/network.ts` | request/response/requestfailed/ws-frame payload shapes + builders (truncation caps, volatile-header stripping) + reducer |
| `src/logs/storage.ts` | storage inventory (localStorage/sessionStorage/cookies/SW/caches/IndexedDB), sorted + redacted + capped, sw-registered event payload, reducer |
| `src/static-inventory.ts` | static asset classification (rel → resourceType → mime → extension, data: URLs) and DOM+network merge (dedupe by URL, sort, cap) |
| `src/session-core.ts` | `SessionCore`: session state machine (idle→running⇄paused→ended), the capture funnel (prune → redact → canonical check → bounds), batching, buffer bounds |

Adapter:

| module | owns |
| --- | --- |
| `src/capture-contract.ts` | byte-identical mirror of the shared capture contract (canonical owner `@clapp/evidence`) |
| `src/journey-contract.ts` | byte-identical mirror of the shared journey contract (canonical owner `@clapp/journey`) — `TargetSelector`/`JourneyAction` are used by the runner's action steps |
| `src/dom-kit.ts` | in-page JS helpers as STRING constants (DOM walker, static links, storage snapshot, click/fill by element path); self-invoking-expression evaluate convention |
| `src/page-driver.ts` | the `PageDriver` port (navigate/evaluate/screenshot/keyboard/cookies/storage/drain) — the seam that makes runner wiring unit-testable without a browser |
| `src/playwright-session.ts` | context/page lifecycle, CDP attach (Log domain, level-filtered), live subscriptions (console, pageerror, request/response/requestfailed, WS frames, SW starts) through ONE ordered queue, deterministic pending-network drain |
| `src/sandbox-server.ts` | `launchServerInSandbox(executor, opts)`: fixture server inside an isolated `ExecutionProfile`, port-file + HTTP ready-poll, duration-budget reaper + cooperative stop route |
| `src/runner.ts` | `ObservationRunner`: script → steps → funnel → `SessionCore` → `onFlush` → `recorder.record()`; action steps resolve journey selectors through `dom-semantics` and act by element path; step failures throw `ObservationRunError` with the partial result |
| `src/testing.ts` | `FakeEvidenceRecorder` (canonical-bytes hashing like the real recorder), browser-availability probe, fixture loading — test-support, not runtime API |

## Determinism model (why capture sequences replay)

- **Event order**: every live subscription funnels through one ordered
  async queue, so records enqueue in event-arrival order even when data
  gathering is async (console args, response headers/bodies).
- **Network responses** are drained at `settle` boundaries in
  request-initiation order (live response arrival can jitter for parallel
  fetches; request order cannot).
- **No timing data** is captured anywhere; per-response timestamp headers
  (`date`, `age`) are stripped from network records.
- **Storage** is inventoried at explicit steps (pull), never streamed;
  every list is sorted.
- **Fixture design matters**: an observed app whose async operations race
  (e.g. two unsequenced fetches logged on completion) produces racy
  capture sequences — determinism is a property of script + app behavior.
  The bundled fixture serializes its load-time work deliberately.
- Verified by `src/e2e/determinism.e2e.test.ts`: two full runs of the same
  script produce identical `(kind, redacted, canonicalJson(payload))`
  sequences, element for element (see "Known limitations" for the
  screenshot-raster caveat).

## Redaction model

- Applied at the `SessionCore` funnel for every redactable channel, BEFORE
  records reach the recorder; idempotent (defense-in-depth safe).
- `CaptureRecord.redacted === true` means "this record passed through an
  ACTIVE redaction policy" — provenance of the scrubbing pass, NOT a claim
  that secret-shaped content was found.
- Over-redaction is safe by design: long hex digests are scrubbed along
  with tokens; URL userinfo is scrubbed whole; cookie values are always
  replaced (names kept).
- **Screenshots are not redactable** (`redacted: false`, channel marked
  non-redactable): pixel content cannot be scrubbed. Observed apps must
  not render secret material.
- `input[type=password]` values are never serialized.

## Budget model (`launchServerInSandbox`)

The frozen `SandboxExecutor` duration budget IS the hard reaper: the
fixture server is SIGTERM→SIGKILLed at `budget.maxDurationMs` even if the
caller disappears. `stopPath` adds a cooperative reaper for graceful,
fast closes. Readiness polling (port file + HTTP) is bounded by
`readyTimeoutMs` which must fit inside the budget.

## Verification

Root battery (repo root):

```bash
bun install
bun run typecheck   # 0 errors
bun run lint        # 0 errors
bun test            # unit + browser-gated e2e suites
```

- Unit tests cover every pure-core module, the recorder-port wiring (fake
  driver + fake recorder), and `launchServerInSandbox` over the real
  `ProcessSandboxExecutor` (no browser needed).
- E2E tests are browser-gated (`describe.skipIf(!browserAvailable)`): they
  probe `chromium.launch()` first and skip cleanly when no browser binary
  is present. Playwright is pinned to `1.63.0` (matches the cached
  chromium-1243 build).

## Known limitations (honest)

- **Network enforcement**: `networkEnforced` is false in the v0
  child-process executor — the sandbox profile's deny-all posture is
  declarative here. Real egress control lands with the runner
  egress-proxy/netns layer (CLAPP-040).
- **No external kill for a sandboxed server**: through the frozen executor
  contract there is no PID handle; the duration budget is the hard kill
  and `stopPath` the cooperative one. A ready-timeout leaves the orphan to
  the budget reaper (surfaced via `ServerLaunchError.result`).
- **Screenshot rasters are not byte-guaranteed**: Chromium text
  antialiasing can differ by ±1 in isolated pixels across renderer
  processes (empirically 6 of 921600 pixels on the fixture, in text rows;
  PNG encoding size shifts accordingly). The determinism e2e therefore
  compares screenshot records up to raster encoding (structure + PNG
  validity asserted; content equality independently pinned by the
  byte-compared dom-tree records in the same sequence).
- **CDP browser-log channel is level-filtered (default: error only)**:
  verbose/info browser log entries proved noisy-adjacent (nondeterminism
  risk); the channel is wired, unit-tested for payload shape, and the
  filter is configurable via `PlaywrightSessionOptions.cdpLogLevels`.
- **Role table is context-insensitive**: `header` maps to `banner`
  unconditionally (a real a11y engine is context-sensitive). Good enough
  for role/name anchoring; documented divergence.
- **Name matching is exact** (collapsed subtree text / aria-label / alt /
  title / placeholder): no fuzzy containment — deliberate, for
  deterministic resolution.
- **IndexedDB inventory** lists databases + object-store names only (no
  row counts — non-upgrading opens only); **Cache Storage** URL lists are
  capped at 32 per cache; storage values are truncated to 128-char
  previews after redaction.
- **`assert-visible`** means "resolvable in the serialized DOM" — no
  layout-level visibility check in v0.
- **Body previews** are opt-in-ish: only textual responses ≤ 2048 bytes,
  capped at 512 chars, lossy; request postData capped at 2048 chars; WS
  frame payloads capped at 256 chars.
- **Lexical cwd containment** (inherited from the v0 sandbox): a symlink
  inside the profile pointing outward is not detected.

## Package boundaries

- Runtime dependencies: `@clapp/core` (contract + hashing), `@clapp/sandbox`
  (executor port + deny-all default for the fixture-server launcher).
- `@clapp/evidence` and `@clapp/journey` are NOT imported — their shared
  contract types are carried as byte-identical mirrors (see module map);
  the tech lead verifies byte-equality at integration. Consumers inject
  the `EvidenceRecorder` implementation.
- Playwright is a devDependency (pinned 1.63.0); the runner itself imports
  no Playwright — `createPlaywrightDriverFactory` wires the browser in.
