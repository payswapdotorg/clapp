# ADR-001: Web-First Architecture

Status: Accepted

## Context

CLAPP eventually targets multiple application platforms, but platform observability varies substantially.

Web applications run inside an instrumentable browser. Current tooling provides:
- network inspection and mocking
- WebSocket inspection
- DOM inspection
- runtime evaluation
- screenshots
- page/resource introspection
- service-worker and browser-storage primitives

This makes the web the fastest environment in which to prove the complete loop:
observation → behavioral model → synthesis → differential verification → repair → package learning.

## Decision

Build the platform around a platform-neutral Behavioral IR and make the web adapter the first complete production adapter.

Native platforms must implement the same adapter contracts rather than introduce separate cloning stacks.

## Consequences

Positive:
- faster first working product
- strongest observability
- easy benchmark distribution
- fast feedback from differential testing
- reusable architecture for native adapters

Negative:
- web-specific assumptions must not leak into core IR
- browser artifacts can be noisy
- server-side behavior remains partly opaque

## Alternatives rejected

### Build native first

Rejected because platform security and packaging boundaries make the first end-to-end learning loop slower to prove.

### Build a source-code generation product first

Rejected because parity verification is the real feedback signal and should shape the architecture from the beginning.

### Treat each platform as a separate product

Rejected because it would duplicate the model, synthesis, package, and verification layers and prevent cross-platform learning.
