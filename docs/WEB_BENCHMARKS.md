# Web Benchmark Corpus

The benchmark corpus is critical because CLAPP learns through repeated parity measurement.

## Benchmark categories

### B01 — Static marketing site
Tests:
- navigation
- responsive layout
- forms
- links
- media/assets

### B02 — CRUD SaaS dashboard
Tests:
- authentication stub
- list/detail/create/edit/delete
- filters
- pagination
- validation
- optimistic state

### B03 — Rich editor
Tests:
- keyboard interactions
- selection
- undo/redo
- autosave
- local state

### B04 — Realtime app
Tests:
- WebSockets
- reconnect
- presence
- streaming updates
- optimistic UI

### B05 — PWA/offline app
Tests:
- service worker
- cache
- offline startup
- IndexedDB
- sync/reconciliation

### B06 — File application
Tests:
- uploads/downloads
- progress
- validation
- object storage adapter

### B07 — API-heavy application
Tests:
- multiple resources
- pagination
- errors
- retries
- rate/timeout behavior

### B08 — SSR/hybrid application
Tests:
- initial server-rendered state
- hydration
- navigation
- mutations

### B09 — Authentication-heavy app
Tests:
- login
- logout
- session expiry
- authorization boundaries
- role-based UI

### B10 — Complex product surface
Tests:
- multiple modules
- cross-module state
- background jobs
- notifications
- search

## Corpus requirements

Each benchmark must provide:
- deterministic seed data
- reference app version
- authorized execution mode
- canonical journeys
- expected semantic outcomes
- allowed nondeterminism
- known limitations
- reset mechanism
- environment descriptor

## Scoring

Track at minimum:
- journey pass rate
- semantic parity rate
- visual mismatch rate
- API contract parity
- state/storage parity
- number of repair iterations
- wall-clock build time
- token/compute cost
- package reuse rate
- novel code generated
- regression count

Do not collapse these into one opaque score. Preserve dimensions so failures remain diagnosable.
