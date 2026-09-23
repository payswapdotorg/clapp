# Behavioral IR v0.1

Behavioral IR is CLAPP's canonical intermediate representation. It is intentionally independent of any implementation framework.

## 1. Design principles

1. Evidence and inference are separate.
2. Observed facts are immutable.
3. Every inferred property links to evidence.
4. Unknown is a valid value.
5. Implementations can differ while behavior remains comparable.
6. The IR must support web and future native adapters.
7. The IR must be serializable, diffable, and versioned.

## 2. Top-level shape

```yaml
modelVersion: 0.1
application:
  id:
  name:
  platform:
  entrypoints: []
environment:
  browser:
  os:
  viewport:
  locale:
  timezone:
  network:
evidence:
  - id:
    kind: dom|runtime|network|storage|screenshot|static|user
    source:
    hash:
    confidence:
journeys:
  - id:
    purpose:
    preconditions: []
    steps: []
screens:
  - id:
    route:
    treeRef:
    visualRef:
components:
  - id:
    role:
    properties: {}
    events: []
state:
  variables: []
  transitions: []
data:
  entities: []
  persistence: []
api:
  operations: []
integrations:
  - id:
    capability:
    status: observed|inferred|mocked|unreproducible
assumptions:
  - id:
    statement:
    confidence:
    evidenceRefs: []
constraints: []
```

## 3. Evidence levels

- OBSERVED — directly captured.
- DERIVED — deterministic transformation of observations.
- INFERRED — hypothesis supported by observations.
- ASSUMED — synthesis choice not established by evidence.
- UNAVAILABLE — behavior could not be observed.

These labels must survive into reports and verification.

## 4. State machine representation

Every meaningful interaction should become a candidate transition:

```
state_before
  + action
  + input
  + environment
      ↓
state_after
  + outputs
  + side_effects
```

Examples:
- click
- type
- submit
- drag
- scroll
- navigate
- upload
- download
- timer
- background event
- API response
- WebSocket message

## 5. API model

Each operation records:

- transport
- method
- URL pattern
- headers needed
- request schema
- response schema
- error schema
- auth dependency
- observed examples
- replayability
- external side effects

Do not claim an API's server-side internals when only its external contract was observed.

## 6. Visual model

Store semantic UI structure plus visual evidence.

Preferred comparison hierarchy:
1. semantic/accessibility structure
2. visible text
3. geometric relationships
4. screenshots/pixels

Pure pixel equality should not be the only parity criterion because dynamic content, fonts, rendering engines, and remote data can vary.

## 7. Uncertainty

Every requirement can carry:

```yaml
confidence:
  value: 0..1
  rationale:
  evidenceRefs: []
```

A synthesis agent must not silently convert low-confidence inference into a high-confidence implementation requirement.

## 8. Compatibility

The IR is versioned. Adapters must declare:
- supported IR versions
- emitted capabilities
- unsupported constructs
- degradation behavior
