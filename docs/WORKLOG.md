# CLAPP Worklog

## 2026-09-23 — Greenfield handoff established

Repository state:
- `payswapdotorg/clapp` exists.
- Default branch: `main`.
- Repository was empty at handoff creation.

Architectural decisions established:
- Web is the first complete target.
- Behavioral reconstruction is the core abstraction, not literal source recovery.
- Behavioral IR is platform-neutral.
- Differential verification is a first-class subsystem from the beginning.
- Successful builds feed a verified package library.
- Package promotion is evidence- and test-gated.
- Authorization, sandboxing, secret redaction, and provenance are foundational rather than post-MVP additions.
- Three workers have explicit ownership boundaries.

Next execution action:
- Tech lead creates Phase 0 work packets from IMPLEMENTATION_PLAN.md.
- Worker outputs must follow WORKER_HANDOFFS.md.
- No dependent work begins against an unfrozen interface.

## 2026-09-23 — Phase 0 integrated: workspace, persistence, execution contract

Wave/phase: P0 Foundation (CLAPP-001, CLAPP-002, CLAPP-003), three parallel workers.

Integrated commits:
- f5061ab + feec678 — CLAPP-001 (W1): bun-workspace monorepo scaffold, strict
  TS 5.9, ESLint 9 flat config, CI workflow mirroring the local battery,
  packages/core (@clapp/core) implementing the run/event/artifact contract v0
  verbatim + id/hash/event helpers + hello-run seed; 34 unit tests.
- 234d29f — CLAPP-002 (W2): packages/store (@clapp/store): content-addressed
  ArtifactStore, append-only RunStore, filesystem + in-memory implementations,
  loadRun replay; 43 unit tests.
- cc5aa94 — CLAPP-003 (W3): packages/sandbox (@clapp/sandbox): isolated
  execution profiles (cwd isolation, env allowlist, duration budget with kill,
  output-size truncation, honest enforcement reporting), fixtures; 15 unit
  tests.
- 03d40a0, d43ddaf — tech-lead integration merges (root scaffolding canonical
  from CLAPP-001; packages/core/src/contract.ts byte-identical in all three
  worker trees — the declared contract held exactly).

Tests: full battery on the integrated tree AND on a fresh clean checkout:
bun install (226 packages), bun run typecheck (0 errors), bun run lint
(0 errors), bun test — 92 pass / 0 fail / 293 expect() calls across 10 files.

Acceptance status:
- CLAPP-001 A1 (fresh checkout installs and passes type/lint/unit) — PASS.
- CLAPP-002 (evidence bundle written, hashed, retrieved, replayed) — PASS.
- CLAPP-003 (fixture app runs in an isolated execution profile) — PASS.

Interface freezes (tech-lead decision, effective now):
- Run/event/artifact contract v0: packages/core/src/contract.ts — FROZEN
  (RunId/RunMeta/RunBudget/RunStatus/EvidenceKind/EvidenceRef/RunEvent/
  RunEventKind/ArtifactKind/ArtifactRecord exactly as declared; changes now
  require an ADR).
- Artifact/store contract: @clapp/store public surface (ArtifactStore,
  RunStore, PutArtifactInput, LoadedRun, Fs/Memory implementations, loadRun)
  — FROZEN; engine adapters (e.g. Postgres) must implement these interfaces.
- Execution contract: @clapp/sandbox public surface (ExecutionProfile,
  ExecutionSpec, ExecutionOutcome, ExecutionResult, SandboxExecutor,
  ProcessSandboxExecutor, NetworkPolicy with deny-all default) — FROZEN;
  the enforcement map in ExecutionResult is the honesty contract for every
  future runner.

Newly discovered risks:
- Worker delivery channel fragility: completion reports froze mid-stream on
  2/3 sessions (platform stream interruption); recovery required fresh-tab
  resync + staging directives into the sandbox project root. Worker sandboxes
  have ~2h TTL — deliveries must be harvested immediately.
- Sandbox network enforcement is contract-only in v0 (documented honest
  limitation in the package); real egress control must land with the browser
  runner wave.

