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
