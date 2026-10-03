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

## Multi-tenant isolation (CLAPP-072)

The Phase-7 THIRD lane (the `docs/ROADMAP.md` P7 checkbox "tenancy",
`docs/WORK_ITEMS.md`: "CLAPP-072 — Multi-tenant isolation, Owner W3"):
the **tenant isolation zone** — the §6 data-domain separation, made
executable.

`docs/SECURITY_AND_AUTHORIZATION.md` §6 (Data isolation) reads:

> Separate:
> - user project data
> - target app evidence
> - generated code
> - package library
> - benchmark corpus
>
> Library promotion must never accidentally publish private project data.

This module IS that separation: `createTenantZone` mints a fail-closed
tenant zone — an in-memory store whose every datum lives under exactly
one of the five frozen §6 domains, inside exactly one tenant's zone
instance — and the zone's write path enforces the two §6 laws: domain
integrity (insert-only per (domain, key) pair) and the publish-leak
guard (the §6 acceptance law, executable).

### The contract

```
createTenantZone(tenantId)                  → { ok: true, zone } | { ok: false, errors[] }
zone.put(input, options)                    → Promise<{ ok: true, datum } | { ok: false, errors[] }>
zone.get(domain, key)                       → IsolatedDatum | null
zone.list(domain)                           → string[]
zone.counts()                               → Record<string, number>
zone.snapshot()                             → Promise<string>   // 'iso_' + 64 lowercase hex
```

- **The factory is fail-closed**: the `tenantId` must be a non-empty
  string — anything else (empty, null, a number, …) is a named error and
  no zone is minted; the call never throws. (A valid zone is
  `{ ok: true, zone }`, reading like the siblings'
  `AuthorizationSessionResult`.)
- **`put(input, options)`** — `input` = `{ domain, key, value }`
  (optionally `originDomain`); `options` = `{ storedAt }` (RFC3339,
  caller-injected per write). Fail-closed: ALL field errors are
  collected and named (the list canonicalized — sorted, deduped), and a
  rejected write stores nothing. The datum value must be
  canonical-JSON-serializable plain data — the write path refuses what
  the snapshot channel could never hash.
- **Queries never error**: `get` with a non-string domain/key, an empty
  key, or a miss is an honest `null`; `list` of a non-string or unknown
  domain is `[]`; `counts()` is MEASURED per domain (only non-empty
  domains listed, a fresh record every call).
- **Query-handle policy (the registry precedent)**: `put` and `get`
  return the STORED RECORD itself — an alias by construction; the stored
  VALUE is verbatim BY VALUE (a deep copy preserving every key and value
  exactly — the caller can never mutate a stored datum through the
  object they passed in). `list` and `counts` are the sealed fresh-copy
  channels.

### The five §6 domains (the frozen v0.1 vocabulary)

| domain             | the §6 class (verbatim)   |
| ------------------ | ------------------------- |
| `user-project`     | user project data         |
| `target-evidence`  | target app evidence       |
| `generated-code`   | generated code            |
| `package-library`  | the package library       |
| `benchmark-corpus` | the benchmark corpus      |

A datum may live in no other domain: an off-vocabulary domain is a named
error listing the frozen vocabulary.

### The immutability law (insert-only zone data)