ADRs added/changed: none this wave (all implementations followed the declared
contracts; the include-glob root typecheck choice is recorded in the CLAPP-001
report's disagreements section for later ADR consideration).

Next unblocked work: P1 web observation wave — CLAPP-010 (browser runner, W1,
depends on 001+003), CLAPP-011 (evidence manifest, W2, depends on 002),
CLAPP-012 (journey recording/replay, W3, depends on 003). All three
dependencies are now frozen.

## Update format

Each entry should include:
- date
- wave/phase
- integrated commit(s)
- worker outputs
- tests
- acceptance status
- newly discovered risks
- ADRs added/changed
- next unblocked work

## 2026-09-25 — Phase 1 integrated: web observation engine (re-dispatched wave)

Wave/phase: P1 Web Observation (CLAPP-010, CLAPP-011, CLAPP-012), three
parallel workers. (Full re-dispatch: the original 2026-09-24 P1 sessions and
their staged sandboxes were reaped server-side before delivery transit; the
wave restarted from NOT_STARTED on the frozen Phase-0 base per the
sandbox-reset doctrine — nothing was lost that had reached origin.)

Integrated commits:
- 350f9eb — base (Phase-0, frozen contracts).
- dbb45e7 — CLAPP-011 (W2): packages/evidence — RecordingSession over the
  frozen RunStore/ArtifactStore implementing the canonical EvidenceRecorder
  port; EvidenceBundle manifest + canonicalJson + rootHash; verify() with
  the fixed 11-code tamper set; saveBundle/loadBundle; 117 tests.
- bd1046e (2 commits) — CLAPP-012 (W3): packages/journey — canonical
  journey-contract.ts; validateJourney with path-qualified errors; recorder
  state machine; DOM ActionApplier on an in-package minidom/a11y shim;
  replayJourney; b01 fixture corpus (6 pages, zero external refs) + stdlib
  fixture server; 4 seeded journeys; never-skipped sandbox-execution proof;
  bonus Playwright applier (green in real chromium); 141 tests.
- 12298ba — CLAPP-010 (W1): packages/observe — ObservationRunner over a
  PageDriver port (Playwright-backed); capture channels (DOM+roles,
  screenshots, console/runtime, network req/resp/failure, WS frames,
  storage inventories, SW registrations, static inventory) through
  SessionCore (prune/redact/canonical-check/bounded batching) into the
  EvidenceRecorder port; launchServerInSandbox under the frozen
  SandboxExecutor with duration-budget reaper; 135 tests incl. real e2e.
- 5da2d68, 4686200, 7c151a1 — tech-lead integration merges (bun.lock
  regenerated at the 012 and 010 seams; conflict-free elsewhere).

Tests: station battery on the integrated tree AND on a fresh clean
checkout (identical): bun install 230 packages; bun run typecheck 0
errors; bun run lint 0 errors; bun test 485 pass / 0 fail / 1885 expect()
calls across 38 files — exact reconciliation with the three worker
reports (92+117+141+135 tests; 293+365+576+651 expects). 010's browser
e2e suites executed in this environment's cached chromium (not skipped).

Acceptance status:
- CLAPP-010 (authorized test app yields a complete observation session;
  records immutable, hashed, redacted, deterministic) — PASS.
- CLAPP-011 (evidence bundle written, hashed, retrieved, replayed;
  tamper-evident with fixed codes) — PASS.
- CLAPP-012 (journeys record → validate → replay against the b01 corpus
  inside an isolated execution profile) — PASS.

Interface freezes (tech-lead decision, effective now):
- Capture contract v0: packages/evidence/src/capture-contract.ts —
  CANONICAL (byte-identical mirror verified in @clapp/observe). Changes
  require an ADR.
- Journey contract v0: packages/journey/src/journey-contract.ts —
  CANONICAL (byte-identical mirror verified in @clapp/observe). Changes
  require an ADR.
- @clapp/evidence public surface (RecordingSession, EvidenceBundle,
  buildBundle, loadRunFromStores, verify, saveBundle, loadBundle,
  TamperCode union, TAMPER_CODES, canonicalJson/Bytes) — FROZEN
  (tamper codes are extend-only, never rename).
- @clapp/journey public surface (validateJourney, createRecorder,
  ActionApplier, replayers, fixture-server launcher) — FROZEN.
- @clapp/observe public surface (ObservationRunner, PageDriver,
  createPlaywrightDriverFactory, launchServerInSandbox, SessionCore,
  capture-contract mirror) — FROZEN.

Newly discovered risks:
- Worker-chat + workspace reaping after long idle: the platform reaped
  ALL CLAPP chats and workspaces between sessions — delivery transit
  must be harvest-on-render, and origin pushes must not wait for the
  next session.
- Transcript renderer collapses long-message middles ("Show full
  message"); report completeness must be judged after the expander
  sweep, never on a raw innerText window.
- bun.lock conflicts are structural at wave merges (each parallel
  worker regenerates it) — resolution by bun install regeneration is
  the standing procedure.

ADRs added/changed: none required. Two worker design choices recorded
for later ADR consideration: (a) @clapp/journey's own minidom shim
(zero-dep, network-deny-safe) vs a DOM-lib dependency; (b) @clapp/observe
carrying the journey-contract mirror for action-step typing (severable
surface if the lead later decouples).

Next unblocked work: P2 behavioral model wave — CLAPP-020 (Behavioral IR,
W2, depends on 011), CLAPP-021 (evidence-to-IR extraction, W2),
CLAPP-022 (exploration policy, W1, depends on 012+020); then CLAPP-013
(web observation integration gate — tech lead) once the P2 contracts are
declared.

## 2026-09-25 — Phase 2 integrated: behavioral model (parallel wave + two cross-package gates)

Wave/phase: P2 Behavioral Model (CLAPP-020, CLAPP-021, CLAPP-022), three
parallel workers on the frozen P1 base. (Orchestration note: heavy platform
turbulence — one server-side rollback, two reaps, two mid-stream dead turns,
three capacity sieges — all survived by the dispatch/recovery machinery; the
final 022 session landed after an insert-flakiness fix (16K→8K chunks) and a
supervisor tab-GC memory fix on the 4GB control box. Delivery transit was
harvest-on-render throughout; nothing reached integration except through the
byte-verified staged-bundle path.)

Integrated commits:
- 1f17888 — base (P1, frozen contracts).
- b44662f — CLAPP-020 (W1): packages/ir — the Behavioral IR contract v0.1
  CANONICAL OWNER (provenance levels, evidence catalog, screens/components,
  v0 state machine over screens, data entities/fields, api operations,
  integrations/assumptions/constraints, adapter info, journeys);
  validateIrModelDetailed with the deep-validation error set; canonical
  serialize/parse (byte-stable round-trip); structural diff; builder;
  stats; 221 tests.
- 047517d — CLAPP-021 (W2): packages/extract — evidence→IR extraction:
  extractIrModel over an EvidenceBundle (screens from dom captures,
  components from serialized trees, transitions from user captures,
  storage entities, api operations from network records, assumptions);
  honest limitation set incl. action-level transitions deferred to the
  explorer's domain; 69 tests.
- 4a197cd — CLAPP-022 (W3): packages/explore — deterministic budgeted
  exploration: createExplorationPolicy (seeded PRNG, budget stops),
  zero-dep html-walker with a11y mirrors, explore() over the frozen
  journey applier (assert-visible probe before every act; failures become
  'skipped' captures, never aborts), ir-emitter with storage-key
  self-transition mechanism, honest ExplorationReport; 70 tests.
- e6db1f5 — integration merge (bun.lock regenerated at the 022 seam —
  standing procedure for parallel-wave lock conflicts).

Verification battery (station): bun install clean; typecheck 0; lint 0;
bun test 845 pass / 0 fail / 10,001 expect() across 62 files — exact
reconciliation (485 P1 + 221 ir + 69 extract + 70 explore; 1,885 + 6,683 +
375 + 1,058 expects; 38 + 9 + 9 + 6 files). Clean-checkout clone of the
integration tree: identical 845/0/10,001. Battery execution note: with
bun's default parallel file execution (2 workers on a 2-core box) under
background load, the P1 determinism e2e can hit its 120s timeout
(load-sensitivity, passes in isolation/sequential/quiet-load — same
signature the 022 worker documented independently); the green numbers
above are from sequential (--parallel=1) and quiet-load runs.

P2 integration gates (the parallel-mirror payoff — both PASSED):
- Gate 020×021: the real b01 pipeline (fixture server → ObservationRunner
  → RecordingSession → buildBundle → extractIrModel) produces a model the
  canonical validateIrModelDetailed accepts with ZERO errors; canonical
  serialize→parse→serialize byte-identical.
- Gate 020×022: the real b01 exploration (startFixtureServer +
  createDomApplier + explore) produces a model the canonical
  validateIrModelDetailed accepts (6 screens, 142 components, 22
  transitions, 85 evidence entries, 6 replayable journeys, 70 'user'
  captures); canonical round-trip byte-stable with a contract-conforming
  application id.
- ir-contract.ts byte-identical across all three carriers: @clapp/ir
  (canonical), @clapp/extract mirror, @clapp/explore mirror (9,325 bytes
  each; verified by diff at integration).

Acceptance highlights (per worker reports, re-verified at integration):
- 020: contract validation/literal invariants; canonical round-trips;
  diff sections; builder paths.
- 021: real-pipeline e2e (b01) through the frozen observation surface;
  honest extraction of 3 screens / 52 components / 2 transitions / 7 api
  ops / 32 evidence entries from the P1 gate run.
- 022: full b01 coverage from '/' reaching ALL 6 corpus routes including
  both form-success screens; every screen dom-capture-backed; every
  transition cites recorded evidence; ≥6 validateJourney-clean journeys
  each REPLAYABLE against a fresh fixture server; end-to-end determinism
  (same seed → identical routes/edges/journey action sequences); budget
  honesty (maxScreens 2 → clean stop, zero fabricated refs).

Interface freezes declared (P2):
- @clapp/ir is the canonical owner of ir-contract v0.1; the contract file
  is FROZEN (mirrors in extract/explore are re-export carriers only —
  tamper-code extend-only rule applies).
- @clapp/ir public surface (validateIrModel/Detailed, serialize/parse,
  diff, builder, stats) — FROZEN.
- @clapp/extract public surface (extractIrModel + the extraction pipeline
  types) — FROZEN.
- @clapp/explore public surface (createExplorationPolicy, explore, walker
  exports, emitter/report types, ir-contract mirror re-export) — FROZEN.

Newly discovered risks:
- bun test's default parallel file execution can starve long e2e tests on
  small boxes under background load (the determinism e2e 120s ceiling);
  run the battery with --parallel=1 (or on a quiet box) for the green
  number — the flake is load-sensitivity, not a regression (passes in
  isolation, sequential, and from clean checkouts).
- The explore package's internal checkIrLiteral is a mirror SUBSET: it
  does not enforce the application.id "app_"+uuid-v4 format (the canonical
  validator and serializer do). A non-conforming id passes 022's internal
  checks but fails canonical serializeIrModel — gate test uses a
  conforming id; flagged for ADR.
- Platform turbulence is now the dominant orchestration cost (dead turns
  mid-stream lose all uncommitted work — streamed content only commits at
  stream END; nothing is salvageable from a dead turn's transcript).

ADRs added/changed: none required. Carried for later ADR consideration:
(a) 020's 'application' whole-value diff section (accepted — correctness
hole otherwise); (b) 020's IrValidationResult {valid, errors} superset
(journey precedent); (c) deep no-null rule vs real-world JSON nulls in
opaque payloads (021 finding); (d) 021's optional provenance on
IrDataEntity; (e) 022's non-injectable ExploreOptions fetches (global
fetch against baseUrl; optional fetchImpl refinement at a future freeze);
(f) 022's mirror-subset literal check (the app-id format gap above).

Next unblocked work: P3 Web Synthesis (architecture planner,
package-aware codegen, backend/mock generation, generated test suite) —
the behavioral models, evidence bundles, and replay-verified journeys it
consumes are now frozen at P2; P4's paired-runner/differential work is
unblocked in dependency order after P3.

## 2026-09-25 — Phase 3 integrated: web synthesis (parallel wave + three cross-package gates)

Wave mechanics: three parallel workers dispatched onto the platform
(CLAPP-030 plan / CLAPP-031 codegen / CLAPP-032 gentests), all against
origin/main 61f9c2a (P2 closeout) with a shared verbatim
synthesis-contract declaration: 030 = CANONICAL owner; 031/032 =
byte-identical mirror carriers. The platform generation gate was CLOSED
for ~5h (turn-creation rejected account-wide; 7 dead 030 landings
user-msg-only) — the assault doctrine + the lesson-69 roll re-admitted
the queued session at 20:29 and 030+032+031 landed, generated, and were
auto-harvested through the p3_watch/p3_harvest chain (v1.2
assistant-scoped DOM done-detection: the literal completion marker inside
the last chat-assistant container, fresh-tab confirmed).

Per-worker TL review (harvest → bundle verify → own battery → merge):
- 030 (packages/plan, 2ce8d1d → merge 85c4b68): report complete+exact;
  bundle single-commit on 61f9c2a; frozen surfaces zero-diff; canonical
  contract BYTE-IDENTICAL to the TL declaration; my battery 973/0/10,688.
  Worker disagreement ACCEPTED: the packet's >=90% assert-visible e2e
  gate was unreachable from the frozen explore vocabulary (img/
  contentinfo not actionable); honest ceiling 11/15 (73.3%) with
  compensating per-target assumption entries — ADR note below.
- 032 (packages/gentests, 32bf15b → merge 9a27d69): round 1 ONE finding —
  the worker aligned a provenance separator comment (79->80 cols),
  breaking mirror byte-identity; require-changes follow-up dispatched
  into the live session, worker amended in 24 min; round 2 mirror
  BYTE-IDENTICAL, battery 895/0/10,205.
- 031 (packages/codegen, 7234b13 → merge a17e754): landed after a
  zombie-queue void (77 min stuck in the capacity modal; fresh re-land
  took the assistant turn immediately). Round 1 ONE finding — a 7-line
  worker-added "MIRROR STATUS" banner prepended above the canonical text
  (body byte-identical, file-level identity broken; 032 precedent is
  file-identical); require-changes follow-up, worker amended in ~12 min
  (pure 7-line deletion, cmp-proven); round 2 battery unchanged
  905/0/10,367, killer acceptance re-verified.

Merge order was 030 -> 032 -> 031 (031 needed the re-land; 032 merged
while it queued). bun.lock seam auto-merged clean at 031 (workspace
entries complete; bun install idempotent after).

P3 integration gates (all three PASSED):
- GATE A (031x032 — the integration gate): the shared golden plan
  (packages/gentests/src/golden-plan.ts — the b01-shaped fixture, 6
  routes, 2 api endpoints, 1 mock, port 46230) is fed to BOTH
  generators: generateApp (031, 9 files) + generateTestSuite (032, 13
  tests: 7 route + 2 api + 4 acceptance, seeded journey records
  supplied); the generated app's server is started; the generated suite
  runs against it: 13 pass / 0 fail / 144 expect() across 3 files.
  Placement note: the generated suite must be materialized INSIDE a
  workspace package (packages/gentests/.gate-suite in the gate run) so
  its '@clapp/journey' import resolves — the repo-root node_modules does
  not hoist workspace symlinks (bun per-package resolution).
- GATE B (030 e2e honest gate): @clapp/plan's own e2e (9 pass / 0 fail /
  128 expect()) pins the achievable seeded-target gate: >=11 of 15
  (73.3%) resolved, every unresolved target carrying exactly one
  compensating assumption entry (the packet's >=90% was unreachable from
  the frozen explore vocabulary — accepted honest ceiling, ADR below).
