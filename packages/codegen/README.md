# @clapp/codegen — package-aware codegen + mock backend (CLAPP-031)

Renders a **SynthesisPlan** (synthesis-contract v0.1 **mirror** in
`src/synthesis-contract.ts`; canonical owner `@clapp/plan`, CLAPP-030 —
re-exported from the public surface) into a **complete, runnable candidate
web app**: a zero-dependency (node/bun stdlib HTTP) server serving
server-rendered HTML pages with preserved testids/roles/accessible
names/forms, plus a mock backend serving the plan's api endpoints —
emitted as a well-formed file tree that also auto-joins a bun workspace
when materialized under `packages/*`.

## Public surface

```ts
import {
  generateApp, writeApp, CODEGEN_ADAPTER_INFO,
  renderPageHtml, resolveStorage, buildApiTable, selectApiRoute,
} from '@clapp/codegen';
export * from './synthesis-contract'; // the byte-identical mirror

const app = generateApp(plan, { port?: number });
// → { files: GeneratedFile[]; manifest: AppManifest }
const root = await writeApp(app, dir); // materialize (idempotent)
```

- `generateApp(plan, opts?)` — deterministic render of the whole app
  (same plan + options → byte-identical file tree).
- `writeApp(app, dir)` — materializes the tree (mkdir -p semantics,
  overwrite), returns the absolute root.
- `CODEGEN_ADAPTER_INFO` — the IrAdapterInfo-shaped honesty summary
  (emitted capabilities, unsupported constructs, degradation behavior).
- `renderPageHtml` / `resolveStorage` / `buildApiTable` / `selectApiRoute`
  — the render/storage/mock subsystems, exported for direct testing and
  P4 consumers.

## The generated tree

```
package.json          zero-dependency app package (type: module, scripts.start)
server.ts             zero-dep node:http server (pages + mocks + storage)
pages/<slug>.html.ts  one pre-rendered HTML module per planned route
README.md             generated documentation incl. honest limitations
```

Server semantics (all documented in the generated header + README):

- Listens on `127.0.0.1` at the planned port; **PORT env var overrides**
  (`PORT=0` → ephemeral; the actual port is printed as one JSON line
  `{ url, port }` once listening — that is how test harnesses find it).
- Serves `healthPath` with 200 (the page when the health path is a route,
  else `ok`); serves every planned route path with its page HTML
  (GET/HEAD + POST for same-origin form submissions; query strings
  ignored); 404s unknown paths with a `data-testid="not-found"` page.
- Mock backend: `:param` matches exactly one non-empty segment; the
  **first mock by declaration order** serves; no mocks → `501` JSON
  naming the endpoint id; wrong method → `405` JSON naming the first
  path-matching endpoint + allowed methods.
- Redirect transitions whose from-route carries no rendered page are
  served as `308` + `Location` (a rendered page always wins).
- Storage: cookie bindings → `Set-Cookie` on the `writtenOn` transitions'
  destination routes; localStorage/sessionStorage bindings → inline
  `<script>` writes in those pages (real browsers execute them). Value
  semantics are documented placeholders (value = key name). Verbatim
  limitation, in every generated README: *minidom replay never gates on
  storage; P4's paired runner owns storage verification.*
- Planned images carry alt text but no sources in the contract; the
  codegen serves deterministic placeholder SVGs (alt text embedded).

## Rendering rules (documented contract with the planner)

The plan's element list is FLAT (document order). The renderer maps:

- `kind 'other'` + role `banner`/`main`/`contentinfo`/`complementary`/
  `article`/`region` → landmark containers (`<header>` `<main>`
  `<footer>` `<aside>` `<article>` `<section>`) that absorb following
  elements until the next landmark (landmarks cannot nest in v0.1);
- `kind 'navigation'` → `<nav aria-label>` absorbing the following run of
  link elements (planners must not place non-nav links directly after a
  nav);
- everything else → semantic leaves (`h1..h6`, `<p>`, `<a>`, `<button
  type="button">`, `<img>`, `<ul><li>`, `<div role>`), forms rendering
  their `PlannedForm` (label+control per field, `<button type="submit">`);
- accessible names render via visible text or `aria-label` when the plan
  name differs from the text; `data-testid` renders verbatim when present;
  an explicit `role` attribute renders only when it differs from the
  emitted tag's implicit role.

## Honest limitations

See `CODEGEN_ADAPTER_INFO.unsupportedConstructs` (echoed verbatim in the
generated README): no element nesting beyond landmarks/nav groups, no
client-side scripting beyond declared storage writes, no `server` storage
emission, no schema enforcement for api mocks, static pages (request
bodies are never read), checkbox fields render unchecked, images are
placeholder SVGs. Structural validation of plans is `@clapp/plan`'s job;
codegen throws only on the malformed shapes listed in `src/generate.ts`
and surfaces everything lenient as generated-README notes.

## Test battery (bun test)

- `test/golden-plan.test.ts` — the golden b01-shaped plan → golden HTML:
  every testid / heading / form field / action / method, determinism
  (byte-identical regeneration), generated README duties.
- `test/acceptance.test.ts` — **the killer**: the golden app is written to
  a temp dir, its server spawned, and ALL FOUR seeded b01 journeys replay
  clean through `@clapp/journey`'s `createDomApplier` + `replayJourney`.
- `test/server.test.ts` — routes, query strings, 404/405, HEAD, assets,
  PORT override, health paths, 308 redirects.
- `test/mock-backend.test.ts` — matching oracle + real-HTTP mock serving
  (first-mock determinism, 501, 405, 404, bodyless mocks).
- `test/storage.test.ts` — cookies/scripts on the writtenOn routes only;
  honest degradation notes.
- `test/structural.test.ts` — field variants, escaping, fallbacks,
  landmark grouping, redirect (no rendered trigger), defensive throws.
- `test/write-app.test.ts` — idempotence, nested route directories.

The root `bun run typecheck` covers `src/**`; the per-package
`tsconfig.json` additionally covers `test/` and `fixtures/`
(`bunx tsc --noEmit -p packages/codegen` — the same convention as
`@clapp/explore`).

Dependencies: `@clapp/core` (types only). `@clapp/journey` is a
devDependency used by the acceptance test battery — the package NEVER
depends on `@clapp/plan` (parallel worker; mirror types only) or
`@clapp/gentests`.