The integrity unit is the **(domain, key) pair** — the registry's
`(id, version)` precedent: a datum may be written ONCE per pair. The
same key MAY live in several domains as separate, unrelated data (the
domain is part of the address; there is no cross-domain overwrite
channel — a write addressed to another domain never touches the first
domain's datum). A rewrite of an existing pair is refused, naming the
key and the domain:

- **a CHANGED rewrite** — a different value, or the same value under a
  different `storedAt` (the timestamp is content) — is the
  `immutable datum:` refusal;
- **an IDENTICAL rewrite** — same value AND same `storedAt` — is the
  `duplicate datum:` refusal (an idempotent no-op refused as a
  duplicate, the fail-closed memory precedent).

### The publish-leak guard (the §6 acceptance law, executable)

> Library promotion must never accidentally publish private project data.

The write input MAY carry an optional `originDomain: DataDomain` — the
domain the value came FROM. When it is present and differs from the
target `domain`, the write is REFUSED with the named error:

```
cross-domain publication refused: "user-project" data cannot enter the "package-library" domain
```

This makes the §6 law EXECUTABLE for the one case it names (private
project data never entering the library) and honestly GENERALIZES it to
every domain pair (`target-evidence` → `generated-code` is refused the
same way). A present `originDomain` EQUAL to the target domain is the
explicit same-origin assertion — the write proceeds. When `originDomain`
is ABSENT, the write also proceeds — **the caller asserts same-origin by
omission**, an honesty this module documents rather than hides: v0.1
cannot read a value's provenance off its bytes; the declaring caller IS
the provenance channel. A present-but-malformed `originDomain`
(non-string, off-vocabulary) fails closed with a named error.

### The tenant-zone model

The zone IS the tenant. `createTenantZone` validates the tenantId and
the minted instance holds its data in a closure-private store: separate
instances share NOTHING (no module-level state, no tenant-keyed
registry), so one tenant's data is invisible to another zone — even
another zone minted with the SAME tenantId string (the instance, not the
string, is the boundary). The tenantId is deliberately not retained
after validation: there is nothing to look the tenant up BY in a model
where the instance is the boundary.

### The `iso_` prefix proposal

The zone snapshot is content-addressed: `'iso_' + sha256Hex(
canonicalJson(the canonically-sorted [{ domain, key, valueDigest }]))`
where each `valueDigest = sha256Hex(canonicalJson(value))` — this lane's
frozen proposal in the house prefix discipline (`pkg_` / `cgraph_` /
`rq_` / `creg_` / `fail_` / `fmem_` / `rpat_` / `arch_` / `comp_` /
`bench_` / `authz_` / `redct_`). Shape: `iso_` + 64 lowercase hex chars
(`ISO_SNAPSHOT_PATTERN`). The values are HASHED — never serialized into
the id — so the snapshot is a leak-free fingerprint; the entries are
sorted by (domain, key) before hashing, so the writes' input order never
leaks; any change moves the snapshot. Changing the prefix changes every
zone snapshot id and requires a contract version bump.

### The determinism discipline

- Same writes in ANY order → the identical `iso_` snapshot (entries are
  canonically sorted before hashing); any change moves the snapshot.
- No clock: `storedAt` is caller-injected per write and validated
  (RFC3339, calendar-valid — 2026-02-30-style rollover dates are
  refused); the zone never reads a clock. The timestamp is content — a
  different `storedAt` is a different write.
- No randomness, no network, no filesystem, no module-level mutable
  state, no hidden global state.
- The module never mutates its inputs; stored values are VERBATIM (by
  value — a deep copy, never aliased to the caller's input).
- All error lists canonical (sorted, deduped where multiple).

### Honest scope notes

- **In-memory v0.1**: the zone is a closure-private store; persistence,
  cross-zone process isolation, and multi-process tenancy are later,
  tech-lead-declared lanes. The §4 sandbox budgets (filesystem
  boundaries, CPU/memory, process limits, network egress) are a
  DIFFERENT section's lane — this one separates the DATA domains.
- The write path validates value serializability precisely so
  `snapshot()` — whose frozen signature returns `Promise<string>` with
  no refusal branch — can never fail on a well-formed zone; the one
  documented way to violate that invariant is to mutate a stored record
  through the `get()` alias (the registry precedent's same trade-off,
  outside the contract).
- Audit (CLAPP-073) and the production readiness gate (CLAPP-074) are
  later lanes, not this one.
- Runtime dependencies are exactly `@clapp/core` (`sha256Hex`) and
  `@clapp/observe` (`canonicalJson`); the isolation shapes are fully
  local (no devDependencies in v0.1).

## Audit/cancellation/resume (CLAPP-073)

The Phase-7 FOURTH lane (the `docs/ROADMAP.md` P7 checkbox
"auditability", `docs/WORK_ITEMS.md`: "CLAPP-073 —
Audit/cancellation/resume, Owner W3"): the **audit trail** — the
production-hardening spine's RECORDING layer — plus the **honest
cancellation state machine**. The three security surfaces that landed
before this lane (the §1 boundary, the §3 redaction, the §6 isolation)
all ACT; this module RECORDS those actions and makes the long
operations they guard CANCELLABLE and RESUMABLE.

### The contract

```
createAuditTrail()                            → AuditTrail
trail.record(input, options)                  → Promise<{ ok: true, event } | { ok: false, errors[] }>
trail.list()                                  → AuditEvent[]           // canonical (id) order, defensively copied
trail.countsByKind()                          → Record<string, number> // MEASURED, only kinds that fired
trail.snapshot()                              → Promise<string>         // 'atrail_' + 64 lowercase hex
trail.registerOperation(input, options)       → Promise<OperationResult>
trail.cancel(operationId, options)            → Promise<OperationResult>
trail.resume(operationId, options)            → Promise<OperationResult>
trail.operation(operationId)                  → CancellableOperation | null
```

- **`record(input, options)`** — `input` = `{ kind, actor, subject,
  facts? }`; `options` = `{ recordedAt }` (RFC3339 calendar-valid,
  caller-injected). Fail-closed: the `kind` must be IN the frozen
  seven-kind vocabulary (an unknown kind is a named error listing the
  observed value), `actor`/`subject` non-empty strings, and `facts` —
  when present — a plain object of canonical-JSON-serializable MEASURED
  values (arrays are not facts objects; an ABSENT facts rides as `{}` —
  the event's non-optional slot, freshly minted per event). ALL errors
  are collected (each naming its field, the list canonicalized —
  sorted, deduped) and the call NEVER throws. Extra input keys are
  ignored (the isolation `put()` precedent — the event is constructed
  from the named fields).
- **The operation methods are ASYNC and return `OperationResult`** —
  the ok branch carries the `operation` record, with `event` present
  exactly when the transition moved the trail (cancel and resume record
  an event; registration does not — the seven-kind v0.1 vocabulary has
  no registration kind). The work order's earlier
  `AuditResult & { operation? }` sketch is superseded by its own
  binding prose (the CLAPP-072 `ZoneResult` precedent): the sketch's
  synchronous signatures cannot mint content-addressed event ids
  (WebCrypto `sha256Hex` is async by design), and the sketch's required
  `event` on every ok branch would force registration to fabricate an
  off-vocabulary event. The rule the resolution yields: every TRAIL
  MUTATION is async (it may mint an id); every query is synchronous
  except `snapshot` (which hashes).
- **`operation(operationId)`** — a query never errors: non-string,
  empty, or unknown → an honest `null`; a hit is the operation record.

### The seven-kind vocabulary (the frozen v0.1 audit action kinds)

The recorded action kinds — the security surfaces that exist:

| kind                   | the recorded action                                   |
| ---------------------- | ----------------------------------------------------- |
| `session-admitted`     | an authorization session was admitted                 |
| `observation-refused`  | the §1 boundary refused                               |
| `redaction-applied`    | sensitive fields were redacted (the count is a fact)  |
| `zone-write`           | a datum entered an isolation zone                     |
| `zone-refused`         | a zone write was refused                              |
| `operation-cancelled`  | a cancellable operation was cancelled                 |
| `operation-resumed`    | a cancelled operation was resumed                    |

An off-vocabulary kind is a named error listing the observed value and
the frozen vocabulary.

### The append-only law and the duplicate refusal

Once recorded, an event is NEVER rewritten, NEVER removed, and NEVER
re-recorded — the trail stores events verbatim (facts carried verbatim,
a deep copy preserving every key and value exactly), insert-only (the
fail-closed memory precedent, CLAPP-060). The event id is
content-addressed: `'audit_' +
sha256Hex(canonicalJson(event minus id))` — so the identical event
content (including `recordedAt`, because **the timestamp is content**)
re-recorded into the same trail mints the same id and is refused as the
`duplicate event:` (naming the already-recorded id); the same content
under a different `recordedAt` is a DISTINCT event, and both are
stored. Two separate trails may hold the same event content — the
duplicate law is per-trail (separate instances share NOTHING).

### The cancellation state machine (running → cancelled → resumed, the cycle)

`registerOperation({ operationId }, { registeredAt })` — the CALLER
supplies the non-empty operation id (the module never generates one —
determinism; there is no `oper_` prefix law in v0.1, the caller's
naming discipline is the boundary). A duplicate `operationId` is
refused (named, the existing record carried). The operation starts
`'running'`, `cancellationCount` 0, and records NO event.

- **`cancel(operationId, { cancelledAt })`** — legal from `'running'`
  OR `'resumed'`: state `'cancelled'`, `cancelledAt` set, the MEASURED
  `cancellationCount` +1, and an `operation-cancelled` event recorded
  (actor `'system'`, subject the operationId, facts
  `{ cancellationCount }` measured, `recordedAt` the cancelledAt) — the
  trail and the state machine move TOGETHER. Cancelling an
  already-cancelled operation is refused (`already cancelled:`, the
  state carried).
- **`resume(operationId, { resumedAt })`** — legal ONLY from
  `'cancelled'`: state `'resumed'`, `resumedAt` set, an
  `operation-resumed` event recorded (the count STANDS on resume —
  resume measures nothing new). A running operation is refused
  (`not cancelled:`); a resumed one is refused (`already resumed:`);
  both carry the state.
- **The cycle continues**: a resumed operation may be cancelled again
  (and again) — each cancellation bumps the measured count. The
  single-slot `cancelledAt`/`resumedAt` fields carry the LATEST
  transition's timestamp; `cancellationCount` is the cumulative
  MEASURED total — the honest v0.1 record of a cycling operation.
- **Atomicity**: a legal cancel or resume mints its event (duplicate
  check included) BEFORE mutating the operation record — a transition
  whose event would collide with an already-recorded identical event
  is refused WHOLE (neither the state nor the trail moves).

`registeredAt` is validated (the caller-injected-clock law holds at
every mutation) and then deliberately NOT retained: the frozen v0.1
`CancellableOperation` shape carries no registration slot, and
retaining an unobservable timestamp would be unverifiable decoration.

### The caller-injected-clock law

`recordedAt`, `registeredAt`, `cancelledAt`, and `resumedAt` are
CALLER-injected and validated (RFC3339, calendar-valid —
2026-02-30-style rollover dates are refused); the trail never reads a
clock (there is no clock to read). The timestamp is content: a
different `recordedAt` is a different event, and a state-machine
transition's caller-injected timestamp IS its event's `recordedAt`.

### The prefixes

The event id and the trail snapshot are content-addressed — this lane's
two frozen proposals in the house prefix discipline (`pkg_` / `cgraph_`
/ `rq_` / `creg_` / `fail_` / `fmem_` / `rpat_` / `arch_` / `comp_` /
`bench_` / `authz_` / `redct_` / `iso_`):

- **`audit_`** — `'audit_' + sha256Hex(canonicalJson(event minus id))`**
  + 64 lowercase hex chars (`AUDIT_EVENT_ID_PATTERN`, module-level).
- **`atrail_`** — `'atrail_' +
  sha256Hex(canonicalJson(the canonically-sorted events))`** + 64
  lowercase hex chars (`ATRAIL_SNAPSHOT_PATTERN`, module-level). The
  events are sorted by id before hashing, so the same events recorded
  in ANY order produce the identical snapshot and any change (any new
  event) moves it; the empty trail hashes the empty array — a valid
  digest.

Changing either prefix changes every minted id and requires a contract
version bump.

### The determinism discipline

- Same events + operations in ANY order → the identical `atrail_`
  snapshot (the events are canonically sorted by id before hashing).
- No clock, no randomness, no network, no filesystem, no module-level
  mutable state, no hidden global state; separate `createAuditTrail()`
  instances share NOTHING.
- The module never mutates its inputs; events are stored VERBATIM
  (facts carried verbatim, never normalized).
- **The trail is SEALED** (a deliberate strengthening over the registry
  alias precedent): every event and every operation record handed to
  the caller — from `record`, `cancel`, `resume`,
  `registerOperation`, `list`, and `operation` — is a FRESH DEEP COPY.
  There is no alias channel at all: no caller can silently rewrite an
  audit record (the audit law — immutable once recorded). This is also
  why `snapshot()` can never fail on a well-formed trail: every stored
  event was validated canonical-serializable at record time, and no
  documented mutation channel exists.
- All error lists canonical (sorted, deduped where multiple).

### Honest scope notes

- **In-memory v0.1**: the trail is a closure-private store; persistence,
  tamper-evident external storage, and retention policy are later,
  tech-lead-declared scope. The production readiness gate (CLAPP-074)
  is the tech lead's lane and depends on this one.
- The audit vocabulary records the security surfaces THAT EXIST; when
  later surfaces land (resource budgets, native adapters), their kinds
  arrive via a contract version bump, never a quiet widening.
- Runtime dependencies are exactly `@clapp/core` (`sha256Hex`) and
  `@clapp/observe` (`canonicalJson`); the audit shapes are fully local
  (no devDependencies in v0.1).

## Production readiness gate (CLAPP-074)

P7's closing lane — owned and implemented by the **tech lead**: readiness
is a JUDGMENT over measured facts (the promotion-gate pattern applied to
production). `evaluateReadiness(evidence, options)` weighs the four landed
surfaces' measured evidence against the frozen v0.1 check table — the
gate never inspects implementations and never re-measures; it weighs the
caller's own numbers:

| # | surface | requirement (frozen v0.1) |
|---|---|---|
| 1 | authorization | sessionsAdmitted >= 1 (the boundary admits) |
| 2 | authorization | observationRefusals >= 1 (the fail-closed path PROVEN exercised) |
| 3 | redaction | fieldsRedacted >= 1 (the engine redacts) |
| 4 | redaction | rawSecretLeaks === 0 — **absolute**: any measured leak is not-ready regardless of everything else |
| 5 | isolation | zoneWrites >= 1 (zones store) |
| 6 | isolation | crossOriginRefusals >= 1 (the publish-leak guard PROVEN exercised) |
| 7 | audit | eventsRecorded >= 1 (the trail records) |
| 8 | audit | cancellationCycles >= 1 (cancel/resume PROVEN exercised) |

ALL eight met → `'ready'`; ANY unmet → `'not-ready'` with every unmet
check named and its measured value carried. Evidence-shape failures
(non-objects, negative or non-integer counts, a non-RFC3339 evaluatedAt)
are collected, named errors — results, never exceptions. The report is
content-addressed (`'ready_'` + sha256Hex over the canonical report minus
its id — this lane's frozen prefix proposal); `evaluatedAt` is
caller-injected (calendar-valid; a different timestamp moves the id, the
weighed checks stay byte-identical — the clock-free proof). Deterministic:
same evidence + options → deep-equal report.