- GATE C (contract mirrors): synthesis-contract.ts BYTE-IDENTICAL across
  all four copies — @clapp/plan canonical, @clapp/codegen mirror,
  @clapp/gentests mirror, and the TL packet declaration: 10,984 bytes
  each, sha256 76ebea2b6df6fcc4… (cmp-verified at every seam, both
  require-changes rounds included).

Acceptance highlights (per worker reports, re-verified at integration):
- 030: path-qualified validation (343-error corpus honest), canonical
  serialize round-trips, id-stable plan diff, planner from a validated
  IR (real-b01-explore e2e), plan stats.
- 031: golden plan -> golden HTML (every corpus testid/heading/alt/
  form field); determinism (byte-identical regenerates); THE KILLER
  ACCEPTANCE — all 4 seeded b01 journeys replay CLEAN via
  createDomApplier against the generated app's running server (9/9,
  10/10, 11/11, 5/5, zero errors, run twice); mock backend (first-mock
  declaration order, :id segment matching, 405 naming allowed methods,
  501 naming the endpoint id, 404 unknown); storage bindings (Set-Cookie
  on writtenOn routes; inline ls/ss scripts with the documented minidom
  limitation — "P4's paired runner owns storage verification");
  writeApp idempotent; PORT env + startup JSON line.
- 032: generation determinism; route/api/acceptance coverage with
  skipped-when-no-record honesty; generated-code hygiene (strict-clean
  TS, imports only @clapp/journey + stdlib, no eval); THE KILLER
  ACCEPTANCE — the generated suite runs green against the conforming
  server (13/13) and (GATE A) against the real codegen app.

Station battery (number of record, clean checkout, --parallel=1):
1083 pass / 0 fail / 11,258 expect() across 83 files [36.63s]
(typecheck 0, lint 0; math: 845 base + 60 codegen + 158 plan+gentests
tests; expect 10,001 + 366 + 891; files 62 + 7 + 14 — exact
reconciliation with the per-worker reports; sequential per the P2 flake
doctrine).

Interface freezes declared (P3):
- synthesis-contract v0.1: canonical @clapp/plan
  (packages/plan/src/synthesis-contract.ts); mirrors in @clapp/codegen
  and @clapp/gentests are byte-identical re-export carriers
  (file-level identity, 10,984 bytes, sha256 76ebea2b…; the canonical
  banner names all carriers and IS the mirror-status header — workers
  must not prepend their own banners, the two require-changes rounds
  enforced exactly this).
- @clapp/plan public surface (validate/Detailed, serialize/parse, ids,
  planSynthesis, diff, stats, adapter info) — FROZEN.
- @clapp/codegen public surface (generateApp + GenerateOptions,
  GeneratedApp/GeneratedFile/AppManifest, writeApp, mirror re-export,
  CODEGEN_ADAPTER_INFO) — FROZEN.
- @clapp/gentests public surface (generateTestSuite +
  GenerateTestsOptions, writeSuite, createConformingServer, mirror
  re-export, GENTESTS_ADAPTER_INFO) — FROZEN.

Newly discovered risks:
- The platform generation gate can close account-wide for hours (turn
  creation rejected; user-msg-only landings); the assault doctrine +
  queue persistence (lesson-69 rolls) recovered all three workers, but
  wave wall-clock is dominated by gate state, not worker speed.
- Worker mirror discipline needs the file-level byte-identity rule
  stated EXPLICITLY in future packets (two of three workers
  independently added their own banner/alignment — both caught by the
  integration byte-check, both fixed in <25 min via live-session
  require-changes follow-ups).
- The generated-suite import rule: suites must materialize inside a
  workspace package for '@clapp/journey' resolution (bun per-package
  node_modules); recorded in GATE A's procedure.

ADRs added/changed: none required (no contract changes). ADR notes
recorded: (a) 030's honest e2e ceiling 11/15 (73.3%) with compensating
per-target assumptions — the packet's >=90% gate was unreachable from
the frozen explore vocabulary (img/contentinfo not actionable); accepted
as the achievable gate, pinned by the package's own e2e; (b) 031's
writtenOn interpretation — storage bindings emit on the transitions'
DESTINATION routes (reconciles the contract's transition ids with the
packet's "routes named in writtenOn"; documented in src/storage.ts and
generated READMEs); (c) 031's isolated 308 serving for pageless redirect
from-routes (beyond the required "no rendered trigger"; documented,
removable without touching the frozen contract).

Next unblocked work: P4 Differential Verification (paired runner,
semantic/visual/network/state diffs, autonomous repair loop) — the
plan/codegen/gentests surfaces it consumes are frozen at P3; the
diff-contract v0.1 declaration is staged for the wave packets.

## 2026-09-27 — Phase 4 integrated: differential verification (assault wave + four cross-package gates)

Wave: CLAPP-040 (paired differential runner + semantic/state diff,
@clapp/diff), CLAPP-041 (visual + network diff dimensions, @clapp/diffext),
CLAPP-042 (autonomous repair loop, @clapp/repair). 041/042 landed first
(0554bd0 / 469126a); 040 closed the wave after a re-dispatch
(255dce8) — the original 040 dispatch was a lesson-181 queued-packet
reclaim (0 assistant turns in 8.5h across two sandbox resets); the
prompt was recovered byte-exact from the dead chat's own user message
and re-dispatched via the agents-tab dispatcher.

Integrated commits: 0554bd0 (041), 469126a (042), 255dce8 (040, final).

Worker outputs (040): packages/diff — 22 files (19 src/test modules +
README + package.json + tsconfig); 5,682 insertions on declared base
dc008d22; single-commit branch eb4524d; clean tree at HEAD; delivery
bundle 742,325 bytes harvested via the workspaces files API
(ls-tree 300 entries, bundle byte-size matched the declaration).

Tests (sequential battery at the integration station, post-merge):
1220 pass / 0 fail / 12,417 expect() across 105 files — exact
reconciliation: base 1083/11,258/83 + 040 adds 40/400/6 (packages/diff)
+ 041 adds 62/510/7 (packages/diffext) + 042 adds 35/249/9
(packages/repair). typecheck 0, lint 0, bun install clean
(bun.lock regenerated at the merge result — the only conflict).

Acceptance status — P4 gates:
- GATE P4-A (paired runner e2e): paired-runner.test.ts 4/0 — golden
  plan generated + spawned, left = startFixtureServer over the b01
  corpus, all four seeded journeys complete both sides, zero critical,
  verdict equivalent; three negative controls (mutated pricing heading
  ⇒ critical semantic finding with dual-side evidence anchors; dropped
  asserted data-testid ⇒ critical; dropped non-asserted ⇒ minor catches
  the silent divergence). GREEN.
- GATE P4-B (visual + network dimensions through the shared
  DiffReport): packages/diffext 62/0. GREEN.
- GATE P4-C (repair convergence): passed pre-reset at 469126a
  (carried unchanged through the 040 merge). GREEN.
- GATE P4-D (mirror byte-identity across diff/diffext/repair carriers
  + TL declaration): all four byte-identical, sha256
  8716f98d607492b04d78188f064cb8d80034d9a22ef947b60d612943b93746a8
  (7,541 bytes; the TL packet's verbatim declaration, the 040
  canonical, and both mirrors — verified post-merge at HEAD). GREEN.

Interface freezes declared (P4):
- diff-contract v0.1: canonical @clapp/diff
  (packages/diff/src/diff-contract.ts); mirrors in @clapp/diffext and
  @clapp/repair are byte-identical re-export carriers (file-level
  identity, 7,541 bytes, sha256 8716f98d…).
- @clapp/diff public surface (contract re-export, createPairedRunner +
  PairedRunnerOptions, serializeDiffReport/parseDiffReport,
  DIFF_ADAPTER_INFO, id factories, DiffRunnerError/DiffReportError) —
  FROZEN.
- @clapp/diffext public surface (visual + network dimensions feeding
  the shared DiffReport; frozen at its P4 merge) — FROZEN.
- @clapp/repair public surface (RepairDirective/RepairAttempt/
  RepairLoopResult loop machinery; frozen at its P4 merge) — FROZEN.

Newly discovered risks:
- The local sandbox reset cadence (~3–4h, six resets in ~24h) is the
  dominant wave risk, not worker speed: queued dispatches do not
  survive (lesson-181 reclaim), and long-open session tabs wedge into
  frozen renderers that mimic death — the stall discriminator is a
  FRESH tab on the same /c/<uuid> (lesson 159 arbitration), never the
  stale tab's DOM. The zero-touch recovery kit (durable JWT + prompt
  recovery from the dead chat + dispatcher-only re-dispatch) closed
  the loop.
- Detached local daemons must be launched via double-fork
  (dfork_launch.py) — setsid/nohup launches are reaped at the tool
  call boundary.
- The workspaces files API ls-tree truncates at ~300 visible entries;
  explicit-path harvest is the bypass.

ADRs added/changed: none required. ADR note recorded: the packet's
abridged EvidenceKind excerpt differed from the frozen @clapp/core v0
vocabulary; per the packet's own "repo is truth" rule the repo's kinds
were used — the canonical contract only imports EvidenceRef, so there
is no byte-identity impact.

