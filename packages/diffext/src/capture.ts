/**
 * @clapp/diffext — capture adapters for BOTH diff media (CLAPP-041).
 *
 * The visual and network dimensions consume CAPTURES, not live pages. This
 * module is the single place that produces them, per side, with the SAME
 * vocabulary either way:
 *
 * SCREENSHOTS (kind 'screenshot')
 *   captureScreenshot(stepIndex, side, url) drives a REAL browser page via
 *   @clapp/observe's PlaywrightSession (the page lifecycle + screenshot
 *   wrapper). playwright-core is loaded LAZILY (the @clapp/journey
 *   replayer-playwright precedent): importing @clapp/diffext never
 *   requires a browser. When no browser is available the capture reports
 *   status 'capture-unavailable' HONESTLY (no fake pixels, no absent-
 *   instead-of-null games) and the visual comparison degrades to an
 *   'info'-grade finding (see ./visual.ts).
 *
 * NETWORK (kind 'network')
 *   Two drivers, one record shape (CapturedRequest in ./network.ts):
 *   - 'replayer-dom' (browser-independent): createDomNetworkRecorder()
 *     returns a fetch implementation that records every exchange (request
 *     URL + method, response status + headers + body). Inject it into
 *     @clapp/journey's createDomApplier({ baseUrl, fetchImpl }) and the
 *     replayed journey's whole HTTP footprint is captured.
 *   - 'replayer-playwright': captureNetworkWithPlaywright() opens a
 *     PlaywrightSession, wires its capture sink (the @clapp/observe
 *     network channel), navigates through the given URLs, then drains the
 *     pending-network map — resourceType-classified, bodyPreview-capped
 *     records (the observe channel's documented determinism model).
 *
 * Every captured artifact is addressable as an EvidenceRef-shaped record
 * (@clapp/core): evidenceId "ev_…", the media's EvidenceKind, and the
 * SHA-256 of the canonical evidence bytes (the raw PNG bytes for
 * screenshots; the canonical-JSON capture record for network exchanges,
 * via @clapp/observe's canonicalJson — the platform's canonical
 * serialization, so hashes are stable across processes).
 *
 * Honest limitations (echoed in DIFFEXT_ADAPTER_INFO):
 * - the dom network recorder appends records at RESPONSE time (the DOM
 *   applier navigates strictly sequentially; initiation order equals
 *   completion order there — in-browser parallelism does not exist on
 *   this path);
 * - the playwright network path joins drained responses to requests by
 *   (url, method) FIFO — exact for deterministic apps (the CLAPP corpus
 *   and candidates), potentially ambiguous for apps that issue the same
 *   request concurrently with different outcomes;
 * - volatile clock headers ('date', 'age') are stripped from network
 *   records before hashing (same list as @clapp/observe) so identical
 *   exchanges hash identically across seconds;
 * - screenshot evidence hashes the PNG bytes as-is; two captures of the
 *   same static page hash equal only when chromium encodes them
 *   byte-identically (it does for identical pixels — the determinism
 *   control in the visual battery pins this).
 */

import { newEvidenceId, sha256Hex } from '@clapp/core';
import type { EvidenceRef } from '@clapp/core';
import type { Browser } from 'playwright-core';
import {
  PlaywrightSession,
  canonicalJson,
  type CaptureSink,
  type NetworkCapturePayload,
  type NetworkRequestPayload,
  type NetworkResponsePayload,
} from '@clapp/observe';
import type { DiffSide } from './diff-contract';
import { capturedRequestEvidencePayload, type CapturedRequest } from './network';
import { decodePng } from './png';

// ---------------------------------------------------------------------------
// Shared evidence helpers
// ---------------------------------------------------------------------------

/** Evidence kind for screenshot captures (the @clapp/core EvidenceRef vocabulary). */
export const SCREENSHOT_EVIDENCE_KIND = 'screenshot' as const;

/** Clock-volatile response headers stripped before hashing (the @clapp/observe list). */
export const VOLATILE_RESPONSE_HEADERS: readonly string[] = ['date', 'age'];

function stripVolatileHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of Object.keys(headers)) {
    if (VOLATILE_RESPONSE_HEADERS.includes(name.toLowerCase())) {
      continue;
    }
    out[name] = headers[name]!;
  }
  return out;
}

async function networkEvidenceRef(request: CapturedRequest): Promise<EvidenceRef> {
  const payload = capturedRequestEvidencePayload(request);
  return {
    evidenceId: newEvidenceId(),
    kind: 'network',
    sha256: await sha256Hex(canonicalJson(payload)),
  };
}

async function screenshotEvidenceRef(png: Uint8Array): Promise<EvidenceRef> {
  return {
    evidenceId: newEvidenceId(),
    kind: 'screenshot',
    sha256: await sha256Hex(png),
  };
}

function isTextualContentType(contentType: string): boolean {
  const lower = contentType.toLowerCase();
  return (
    lower.startsWith('text/') ||
    lower.includes('json') ||
    lower.includes('javascript') ||
    lower.includes('xml') ||
    lower.includes('form-urlencoded')
  );
}

// ---------------------------------------------------------------------------
// Screenshot capture (via PlaywrightSession; browser optional)
// ---------------------------------------------------------------------------

/** One captured screenshot, addressable as evidence. */
export interface ScreenshotCapture {
  stepIndex: number;
  side: DiffSide;
  /** The page URL that was screenshotted. */
  url: string;
  /** 'captured', or 'capture-unavailable' when no browser could take the shot. */
  status: 'captured' | 'capture-unavailable';
  /** Honest reason when status is 'capture-unavailable' (absent otherwise). */
  note?: string;
  /** PNG bytes (ABSENT when unavailable — never null). */
  png?: Uint8Array;
  /** Image width in px (absent when unavailable). */
  width?: number;
  /** Image height in px (absent when unavailable). */
  height?: number;
  /** EvidenceRef for the PNG bytes (kind 'screenshot'; absent when unavailable). */
  evidenceRef?: EvidenceRef;
}

/** How the screenshot adapter drives the browser. */
export interface ScreenshotAdapter {
  /** 'playwright' when a chromium was launched; 'unavailable' otherwise. */
  readonly driver: 'playwright' | 'unavailable';
  /** Honest reason when driver is 'unavailable'. */
  readonly note?: string;
  /** Takes one screenshot of one URL. */
  captureScreenshot(stepIndex: number, side: DiffSide, url: string): Promise<ScreenshotCapture>;
  /** Releases the browser (no-op when unavailable). */
  close(): Promise<void>;
}

export interface ScreenshotAdapterOptions {
  /** Full-page screenshot instead of viewport (default false: 1280x720 viewport). */
  fullPage?: boolean;
}

/**
 * Builds an adapter that reports capture-unavailable for every call — the
 * honest stand-in for environments without a browser. Paired runners use
 * it to keep the visual dimension's record complete instead of guessing.
 */
export function unavailableScreenshotAdapter(reason: string): ScreenshotAdapter {
  return {
    driver: 'unavailable',
    note: reason,
    async captureScreenshot(stepIndex: number, side: DiffSide, url: string): Promise<ScreenshotCapture> {
      return {
        stepIndex,
        side,
        url,
        status: 'capture-unavailable',
        note: reason,
      };
    },
    async close(): Promise<void> {
      // nothing to release
    },
  };
}

/**
 * Opens the playwright-backed screenshot adapter: launches headless
 * chromium via playwright-core (LAZY import — module load never needs a
 * browser) and takes each screenshot through a FRESH PlaywrightSession
 * (context + page per capture: clean state, no cross-step leakage).
 * Falls back to an unavailable adapter when the runtime or the browser is
 * missing — never throws for a missing browser.
 */
