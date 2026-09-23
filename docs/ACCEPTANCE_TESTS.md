# Acceptance Tests

## A. Foundation

### A1 Fresh checkout
A clean environment can install dependencies and run:
- unit tests
- type checks
- lint
- integration tests

### A2 Artifact provenance
Every run has:
- run ID
- target ID
- environment record
- artifact hashes
- timestamps
- source/evidence classification

## B. Web observation

### B1 UI discovery
Given a benchmark app, CLAPP discovers:
- routes reached by exploration
- major interactive elements
- visible text
- accessibility structure

### B2 Network discovery
Given a benchmark workflow, CLAPP records:
- relevant HTTP requests/responses
- status codes
- request/response bodies where authorized
- WebSocket activity where applicable

### B3 Storage discovery
Given a benchmark app using local persistence, CLAPP detects relevant:
- cookies
- local/session storage
- IndexedDB
- Cache API/service-worker artifacts where accessible

### B4 Replay
A recorded journey can be replayed without manually rewriting selectors.

## C. Behavioral IR

### C1 Evidence linkage
Every inferred route, transition, API operation and persistence rule references evidence.

### C2 Unknown preservation
When the system cannot infer a fact, the IR marks it unknown/unavailable rather than inventing it.

### C3 Serialization
The same IR can be validated, diffed and loaded in a clean environment.

## D. Synthesis

### D1 Build
Generated application builds from clean checkout.

### D2 Run
Generated application starts through the standard runtime interface.

### D3 Journey coverage
Generated tests exercise all benchmark journeys selected for the run.

## E. Differential parity

### E1 Journey parity
For selected journeys, compare reference and candidate outcomes.

### E2 Semantic parity
Compare:
- route
- visible text
- accessible names/roles
- expected state
- errors

### E3 Visual parity
Produce deterministic screenshots and structured visual diff reports.

### E4 API parity
Compare normalized request/response contracts, excluding intentionally substituted endpoints.

### E5 Repair
A mismatch produces a machine-readable repair task.

### E6 Regression
A repaired candidate must not regress previously passing journeys.

## F. Package system

### F1 Candidate extraction
A successful reusable pattern can be converted into a package candidate.

### F2 Package verification
Package candidate has tests and metadata.

### F3 Reuse
An independently generated app can consume a promoted package.

### F4 Promotion
A package cannot become promoted without passing promotion gates.

### F5 Versioning
Replacing a package creates a new immutable version.

## G. Continuous learning

### G1 Failure memory
Failure signatures are stored and retrievable.

### G2 Repair reuse
A known repair pattern can be retrieved for a new matching failure.

### G3 Build improvement
On a repeated application archetype benchmark, later runs demonstrate lower work or fewer repairs than earlier runs.

## H. Security

### H1 Authorization boundary
A run cannot start unless the target scope has an explicit authorization record or is a CLAPP-owned benchmark.

### H2 Secret handling
Credentials are never persisted as raw observation artifacts.

### H3 Sandbox
Generated/untrusted application code runs in an isolated environment.

### H4 Network policy
Outbound network access is explicitly controlled.

### H5 Package trust
Only packages passing provenance and security gates can be automatically composed.

## Release gate

A phase is complete only when:
- acceptance tests pass,
- documentation matches implementation,
- worker handoff is reconciled,
- no known critical security regression exists,
- and a clean checkout reproduces the validation.