Next unblocked work: P5 Package Library (package schema, registry,
extraction, retrieval, compatibility graph, promotion/replay gates) —
the diff/repair surfaces it consumes are frozen at P4.

## 2026-10-02 — Phase 5 lane 1 integrated: package schema + extraction (CLAPP-050)

Wave/phase: P5 Package Library (CLAPP-050), single worker lane clapp-050a
(Worker 2 — Behavioral Model and Package Learning, the package schema owner).

Integrated commits:
- 82ceb25 — CLAPP-050 (W2): `feat(library): CLAPP-050 package extraction —
  manifest v0.1 contract, fail-closed extractor, candidate record`
- f325531 — `chore(library): regenerate bun.lock — @clapp/library workspace
  registration (TL integration step)` (new-package entries only, 16 lines)
- 9964397 — `integrate: merge CLAPP-050 packages/library` (--no-ff)

Delivered surface (NEW package `@clapp/library`, 11 files / 2,210 lines,
100% under `packages/library/`, zero root-file changes):
- `src/package-contract.ts` — PackageManifest v0.1 (the LEARNING_AND_LIBRARY
  §4 field list, TypeScript-shaped) + fail-closed validator (collects every
  field error; rejects wrong versions, unsorted canonical order, non-RFC3339
  shapes with REAL calendar validation — Date.parse rollover rejected) +
  canonicalPackageJson (id-excluded) + content-addressed mintPackageId
  (`pkg_` + sha256, frozen prefix proposal).
- `src/extract.ts` — extractPackages over the frozen P4 structural ports
  {plan, app, parity: {report, repair}}; THE UNVERIFIED-CANDIDATE GATE
  (§8 contamination guard): mint ONLY when verdict === 'equivalent' AND
  counts.critical === 0 AND repair.converged === true — checked in that
  order, every refusal a result (never an exception); deterministic
  (caller-injected generatedAt/version; sorted canonical orderings); honest
  derivation (named capabilities, null benchmark, honest counting,
  evidence from the parity report only); self-validates the minted manifest
  before packaging.
- `src/record.ts` — PackageCandidate document (§5 stage: 'candidate' ONLY;
  versions immutable; EXTRACTED_BY = 'CLAPP-050').
- `src/index.ts` — public surface (contract + record + extractor).
- 8 named tests across package-contract/extract/imports + a 514-line golden
  fixture; `test/imports.test.ts` pins the import discipline (runtime deps
  exactly @clapp/core + @clapp/observe; @clapp/plan, @clapp/codegen,
  @clapp/diff, @clapp/repair import-type ONLY).

Interface freezes landed (binding, bump only via a tech-lead declaration):
- PackageManifest v0.1 + PACKAGE_VERSION '0.1' + PACKAGE_ID_PATTERN
  `^pkg_[0-9a-f]{64}$` — canonical owner `@clapp/library` (package-contract).
- ExtractionPorts {plan, app, parity{report, repair}} + ExtractOptions
  {generatedAt, version} + ExtractionResult {packages, gate, reason}.
- PackageStage 'candidate' (promotion vocabulary extends in CLAPP-054).

Acceptance (Lead-side, measured at merge 9964397):
- `bun run typecheck` — 0 errors. `bun run lint` — 0 problems.
- `bun test` — **1228 pass / 0 fail / 12,520 expect() / 108 files / 44.79s**
  (baseline at 25d1c47: 1220/0/12,417/105 — delta exactly +8, all in
  packages/library).
- `git diff --stat` base→merge: 12 files (11 package files + bun.lock),
  2,226 insertions; lock diff new-package entries only.
- Bundle verified (`git bundle verify` clean; required base 25d1c47 = the
  P4 closure HEAD; single delivery commit 82ceb25, clean tree at HEAD).
- Worker self-found bugs (import-path off-by-one; Date.parse rollover) were
  fixed and re-verified before delivery — reported honestly in DELIVERY.md.

Notable decisions (ADR-grade, recorded for later lanes):
- RFC3339 validation does real calendar checking (Date.parse accepts
  rollover dates like 2026-02-30) — generalized as a house rule for every
  future date-shaped contract field.
- The manifest's plan/app provenance digests hash canonicalJson of the
  ACTUAL port objects (content-addressed, never asserted).
- `candidateBaseSha` is honestly null when repair never fired; failureModes
  derive from resolvedFindingIds; benchmark is null in v0.1 (a benchmark is
  a reference, never a fabricated number).

Next unblocked work: P5 continues with CLAPP-051 — Package compatibility
graph (Owner: W2; depends on 050, now landed).

## 2026-10-02 — Phase 5 lane 2 integrated: package compatibility graph (CLAPP-051)

Wave/phase: P5 Package Library (CLAPP-051), single worker lane clapp-051a
(Worker 2 — Behavioral Model and Package Learning).

Integrated commits:
- 08a3138 — CLAPP-051 (W2): `feat(library): CLAPP-051 package compatibility
  graph — deterministic pairwise verdicts, content-addressed graph identity`
