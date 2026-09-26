/**
 * @clapp/diffext — public API (CLAPP-041).
 *
 * The extended diff dimensions of CLAPP differential verification:
 * - 'visual'  — screenshot pairs compared structurally + pixel-wise
 *   (zero-dep PNG codec; 4×4 region-grid decomposition; postcondition
 *   regions can escalate to 'critical');
 * - 'network' — captured traffic vs the plan's api/mock spec (codegen
 *   routing semantics; 501/405/404 as-spec contracts).
 *
 * Findings conform to the Differential Verification contract v0.1 MIRROR
 * in ./diff-contract.ts (canonical owner: @clapp/diff, CLAPP-040 — the
 * tech lead byte-checks this mirror at integration). This package never
 * depends on @clapp/diff or @clapp/repair (parallel P4 workers); it
 * constructs plain DiffFinding literals against the mirror types.
 *
 * Quick start:
 *
 *   import {
 *     createDomNetworkRecorder, compareNetworkTraffic,
 *     openScreenshotAdapter, compareVisualPair,
 *   } from '@clapp/diffext';
 *
 *   // network (browser-independent, dom driver)
 *   const recorder = createDomNetworkRecorder();
 *   const applier = createDomApplier({ baseUrl, fetchImpl: recorder.fetch });
 *   await replayJourney(journey, applier);
 *   const findings = compareNetworkTraffic(
 *     recorder.requests(), plan.api.endpoints, plan.api.mocks, anchor,
 *   );
 *
 *   // visual (browser-backed, honest when no browser)
 *   const adapter = await openScreenshotAdapter();
 *   const left = await adapter.captureScreenshot(0, 'left', leftUrl);
 *   const right = await adapter.captureScreenshot(0, 'right', rightUrl);
 *   const visual = compareVisualPair(left, right, anchor);
 *   await adapter.close();
 */

// --- the contract mirror (byte-identical; canonical owner @clapp/diff) ---
export * from './diff-contract';

// --- identity helpers ---
export { newDiffFindingId } from './ids';

// --- network dimension ---
export {
  compareNetworkTraffic,
  pathMatchesPattern,
  requestPathOf,
  jsonDeepEqual,
  capturedRequestEvidencePayload,
  NETWORK_EVIDENCE_KIND,
} from './network';
export type { CapturedRequest, NetworkComparisonOptions } from './network';

// --- visual dimension ---
export {
  compareVisualPair,
  comparePixelsInBrowser,
  IN_BROWSER_COMPARE_FN,
} from './visual';
export type {
  VisualComparisonOptions,
  PixelRegion,
  PostconditionRegion,
  InBrowserPixelComparison,
} from './visual';

// --- capture adapters (both media, both drivers) ---
export {
  captureScreenshot,
  openScreenshotAdapter,
  unavailableScreenshotAdapter,
  closeDefaultScreenshotAdapter,
  createDomNetworkRecorder,
  captureNetworkWithPlaywright,
  joinNetworkRecords,
  SCREENSHOT_EVIDENCE_KIND,
  VOLATILE_RESPONSE_HEADERS,
} from './capture';
export type {
  ScreenshotCapture,
  ScreenshotAdapter,
  ScreenshotAdapterOptions,
  DomNetworkRecorder,
  DomNetworkRecorderOptions,
  PlaywrightNetworkCapture,
  PlaywrightNetworkCaptureOptions,
} from './capture';

// --- zero-dep PNG codec (the visual dimension's decode path) ---
export { decodePng, encodePng, bytesEqual, PngError } from './png';
export type { RgbaImage } from './png';

// ---------------------------------------------------------------------------
// Adapter honesty declaration
// ---------------------------------------------------------------------------

/**
 * The @clapp/diffext honesty summary: which drivers capture which media,
 * how pixels are compared, and what this adapter does NOT do. Shaped
 * after @clapp/codegen's CODEGEN_ADAPTER_INFO (the P3 convention).
 */
export const DIFFEXT_ADAPTER_INFO = {
  adapterId: '@clapp/diffext',
  diffVersion: '0.1',
  dimensions: ['visual', 'network'] as const,
  capture: {
    screenshot: {
      driver: 'replayer-playwright only (PlaywrightSession over a lazily-launched playwright-core chromium; fresh context per capture)',
      browserOptional: true,
      whenUnavailable:
        "captures report status 'capture-unavailable' with an honest note; compareVisualPair degrades to a single 'info' finding and judges no pixels",
    },
    network: {
      'replayer-dom':
        "createDomNetworkRecorder: a recording fetch injected as the dom applier's fetchImpl — request URL + method, response status + headers + full textual body; records appended at response time (sequential navigation ⇒ deterministic order)",
      'replayer-playwright':
        'captureNetworkWithPlaywright: the @clapp/observe network channel (request events + drained responses joined by (url, method) FIFO; resourceType classified; bodies are observe-capped previews)',
    },
  },
  pixelComparison: {
    method:
      'zero-dep PNG codec (node:zlib inflate/deflate + local CRC-32; color types 0/2/3/4/6, 8-bit, non-interlaced), byte-identity fast path, 4x4 region-grid decomposition + row/column delta summaries, exact-match tolerance by default',
    inBrowserCrossCheck:
      'comparePixelsInBrowser decodes both PNGs on a canvas via PlaywrightSession.evaluate (the engine that produced the screenshots) — an optional parity path, never the only one',
    severityPolicy:
      "pixel divergence is 'minor' (default) or 'info' (caller opt-down); 'critical' ONLY for a lost assert-visible postcondition region (left content, right blank)",
  },
  networkVerdictPolicy: {
    matchedMocked: 'response status + parsed JSON body must equal the MockResponse spec, else major',
    matchedUnmocked: '501 + JSON naming the endpoint id is as-spec (no finding); anything else is major',
    wrongMethod: '405 is as-spec (no finding); anything else is major',
    unmatched404: 'the as-spec unknown-path answer — no finding',
    unmatched2xxApiPath: 'major (unplanned API surface served; default API prefixes: /api/)',
    unmatchedStaticDocument: 'info (documents/static assets are not API behavior — the b01 corpus case)',
    neverExercised: 'one info finding per planned endpoint the traffic never exercised',
  },
  unsupportedConstructs: [
    'PNG bit depths other than 8, interlaced (Adam7) PNGs, and non-palette tRNS (rejected with clear errors — honest refusal, never silent approximation)',
    'visual comparison across unequal dimensions is NOT rescaled: one minor finding, pixel pass skipped',
    'screenshot pixel comparison cannot see causes — a lost postcondition region is provable, WHICH element vanished is the semantic dimension (CLAPP-040) or repair (CLAPP-042) territory',
    'the playwright network join is (url, method) FIFO — ambiguous only for apps issuing the same request concurrently with different outcomes (not the corpus/candidate class)',
    'no judgment of response CONTENT beyond the plan mock contract (schemas are documented by the plan, not enforced — the codegen contract)',
    'the bench-b01 corpus carries NO api baseline: endpoint-less plan api sections are legal, and corpus page loads surface only as info-grade document entries',
  ],
  degradationBehavior:
    'Every degradation is a finding-shaped or status-shaped honest report: unavailable screenshots become capture-unavailable records (comparison then emits info, never guesses); undecodable PNGs emit info with the codec error; failed requests carry their failure text. Nothing is silently dropped, rescaled, or approximated.',
} as const;
