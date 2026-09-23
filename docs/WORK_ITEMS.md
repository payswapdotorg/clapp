# CLAPP Work Items

All work items are designed for a tech lead coordinating three concurrent workers.

## P0 — Foundation

### CLAPP-001 — Workspace and CI
Owner: W1
Depends on: none
Output:
- monorepo/workspace
- package boundaries
- CI checks
Acceptance:
- fresh checkout installs and passes type/lint/unit checks.

### CLAPP-002 — Persistence and artifacts
Owner: W2
Depends on: CLAPP-001 interface only
Output:
- run/evidence/model/artifact persistence
- object storage abstraction
Acceptance:
- an evidence bundle can be written, hashed, retrieved, and replayed.

### CLAPP-003 — Sandbox/execution contract
Owner: W3
Depends on: CLAPP-001 interface only
Output:
- execution API
- resource budgets
- process/network policy abstraction
Acceptance:
- generated fixture application runs inside an isolated execution profile.

## P1 — Web observation

### CLAPP-010 — Browser runner
Owner: W1
Depends on: 001,003

### CLAPP-011 — Evidence manifest
Owner: W2
Depends on: 002

### CLAPP-012 — Journey recording/replay
Owner: W3
Depends on: 003

### CLAPP-013 — Web observation integration gate
Owner: tech lead
Depends on: 010,011,012
Acceptance:
- one benchmark app yields a complete evidence bundle and replayable journey.

## P2 — Behavioral model

### CLAPP-020 — Behavioral IR
Owner: W2
Depends on: 011

### CLAPP-021 — Evidence-to-IR extraction
Owner: W2
Depends on: 020

### CLAPP-022 — Exploration policy
Owner: W1
Depends on: 012,020

### CLAPP-023 — Journey DSL
Owner: W3
Depends on: 012,020

### CLAPP-024 — IR integration gate
Owner: tech lead
Depends on: 021,022,023
Acceptance:
- benchmark journeys produce evidence-linked IR and can be replayed from the IR.

## P3 — Web synthesis

### CLAPP-030 — Architecture planner
Owner: W3
Depends on: 024

### CLAPP-031 — Code generation
Owner: W3
Depends on: 030

### CLAPP-032 — Package schema/registry foundation
Owner: W2
Depends on: 020

### CLAPP-033 — Initial package set
Owner: W2
Depends on: 032

### CLAPP-034 — Generated application runtime
Owner: W1
Depends on: 003,031

### CLAPP-035 — Synthesis gate
Owner: tech lead
Depends on: 031,033,034
Acceptance:
- benchmark target produces a clean-checkout runnable candidate.

## P4 — Differential verification

### CLAPP-040 — Paired runner
Owner: W1
Depends on: 034

### CLAPP-041 — Semantic/state diff
Owner: W2
Depends on: 020,040

### CLAPP-042 — Visual diff
Owner: W2
Depends on: 040

### CLAPP-043 — Network/API diff
Owner: W1
Depends on: 040

### CLAPP-044 — Failure classifier
Owner: W3
Depends on: 041,042,043

### CLAPP-045 — Repair loop
Owner: W3
Depends on: 044

### CLAPP-046 — Parity gate
Owner: tech lead
Depends on: 045
Acceptance:
- known seeded defects are detected, classified, repaired, and regression-tested.

## P5 — Package learning

### CLAPP-050 — Package extraction
Owner: W2
Depends on: 046

### CLAPP-051 — Package compatibility graph
Owner: W2
Depends on: 050

### CLAPP-052 — Package retrieval
Owner: W1
Depends on: 051

### CLAPP-053 — Package replay benchmark
Owner: W3
Depends on: 051,052

### CLAPP-054 — Promotion gate
Owner: tech lead
Depends on: 053
Acceptance:
- a package extracted from one app can be independently reused and verified in another.

## P6 — Continuous learning

### CLAPP-060 — Failure memory
Owner: W3
Depends on: 044

### CLAPP-061 — Repair pattern mining
Owner: W2
Depends on: 060

### CLAPP-062 — Archetype classifier
Owner: W1
Depends on: 020,050

### CLAPP-063 — Composition planner
Owner: W2
Depends on: 051,062

### CLAPP-064 — Improvement benchmark
Owner: tech lead
Depends on: 061,063
Acceptance:
- repeated benchmark families show measurable reduction in build/repair work.

## P7 — Production hardening

### CLAPP-070 — Authorized-session boundary
Owner: W1

### CLAPP-071 — Secret redaction
Owner: W2

### CLAPP-072 — Multi-tenant isolation
Owner: W3

### CLAPP-073 — Audit/cancellation/resume
Owner: W3

### CLAPP-074 — Production readiness gate
Owner: tech lead
Depends on: 070,071,072,073

## P8 — Native adapters

Each native platform must implement:
- observation adapter
- environment descriptor
- evidence emitter
- synthesis target
- verification adapter

Sequence:
Android → Linux → Windows → macOS → iOS

Do not fork the core Behavioral IR.

## Parallelism rule

Workers can work concurrently when they depend only on frozen interfaces. The tech lead owns interface freezes and integration gates.
