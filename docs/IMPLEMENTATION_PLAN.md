# Implementation Plan

## Phase 0 — Repository and execution foundation

Goal: establish reproducible development and worker coordination.

Deliver:
- TypeScript monorepo or equivalent modular workspace.
- package boundaries.
- CI.
- local development commands.
- artifact conventions.
- run/event schema.
- sandbox execution abstraction.
- database migrations.
- object artifact storage abstraction.
- test harness.
- tech-lead worklog protocol.

Exit:
- clean bootstrap from fresh checkout.
- one end-to-end hello-run stored and replayed.

Parallelism:
- Worker 1: workspace + CI.
- Worker 2: persistence/artifact abstractions.
- Worker 3: execution/test harness.
- Tech lead: integration contract.

## Phase 1 — Web observation engine

Goal: capture enough evidence to describe an application without hand-written selectors.

Deliver:
- Playwright runner.
- browser context management.
- action recorder.
- DOM/accessibility snapshotter.
- screenshots.
- console/error capture.
- HTTP request/response capture.
- WebSocket capture where supported.
- storage inventory.
- service-worker awareness.
- optional CDP adapter.
- evidence manifests.

Exit:
- given an authorized test web app, a run yields a complete evidence bundle.
- evidence is immutable, hashed, replayable.

Worker split:
- W1: browser instrumentation.
- W2: evidence storage/provenance.
- W3: journey recorder/replayer + sample corpus.

## Phase 2 — Behavioral IR and exploration

Goal: convert evidence into an executable behavioral model.

Deliver:
- IR schema and validator.
- evidence references.
- state-transition extraction.
- route/screen extraction.
- API operation extraction.
- deterministic journey format.
- autonomous exploration policy.
- uncertainty model.

Exit:
- explorer can discover and replay seeded journeys.
- every inferred requirement links to evidence.

Worker split:
- W1: IR + parsers.
- W2: exploration agent.
- W3: journey DSL + replay evaluator.

## Phase 3 — Web synthesizer

Goal: synthesize an independent web application from the IR.

Deliver:
- application architecture planner.
- framework adapter contract.
- package retriever stub.
- code generation pipeline.
- build runner.
- generated test suite.
- local backend/mock adapter.

Initial supported output target should be one stable stack; avoid framework proliferation.

Exit:
- seeded benchmark apps produce runnable replacements with major journeys working.

Worker split:
- W1: planner/codegen.
- W2: package system foundation.
- W3: build/runtime/deployment/test harness.

## Phase 4 — Differential parity engine

Goal: automatically identify behavioral mismatches and repair them.

Deliver:
- paired reference/candidate runner.
- synchronized journey execution.
- semantic diffing.
- visual diffing.
- API/network diffing.
- storage/state diffing.
- failure classifier.
- repair task generator.
- repair loop with bounded iterations.

Exit:
- on benchmark apps, failures are converted into actionable repair tasks.
- repaired builds improve measured parity rather than regress.

Worker split:
- W1: execution/diff engine.
- W2: visual/semantic comparators.
- W3: repair loop + regression suite.

## Phase 5 — Package library v1

Goal: turn successful implementations into reusable components.

Deliver:
- package schema.
- extraction pipeline.
- package tests.
- provenance.
- registry.
- semantic/constraint retrieval.
- compatibility matrix.
- versioning/deprecation.
- cross-project replay harness.

Exit:
- at least a small curated set of packages can be reused in independent applications without manual surgery.

Worker split:
- W1: package extraction/registry.
- W2: retrieval/ranking/compatibility.
- W3: package replay/security/benchmarks.

## Phase 6 — Continuous learning

Goal: make each completed build improve subsequent builds.

Deliver:
- failure memory.
- repair-pattern extraction.
- package candidate mining.
- successful trajectory index.
- archetype detection.
- composition planner.
- library promotion gates.
- cost/success telemetry.

Exit:
- benchmark sequence demonstrates reduced implementation time and repair work across repeated application families.

## Phase 7 — Web production hardening

Deliver:
- authenticated capture using user-controlled sessions.
- production artifact limits.
- cancellation/resume.
- queueing.
- resource budgets.
- secret redaction.
- tenancy isolation.
- abuse controls.
- audit logs.
- reproducible exports.

Exit:
- safe multi-user operation on authorized workloads.

## Phase 8 — Native adapter foundation

Implement the same observation/IR/verification interfaces for one native platform at a time.

Order:
1. Android
2. Linux
3. Windows
4. macOS
5. iOS

Do not create separate cloning architectures.

## Phase 9 — Multi-platform package ecosystem

Extend package metadata with:
- platform
- runtime
- capability
- architecture
- permission model
- packaging model

The same package idea should support shared conceptual components where practical while allowing platform-native implementations.

## Phase 10 — Autonomous application factory

Target workflow:

```
User supplies target
      ↓
CLAPP classifies archetype
      ↓
selects observation budget
      ↓
explores target
      ↓
builds Behavioral IR
      ↓
retrieves package graph
      ↓
synthesizes candidate
      ↓
differential verification
      ↓
autonomous repair
      ↓
human review
      ↓
export/deploy
      ↓
distill successful components
```

The human remains the approval boundary for authorized target scope and final release.

## Implementation sequencing rule

No worker should start a dependent phase by guessing an interface. The tech lead must merge/declare the preceding contract before dependent work begins.

Workers may develop adapters and test fixtures against frozen interface contracts.
