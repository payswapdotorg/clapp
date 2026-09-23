# Product and Feasibility

## 1. Product thesis

The durable product is not an AI decompiler. It is a **behavioral reconstruction and application synthesis system**.

A useful abstraction is:

```
Target App
  ├─ static/source artifacts where available
  ├─ runtime observations
  ├─ UI structure
  ├─ network/API behavior
  ├─ client state/storage
  ├─ service workers/workers
  └─ generated test journeys
          ↓
   Behavioral Application Model
          ↓
   Package retrieval + code synthesis
          ↓
   Independent implementation
          ↓
   Differential verification
          ↓
      repair loop
```

For web applications, the platform has unusually strong observability. Playwright can monitor and modify HTTP/HTTPS traffic, mock APIs, record HAR files, inspect WebSockets, and drive browser interactions. Chrome DevTools Protocol exposes page, DOM, runtime and network domains. Browser-exposed storage can include IndexedDB, Cache API and Web Storage; service workers can intercept and modify fetches. These make web applications an excellent first platform for application archaeology and parity testing.

Sources:
- https://playwright.dev/docs/network
- https://playwright.dev/docs/mock
- https://chromedevtools.github.io/devtools-protocol/tot/DOM/
- https://chromedevtools.github.io/devtools-protocol/tot/Network/
- https://chromedevtools.github.io/devtools-protocol/tot/Runtime/
- https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API
- https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API
- https://developer.mozilla.org/en-US/docs/Glossary/Source_map

## 2. Why web is substantially easier than native platforms

A web application runs inside an instrumentable browser. A reconstruction system can directly observe:

- DOM and accessibility structure.
- URL and navigation transitions.
- visible text and controls.
- screenshots and layout geometry.
- JavaScript runtime state where permitted.
- network requests/responses.
- WebSockets.
- cookies and browser storage within an authorized test context.
- service-worker behavior.
- static resources.
- source maps when published.
- console/errors and timing signals.
- user interaction outcomes.

A native application can hide equivalent behavior behind binaries, OS entitlements, drivers, private frameworks, hardware interfaces, signing, attestation, and platform-specific security boundaries.

Therefore web should be the first production-grade adapter.

## 3. The correct promise

Do not promise:

> Clone any app perfectly.

Promise a measurable contract:

> Given an application and an authorized execution context, CLAPP reconstructs observable behavior and synthesizes an independently implemented replacement, with an automatically generated parity suite and an explicit report of what was observed, inferred, reproduced, mocked, or not reproducible.

This makes uncertainty a product feature rather than a hidden failure.

## 4. Web feasibility tiers

### Tier W0 — static/site reconstruction

Input: URL or saved build.

Can reproduce:
- pages
- assets
- routes
- layout
- typography
- basic interactions

Feasibility: very high.

### Tier W1 — client-side application reconstruction

Input: SPA/PWA plus journeys.

Can reproduce:
- state transitions
- forms
- client validation
- local storage
- IndexedDB-backed flows
- routing
- asynchronous UI states
- optimistic updates

Feasibility: high.

### Tier W2 — API-backed application reconstruction

Observe authorized API traffic and infer contracts.

Can reproduce:
- frontend
- API contract
- local replacement backend
- deterministic fixtures
- selected live integrations

Feasibility: high where backend behavior is observable or can be replaced.

### Tier W3 — production SaaS behavior

Dependencies include:
- private backend logic
- payments
- proprietary third-party APIs
- anti-automation
- identity/attestation
- hidden business rules
- feature flags
- operator workflows

CLAPP can reproduce the observable contract, but cannot infer unobserved server-side truth. Some external services must be mocked, substituted, or integrated through legitimate APIs.

Feasibility: medium.

### Tier W4 — arbitrary web system with inaccessible server truth

If critical behavior is exclusively server-side and cannot be legitimately observed, the product cannot guarantee equivalent internal implementation.

Feasibility: inherently bounded.

## 5. Platform strategy

| Platform | First-class target? | Why |
|---|---|---|
| Web | Yes, Phase 1 | Highest observability and fastest parity loop |
| Android | Yes, Phase 2+ | Strong package/runtime observability; emulator/device automation |
| Linux | Yes, Phase 2+ | High process/system observability |
| Windows | Yes, Phase 3+ | Large commercial migration opportunity, heterogeneous stack |
| macOS | Yes, Phase 3+ | Strong opportunity but security/signing constraints |
| iOS | Yes, research/controlled first | Highest platform restrictions; require constrained claims |

Native adapters must reuse the same Behavioral IR and verification engine.

## 6. Compounding advantage

The moat should be a verified library of:

- UI patterns
- workflow implementations
- state machines
- API adapters
- auth patterns
- data models
- storage modules
- background-job patterns
- deployment recipes
- testing strategies
- platform adapters
- repair patterns
- known failure modes

Each library item needs executable tests and provenance. A package is promoted only after it demonstrates successful reuse or strong standalone verification.

## 7. Business modes

CLAPP can expose one engine through multiple products:

1. **Migration** — modernize legacy software.
2. **Compatibility** — create independently implemented equivalents.
3. **Parity QA** — continuously test an implementation against a reference.
4. **Reconstruction** — recover architecture/behavior documentation from running software.
5. **Application synthesis** — generate new applications by composing proven packages.

The shared engine is more valuable than a single “cloner” UI.
