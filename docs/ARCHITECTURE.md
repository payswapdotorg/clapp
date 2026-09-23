# CLAPP Architecture

## 1. System overview

```
                         ┌─────────────────────────┐
                         │       CLAPP UI          │
                         │ intake / progress /     │
                         │ parity / library        │
                         └────────────┬────────────┘
                                      │
                         ┌────────────▼────────────┐
                         │     Orchestrator        │
                         │ run planning / budgets  │
                         │ worker coordination     │
                         └───────┬────────┬────────┘
                                 │        │
              ┌──────────────────┘        └──────────────────┐
              ▼                                               ▼
       ┌───────────────┐                              ┌────────────────┐
       │ Observation   │                              │ Synthesis       │
       │ Plane         │                              │ Plane           │
       ├───────────────┤                              ├────────────────┤
       │ browser       │                              │ planner         │
       │ static        │                              │ package retriever│
       │ runtime       │                              │ codegen         │
       │ network       │                              │ repair agent     │
       │ storage       │                              │ build/packaging  │
       └───────┬───────┘                              └───────┬────────┘
               │                                              │
               └─────────────────┬────────────────────────────┘
                                 ▼
                       ┌────────────────────┐
                       │  Behavioral IR     │
                       │ evidence + model   │
                       └─────────┬──────────┘
                                 │
                 ┌───────────────┼────────────────┐
                 ▼               ▼                ▼
          ┌────────────┐  ┌──────────────┐  ┌─────────────┐
          │ Differential│  │ Package       │  │ Evaluation  │
          │ verifier    │  │ Library       │  │ + Learning  │
          └──────┬─────┘  └──────┬───────┘  └──────┬──────┘
                 │               │                  │
                 └───────────────┴──────────────────┘
                                 │
                                 ▼
                         Verified knowledge
```

## 2. Core planes

### Observation Plane

Produces immutable evidence rather than conclusions.

Artifacts:
- DOM snapshots
- accessibility trees
- screenshots
- interaction traces
- request/response records
- WebSocket frames where authorized
- runtime values
- console/errors
- storage metadata
- static asset inventory
- source maps where available
- timing and environment metadata

Every observation has:
- source
- timestamp
- execution context
- confidence
- redaction status
- provenance hash

### Behavioral Modeling Plane

Converts evidence into the Behavioral IR.

The model contains:
- pages/screens
- components
- actions
- states
- transitions
- data entities
- API operations
- persistence
- side effects
- permissions
- uncertainty
- assumptions
- evidence links

### Synthesis Plane

Produces an implementation from the IR.

Pipeline:
```
IR
 ↓
architecture plan
 ↓
package retrieval
 ↓
composition plan
 ↓
code generation
 ↓
build
 ↓
generated tests
 ↓
execution
```

### Differential Verification Plane

Runs equivalent journeys against reference and candidate.

Comparison dimensions:
- journey success
- visible text
- accessibility structure
- screenshot/layout
- navigation
- state transition
- network contract
- persistence behavior
- errors
- timing envelopes where relevant

Failures become repair tasks.

### Learning Plane

Mines successful runs for reusable abstractions.

```
successful implementation
      ↓
candidate package extraction
      ↓
generalization
      ↓
standalone tests
      ↓
cross-project replay
      ↓
package promotion
```

## 3. Web adapter

### Capture modes

1. Public URL.
2. Authorized interactive session.
3. Local build/static artifact.
4. Test environment URL.
5. Source repository/export supplied by the user.

The system must never require the user to paste passwords or bypass security controls. Authenticated capture should use a user-controlled browser/session mechanism.

### Browser instrumentation

Use:
- Playwright for deterministic browser automation and network interception.
- Chrome DevTools Protocol where lower-level runtime/DOM/network signals are required.
- Service-worker-aware capture.
- Screenshot and accessibility snapshots.
- HAR/network recording when appropriate.

### Web artifact inventory

```
origin
routes
HTML
CSS
JS
images/fonts/media
source maps
service workers
workers
API calls
WebSockets
cookies
localStorage
sessionStorage
IndexedDB
Cache Storage
forms
dialogs
navigation
errors
```

## 4. Orchestrator

The orchestrator owns:
- run IDs
- budgets
- task graph
- worker leases
- retries
- artifacts
- dependency ordering
- acceptance gates
- package promotion gates

Workers should operate through explicit contracts, not shared mutable assumptions.

## 5. Storage model

Logical stores:

- `runs`
- `evidence`
- `behavior_models`
- `journeys`
- `implementations`
- `verification_runs`
- `failures`
- `packages`
- `package_versions`
- `package_tests`
- `learning_records`

A relational database is appropriate for metadata; object storage is appropriate for traces, screenshots, HAR files, and larger artifacts.

## 6. Trust boundaries

Untrusted:
- target app content
- target network responses
- generated code
- package candidates
- user-provided artifacts

Trusted:
- orchestration state
- policy engine
- authorization decision
- immutable provenance metadata
- promotion gates

Generated applications execute in isolated sandboxes.
