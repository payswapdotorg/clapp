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

## Secret redaction (CLAPP-071)

The Phase-7 SECOND lane (the `docs/ROADMAP.md` P7 checkbox
"secrets/redaction", `docs/WORK_ITEMS.md`: "CLAPP-071 — Secret redaction,
Owner W2"): the **secret redaction** engine for durable evidence — the §3
secret-handling default behavior, made executable.

`docs/SECURITY_AND_AUTHORIZATION.md` §3 (Secret handling) reads:

> The observation pipeline must classify sensitive fields:
> - cookies
> - Authorization headers
> - bearer tokens
> - API keys
> - passwords
> - private user data
>
> Default behavior:
> - redact from durable evidence
> - keep only short-lived in-memory references where required
> - make redaction visible in provenance
> - never train package retrieval directly on raw secrets

This module IS that default behavior for durable evidence:
`redactSensitiveFields` walks an evidence-shaped object (never mutating
it), replaces every field whose NAME classifies into the frozen six-kind
§3 vocabulary with a visible NON-REVERSIBLE marker, and returns the
`RedactionReport` that makes the redaction visible in provenance.

### The contract

```
classifyFieldName(name)        → SensitiveKind | null   (synchronous, pure)
redactSensitiveFields(input)   → Promise<{ ok: true, report } | { ok: false, errors[] }>
```

- **Fail-closed, never an exception for ANY input**: a root that is
  `null`, `undefined`, or a primitive (`input: expected an object or array
  to walk, got …` — a scalar holds no fields to redact and the report
  contract demands a walkable root), a CYCLIC input (detected via an
  ancestry WeakSet and refused with a named `cyclic reference detected`
  error — no infinite loop, no crash; the honest v0.1 limitation: cycles
  are refused, not walked), an unfingerprintable value (e.g. a Symbol),
  or a non-canonical-JSON-serializable input each refuse with the defect
  NAMED. The error list is canonicalized (sorted, deduped).
- **Walk semantics (v0.1, binding)**: a classified field whose value is a
  scalar (or an opaque non-plain object) is replaced by its marker; a
  walkable container (a plain object or an array, classified or not) is
  always DESCENDED INTO, and its inner fields classify by their own names
  — that is how `cookies: [{ sessionToken }]` yields the entry
  `cookies[0].sessionToken` (kind `bearer-token`) rather than one
  wholesale `cookies` marker. Honest limits, stated: unnamed primitives
  under a classified container name (`cookies: ['sid=1']`) ride verbatim,
  and an off-vocabulary inner name (`cookies[0].value`) rides verbatim —
  the frozen vocabulary decides everything, field name by field name.
- **The input is NEVER mutated**: the walk only reads it;
  `report.redacted` is a fresh deep copy with the markers in place —
  non-sensitive values ride verbatim (plain objects and arrays are
  deep-copied; opaque objects ride by reference; shared non-cyclic
  references are copied independently — aliasing is not preserved).
- **`report.entries`**: one `RedactionEntry` per redacted field, in
  canonical order (sorted by path) — paths dot-joined with array indexes
  bracketed (`headers.authorization`, `cookies[0].sessionToken`,
  `user.email`). Honest limit: a field name that itself contains `.` or
  brackets produces an ambiguous path string.
- **`report.countsByKind`** is MEASURED from the entries — only kinds
  that fired.
- **The digests are MEASURED**: `originalDigest` =
  `sha256Hex(canonicalJson(input))` (the pre-redaction digest, for
  provenance comparison); `redactedDigest` =
  `sha256Hex(canonicalJson(redacted))`. They differ whenever anything was
  redacted; a nothing-sensitive input yields the honest no-op report —
  empty entries, `{}` counts, EQUAL digests.
- **`report.id`** is content-addressed: `'redct_' +
  sha256Hex(canonicalJson(report minus its id))` — any input change moves
  it.

### The six §3 classes (the frozen vocabulary, the rule table — ORDER MATTERS)

`classifyFieldName` matches a field NAME case-insensitively against this
exact table, top to bottom, **first match wins**:

| # | kind                   | the name …                                                                    |
| - | ---------------------- | ----------------------------------------------------------------------------- |
| 1 | `cookie`               | IS `cookie`/`cookies`, or ends with `cookie`/`cookies`                        |
| 2 | `authorization-header` | IS `authorization` or `authorization-header`                                  |
| 3 | `bearer-token`         | IS `token`/`bearer`/`bearer-token`/`access-token`, or ends with `token`       |
| 4 | `api-key`              | IS `key`/`apikey`/`api-key`, or ends with `key`/`apikey`                      |
| 5 | `password`             | IS `password`/`pass`, or ends with `password`                                 |
| 6 | `private-user-data`    | IS `email`/`phone`/`ssn`/`address`/`birthdate`, or ends with `email`/`phone`  |

The ORDER is binding: `secretKey` ends with `key` → `api-key` — it never
reaches the `password` rule (`passwordKey` is likewise `api-key`).
Suffix matches are literal: a name such as `monkey` ends with `key` and
classifies `api-key` — the frozen table's behavior, not a judgment.
Everything else — `value`, `name`, `route`, `title`, … — returns `null`:
NOT sensitive in v0.1. **The classifier never guesses; a miss is a miss,
honestly.**

### The marker and the non-reversible fingerprint

A redacted value is replaced by the visible marker

```
REDACTED:<kind>:<fingerprint8>
```

where `fingerprint8 = sha256Hex(String(value)).slice(0, 8)` — a sha256
prefix. The fingerprint NEVER allows recovery of the value, and it exists
so the redaction is **visible and distinguishable in provenance**: two
different secrets produce different fingerprints with overwhelming
probability. The value's own content is dropped — it appears nowhere in
the report. Markers are strings; the walk does not recurse into them.

Honesty note, stated plainly: an 8-hex-char (32-bit) digest prefix is
brute-forceable offline for low-entropy values (short passwords); two
distinct object values share `String()`'s default `'[object Object]'`
form; and `report.originalDigest` is a digest of the full original —
one-way, but equally checkable against guesses. Treat every marker and
digest as sensitive-adjacent in durable evidence.

### The `redct_` prefix proposal

The report id is content-addressed: `'redct_' +
sha256Hex(canonicalJson(report minus its id))` — this lane's frozen
proposal in the house prefix discipline (`pkg_` / `cgraph_` / `rq_` /
`creg_` / `fail_` / `fmem_` / `rpat_` / `arch_` / `comp_` / `bench_` /
`authz_`). Shape: `redct_` + 64 lowercase hex chars. Changing the prefix
changes every minted report id and requires a contract version bump.

### The determinism discipline

- Same input → deep-equal report, identical `redct_` id, identical
  fingerprints (`canonicalJson` sorts keys, so the caller's key order
  never leaks into the identity; any input change moves the id).
- No clock, no randomness, no network, no filesystem, no module-level
  mutable state, no hidden global state.
- The module never mutates its inputs.
- All error lists canonical (sorted, deduped where multiple).
