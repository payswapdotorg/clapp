# CLAPP Final Handoff

## Mission

Build an application parity and synthesis system that becomes progressively better at software construction by converting successful builds into verified reusable packages.

## Product decision

**Web applications are the first production target.**

They are significantly more tractable than arbitrary native applications because the browser exposes a rich set of observable surfaces: DOM/accessibility structure, runtime execution, network traffic, WebSockets, screenshots, page resources, browser storage, service workers, and other browser/devtools signals.

The product should therefore prove the complete compounding loop on web first:

```
authorized target
  ↓
observe
  ↓
Behavioral IR
  ↓
retrieve package graph
  ↓
synthesize
  ↓
differentially verify
  ↓
repair
  ↓
promote reusable packages
  ↓
reuse on future applications
```

## Critical product boundary

CLAPP does **not** promise universal source-code recovery or perfect copies of arbitrary software.

The supported promise is:

> Given an application and an authorized execution context, reconstruct observable behavior, synthesize an independent implementation, measure parity, and clearly report behavior that is unavailable or replaced.

No bypassing of authentication, DRM, attestation, anti-tamper, rate limits, or other security controls is part of the product architecture.

## Compounding strategy

The library is the strategic asset.

Every successful build can yield:
- reusable packages
- test fixtures
- implementation recipes
- repair patterns
- compatibility facts
- archetype metadata

Package promotion requires executable evidence and provenance. Future builds should increasingly become composition rather than greenfield generation.

## Repository artifacts

- `README.md`
- `docs/PRODUCT_AND_FEASIBILITY.md`
- `docs/ARCHITECTURE.md`
- `docs/BEHAVIORAL_IR.md`
- `docs/LEARNING_AND_LIBRARY.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/WORKER_HANDOFFS.md`
- `docs/WORK_ITEMS.md`
- `docs/TECH_LEAD_START_PROMPT.md`
- `docs/ACCEPTANCE_TESTS.md`
- `docs/WEB_BENCHMARKS.md`
- `docs/SECURITY_AND_AUTHORIZATION.md`
- `docs/ADR-001-WEB-FIRST.md`
- `docs/ROADMAP.md`
- `docs/WORKLOG.md`
- `schemas/behavioral-ir.schema.json`
- `schemas/package.schema.json`

## Initial worker split

**Worker 1**
Observation, browser instrumentation, platform adapters, candidate runtime.

**Worker 2**
Behavioral IR, package registry/retrieval, learning and promotion.

**Worker 3**
Synthesis, differential verification, repair, benchmark execution.

**Tech lead**
Architecture, interface freezes, integration, acceptance, dogfooding, and repository truth.

## First implementation wave

Dispatch:
- CLAPP-001 — Workspace and CI
- CLAPP-002 — Persistence and artifacts
- CLAPP-003 — Sandbox/execution contract

Freeze their interfaces.

Then dispatch the web observation wave:
- CLAPP-010
- CLAPP-011
- CLAPP-012

Do not begin dependent work by guessing interfaces.

## Definition of success for the first meaningful milestone

A user supplies an authorized benchmark web application and its environment.

CLAPP:
1. explores it;
2. records evidence;
3. produces a valid Behavioral IR;
4. generates an independent application;
5. executes canonical journeys against both;
6. reports semantic/visual/API/state differences;
7. repairs seeded defects within a bounded budget;
8. extracts at least one reusable package;
9. reuses that package in a separate benchmark;
10. shows measurable reduction in work for the second build.

That is the first proof that CLAPP is becoming a **software-building system that learns from its own successful work**, rather than merely another code generator.