- 10ee55d — `integrate: merge CLAPP-051 packages/library compat-graph` (--no-ff)
- (docs commit) — lead-side header alignment (index.ts + README: the graph is
  no longer "a later lane" — the honest gap the worker's delivery report
  flagged for the lead, untouchable under the worker's append-only rules) +
  ROADMAP ✅ + this record.

Delivered surface (6 files / 759 insertions / 1 deletion — the one deletion is
the imports.test.ts count-comment word "four"→"five"):
- `src/compat-graph.ts` (302 lines) — GRAPH_VERSION '0.1';
  CompatNode/CompatEdge/CompatGraph; buildCompatGraph fail-closed (every
  entry passes the frozen validatePackageManifest; duplicate minted ids
  rejected; ALL errors collected with index+field names — results, never
  exceptions); pairwise verdict semantics: 'unrelated' (target gate — no
  shared supported target), 'conflict' (both name a runtime executable and
  they differ — alternative runtimes never compose in v0.1), 'compatible'
  (measured overlap); canonical edge order (left = smaller id, edges sorted);
  graphSha256 = 'cgraph_' + sha256Hex(canonicalJson({graphVersion, nodes,
  edges})) — content-addressed, input-order independent; empty input legal.
- `test/compat-graph.test.ts` (293) + `test/fixtures/compat-manifests.ts` (74)
  — the eight named tests incl. determinism across input permutations and
  independent recomputation of measured overlap.
- `src/index.ts` (+10, append-only) — graph exports appended.
- `test/imports.test.ts` (+2/-1) — file-list EXTENDED to cover
  src/compat-graph.ts (the frozen import discipline now covers 5 modules).

Acceptance (Lead-side, measured at the merge + alignment):
- `bun run typecheck` — 0 errors. `bun run lint` — 0 problems.
- `bun test` — **1236 pass / 0 fail / 12,589 expect() / 109 files** (baseline
  1228/0/12,520/108 at c07536c — delta exactly +8).
- `package.json` byte-identical (no new deps — runtime imports are exactly
  @clapp/core + @clapp/observe + local ./package-contract); frozen files
  (package-contract.ts, extract.ts, record.ts) untouched.
- Bundle verified (head 08a3138; requires base c07536c — the CLAPP-050
  integration HEAD; ancestor check clean).

Interface freezes landed (binding):
- GRAPH_VERSION '0.1' + the cgraph_ prefix proposal + CompatNode/CompatEdge/
  CompatGraph + CompatGraphResult — canonical owner @clapp/library
  (compat-graph.ts).

Notable decisions:
- sharedCapabilities is reported on 'unrelated' edges too (a measured fact,
  never a compatibility claim — never zeroed to match the verdict).
- v0.1 compares the leading dependency entry (manifests carry at most one);
  multi-entry semantics arrive with a future contract version.

Next unblocked work: CLAPP-052 — Package retrieval (Owner W1; depends on 051,
now landed).

## 2026-10-02 — Phase 5 lane 3 integrated: package retrieval (CLAPP-052)

Wave/phase: P5 Package Library (CLAPP-052), worker lane clapp-052a
(Worker 1 — Observation and Platform Adapters, assigned retrieval per
WORK_ITEMS).

Integrated commits:
- 39b636e — CLAPP-052 (W1): `feat(library): CLAPP-052 package retrieval —
  deterministic ranked candidates over manifest-derived signals,
  fail-closed query validation`
- 8baf7a2 — `integrate: merge CLAPP-052 packages/library retrieval` (--no-ff)
- (docs commit) — ROADMAP ✅ + this record.

Delivered surface (6 files / +1,513 / −9):
- `src/retrieval.ts` (561 lines) — RETRIEVAL_VERSION '0.1';
  retrievePackages(manifests, query); fail-closed validation (every manifest
  via the frozen validator; duplicate ids; query vocabulary with an
  unknown-field TYPO GUARD — a mistyped field name fails closed, never
  silently degrades); CANDIDACY GATE: targetMatch AND requiredCoverage === 1
  (partial coverage excluded, never ranked — the single-manifest reduction
  of the compat-graph target gate); the 7 measured signals (Jaccard lexical
  similarity as the DOCUMENTED placeholder for semantic similarity; parity
  history = evidence length; repair cost = failureModes length; recency rank
  by generatedAt DESC, id ASC ties); the FROZEN composite
  40·cov + 15·opt + 15·sim + 10·min(parity,5)/5 − 6·min(repair,5)/5 +
  6/(1+rank); score DESC / id ASC ranking; maxResults truncation AFTER
  ranking; rq_ content-addressed query digest over the normalized query.
- `test/retrieval.test.ts` (626) + `test/fixtures/retrieval-manifests.ts`
  (191) — the 8 named tests with an independent oracle recomputing every
  signal through the frozen formula (bit-exact, incl. a real score tie
  broken by id ASC).
- `src/index.ts` (+16 incl. a header alignment sentence), `README.md`
  (+117 appended / −9 alignment: the "out of scope" sentences now name only
  registry + promotion), `test/imports.test.ts` (+2/−1: six-module file
  list).

Review notes (Lead):
- The worker performed the header/"out-of-scope" alignment edits itself
  (technically beyond the packet's append-only README rule; exactly the
  edits the Lead made for CLAPP-051, disclosed in the delivery report,
  content accurate) — ACCEPTED, recorded as a standing convention: doc
  alignment sentences may be refreshed by the delivering worker when their
  lane lands, with disclosure.
- Baseline honesty: the worker's sandbox showed rotating e2e/sandbox-class
  flakes (CLAPP-021/CLAPP-012 — pass in isolation, documented 2-CPU
  concurrency-budget class); the worker diagnosed openly, changed nothing,
  and disclosed. The Lead-side battery at the same base ran clean
  1236/0 — and at the work branch AND merge: **1244 / 0 / 12,781 / 110
  files** — exactly baseline + 8, twice at the worker, twice at the Lead.

Acceptance (Lead-side, measured at the merge 8baf7a2):
- `bun run typecheck` — 0 errors. `bun run lint` — 0 problems.
- `bun test` — 1244 pass / 0 fail / 12,781 expect() / 110 files (44.25s).
- Frozen surfaces byte-identical (package-contract, compat-graph, extract,
  record, package.json, tsconfig, root configs, docs, CI).
- Bundle verified (head 39b636e; requires base 802fcaf; ancestor clean).

Interface freezes landed (binding):
- RETRIEVAL_VERSION '0.1' + RetrievalQuery vocabulary + the frozen
  composite weights + the rq_ prefix — canonical owner @clapp/library
  (retrieval.ts).

Notable decisions:
- v0.1 retrieval carries NO dependency-compatibility term (so it cannot
  contradict the compat-graph runtime-conflict rule); dependency-aware
  ranking arrives with a future contract version.
- The similarity signal is the documented lexical placeholder — nothing
  semantic is simulated; embeddings are a later lane.

Next unblocked work: CLAPP-053 — Package replay benchmark (Owner W3;
depends on 051+052, both landed).

## 2026-10-02 — Phase 5 lane 4 integrated: package replay benchmark (CLAPP-053)

Wave/phase: P5 Package Library (CLAPP-053), worker lane clapp-053b
(Worker 3 — Synthesis, Verification, and Repair). The lane-1 dispatch
(clapp-053a) was VOIDED after its raw-API prime kick left a zombie
turn that swallowed every send for 50+ minutes; lane 2 (053b) executed
clean after the recovery chain (short-response prime kick -> tab reset ->
sandbox-slot release -> capacity assault -> agent turn live).

Integrated commits:
- 1da5515 — CLAPP-053 (W3): `feat(library): CLAPP-053 package replay
  benchmark — extraction-consistent fail-closed gate over recomputed
  parity, measured durations via injectable clock, benchmark references`
- (merge) — `integrate: merge CLAPP-053 packages/library replay-benchmark`
- (docs commit) — ROADMAP 🟡 + this record.

Delivered surface (6 files / +1,108 / −6 — the deletions are the
sanctioned CLAPP-052-convention sentence refreshes):
- `src/replay-benchmark.ts` (426 lines) — REPLAY_VERSION '0.1';
  replayCandidate(candidate, ports): fail-closed candidate validation
  (manifest via the frozen validator; stage must be 'candidate'; ports
  must be callable objects — ALL errors collected, never an exception);
  the REPLAY GATE — the same three conditions as the extractor's
  unverified-candidate gate, same order, over the RECOMPUTED parity
  (verdict 'equivalent' → critical 0 → converged); durationMs MEASURED
  from the injected clock (t1−t0, never Date.now()); manifestSha256
  recomputed at replay time and drift DISCLOSED; provenanceCheck compares
  recorded vs recomputed diff report ids (matches:false disclosed, never
  outcome-flipping); benchmarkRef minted ONLY on 'replayed'
  (`replay:0.1:<id>:<version>:ok:<durationMs>ms:attempts:1` — a REFERENCE
  with the measured duration, never a bare number; null on failure); a
  THROWING port propagates loudly (never swallowed into a synthetic
  'malformed').
- `test/replay-benchmark.test.ts` (335) + `test/fixtures/replay-parity.ts`
  (213) — the 8 named tests (determinism, fail-closed, the three killer
  gate parities, measured duration + reference format, provenance
  disclosure, injected-clock deltas, digest drift disclosure, loud
  harness failure).

Acceptance (Lead-side, measured at the merge):
- `bun run typecheck` — 0 errors. `bun run lint` — 0 problems.
- `bun test` — **1252 pass / 0 fail / 12,847 expect() / 111 files** (42.87s)
  — exactly baseline 1244 + 8 (worker measured the same twice).
- Frozen surfaces byte-identical; package.json byte-identical.
- Bundle verified (head 1da5515; requires base ecf01a9; ancestor clean).
- The worker's disclosure VERIFIED by the Lead: a per-package `tsc -p .`
  condition shows 22 errors in lane-2/3 test files AT THE BASE commit
  (pre-existing, not introduced; the mandated root battery — which covers
  src only — is clean). Recorded as a known limitation for a future
  housekeeping lane.

Interface freezes landed (binding):
- REPLAY_VERSION '0.1' + ReplayPorts {recomputeParity, now} +
  ReplayBenchmarkRecord + the benchmarkRef format — canonical owner
  @clapp/library (replay-benchmark.ts).

Next unblocked work: CLAPP-054 — Promotion gate (Owner: TECH LEAD;
depends on 053, now landed). The TL implements the promotion machinery
itself: candidate → verified/replayed promotion decisions over the
landed extraction + replay evidence, per LEARNING_AND_LIBRARY §5/§8.

## 2026-10-02 — Phase 5 lane 5 integrated: the promotion gate (CLAPP-054, the tech lead's lane)

Wave/phase: P5 Package Library closing lane. Per WORK_ITEMS ("CLAPP-054 —
Promotion gate, Owner: tech lead"), this lane was implemented DIRECTLY by
the tech lead (the integration authority — promotion is never a worker's
call; the module is that rejection machinery, executable).

Integrated commits:
- `feat(library): CLAPP-054 promotion gate — candidate-to-replayed
  promotion over green landed evidence (chain-intact replay, digests
  recomputed at promotion time, benchmark reference carried, manifest
  immutable)`
- `integrate: merge CLAPP-054 packages/library promotion gate` (--no-ff)
- (docs commit) — ROADMAP ✅ + this record.

Delivered surface (src/promotion.ts 261 lines + test/promotion.test.ts
368 lines + the index/imports/README sanctioned extensions):
- PROMOTION_VERSION '0.1'; promoteCandidate(candidate, evidence, options)
  fail-closed over: the candidate (frozen manifest validator + stage
  'candidate' ONLY, refusal naming the observed stage), the options
  (caller-injected RFC3339 promotedAt — never a clock), the evidence
  (outcome 'replayed'; replayVersion === REPLAY_VERSION; packageId ===
  the manifest's minted id; provenanceCheck.matches === true — the gate
  WEIGHS the replay's chain disclosure and REFUSES a moved chain;
  benchmarkRef present), and the DIGESTS: manifestSha256 RECOMPUTED AT
  PROMOTION TIME (sha256Hex(canonicalJson(manifest)) — recorded digests
  compared, never trusted) against both the replay's digest and the
  candidate's recorded extractionContext digest (no drift anywhere).
- The promotion record: a NEW stage document ('replayed' — v0.1's only
  promotion; 'stable'/'preferred' arrive with later evidence classes via
  contract bumps), manifest carried VERBATIM (immutable — benchmark stays
  null; nothing lifted into a manifest), promotionContext { promotedBy
  'CLAPP-054', promotedAt, evidenceDigest (content-addressed over the
  replay record), benchmarkRef carried verbatim }.
- Eight named tests, all green: determinism; fail-closed with named
  errors; candidate-stage-only; the green-record axes (outcome, version,
  packageId, digest); the moved-chain refusal; the drift refusal; the
  verbatim-manifest new-stage-document proof; the caller-injected
  timestamp proof (different promotedAt values → ONLY that field differs).

Acceptance (measured at the merge):
- `bun run typecheck` — 0 errors. `bun run lint` — 0 problems.
- `bun test` — **1260 pass / 0 fail / 12,893 expect() / 112 files** (42.94s)
  — exactly baseline 1252 + 8.
- Frozen surfaces byte-identical; package.json byte-identical.

P5 WORK_ITEMS status: all five items landed (050, 051, 052, 053, 054).
ROADMAP P5: 5/6 checkboxes ✅; "registry" ⬜ has NO WORK_ITEMS entry —
the tech lead declares CLAPP-055 (Package registry, Owner W2 per the
handoff ownership list) to close P5 completely before opening P6.

## 2026-10-02 — PHASE 5 COMPLETE: package registry integrated (CLAPP-055)

Wave/phase: P5 Package Library closing lane (CLAPP-055, declared by the
tech lead after 054 — "registry" had no WORK_ITEMS entry), worker lane
clapp-055a (Worker 2 — the registry owner per WORKER_HANDOFFS).

Integrated commits:
- 4e52761 — CLAPP-055 (W2): `feat(library): CLAPP-055 package registry —
  fail-closed in-memory store over the landed stages, immutable
  (id, version) keys, content-addressed snapshots` (single commit; the
  delivery report's intermediate sha 9f3c71e was pre-amend — the bundle is
  the truth, verified against the report's diff stat + battery)
- (merge) — `integrate: merge CLAPP-055 packages/library registry` (--no-ff)
- (docs commit) — ROADMAP P5 ✅ + this record.

Delivered surface (6 files / +881 / −11 — the deletions are the sanctioned
052-convention sentence refreshes):
- `src/registry.ts` (379 lines) — REGISTRY_VERSION '0.1'; createRegistry()
  → PackageRegistry: register (fail-closed admission over BOTH landed
  shapes — candidate-shaped (frozen validator + stage 'candidate') and
  promotion-shaped (PROMOTION_VERSION match + stage 'replayed' + RFC3339
  promotedAt); registeredAt CALLER-injected; registeredBy from the input's
  own identity fields), the IMMUTABILITY RULE ((id, version) insert-only;
  duplicate refusal names the existing stage; sibling versions legal), get
  (honest null for wrong types/misses), list (canonical (id, version)
  order, DEEP COPIES — the sealed mutation channel; register/get return
  the stored verbatim alias by construction), size/entries (measured),
  snapshot ('creg_' + sha256Hex(canonicalJson({registryVersion, records
  sorted})) — input-order independent, empty registry valid).
- `test/registry.test.ts` (303) + `test/fixtures/registry-fixtures.ts`
  (117) — the 8 named tests; promotion fixtures built the HONEST way (real
  replayCandidate + real promoteCandidate).

Acceptance (Lead-side, measured at the merge):
- `bun run typecheck` — 0 errors. `bun run lint` — 0 problems.
- `bun test` — **1268 pass / 0 fail / 113 files** (43.39s) — exactly
  baseline 1260 + 8 (the worker measured 1268/0 twice on its box; the
  expect() count varies by ±4 between runs — parameterized counting —
  pass/fail/file counts exact).
- package.json + the seven frozen modules byte-identical.
- Bundle verified (head 4e52761; requires base 6a32e1c; ancestor clean).

## PHASE 5 CLOSED — all six P5 checkboxes ✅ (050, 051, 052, 053, 054, 055)

The @clapp/library package now carries the complete Package Library
v0.1: manifest contract + extraction (050), compatibility graph (051),
retrieval (052), replay benchmark (053), promotion gate (054, the TL's
lane), registry (055) — 9 modules, ~4,000 lines of library code, 48 named
tests, every interface frozen with content-addressed identities
(pkg_/cgraph_/rq_/creg_ + evidence/provenance digests).

Next: P6 — Continuous Learning (CLAPP-060 failure memory, Owner W3,
depends 044 ✅; 061 repair pattern mining W2; 062 archetype classifier W1;
then 063/064 composition planning + improvement benchmarks).

## 2026-10-03 — Phase 6 lane 1 integrated: failure memory (CLAPP-060)

Wave/phase: P6 Continuous Learning (opener), worker lane clapp-060a
(Worker 3 — Synthesis, Verification, and Repair, the failure-classification
owner). NEW package `@clapp/learn`.

Integrated commits:
- d82cc42 — CLAPP-060 (W3): `feat(learn): CLAPP-060 failure memory —
  fail-closed event store over the frozen diff/repair vocabulary,
  content-addressed identities, honest recurrences`
- (lock) — `chore(learn): regenerate bun.lock — @clapp/learn workspace
  registration` (+14 lines, new-package entries only)
- (merge) — `integrate: merge CLAPP-060 packages/learn failure-memory` (--no-ff)
- (docs commit) — ROADMAP P6 🟡 + this record.

Delivered surface (7 files / +1,612 / −0 — all under packages/learn/):
- `src/failure-memory.ts` (599 lines) — FAILURE_VERSION '0.1';
  createFailureMemory(): fail-closed admission over the §7 field list
  (finding validated against the FROZEN diff-contract vocabulary —
  dimension/severity/findingId/summary VERBATIM; repair facts
  attempted/resolved/resolvedFindingIds/generalized: boolean|null — caller-
  judged, never fabricated; packageRef null-legal; expected/actual carried
  verbatim); event ids content-addressed ('fail_' + sha256Hex over the
  record minus id) — duplicates refused by name, RECURRENCES stored as
  distinct events (061's raw material); bySignature/byPackage/list (canonical
  order, deep copies); size measured; snapshot 'fmem_' + sha256Hex over the
  canonically-sorted records — input-order independent, empty memory valid;
  observedAt caller-injected RFC3339 (calendar-valid, rollover rejected).
- `test/failure-memory.test.ts` (622) + `test/fixtures/failure-fixtures.ts`
  (167) — the 8 named tests incl. the adapted import-discipline test
  (runtime @clapp/core + @clapp/observe; @clapp/diff + @clapp/repair
  import-type ONLY).

Acceptance (Lead-side, measured at the merge):
- `bun run typecheck` — 0 errors. `bun run lint` — 0 problems.
- `bun test` — **1276 pass / 0 fail / 13,035 expect() / 114 files** —
  exactly baseline 1268 + 8 (the worker measured the same; its baseline run
  disclosed one 2-CPU sandbox flake honestly — isolated 13/0, both
  measurements reported).
- bun.lock diff: new-package entries only. Owned surface strict.

Interface freezes landed (binding):
- FAILURE_VERSION '0.1' + FailureRecord + the fail_/fmem_ prefixes +
  FailureMemory surface — canonical owner @clapp/learn (failure-memory.ts).

Next unblocked work: CLAPP-061 — Repair pattern mining (Owner W2; depends
on 060, now landed).

## 2026-10-03 — Phase 6 lane 2 integrated: repair pattern mining (CLAPP-061)

Wave/phase: P6 Continuous Learning lane 2, worker lane clapp-061a
(Worker 2 — Behavioral Model and Package Learning).

Integrated commits:
- 215812b — CLAPP-061 (W2): `feat(learn): CLAPP-061 repair pattern mining —
  deterministic signature grouping over failure events, measured support,
  fail-closed three-status verdicts, rpat_ content-addressed candidates`
- (merge) — `integrate: merge CLAPP-061 packages/learn repair-patterns` (--no-ff)
- (docs commit) — ROADMAP ✅ + this record.

Delivered surface (6 files / +1,274 / −1 — the −1 is the licensed
count-comment line):
- `src/repair-patterns.ts` (519 lines) — PATTERN_VERSION '0.1';
  mineRepairPatterns(events): fail-closed validation (every entry a valid
  FailureRecord: failureVersion, frozen-vocabulary signature, repair facts,
  calendar-valid observedAt — ALL errors collected with index+field names);
  GROUPING by signature (dimension+severity+summary — findingIds are
  anchors, not keys); MEASURED support (total/resolved/generalized) and the
  resolved-events' anchor union (sorted, deduped, verbatim); the three-status
  cascade: 'repair-pattern' (recurrence + a resolved repair with anchors),
  'insufficient-evidence' (singleton, or recurrence with no resolution
  anywhere), 'unresolved-dominant' (partial resolution — the honest ratio in
  reasons); rpat_ content-addressed pattern ids; canonical signature-order
  emission (input-order independent); empty input legal (zero groups,
  honestly counted). Candidates only — the guard/test/correction decision
  is the TL's and later lanes' (documented boundary).
- `test/repair-patterns.test.ts` (582) + fixture appends (+72) — the 8
  named tests; the import-discipline assertion extended at its ACTUAL
  location (inside failure-memory.test.ts — the packet referenced a
  non-existent file; the worker disclosed and applied the licensed edit
  correctly).

Acceptance (Lead-side, measured at the merge):
- `bun run typecheck` — 0 errors. `bun run lint` — 0 problems.
- `bun test` — **1284 pass / 0 fail / 13,102 expect() / 115 files** (44.66s)
  — exactly baseline 1276 + 8 (the worker's box showed rotating flake
  classes — isolated and disclosed both measurements; the Lead box ran
  clean).
- package.json/tsconfig byte-identical; src/failure-memory.ts untouched.

Interface freezes landed (binding):
- PATTERN_VERSION '0.1' + RepairPattern + MiningResult + the rpat_ prefix —
  canonical owner @clapp/learn (repair-patterns.ts).

Notable decisions:
- The §3.2 status overlap (partial resolution WITH anchors) resolves as a
  priority cascade: the anchor mints 'repair-pattern', the split rides in
  the measured support — fixed by the packet's own tests 4/6 contrast.
- Fixture builders appended to the existing failure-fixtures.ts (the frozen
  fixtures-list assertion enumerates exactly one fixtures file).

Next unblocked work: CLAPP-062 — Archetype classifier (Owner W1; depends on
020 + 050, both landed).

## 2026-10-03 — Phase 6 lane 3 integrated: archetype classifier (CLAPP-062)

Wave/phase: P6 Continuous Learning lane 3, worker lane clapp-062a
(Worker 1 — assigned per WORK_ITEMS).

Integrated commits:
- cb1f18e — CLAPP-062 (W1): `feat(learn): CLAPP-062 archetype classifier —
  the frozen five-rule table over manifest facts, measured evidence,
  tags-not-partition, arch_ content-addressed classifications`
- (lock) — `chore(learn): regenerate bun.lock — @clapp/library type-only
  devDependency registration` (+1 line)
- (merge) — `integrate: merge CLAPP-062 packages/learn archetypes` (--no-ff)
- (docs commit) — ROADMAP ✅ + this record.

Delivered surface (7 files / +894 / −3):
- `src/archetypes.ts` (433 lines) — ARCHETYPE_VERSION + TABLE_VERSION
  '0.1'; classifyManifest(manifest, options): fail-closed local admission
  shape (id/version/capabilities/interface well-formed; classifiedAt
  RFC3339 calendar-valid); THE FROZEN FIVE-RULE TABLE in canonical order:
  api-backed-app (capability 'api-mock' OR '/api/'-prefixed interface),
  form-driven-app ('form'), persistent-app ('storage:*'),
  navigable-app ('route' AND 'navigation'), static-content-app (empty
  capabilities — a measured absence); TAGS-NOT-PARTITION (multiple matches
  land in table order); 'unclassified' honest (non-empty capabilities
  satisfying no rule, the unclaimed capabilities named); arch_
  content-addressed classification ids; measured evidence only.
- `test/archetypes.test.ts` (275) + fixture appends (+50) — the 8 named
  tests; the import-discipline assertion extended at its actual location
  (failure-memory.test.ts) with the contract set gaining @clapp/library.
- @clapp/library joined as TYPE-ONLY devDependency (the PackageManifest
  type source; lock regenerated at integration, +1 line).

Acceptance (Lead-side, measured at the merge):
- `bun run typecheck` — 0 errors. `bun run lint` — 0 problems.
- `bun test` — **1292 pass / 0 fail / 13,156 expect() / 116 files** (67.18s)
  — exactly baseline 1284 + 8 (the worker's baseline run disclosed the
  documented CLAPP-010 e2e flake — isolated 1/0; its final full battery
  ran clean 1292/0).
- tsconfig.json byte-identical; frozen learn modules untouched.

Interface freezes landed (binding):
- ARCHETYPE_VERSION + ARCHETYPE_TABLE_VERSION '0.1' + the five-rule table +
  ArchetypeMatch/ArchetypeClassification + the arch_ prefix — canonical
  owner @clapp/learn (archetypes.ts).

Notable decisions:
- ADDITIVE `reasons: string[]` on ArchetypeClassification (the packet's
  §3.1 field list had nowhere to carry the unclassified reason its own
  test 7 requires — resolved per the 061 precedent: the packet's tests are
  the tiebreaker; every §3.1 field kept exact name/type/semantics;
  disclosed by the worker in module header, README, DELIVERY.md).
- The import-discipline assertion's in-body contract-set comment updated
  to name @clapp/library (leaving it stale would misdocument the change).

Next unblocked work: CLAPP-063 — Composition planner (Owner W2; depends on
051 + 062, both landed).

## 2026-10-03 — Phase 6 lane 4 integrated: composition planner (CLAPP-063)

Wave/phase: P6 Continuous Learning lane 4, worker lane clapp-063a
(Worker 2 — the composition-planning owner).

Integrated commits:
- 51a19c3 — CLAPP-063 (W2): `feat(learn): CLAPP-063 composition planner —
  greedy rank-ordered selection over the frozen retrieval + compat
  verdicts, comp_ content-addressed plans, measured facts`
- (lock) — `chore(learn): regenerate bun.lock — @clapp/library moves to
  runtime dependencies` (1 line)
- (merge) — `integrate: merge CLAPP-063 packages/learn composition` (--no-ff)
- (docs commit) — ROADMAP ✅ + this record.

Delivered surface (7 files / +1,263 / −8):
- `src/composition.ts` (548 lines) — COMPOSITION_VERSION '0.1';
  planComposition(corpus, query, options): fail-closed corpus admission
  VIA the frozen buildCompatGraph (errors carried verbatim); the frozen
  retrieval's ranking (errors carried verbatim; queryDigest rq_ carried);
  the GREEDY compat walk in frozen rank order (pairwise verdicts READ from
  the frozen induced subgraph — 'conflict'/'unrelated' exclude with named
  reasons; rank cut by measured rank); comp_ content-addressed plan ids;
  measured facts (considered, graphEdgeCount); plannedAt caller-injected.
  The verdicts BIND: no ranking/validation/verdict re-implementation.
- `test/composition.test.ts` (429) + fixture appends (+101) — the 8 named
  tests (verbatim error-carries proven by array equality against the
  frozen modules' outputs).
- `package.json`: @clapp/library moved devDependencies → dependencies (the
  first learn module to consume the library machinery at RUNTIME —
  retrievePackages + buildCompatGraph). The import-discipline assertion
  updated accordingly (the runtime set gains @clapp/library; the fixtures
  scan gains a TYPE-ONLY rule for runtime-set members — the discipline
  became STRICTER for fixtures: runtime fixture imports are violations).

Acceptance (Lead-side, measured at the merge):
- `bun run typecheck` — 0 errors. `bun run lint` — 0 problems.
- `bun test` — **1300 pass / 0 fail / 13,260 expect() / 117 files** (61.98s)
  — exactly baseline 1292 + 8 (the worker's first full run hit the
  documented CLAPP-021 sandbox flake — isolated clean, disclosed; the
  final 1300/0 measured).
- tsconfig byte-identical; frozen modules untouched.

Interface freezes landed (binding):
- COMPOSITION_VERSION '0.1' + CompositionPlan/SelectedComponent/
  ExcludedComponent + the comp_ prefix — canonical owner @clapp/learn
  (composition.ts).

Notable decisions (all disclosed by the worker):
- The 'unrelated' exclusion branch is structurally UNREACHABLE through
  planComposition in v0.1 (the frozen retrieval's target gate already
  requires every ranked candidate to carry the query target — two ranked
  candidates can never be target-disjoint). The branch is implemented per
  the packet, test 5 MEASURES the frozen verdict directly, and the
  unreachability is documented — honest dead-but-specified code.
- The rank cut is positional (evaluated before the verdicts).

Next unblocked work: CLAPP-064 — Improvement benchmark (Owner: TECH
LEAD; depends on 061+063, both landed). The TL implements it directly:
the measured benchmark evidence that repeated learning reduces
build/repair work (the P6 acceptance gate).

## 2026-10-03 — PHASE 6 COMPLETE: the improvement benchmark (CLAPP-064, the tech lead's lane)

Wave/phase: P6 Continuous Learning closing lane. Per WORK_ITEMS ("CLAPP-064
— Improvement benchmark, Owner: tech lead, Depends on: 061,063"), this lane
was implemented DIRECTLY by the tech lead.

Integrated commits:
- `feat(learn): CLAPP-064 improvement benchmark — the P6 acceptance
  harness (repeated families over ordered library snapshots through the
  frozen composition machinery, measured deltas, honest verdict cascade,
  bench_ content-addressed reports)`
- (merge) — `integrate: merge CLAPP-064 packages/learn
  improvement-benchmark` (--no-ff)
- (docs commit) — ROADMAP P6 ✅ + this record.

Delivered surface (src/improvement.ts + test/improvement.test.ts + the
index/import-discipline/README sanctioned extensions):
- BENCHMARK_VERSION '0.1'; runImprovementBenchmark(family, options):
  a family = fixed retrieval queries × ORDERED library snapshots; every
  query × snapshot planned through the FROZEN planComposition (corpus/
  query failures carried VERBATIM — the frozen modules are the
  authorities); per-snapshot aggregates MEASURED (totalSelected/
  totalExcluded/totalConsidered/meanSelectedScore); consecutive-pair
  deltas (measured, signed, per-query selected trails); the verdict
  cascade: 'improvement-detected' (totalSelected non-decreasing, one
  strict increase, no query regression) / 'regression' (a named query's
  selected count decreased) / 'no-improvement' (incl. the honest
  nothing-measured case); bench_ content-addressed report ids;
  benchmarkedAt caller-injected RFC3339 (calendar-valid; a different
  timestamp moves the id, the measured facts stay byte-identical — the
  clock-free proof).
- Eight named tests, all green: determinism; fail-closed (incl. the
  verbatim frozen-error carries with query/snapshot identity); the
  aggregates recomputed independently from the frozen plans; the
  growth→improvement case; the regression case (named); the flat
  no-improvement case; the legal single-snapshot/zero-query families;
  the content-addressing + clock-free proof.
- Local house helpers (the 060..063 precedent) — the runtime dependency
  set unchanged (@clapp/core + @clapp/observe + @clapp/library).

Acceptance (measured at the merge):
- `bun run typecheck` — 0 errors. `bun run lint` — 0 problems (after the
  TL's own two unused-var fixes — caught by the battery, self-disclosed).
- `bun test` — **1308 pass / 0 fail / 13,311 expect() / 118 files** (43.64s)
  — exactly baseline 1300 + 8.
- tsconfig/package.json byte-identical; frozen modules untouched.

## PHASE 6 CLOSED — all five P6 checkboxes ✅ (060, 061, 062, 063, 064)

The @clapp/learn package now carries the complete Continuous Learning
v0.1: failure memory (060), repair pattern mining (061), archetype
detection (062), composition planning (063), the improvement-benchmark
harness (064) — 6 modules, ~2,900 lines, 48 named tests, every interface
frozen with content-addressed identities (fail_/fmem_/rpat_/arch_/comp_/
bench_), and the P6 acceptance gate now EXECUTABLE (the harness; the
demonstration campaign with real corpora is future work the harness
measures).

Next: P7 — Production Hardening (auth/session boundary, tenancy, resource
budgets, secrets/redaction, auditability — per the WORK_ITEMS P7 section).

## 2026-10-03 — Phase 7 lane 1 integrated: authorized-session boundary (CLAPP-070)

Wave/phase: P7 Production Hardening (opener), worker lane clapp-070a
(Worker 1 — the observation-pipeline owner the boundary gates). NEW
package `@clapp/security`.

Integrated commits:
- 0f0f056 — CLAPP-070 (W1): `feat(security): CLAPP-070 authorized-session
  boundary — the §1 statement capture, per-target observation gate, authz_
  content-addressed sessions`
- (lock) — `chore(security): regenerate bun.lock — @clapp/security
  workspace registration` (+10 lines, new-package entries only)
- (merge) — `integrate: merge CLAPP-070 packages/security authorization
  boundary` (--no-ff)
- (docs commit) — ROADMAP P7 🟡 + this record.

Delivered surface (7 files / +1,016 / −0 — all under packages/security/):
- `src/authorization.ts` (442 lines) — AUTHZ_VERSION '0.1' + the frozen
  five-kind §1 vocabulary (owned | licensed-open-source |
  explicit-permission | interop-testing | research-benchmark);
  createAuthorizedSession: fail-closed statement admission (kind in the
  vocabulary, non-empty target/owner/grant, calendar-valid RFC3339
  grantedAt; ALL errors named; statements stored VERBATIM by value);
  sessions carry scopes EXACTLY ['observe'] (v0.1 — observation only;
  later scopes via contract bump) and authz_ content-addressed ids;
  assertObservationAuthorized: the per-target boundary (refusal is the
  DEFAULT — a wrong authzVersion, malformed id, non-['observe'] scopes,
  mismatched target, or any malformed shape refuses with the defect
  named; a statement for app A never authorizes app B, both named).
- `test/authorization.test.ts` (257) + fixtures (89) — the 8 named tests.

Acceptance (Lead-side, measured at the merge):
- `bun run typecheck` — 0 errors. `bun run lint` — 0 problems.
- `bun test` — **1316 pass / 0 fail / 13,470 expect() / 119 files** (65.25s)
  — exactly baseline 1308 + 8 (the worker measured the same; its baseline
  run was clean).
- bun.lock diff: new-package entries only. Owned surface strict.

Interface freezes landed (binding):
- AUTHZ_VERSION '0.1' + the five-kind vocabulary + AuthorizationStatement/
  Session + the authz_ prefix + the observation-only scope — canonical
  owner @clapp/security (authorization.ts).

Notable decisions (disclosed by the worker):
- Statements stored VERBATIM by value (extra keys ride along and honestly
  move the id — never normalized).
- The boundary validates the authz_ id's SHAPE, not its hash consistency
  (the boundary is synchronous/pure by contract — documented).

Next unblocked work: CLAPP-071 — Secret redaction (Owner W2).

## 2026-10-03 — Phase 7 lane 2 integrated: secret redaction (CLAPP-071)

Wave/phase: P7 Production Hardening lane 2, worker lane clapp-071a
(Worker 2 — assigned per WORK_ITEMS).

Integrated commits:
- 16543f1 — CLAPP-071 (W2): `feat(security): CLAPP-071 secret redaction —
  the §3 six-class vocabulary, visible non-reversible markers, measured
  provenance digests, redct_ reports`
- (merge) — `integrate: merge CLAPP-071 packages/security redaction` (--no-ff)
- (docs commit) — ROADMAP ✅ + this record.

Delivered surface (6 files / +1,071 / −0):
- `src/redaction.ts` (446 lines) — REDACTION_VERSION '0.1'; the frozen
  §3 six-class vocabulary (cookie | authorization-header | bearer-token |
  api-key | password | private-user-data); classifyFieldName (the ordered
  rule table: ends-with/exact matches, case-insensitive, first-match-wins,
  honest null misses); redactSensitiveFields: the recursive walk (deep
  copy, input never mutated, non-sensitive values verbatim), markers
  'REDACTED:<kind>:<fingerprint8>' (a NON-REVERSIBLE sha256-8 prefix —
  visible in provenance, distinguishable, never recoverable), entries
  with dot/bracket paths in canonical order, countsByKind MEASURED,
  originalDigest/redactedDigest measured (equal on a no-op — honest),
  redct_ content-addressed report ids; cycles DETECTED and refused
  (named error, no hang); scalar roots refused (named). Deterministic;
  no clock/randomness/network/filesystem.
- `test/redaction.test.ts` (236) + `test/imports.test.ts` (131, the FRESH
  import-discipline test: exact 3-file src list, runtime set core+observe)
  + `test/fixtures/redaction-fixtures.ts` (113).

Acceptance (Lead-side, measured at the merge):
- `bun run typecheck` — 0 errors. `bun run lint` — 0 problems.
- `bun test` — **1325 pass / 0 fail / 13,564 expect() / 121 files** (66.19s)
  — exactly baseline 1316 + 9 (8 redaction tests + the imports test; the
  worker measured the same, zero flakes).
- package.json/tsconfig/bun.lock byte-identical. Owned surface strict.

Interface freezes landed (binding):
- REDACTION_VERSION '0.1' + SensitiveKind + the rule table +
  RedactionEntry/Report + the redct_ prefix — canonical owner
  @clapp/security (redaction.ts).

Next unblocked work: CLAPP-072 — Multi-tenant isolation (Owner W3).

## 2026-10-03 — Phase 7 lane 3 integrated: multi-tenant isolation (CLAPP-072)

Wave/phase: P7 Production Hardening lane 3, worker lane clapp-072a
(Worker 3 — assigned per WORK_ITEMS).

Integrated commits:
- 0f556ba — CLAPP-072 (W3): `feat(security): CLAPP-072 multi-tenant
  isolation — the §6 five-domain separation, immutable zone data, the
  executable publish-leak guard, iso_ content-addressed snapshots`
- (merge) — `integrate: merge CLAPP-072 packages/security isolation` (--no-ff)
- (docs commit) — ROADMAP ✅ + this record.

Delivered surface (6 files / +1,254 / −1 — the −1 is the count-comment):
- `src/isolation.ts` (560 lines) — ISOLATION_VERSION '0.1'; the §6
  five-domain vocabulary (user-project | target-evidence | generated-code
  | package-library | benchmark-corpus); createTenantZone (fail-closed
  tenantId validation); put (fail-closed; the immutability law — a
  same-(domain,key) changed rewrite refused, an identical duplicate
  refused; the PUBLISH-LEAK GUARD — an input originDomain differing from
  the target domain is refused with both named, making the §6 acceptance
  law executable and generalized; storedAt caller-injected RFC3339); get
  (honest nulls, verbatim hits — the registry alias precedent); list
  (canonical, fresh arrays); counts (measured per non-empty domain);
  snapshot ('iso_' + sha256Hex over sorted [{domain, key, valueDigest}] —
  values hashed, never leaked; input-order independent). Tenant zones are
  separate instances — zero shared state.
- `test/isolation.test.ts` (429) + fixtures (88) + the imports file-list
  extension.

Acceptance (Lead-side, measured at the merge):
- `bun run typecheck` — 0 errors. `bun run lint` — 0 problems.
- `bun test` — **1333 pass / 0 fail / 13,727 expect() / 122 files** (68.34s)
  — exactly baseline 1325 + 8 (the worker measured the same).
- package.json/tsconfig/bun.lock byte-identical. Owned surface strict.

Interface freezes landed (binding):
- ISOLATION_VERSION '0.1' + DataDomain + IsolationZone + the iso_ prefix —
  canonical owner @clapp/security (isolation.ts).

Next unblocked work: CLAPP-073 — Audit/cancellation/resume (Owner W3).

## 2026-10-03 — Phase 7 lane 4 integrated: audit/cancellation/resume (CLAPP-073)

Wave/phase: P7 Production Hardening lane 4, worker lane clapp-073a
(Worker 3 — assigned per WORK_ITEMS).

Integrated commits:
- 0a39500 — CLAPP-073 (W3): `feat(security): CLAPP-073 audit/cancellation/
  resume — the append-only seven-kind trail, content-addressed events,
  the honest cancellation state machine with measured counts`
- (merge) — `integrate: merge CLAPP-073 packages/security audit` (--no-ff)
- (docs commit) — ROADMAP ✅ + this record.

Delivered surface (6 files / +1,730 / −1):
- `src/audit.ts` (843 lines) — AUDIT_VERSION '0.1'; the seven-kind
  vocabulary (session-admitted | observation-refused | redaction-applied |
  zone-write | zone-refused | operation-cancelled | operation-resumed);
  createAuditTrail(): record (fail-closed: kind/actor/subject/facts/
  recordedAt ALL named; events APPEND-ONLY, immutable, content-addressed
  'audit_' over the event minus id — the same content at a different
  recordedAt is a distinct event; the identical event is the duplicate
  refusal); list (canonical id order, defensively copied);
  countsByKind (measured); snapshot 'atrail_' (content-addressed,
  input-order independent, the empty trail valid); the CANCELLATION STATE
  MACHINE — registerOperation (caller-supplied operationId, duplicates
  refused) / cancel (running→cancelled; a resumed operation can be
  re-cancelled; cancellationCount MEASURED) / resume (only
  cancelled→resumed; illegal transitions refused with named reasons);
  every cancel/resume writes its audit event TOGETHER with the state
  change (subject = operationId, facts = measured counts). Caller-
  injected timestamps everywhere; no clock/randomness/network/filesystem.
- `test/audit.test.ts` (561) + fixtures (133) + the imports file-list
  extension.

Acceptance (Lead-side, measured at the merge):
- `bun run typecheck` — 0 errors. `bun run lint` — 0 problems.
- `bun test` — **1341 pass / 0 fail / 13,948 expect() / 123 files** (65.35s)
  — exactly baseline 1333 + 8 (the worker measured the same twice, zero
  flakes).
- package.json/tsconfig/bun.lock byte-identical. Owned surface strict.

Interface freezes landed (binding):
- AUDIT_VERSION '0.1' + the seven-kind vocabulary + AuditEvent/AuditTrail/
  CancellableOperation + the audit_/atrail_ prefixes — canonical owner
  @clapp/security (audit.ts).

Next unblocked work: CLAPP-074 — Production readiness gate (Owner: TECH
LEAD; depends on 070-073, ALL landed). The TL implements it directly: the
readiness gate that weighs the four landed security surfaces and issues
the honest production verdict.
