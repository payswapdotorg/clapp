/**
 * @clapp/diff — the adapter honesty declaration (DIFF_ADAPTER_INFO).
 *
 * What the paired runner captures, per driver, and what it deliberately
 * does not — the same disclosure discipline as @clapp/observe's
 * runner-wiring notes and @clapp/codegen's CODEGEN_ADAPTER_INFO.
 */

import { DIFF_VERSION } from './diff-contract';

/** The per-driver capture capability matrix. */
export interface DiffDriverCapabilities {
  captures: readonly string[];
  limitations: readonly string[];
}

/** The honesty summary exported from the package index. */
export const DIFF_ADAPTER_INFO = {
  adapterId: '@clapp/diff',
  supportedContractVersions: [DIFF_VERSION],
  /** The dimensions this package owns (visual + network are @clapp/diffext CLAPP-041; repair is @clapp/repair CLAPP-042). */
  dimensions: ['semantic', 'state'],
  perDriverCapture: {
    'replayer-dom': {
      captures: [
        'per-step page captures: every HTML document the dom applier fetches (the fetched bytes, verbatim)',
        'per-step network captures: method, url, status, and the diff-relevant response header subset (content-type / set-cookie / location) via a fetch wrapper',
        'post-run storage inventory: cookies OBSERVED via Set-Cookie response headers (recorded only when at least one was observed)',
      ],
      limitations: [
        'no script execution: page JavaScript never runs, so localStorage/sessionStorage writes are unverifiable under this driver (an honest info finding, never a fabricated inventory)',
        'page captures are the fetched bytes, not a post-script DOM (fill actions mutate the applier-internal tree and are evidenced by the submitted form request, not the page bytes)',
        'no layout/CSS: visibility follows the dom applier approximation (inline styles + hidden attribute only)',
      ],
    },
    'replayer-playwright': {
      captures: [
        'per-step page captures: page.content() after EVERY applied action (the live post-script DOM)',
        'per-step network captures: every observed response (url/method/status/header subset) via a page response listener; the step attribution is the step active when the response arrived',
        'post-run storage inventory: a real browser inventory (context cookies + in-page localStorage/sessionStorage reads)',
      ],
      limitations: [
        'requires a launchable chromium (playwright-core is lazily imported; when unavailable the side run fails honestly with the reason)',
        'response-body bytes are not captured for network entries (headers + the page DOM are)',
        'asset-level traffic is captured as network entries but never compared in this package (the network dimension is @clapp/diffext)',
      ],
    },
  } satisfies Record<'replayer-dom' | 'replayer-playwright', DiffDriverCapabilities>,
  emittedCapabilities: [
    'PairedRunner.runPair: one journey replayed on both sides through the SAME driver vocabulary (createDomApplier / createPlaywrightApplier), per-step page/network capture ids, root-hash-verifiable side evidence bundles',
    'semantic findings: run integrity, navigation symmetry, route agreement, and per-page structural comparison (title, ordered headings, data-testid surface, landmark sequence, journey-targetable surface, form fields incl. labels/options) with severity escalated to critical ONLY on contradicted journey targets',
    'selector resolution symmetry: every attempted journey target resolved against both sides with the observe vocabulary; asymmetric outcomes are findings, symmetric approximation limits are skipped',
    'state findings: PlannedStorageBinding[] verification — cookies via observed Set-Cookie on the writtenOn route (both drivers), local/session storage via a real browser inventory (playwright driver) or an honest info limitation (dom driver)',
    'DiffReport assembly with computed counts + derived verdict, canonical serialization (sorted keys, no whitespace), and total parse-time validation',
  ],
  unsupportedConstructs: [
    'visual dimension (screenshot/pixel comparison) — @clapp/diffext CLAPP-041',
    'network dimension (request/response comparison vs the plan api/mock spec) — @clapp/diffext CLAPP-041',
    'the repair loop (RepairDirective / RepairAttempt / RepairLoopResult are consumed by @clapp/repair CLAPP-042; this package only declares the contract)',
    'IR-predicted-state verification beyond recorded transitionIds anchoring (the IR model is not a runner input; ids are cited, never re-derived)',
    'storage bindings of kind "server" (not client-observable; recorded as info)',
  ],
  degradationBehavior:
    'Unknown is a valid value: per-step capture ids and optional fields are ABSENT, never null, when a step was not captured. A side that fails to replay (or whose driver is unavailable) is recorded as an incomplete SideRunResult with its failure reason — asymmetry becomes a finding, never an assumption. diff() on a hand-constructed PairedRun (no captures) yields run-integrity findings only; no page comparison is invented. The verdict is equivalent iff the critical count is zero — computed, never asserted.',
} as const;