export async function openScreenshotAdapter(
  options: ScreenshotAdapterOptions = {},
): Promise<ScreenshotAdapter> {
  const fullPage = options.fullPage ?? false;
  let playwright: typeof import('playwright-core');
  try {
    playwright = await import('playwright-core');
  } catch (error) {
    return unavailableScreenshotAdapter(
      `playwright-core is not importable in this environment: ${String(error)}`,
    );
  }
  let browser: Browser;
  try {
    browser = await playwright.chromium.launch({ headless: true });
  } catch (error) {
    return unavailableScreenshotAdapter(
      `headless chromium could not be launched: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return {
    driver: 'playwright',
    async captureScreenshot(stepIndex: number, side: DiffSide, url: string): Promise<ScreenshotCapture> {
      const session = await PlaywrightSession.open({
        browser,
        contextOptions: { viewport: { width: 1280, height: 720 } },
      });
      try {
        await session.navigate(url, 'load');
        const png = await session.screenshotPng(fullPage);
        const image = decodePng(png);
        return {
          stepIndex,
          side,
          url,
          status: 'captured',
          png,
          width: image.width,
          height: image.height,
          evidenceRef: await screenshotEvidenceRef(png),
        };
      } finally {
        await session.close().catch(() => undefined);
      }
    },
    async close(): Promise<void> {
      await browser.close().catch(() => undefined);
    },
  };
}

/**
 * captureScreenshot(stepIndex, side, url) — the packet-required capture
 * entry point. Uses the given adapter, or a lazily-opened module default
 * (closed via closeDefaultScreenshotAdapter; per-call browser launches
 * would make multi-step journeys needlessly slow).
 */
export async function captureScreenshot(
  stepIndex: number,
  side: DiffSide,
  url: string,
  options: ScreenshotAdapterOptions & { adapter?: ScreenshotAdapter } = {},
): Promise<ScreenshotCapture> {
  const adapter = options.adapter ?? (await defaultScreenshotAdapter(options));
  return adapter.captureScreenshot(stepIndex, side, url);
}

let defaultAdapter: ScreenshotAdapter | null = null;
let defaultAdapterOpening: Promise<ScreenshotAdapter> | null = null;

async function defaultScreenshotAdapter(options: ScreenshotAdapterOptions): Promise<ScreenshotAdapter> {
  if (defaultAdapter !== null) {
    return defaultAdapter;
  }
  if (defaultAdapterOpening === null) {
    defaultAdapterOpening = openScreenshotAdapter(options);
  }
  defaultAdapter = await defaultAdapterOpening;
  defaultAdapterOpening = null;
  return defaultAdapter;
}

/** Closes the module-default screenshot adapter (test hygiene). */
export async function closeDefaultScreenshotAdapter(): Promise<void> {
  const adapter = defaultAdapter;
  defaultAdapter = null;
  defaultAdapterOpening = null;
  if (adapter !== null) {
    await adapter.close().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Network capture — dom driver (recording fetch)
// ---------------------------------------------------------------------------

/** A recording fetch session for the dom driver. */
export interface DomNetworkRecorder {
  /** The recording fetch implementation — inject as createDomApplier's fetchImpl. */
  readonly fetch: typeof fetch;
  /** Every completed exchange so far, in completion order. */
  requests(): CapturedRequest[];
  /** EvidenceRef-shaped record per captured exchange (kind 'network'). */
  evidenceRefs(): Promise<EvidenceRef[]>;
}

export interface DomNetworkRecorderOptions {
  /** The underlying fetch (default: globalThis.fetch). */
  fetchImpl?: typeof fetch;
}

/**
 * Creates a recording fetch for the 'replayer-dom' driver: every exchange
 * made through it (journey navigations, form submissions, direct probes)
 * is captured with request URL + method and response status + headers +
 * textual body. Bodies are read from a cloned response, so the caller's
 * stream is never consumed twice.
 */
export function createDomNetworkRecorder(options: DomNetworkRecorderOptions = {}): DomNetworkRecorder {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const records: CapturedRequest[] = [];

  // Typed as a plain callable; the boundary cast below (not the binding)
  // presents it as `typeof fetch` (bun's fetch type carries extra props
  // like preconnect that a plain function cannot carry structurally).
  const recordingFetch = async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (
      init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')
    ).toUpperCase();
    const response = await fetchImpl(input, init);
    const record: CapturedRequest = {
      url,
      method,
      status: response.status,
      headers: stripVolatileHeaders(recordHeaders(response)),
    };
    const contentType = response.headers.get('content-type') ?? '';
    if (isTextualContentType(contentType)) {
      try {
        record.body = await response.clone().text();
      } catch {
        // body unavailable (stream already consumed / transport error):
        // the record stays without a body — honest absence, never a guess
      }
    }
    records.push(record);
    return response;
  };

  return {
    fetch: recordingFetch as typeof fetch,
    requests: () => [...records],
    evidenceRefs: () => Promise.all(records.map((record) => networkEvidenceRef(record))),
  };
}

function recordHeaders(response: Response): Record<string, string> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    headers[name.toLowerCase()] = value;
  });
  return headers;
}

// ---------------------------------------------------------------------------
// Network capture — playwright driver (the observe network channel)
// ---------------------------------------------------------------------------

export interface PlaywrightNetworkCaptureOptions {
  /** An open browser (the caller owns its lifecycle). */
  browser: Browser;
  /** URLs to navigate through, in order (each navigation waits for 'load'). */
  urls: string[];
  /** Settle time after the last navigation before draining (default 250 ms). */
  settleMs?: number;
}

export interface PlaywrightNetworkCapture {
  requests: CapturedRequest[];
  evidenceRefs: EvidenceRef[];
}

/**
 * Captures network traffic through a REAL browser page: the observe
 * network channel. Request records arrive at event time; responses are
 * drained at the settlement point (the channel's documented determinism
 * model) and joined to their requests by (url, method) FIFO.
 */
export async function captureNetworkWithPlaywright(
  options: PlaywrightNetworkCaptureOptions,
): Promise<PlaywrightNetworkCapture> {
  const pending: NetworkRequestPayload[] = [];
  const sink: CaptureSink = (channel, payload) => {
    if (channel === 'network.request') {
      pending.push(payload as NetworkRequestPayload);
    }
    // responses and failures arrive via drainPendingNetwork(), not the sink
  };

  const session = await PlaywrightSession.open({
    browser: options.browser,
    contextOptions: { viewport: { width: 1280, height: 720 } },
  });
  try {
    session.wireCapture(sink);
    for (const url of options.urls) {
      await session.navigate(url, 'load');
    }
    await new Promise((resolve) => setTimeout(resolve, options.settleMs ?? 250));
    const drained: NetworkCapturePayload[] = session.drainPendingNetwork();
    const requests = joinNetworkRecords(pending, drained);
    return {
      requests,
      evidenceRefs: await Promise.all(requests.map((record) => networkEvidenceRef(record))),
    };
  } finally {
    await session.close().catch(() => undefined);
  }
}

/**
 * Joins request-event records with drained response/failure records by
 * (url, method) FIFO. Exact for deterministic apps; documented ambiguity
 * for concurrent identical requests with different outcomes (module doc).
 */
export function joinNetworkRecords(
  requests: NetworkRequestPayload[],
  drained: NetworkCapturePayload[],
): CapturedRequest[] {
  const responses: NetworkResponsePayload[] = drained.filter(
    (payload): payload is NetworkResponsePayload =>
      typeof payload === 'object' && payload !== null && (payload as { subkind?: string }).subkind === 'response',
  );
  const used = new Set<number>();
  const matchResponse = (url: string, method: string): NetworkResponsePayload | undefined => {
    for (const [index, response] of responses.entries()) {
      if (used.has(index)) {
        continue;
      }
      if (response.url === url && response.method.toLowerCase() === method.toLowerCase()) {
        used.add(index);
        return response;
      }
    }
    return undefined;
  };

  const out: CapturedRequest[] = [];
  for (const request of requests) {
    const response = matchResponse(request.url, request.method);
    const record: CapturedRequest = {
      url: request.url,
      method: request.method,
      resourceType: request.resourceType,
    };
    if (response === undefined) {
      const failed = drained.find(
        (payload) =>
          typeof payload === 'object' &&
          payload !== null &&
          (payload as { subkind?: string }).subkind === 'requestfailed' &&
          (payload as { url?: string }).url === request.url,
      );
      if (failed !== undefined) {
        record.failure =
          (failed as { errorText?: string }).errorText ?? 'request failed without a response';
      }
    } else {
      record.status = response.status;
      record.headers = stripVolatileHeaders(response.headers);
      if (response.bodyPreview !== undefined) {
        record.body = response.bodyPreview;
      }
    }
    out.push(record);
  }
  return out;
}
