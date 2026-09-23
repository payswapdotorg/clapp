# Continuous Learning and Package Library

## 1. Goal

CLAPP should get cheaper and better at building software over time.

The learning system is therefore not merely model fine-tuning. Its primary durable memory is a **verified, executable application component library** plus structured evidence about when components work.

## 2. Compounding loop

```
Build
  ↓
Verify
  ↓
Detect repeated implementation pattern
  ↓
Extract package candidate
  ↓
Generalize interface
  ↓
Generate independent tests
  ↓
Replay across prior projects
  ↓
Promote if stable
  ↓
Index for retrieval
  ↓
Compose into future applications
```

## 3. Package taxonomy

### Foundation
- routing
- state management
- validation
- forms
- tables
- dialogs
- notifications
- search
- pagination
- file uploads
- authentication UI

### Product behavior
- CRUD workflows
- onboarding
- account settings
- dashboards
- billing flows
- admin panels
- messaging
- notifications
- content feeds
- collaboration
- scheduling

### Data/backend
- Postgres access
- object storage
- queues
- caching
- webhooks
- event logs
- search indexes
- audit trails

### Platform
- PWA
- offline mode
- service workers
- OAuth
- WebSockets
- browser storage
- background jobs
- deployment adapters

### Verification
- journey generators
- visual assertions
- accessibility assertions
- API contract tests
- state-machine tests
- fixture builders

## 4. Package contract

Every package must include:

```yaml
package:
  id:
  version:
  category:
  purpose:
  interface:
  capabilities: []
  constraints: []
  dependencies: []
  supportedTargets: []
  provenance:
  evidence:
  tests:
  benchmark:
  examples:
  failureModes:
  generatedAt:
```

A package is not just code. It is code + interface + tests + evidence + compatibility metadata.

## 5. Promotion stages

### Candidate

Extracted from one successful build.

### Verified

Passes package-local tests and static/security checks.

### Replayed

Successfully reused in at least one independent task.

### Stable

Passes a cross-project regression corpus.

### Preferred

Frequently selected with high success and low repair cost.

The library must never silently overwrite a package. Publish immutable versions and deprecate explicitly.

## 6. Package retrieval

Retrieval uses multiple signals:

```
semantic similarity
+ capability match
+ target compatibility
+ dependency compatibility
+ parity history
+ repair cost
+ recency
```

The orchestrator should retrieve several candidates, then select through constraint checking and benchmarked evidence.

## 7. Learning from failures

Failures are first-class knowledge.

Record:
- failing package/version
- target/context
- error signature
- expected behavior
- actual behavior
- successful repair
- whether repair generalized

A repeated failure should produce a reusable guard, test, or package correction.

## 8. Preventing library contamination

A generated artifact is not promoted simply because one test passed.

Promotion requires:
- provenance
- deterministic packaging
- reproducible tests
- dependency lock
- security scan
- license/provenance metadata
- regression evidence

## 9. Future model improvement

The system may later use successful trajectories for:
- retrieval optimization
- planner tuning
- code-generation exemplars
- repair-policy learning
- test-generation learning

Model adaptation is secondary to the executable library because verified packages can be inspected, versioned, reverted, benchmarked, and reused deterministically.

## 10. Target end state

A future build should increasingly look like:

```
new app
  ↓
identify archetype
  ↓
retrieve 70–95% of required architecture/components
  ↓
compose
  ↓
fill target-specific gaps
  ↓
verify
```

The exact percentages are aspirational engineering targets, not acceptance guarantees.
