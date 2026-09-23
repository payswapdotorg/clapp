# CLAPP — Continuous Learning Application Parity Platform

CLAPP is an authorized software archaeology, behavioral reconstruction, and application synthesis platform.

The product goal is **not** to promise literal source-code recovery or perfect cloning of arbitrary software. The goal is to turn an accessible application into a tested behavioral specification and then synthesize an independently implemented replacement that reaches measurable parity.

Primary wedge: **web applications**.

Long-term targets:
- Web applications
- Android
- Linux
- Windows
- macOS
- iOS

Core compounding loop:

```
Observe → Model → Compose/Generate → Execute → Differentially Test → Repair
                    ↑                                  ↓
                    └────── Distill reusable packages ──┘
```

Every successful build should make future builds cheaper by extracting verified reusable packages, implementation recipes, test generators, and failure knowledge into the CLAPP Library.

## Quickstart (Phase 0 workspace)

Prerequisites: [bun](https://bun.sh) ≥ 1.1 (verified with 1.3.x).

```bash
git clone https://github.com/payswapdotorg/clapp.git
cd clapp
bun install        # bun workspaces: packages/* (bun.lock is committed)
bun run typecheck  # tsc --noEmit across all workspace packages
bun run lint       # ESLint 9 flat config (typescript-eslint, recommended)
bun test           # unit tests via bun:test, colocated as src/*.test.ts
```

All four commands must pass from a fresh checkout. CI (`.github/workflows/ci.yml`) runs the same battery on every push and pull request.

Workspace layout:

- `packages/core` — `@clapp/core`: the run/event/artifact contract v0 plus pure helpers (prefixed ids, WebCrypto SHA-256, event-stream invariants, hello-run seed). Public API is exported only from `src/index.ts`.
- Sibling packages (`@clapp/store`, `@clapp/sandbox`) register automatically via the `packages/*` workspace glob — nobody but Worker 1 edits root workspace files.
- TypeScript 5 strict, ES modules, tests colocated as `src/*.test.ts`, no other test framework.

## Repository contract

This repository is the sole source of truth for the implementation program.

- `docs/PRODUCT_AND_FEASIBILITY.md` — product definition and feasibility.
- `docs/ARCHITECTURE.md` — system architecture and boundaries.
- `docs/BEHAVIORAL_IR.md` — canonical intermediate representation.
- `docs/LEARNING_AND_LIBRARY.md` — compounding learning/package system.
- `docs/IMPLEMENTATION_PLAN.md` — phased implementation plan.
- `docs/WORKER_HANDOFFS.md` — three-worker parallel execution contract.
- `docs/ACCEPTANCE_TESTS.md` — objective acceptance criteria.
- `docs/SECURITY_AND_AUTHORIZATION.md` — authorization, isolation, and anti-bypass boundaries.
- `docs/ADR-001-WEB-FIRST.md` — architecture decision to make web the first platform.
- `docs/ROADMAP.md` — dependency graph and completion tracking.
- `docs/WORKLOG.md` — tech-lead integration log.

## North-star outcome

A user should be able to provide an application they are authorized to analyze and select:

1. **Reconstruct** — infer behavior and implementation requirements.
2. **Synthesize** — build an independent replacement.
3. **Parity test** — compare original and replacement across generated journeys.
4. **Distill** — promote verified solutions into reusable packages.
5. **Compose next time** — start future builds from the growing library instead of rebuilding primitives.

The system must distinguish **observed facts**, **inferred behavior**, and **generated assumptions** at every stage.
