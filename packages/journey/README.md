# @clapp/journey

CLAPP journey recording, structural validation, and replay (CLAPP-012), plus
the **bench-b01** fixture corpus — a self-contained static marketing site —
and its stdlib-only HTTP server.

This package owns the **canonical** copy of the shared journey contract
(`src/journey-contract.ts`, declared by the tech lead, P1 wave 2026-09-25).
Byte-identical mirrors may be carried by other packages; changes require an
ADR.

Zero runtime dependencies: the DOM action applier is built on an in-package
minimal HTML document model (`src/minidom.ts`), so the whole package — and
the corpus it serves — stays self-contained inside a network-deny execution
profile.

## Usage demo

```ts
import {
  createDomApplier, createRecorder, newJourneyId, replayJourney,
  resolveFixtureRoot, startFixtureServer, validateJourney,
} from '@clapp/journey';

const recorder = createRecorder({ name: 'b01 nav smoke' });
recorder.start('bench/b01-static');
recorder.record({ type: 'navigate', url: '/' });
recorder.record({ type: 'click', target: { testId: 'nav-pricing' } });
recorder.record({ type: 'assert-visible', target: { role: 'heading', name: 'Simple, honest pricing' } });
const journey = recorder.finish();
validateJourney(journey); // => true

const server = await startFixtureServer({ root: resolveFixtureRoot() });
const summary = await replayJourney(journey, createDomApplier({ baseUrl: server.url }));
await server.close();
```

## Modules

| Module | Purpose |
| --- | --- |
| `src/journey-contract.ts` | CANONICAL shared contract (Journey, JourneyAction, TargetSelector, ActionApplier, JourneyRecorder). |
| `src/validate.ts` | `validateJourney` type-safe predicate + `validateJourneyDetailed` with precise, path-qualified error messages. |
| `src/recorder.ts` | `createRecorder()` — start/record/finish state machine producing deterministic Journeys. |
| `src/minidom.ts` | Dependency-free HTML parser + document model (the "own minimal DOM shim"). |
| `src/a11y.ts` | Implicit-role table and simplified accessible-name computation for selector resolution. |
| `src/replayer.ts` | `createDomApplier()` (default, always-available ActionApplier), `replayJourney()` orchestration, machine-readable `JourneyReplayError`. |
| `src/fixtures/server.ts` | b01 fixture HTTP server (node:http stdlib only) + `waitForFixtureServer` ready-poll helper + CLI mode. |
| `src/fixtures/proof.ts` | Sandbox-proof harness: runs INSIDE an execution profile — serves the corpus, replays every seeded journey, prints a JSON verdict. |
| `src/ids.ts` | `newJourneyId()` — `"journey_" + uuid v4`. |
| `fixtures/b01/` | The corpus: 6 HTML pages, 1 CSS, 1 JS, 2 SVG. Zero external references (enforced by tests). |
| `fixtures/journeys/` | Seeded journeys: `b01-nav.json`, `b01-contact.json`, `b01-media.json`, `b01-newsletter.json`. |

## Bench-b01 corpus

A fictional marketing site ("Nimbus Notes") exercising the B01 scope from
`docs/WEB_BENCHMARKS.md`: navigation (header + footer navs), responsive
layout (CSS grid + media queries), forms (contact form with GET submission,
newsletter forms), links (internal only), and media/assets (SVG logo, hero
illustration, inline icons, favicon). All pages share a header/footer shell;
interactive elements carry stable `data-testid` anchors; the contact form
submits (GET) to a success page so full round-trips are replayable.

Serve it:

```bash
bun packages/journey/src/fixtures/server.ts --port 8099
# {"url":"http://127.0.0.1:8099/","port":8099,"root":".../fixtures/b01"}
```

## Sandbox-execution proof

`src/sandbox-proof.test.ts` (never skipped) drives the frozen
`@clapp/sandbox` `ProcessSandboxExecutor`: the proof harness runs inside an
isolated profile (cwd pinned to `profile.rootDir`, env filtered to `[]` +
the executor's documented PATH/HOME injections, deny-all declared network
posture, 60 s duration budget), starts the fixture server on an ephemeral
loopback port, replays every seeded journey, and writes its JSON verdict
both to stdout and to a file inside the profile root (cwd isolation proven
from within). The test asserts a clean exit, every journey ok, and the
honest v0 enforcement flags (`networkEnforced: false`).

## Known limitations (honest list)

- **No script execution.** The DOM applier never runs page JS
  (`assets/app.js` is progressive enhancement for real browsers only).
  Seeded journeys are deliberately JS-independent.
- **No layout engine.** `assert-visible` decides visibility only via the
  `hidden` attribute, inline `display:none`/`visibility:hidden` (self or
  ancestors), and `input[type=hidden]`. External-stylesheet visibility is
  not evaluated — an element hidden only by `assets/styles.css` (e.g. the
  mobile nav toggle on desktop widths) is considered visible.
- **click on non-interactive elements is a no-op success** (no event
  handlers exist to run); **press** models only `Enter` (submits the form
  of the most recently interacted element); other keys are no-ops. There
  is no focus model.
- **fill** supports text-like `<input>` elements and `<textarea>` only.
  Filling `<select>`, checkboxes, radios, or file inputs throws
  `fill-not-supported` (an honest refusal, not a silent pass).
- **a11y is an approximation**: partial implicit-role table; `role`
  attribute values are not split into token lists; no `aria-labelledby`
  traversal; no landmark scoping (a `<footer>` anywhere maps to
  `contentinfo`); accessible-name priority is simplified (see
  `src/a11y.ts`).
- **Strict ambiguity**: by default a selector without `nth` that matches
  multiple elements throws `target-ambiguous` (opt out with
  `strict: false`). An empty `{}` selector is structurally valid (the
  contract makes all fields optional) and matches every element.
- **Cross-origin navigation is blocked by default** (`navigate-blocked`);
  opt in with `allowCrossOrigin: true`. Redirect handling trusts the
  runtime's final `response.url`.
- **minidom is not a full HTML5 parser**: it parses the well-formed subset
  the corpus is authored in; malformed input degrades leniently (stray
  close tags ignored, unclosed elements auto-close at EOF).
- **Network honesty**: the v0 child-process sandbox cannot enforce its
  deny-all posture (`networkEnforced: false`, per the frozen
  `@clapp/sandbox` contract); egress control lands with the runner
  integration (CLAPP-040). The corpus itself is verified to contain zero
  external references, and proof traffic is loopback-only.
- **Playwright applier**: not shipped in this environment (no browser
  binaries available); the DOM applier is the always-available default the
  contract requires. A Playwright `ActionApplier` is a natural follow-up —
  the `ActionApplier` port is the only seam needed.
- **Fixture server**: GET/HEAD only, no TLS, no caching, single root,
  loopback bind by default; suitable as a benchmark fixture, not a
  production frontend host.
- **Secrets**: the corpus and seeded journeys contain no secret-shaped
  literals at all (only obviously fake `@example.*` addresses), so there is
  nothing to redact or fragment-assemble.

## Testing

`bun test` from the repo root runs the package battery alongside the rest
of the workspace: validation (valid + every malformed shape), recorder
sequencing/determinism, minidom parser contract, DOM applier behavior
(deterministic fetch stub — navigation, forms GET/POST, selector
resolution, ambiguity, visibility, error codes), the fixture server
(content types, 404/traversal, CLI child + ready-poll, timeout), corpus
hygiene (inventory, parse, zero external refs, link integrity, seeded
journey validation + testId cross-check + real-server smoke replay), and
the never-skipped sandbox-execution proof.
