# @clapp/diffext — visual + network diff dimensions (CLAPP-041)

The extended dimensions of CLAPP differential verification, producing
`DiffFinding` records per the **Differential Verification contract v0.1
MIRROR** in `src/diff-contract.ts` (canonical owner: `@clapp/diff`,
CLAPP-040 — the tech lead byte-checks the mirror at integration):

- **`visual`** — screenshot pairs per journey step, compared structurally
  + pixel-wise through a **zero-dependency PNG codec** (node:zlib + a
  local CRC-32; color types 0/2/3/4/6, 8-bit, non-interlaced; strict
  refusal on anything else). No unaudited npm image library anywhere in
  the decode path.
- **`network`** — captured HTTP traffic compared against the plan's
  `api`/`mocks` spec (`@clapp/plan` synthesis-contract types), with the
  @clapp/codegen routing semantics reimplemented locally (`:param`
  matches exactly one non-empty path segment; query strings ignored).

This package NEVER depends on `@clapp/diff` or `@clapp/repair` (parallel
P4 workers): findings are plain literals shaped by the mirror types.

## Public surface

```ts
import {
  // contract mirror (byte-identical re-export)
  DIFF_VERSION, // '0.1'  + all DiffFinding/DiffReport/… types
  // network dimension
  compareNetworkTraffic, createDomNetworkRecorder, captureNetworkWithPlaywright,
  // visual dimension
  compareVisualPair, comparePixelsInBrowser, openScreenshotAdapter,
  captureScreenshot, unavailableScreenshotAdapter,
  // codec + honesty
  decodePng, encodePng, DIFFEXT_ADAPTER_INFO,
} from '@clapp/diffext';

// network (browser-independent, the 'replayer-dom' driver)
const recorder = createDomNetworkRecorder();
const applier = createDomApplier({ baseUrl, fetchImpl: recorder.fetch }); // @clapp/journey
await replayJourney(journey, applier);
const findings = compareNetworkTraffic(
  recorder.requests(), plan.api.endpoints, plan.api.mocks, anchor,
);

// visual (browser-backed; honest without a browser)
const adapter = await openScreenshotAdapter({ fullPage: true });
const left = await captureScreenshot(0, 'left', leftUrl, { adapter });
const right = await captureScreenshot(0, 'right', rightUrl, { adapter });
const visual = compareVisualPair(left, right, anchor, { postconditionRegions });
await adapter.close();
```

## Verdict rules (network)

Traffic is matched against the plan by **method + urlPattern** (segment
semantics identical to the codegen mock backend; first mock by
declaration order serves):

| traffic | spec answer | deviation |
| --- | --- | --- |
| matched + mocked | mock's statusCode + exact JSON body | any deviation → `major` |
| matched + unmocked | 501 + JSON naming the endpoint id | anything else → `major` |
| path matched, method not | 405 | non-405 → `major` |
| unmatched, answered 404 | the as-spec unknown answer | **no finding** |
| unmatched 2xx/3xx on `/api/*` | — | `major` (unplanned API surface) |
| unmatched document/static 2xx | — | `info` (recorded, no consequence) |
| unmatched other error | — | `minor` |
| failed on a planned pattern | — | `major` / `minor` |
| planned endpoint never exercised | — | one `info` |

The bench-b01 corpus carries **no API baseline**: endpoint-less plan api
sections are legal input, and corpus page loads surface only as
`info`-grade document entries (proven by the corpus-symmetry battery
against the real fixture server).

## Comparison rules (visual)

1. byte-identity fast path (identical PNG bytes ⇒ identical pixels);
2. decode both sides with the local codec;
3. dimension mismatch → `minor` (pixel pass skipped honestly, nothing
   rescaled; postcondition regions still run — documents are top-anchored);
4. pixel delta ratio (exact-match tolerance by default) + the documented
   4×4 region-grid decomposition and row/column delta summaries in the
   finding's `actual`;
5. caller-declared assert-visible **postcondition regions** (LEFT pixel
   coordinates): left content + right blank-or-unreachable → `critical`
   (the only critical-grade visual case); blank left regions are
   honestly skipped.

Severity honesty: visual-only divergence is `minor` (default) or `info`
(caller opt-down) — `critical` ONLY for a lost postcondition region.
`comparePixelsInBrowser` cross-checks the codec's delta ratio against a
real canvas decode (PlaywrightSession evaluate, the engine that produced
the screenshots).

