# @clapp/security — CLAPP Production Hardening, lane 1 (CLAPP-070)

The Phase-7 FIRST lane (the first `docs/ROADMAP.md` P7 checkbox:
"auth/session boundary", `docs/WORK_ITEMS.md`: "CLAPP-070 —
Authorized-session boundary, Owner W1"): the **authorized-session
boundary** — the §1 authorization-statement capture and the observation
gate.

`docs/SECURITY_AND_AUTHORIZATION.md` §1 (the authorized-use model) reads:

> CLAPP should be designed for:
> - applications owned by the user
> - applications where the user has explicit permission
> - open-source applications subject to their licenses
> - interoperability/testing environments
> - controlled research benchmarks
>
> The system must capture an authorization statement or benchmark ownership
> record before observation begins.

This package IS that capture and that boundary: `createAuthorizedSession`
admits a captured authorization statement fail-closed into a
content-addressed `AuthorizationSession`, and `assertObservationAuthorized`
is the gate an observation must pass through before it begins.

**Out of scope (later P7 lanes, per `docs/ROADMAP.md`):** secret redaction
(CLAPP-071, W2), multi-tenant isolation (CLAPP-072, W3),
audit/cancellation/resume (CLAPP-073, W3), and the production readiness
gate (CLAPP-074, tech lead — depends on 070/071/072/073). This lane only
OPENS the security lane: the authorization statement + the session
boundary that observation must pass through.

## The contract

```
createAuthorizedSession(statement)            → Promise<{ ok: true, session } | { ok: false, errors[] }>
assertObservationAuthorized(session, target)  → { ok: true, sessionId, targetIdentifier } | { ok: false, reason }
```

- **Admission is fail-closed**: the statement must be an object with an
  `authorizationKind` IN the frozen five-kind vocabulary (an unknown kind
  is a named error listing the observed value), non-empty string
  `targetIdentifier`/`ownerIdentity`/`grantReference`, and a
  calendar-valid RFC3339 `grantedAt` (2026-02-30-style rollover dates are
  rejected). ALL errors are collected — each naming its field, the list
  canonicalized (sorted, deduped) — and admission NEVER throws: a
  malformed statement is a `{ ok: false, errors }` result, and nothing is
  minted.
- **The statement is stored VERBATIM** — by value: a deep copy preserving
  every key and value exactly (never normalized, never rewritten, never
  trimmed, never re-cased). The admitted session never aliases the
  caller's input object: the statement is immutable once admitted.
- **The boundary distrusts everything**: a non-object session, a wrong
  `authzVersion`, a missing/malformed (`authz_`-shaped) `sessionId`, a
  malformed statement, or scopes not exactly `['observe']` each refuse
  with the defect named — a session may be structurally present but
  WRONG. Refusal is the default: every unlisted malformed shape refuses
  — the boundary never guesses an authorization.
- **The boundary is synchronous and pure** — it reads nothing but its two
  arguments (no clock, no state, no I/O), so the same session and target
  always yield the identical verdict.

## The five-kind vocabulary (the §1 classes, verbatim)

The frozen v0.1 `AuthorizationKind` vocabulary — the five §1 classes:

| kind                   | the §1 class (verbatim)                              |
| ---------------------- | ---------------------------------------------------- |
| `owned`                | applications owned by the user                       |
| `licensed-open-source` | open-source applications subject to their licenses   |
| `explicit-permission`  | applications where the user has explicit permission   |
| `interop-testing`      | interoperability/testing environments                |
| `research-benchmark`   | controlled research benchmarks                       |

**The module does not scan statement text for intent**: the grant
reference + the kind CARRY the authorization. A statement is authorized
when its `grantReference` names a real ownership / license / permission /
interop / benchmark-ownership record of the named kind for the named
target — for that target and for nothing else. The module never judges
prose and never guesses an authorization the statement does not carry.

## The per-target boundary law

The authorization is **per-target**: a statement for app A never
authorizes observing app B. `assertObservationAuthorized(session, target)`
refuses when `session.statement.targetIdentifier !== target` — with BOTH
identifiers named — and passes only when the statement names the exact
target the observation is about to observe. A non-string or empty
`targetIdentifier` argument refuses, named.

## The observation-only scope

v0.1 grants exactly ONE scope: `['observe']` — the §1 model (observation
must not begin without the boundary's pass). Later scopes arrive via a
contract version bump, never a quiet widening: any scopes value that is
not exactly `['observe']` refuses at the boundary, and every session
mints a FRESH scopes array (no shared array two sessions could alias).

## The `authz_` prefix proposal

The session id is content-addressed: `'authz_' +
sha256Hex(canonicalJson(session minus sessionId))` — this lane's frozen
proposal in the house prefix discipline (`pkg_` / `cgraph_` / `rq_` /
`creg_` / `fail_` / `fmem_` / `rpat_` / `arch_` / `comp_` / `bench_`).
Shape: `authz_` + 64 lowercase hex chars (`AUTHZ_ID_PATTERN`). Changing
the prefix changes every minted session id and requires a contract
version bump.

## The determinism discipline

- Same statement → deep-equal session, identical `authz_` id
  (`canonicalJson` sorts keys, so the caller's key order never leaks into
  the identity; any statement change moves the id).
- No clock: `grantedAt` is caller-injected and validated (RFC3339,
  calendar-valid); the module never reads a clock. The timestamp is
  content — a different `grantedAt` mints a different id while the
  boundary verdict for the same target stays identical (the check is
  clock-free).
- No randomness, no network, no filesystem, no module-level mutable
  state, no hidden global state.
- The module never mutates its inputs.
- All error lists canonical (sorted, deduped where multiple).

## Honest scope notes

- **In-memory v0.1**: the session is a value this module mints and
  validates; persistence is a later, tech-lead-declared lane. Redaction
  is 071, isolation 072, audit 073, the readiness gate 074.
- The boundary validates the `sessionId`'s `authz_` **shape**, not its
  content-addressed consistency with the statement (recomputing the
  digest would cost an async hash; the boundary is synchronous and pure
  by contract — the id's integrity is the minting channel's guarantee).
- Runtime dependencies are exactly `@clapp/core` (`sha256Hex`) and
  `@clapp/observe` (`canonicalJson`); the statement shapes are fully
  local (no devDependencies in v0.1).

## §2 non-goals (verbatim, the product-language law)

`docs/SECURITY_AND_AUTHORIZATION.md` §2 — the product must NOT be
designed around:

- bypassing DRM
- bypassing platform attestation
- defeating authentication
- stealing credentials/session tokens
- disabling anti-tamper systems
- evading rate limits
- unauthorized access to private backends

When a target depends on a security control, CLAPP should report the
limitation and either use an authorized integration or mark the behavior
unreproducible. This module is the FIRST half of that posture: no
authorization statement, no observation.
