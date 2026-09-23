# Three-Worker Handoff

## Tech Lead responsibilities

The tech lead is the single integration authority.

Responsibilities:
- maintain architecture invariants.
- maintain the work graph.
- split tasks into independent work packets.
- freeze interfaces before dependent work.
- reconcile worker changes.
- run end-to-end dogfood.
- reject unverified package promotions.
- update WORKLOG.md after every integrated wave.

The tech lead must treat the repository as the sole source of truth.

## Worker 1 — Observation and Platform Adapters

Owns:
- browser execution
- Playwright/CDP integration
- action capture
- DOM/accessibility extraction
- network capture
- WebSocket capture
- runtime/static evidence adapters
- future platform adapters

Outputs:
- code
- unit/integration tests
- evidence fixture corpus
- adapter capability manifest
- reproducible demo command

Acceptance:
- no hidden global state.
- all captured evidence has provenance.
- runner is deterministic enough for replay.
- secrets are redacted according to policy.

## Worker 2 — Behavioral Model and Package Learning

Owns:
- Behavioral IR
- model extraction
- package schema
- package registry
- retrieval
- package extraction
- composition planning
- learning records
- package promotion gates

Outputs:
- schemas
- validators
- reference fixtures
- registry implementation
- package benchmark corpus
- retrieval evaluation

Acceptance:
- every inferred model element links to evidence.
- package versions are immutable.
- package promotion is test-gated.
- retrieval is explainable through compatibility/evidence metadata.

## Worker 3 — Synthesis, Verification, and Repair

Owns:
- application planner
- code generation
- build/runtime
- differential runner
- semantic/visual/network comparisons
- failure classification
- autonomous repair
- regression suite

Outputs:
- generated benchmark applications
- parity reports
- repair trajectories
- end-to-end test suite
- performance/resource measurements

Acceptance:
- generated apps build from clean checkout.
- paired reference/candidate tests run reproducibly.
- failures are machine-readable.
- repair iterations are bounded and auditable.

## Dependency graph

```
                   Phase 0
                  /   |   \
                 /    |    \
                v     v     v
           Worker1 Worker2 Worker3
              |       |       |
              +---+---+-------+
                  |
                Phase 1
                  |
                Phase 2
               /      \
              /        \
             v          v
        Behavior IR   Exploration
             \        /
              \      /
               v    v
             Phase 3
               |
             Phase 4
               |
        +------+------+
        |             |
      Phase 5       Phase 7
        |
      Phase 6
        |
      Phase 8+
```

## Worker communication format

Every worker report must contain:

1. What changed.
2. Files changed.
3. Interface changes.
4. Tests added/run.
5. Evidence of acceptance criteria.
6. Known limitations.
7. Dependencies unblocked.
8. Follow-up work.
9. Any architecture disagreement, with proposed ADR.

Workers must not silently redefine shared contracts.