## Capture adapters

- **screenshots** — `PlaywrightSession` over a lazily-launched
  `playwright-core` chromium (fresh context per capture, 1280×720
  viewport or full-page). Browser-optional: without a browser every
  capture reports `status: 'capture-unavailable'` with an honest note,
  and the comparison degrades to a single `info` finding — never fake
  pixels.
- **network, dom driver** — `createDomNetworkRecorder()`: a recording
  fetch (request URL + method; response status + headers + full textual
  body; volatile `date`/`age` headers stripped) to inject as the dom
  applier's `fetchImpl`.
- **network, playwright driver** — `captureNetworkWithPlaywright()`: the
  @clapp/observe network channel (request events + drained responses
  joined by (url, method) FIFO; resourceType classified; bodies are
  observe-capped 512-char previews).

Every captured artifact is addressable as an **EvidenceRef-shaped
record** (`@clapp/core`): `ev_…` id, kind `screenshot` (hash of the PNG
bytes) or `network` (hash of the canonical-JSON capture record via
@clapp/observe's `canonicalJson`).

## Test battery (bun test)

- `test/network-acceptance.test.ts` — **the killer acceptance**
  (browser-independent): the golden plan (6 b01 routes + 2 api endpoints:
  one mocked, one unmocked) → codegen → spawned real server → as-spec
  probes (right method, wrong method, unknown pattern, `:id`
  strictness) → **zero findings**; plus the three negative controls
  (mock status 200→500, mock body mutation, 501-handler removal) each
  surfacing a `major` finding with `expected`/`actual`.
- `test/network-rules.test.ts` — the synthetic rule matrix (every
  verdict rule incl. the as-spec no-finding paths).
- `test/corpus-symmetry.test.ts` — all 4 seeded b01 journeys replayed
  against the real fixture server through the recording fetch: static
  documents only, `info`-grade entries only against the endpoint-less
  b01 network baseline.
- `test/png-codec.test.ts` — codec round-trips, determinism, honest
  refusals (CRC, truncation, bit depth, interlacing).
- `test/visual-logic.test.ts` — the comparison logic against synthetic
  PNGs: fast path, dimensions, tolerance, severity policy,
  postcondition regions (blank, missing-entirely, preserved,
  out-of-bounds), degradations, evidence anchoring.
- `test/visual-browser.test.ts` — browser-gated (skip **reported** by an
  always-running test, never silently dropped): determinism control,
  heading-mutation → `minor` finding, copyright-removal → `critical`
  (region measured via a live bounding rect), codec-vs-canvas decode
  parity, and the playwright network path.
- `test/finding-shape.test.ts` — every finding from both dimensions
  validates against the mirror shape (`diff_` uuid v4 ids, closed
  unions, non-empty anchors, absent-not-null optional fields).

The root `bun run typecheck` covers `src/**`; the per-package
`tsconfig.json` additionally covers `test/` and `fixtures/`
(`bunx tsc --noEmit -p packages/diffext`).

## Honest limitations (see also `DIFFEXT_ADAPTER_INFO`)

- 8-bit, non-interlaced PNGs only (what screenshot encoders emit);
  1/2/4/16-bit, Adam7, and non-palette tRNS are rejected with clear
  errors — never silently approximated.
- unequal screenshot dimensions are never rescaled: one `minor` finding,
  pixel pass skipped (postcondition regions still run, top-anchored).
- a region check proves the REGION's pixels are gone — WHICH element
  vanished or moved is the semantic dimension (CLAPP-040) and repair
  (CLAPP-042) territory.
- the playwright network join is (url, method) FIFO — ambiguous only
  for apps issuing the same request concurrently with different
  outcomes (not the corpus/candidate class); its bodies are 512-char
  previews (the observe channel cap) while the dom driver records full
  bodies.
- when the browser-gated battery must skip (no chromium), the
  browser-independent network killer acceptance remains the green spine
  of this package — the gating test reports the skip state explicitly.
- the golden plan's api section is a synthesis choice (b01 has no
  APIs); the corpus-symmetry battery proves the endpoint-less case.

Dependencies: `@clapp/core`, `@clapp/journey`, `@clapp/observe`,
`@clapp/plan` (all frozen, runtime). Dev: `@clapp/codegen` (the battery
generates the candidate app) and `playwright-core` (lazy, browser-
optional paths only).
