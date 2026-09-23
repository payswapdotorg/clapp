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
