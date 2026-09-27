/**
 * @clapp/diff — the paired-run capture pipeline.
 *
 * One journey side (left OR right) is driven step-by-step through the SAME
 * ActionApplier vocabulary (@clapp/journey's createDomApplier /
 * createPlaywrightApplier); every observation the run makes is funneled
 * into typed capture entries shaped after the @clapp/observe capture
 * vocabulary (CaptureRecord: { kind, ts, payload, redacted }), hashed over
 * their canonical bytes, and sealed into a per-side bundle whose root hash
 * makes {@link SideRunResult}.evidenceRef verifiable.
 *
 * Capture channels (per driver — see DIFF_ADAPTER_INFO for the honest
 * capability matrix):
 *
 *   replayer-dom (always available):
 *     - network: every HTTP transaction the applier makes, captured by a
 *       fetch wrapper (method, url, status, the diff-relevant response
 *       header subset: content-type / set-cookie / location);
 *     - dom: the fetched document itself (HTML text) for document
 *       responses — this is the step page capture;
 *     - storage: cookies OBSERVED via Set-Cookie response headers, post-
 *       run (no script execution — the dom applier never runs page JS, so
 *       localStorage/sessionStorage are never fabricated as present).
 *
 *   replayer-playwright (browser-backed, lazily loaded):
 *     - network: page response listener (url/method/status/header subset);
 *     - dom: page.content() after EVERY applied action (the live
 *       post-script DOM — richer than the fetched bytes);
 *     - storage: a real post-run browser inventory (context cookies +
 *       localStorage/sessionStorage via in-page evaluation).
 *
 * Every capture entry's EvidenceRef.sha256 is the sha256 of the canonical
 * JSON bytes of its CaptureRecord; the side bundle's rootHash is the
 * sha256 of the canonical JSON manifest listing every entry ref in capture
 * order. Nothing is asserted about bytes that were not observed.
 */

import { sha256Hex, type EvidenceKind, type EvidenceRef } from '@clapp/core';
import { canonicalJson, pruneUndefined } from '@clapp/observe';
import type { DiffSide } from './diff-contract';
import type { DiffIdFactory } from './ids';

/** The diff-relevant response header subset that enters evidence bytes. */
export const CAPTURED_RESPONSE_HEADERS: readonly string[] = ['content-type', 'set-cookie', 'location'];

// ---------------------------------------------------------------------------
// Payload shapes (canonical-JSON-safe by construction)
// ---------------------------------------------------------------------------

/** One HTTP transaction capture (kind: 'network'). */
export interface NetworkCapturePayload {
  subkind: 'http-transaction';
  stepIndex: number;
  method: string;
  url: string;
  status: number;
  contentType?: string;
  setCookie: string[];
  location?: string;
}

/** One document capture (kind: 'dom'). */
export interface PageCapturePayload {
  subkind: 'page-html';
  stepIndex: number;
  url: string;
  html: string;
}

/**
 * One storage inventory capture (kind: 'storage'), shaped after the
 * observe storage-inventory vocabulary. Under replayer-dom the inventory
 * is honest-by-limitation: cookies observed via response headers only and
 * EMPTY ls/ss entries (never fabricated).
 */
export interface StorageCapturePayload {
  subkind: 'storage-inventory';
  origin: string;
  source: 'response-headers' | 'browser-inventory';
  cookies: { name: string; value: string; path?: string }[];
  localStorage: { key: string; value: string }[];
  sessionStorage: { key: string; value: string }[];
}

// ---------------------------------------------------------------------------
// Capture entries + side bundles
// ---------------------------------------------------------------------------

/** A sealed capture entry: the record, its capture id, and its evidence ref. */
export interface CaptureEntry {
  captureId: string;
  kind: EvidenceKind;
  ts: string;
  payload: unknown;
  redacted: boolean;
  evidence: EvidenceRef;
}

/** One sealed side bundle: every entry plus the root-hash manifest. */
export interface SideCaptureBundle {
  side: DiffSide;
  journeyId: string;
  targetId: string;
  driver: 'replayer-dom' | 'replayer-playwright';
  /** every capture in capture order (network, dom, storage interleaved). */
  entries: CaptureEntry[];
  /** capture id → entry (pages and network alike). */
  byCaptureId: Map<string, CaptureEntry>;
  /** step index → page capture id (fresh captures only). */
  pageAtStep: Map<number, string>;
  /** step index → network capture id (fresh captures only). */
  networkAtStep: Map<number, string>;
  /** the SideRunResult.evidenceRef (rootHash-verifiable). */
  rootRef: EvidenceRef;
  /** the canonical manifest text whose sha256 is rootRef.sha256. */
  manifestText: string;
}

/** Manifest sealed into a side bundle's root hash. */
export interface SideBundleManifest {
  side: DiffSide;
  journeyId: string;
  targetId: string;
  driver: 'replayer-dom' | 'replayer-playwright';
  entries: EvidenceRef[];
}

// ---------------------------------------------------------------------------
// The capture collector
// ---------------------------------------------------------------------------

export interface CaptureCollectorInit {
  side: DiffSide;
  targetId: string;
  baseUrl: string;
  ids: DiffIdFactory;
  now: () => Date;
  fetchImpl?: typeof fetch;
}

/**
 * Accumulates capture entries for ONE side of ONE journey replay. The
 * collector exposes the wrapped fetch (for the dom applier), tracks the
 * active step index, and seals the bundle at the end.
 */
export class CaptureCollector {
  readonly side: DiffSide;
  readonly targetId: string;
  readonly origin: string;
  private readonly ids: DiffIdFactory;
  private readonly now: () => Date;
  private readonly underlyingFetch: typeof fetch;
  private readonly entries: CaptureEntry[] = [];
  private readonly byCaptureId = new Map<string, CaptureEntry>();
  private readonly pageAtStep = new Map<number, string>();
  private readonly networkAtStep = new Map<number, string>();
  private activeStep = 0;

  constructor(init: CaptureCollectorInit) {
    this.side = init.side;
    this.targetId = init.targetId;
    this.ids = init.ids;
    this.now = init.now;
    this.underlyingFetch = init.fetchImpl ?? globalThis.fetch;
    this.origin = new URL(init.baseUrl).origin;
  }

  /** The runner sets this before applying each journey action. */
  setActiveStep(stepIndex: number): void {
    this.activeStep = stepIndex;
  }

  /** The step the side is currently on (network listeners read this). */
  currentStep(): number {
    return this.activeStep;
  }

  /** The captured origin (the side's baseUrl origin). */
  originOf(): string {
    return this.origin;
  }

  /** The page capture id recorded at a step (absent when none). */
  pageCaptureIdAt(stepIndex: number): string | undefined {
    return this.pageAtStep.get(stepIndex);
  }

  /** The network capture id recorded at a step (absent when none). */
  networkCaptureIdAt(stepIndex: number): string | undefined {
    return this.networkAtStep.get(stepIndex);
  }

  /** The fetch implementation the dom applier is constructed with. */
  readonly fetch: typeof fetch = (async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): Promise<Response> => {
    const response = await this.underlyingFetch(input, init);
    try {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();
      const contentType = response.headers.get('content-type') ?? undefined;
      const setCookie =
        typeof response.headers.getSetCookie === 'function'
          ? response.headers.getSetCookie()
          : (response.headers.get('set-cookie') ?? '').split(', ').filter((value) => value !== '');
      const location = response.headers.get('location') ?? undefined;
      const status = response.status;

      const networkPayload: NetworkCapturePayload = {
        subkind: 'http-transaction',
        stepIndex: this.activeStep,
        method,
        url,
        status,
        setCookie,
      };
      if (contentType !== undefined) {
        networkPayload.contentType = contentType;
      }
      if (location !== undefined) {
        networkPayload.location = location;
      }
      await this.seal('network', networkPayload, this.ids.newCaptureId());
      this.networkAtStep.set(this.activeStep, this.lastCaptureId());

      if (contentType !== undefined && contentType.toLowerCase().includes('text/html')) {
        const text = await response.clone().text();
        await this.seal(
          'dom',
          { subkind: 'page-html', stepIndex: this.activeStep, url, html: text } satisfies PageCapturePayload,
          this.ids.newCaptureId(),
        );
        this.pageAtStep.set(this.activeStep, this.lastCaptureId());
      }
    } catch {
      // Capture must never break the replay; a failed capture is an absent
      // entry (honest: absent, never fabricated).
    }
    return response;
  }) as typeof fetch;
  private lastCaptureId(): string {
    return this.entries[this.entries.length - 1]?.captureId ?? '';
  }

  /** Records + hashes one capture entry (the only way entries are made). */
  private async seal(kind: EvidenceKind, payload: unknown, captureId: string): Promise<CaptureEntry> {
    const ts = this.now().toISOString();
    // pruneUndefined: optional-absent payload fields (contentType, location,
    // …) are dropped, never hashed as explicit undefined — the same
    // "absent, never null" discipline the contract mandates.
    const record = { kind, ts, payload: pruneUndefined(payload), redacted: false };
    const evidence: EvidenceRef = {
      evidenceId: this.ids.newEvidenceId(),
      kind,
      sha256: await sha256Hex(canonicalJson(record)),
    };
    const entry: CaptureEntry = { captureId, kind, ts, payload: record.payload, redacted: false, evidence };
    this.entries.push(entry);
    this.byCaptureId.set(captureId, entry);
    return entry;
  }

  /** Records an externally-driven network observation (playwright path). */
  async recordNetwork(payload: NetworkCapturePayload): Promise<void> {
    await this.seal('network', payload, this.ids.newCaptureId());
    if (!this.networkAtStep.has(payload.stepIndex)) {
      this.networkAtStep.set(payload.stepIndex, this.lastCaptureId());
    }
  }

  /** Records an externally-driven page capture (playwright path). */
  async recordPage(payload: PageCapturePayload): Promise<void> {
    await this.seal('dom', payload, this.ids.newCaptureId());
    this.pageAtStep.set(payload.stepIndex, this.lastCaptureId());
  }

  /** Records the post-run storage inventory (either driver). */
  async recordStorage(payload: StorageCapturePayload): Promise<void> {
    await this.seal('storage', payload, this.ids.newCaptureId());
  }

  /** All http-transaction payloads observed so far, in capture order. */
  networkPayloads(): NetworkCapturePayload[] {
    return this.entries
      .filter((entry) => entry.kind === 'network')
      .map((entry) => entry.payload as NetworkCapturePayload);
  }

  /** The page capture id for a step, or the latest one at/before it. */
  pageIdAtOrBefore(stepIndex: number): string | undefined {
    let bestStep = -1;
    let bestId: string | undefined;
    for (const [step, captureId] of this.pageAtStep) {
      if (step <= stepIndex && step > bestStep) {
        bestStep = step;
        bestId = captureId;
      }
    }
    return bestId;
  }

  /** Seals the side bundle (root manifest + hash). */
  async sealBundle(journeyId: string, driver: 'replayer-dom' | 'replayer-playwright'): Promise<SideCaptureBundle> {
    const manifest: SideBundleManifest = {
      side: this.side,
      journeyId,
      targetId: this.targetId,
      driver,
      entries: this.entries.map((entry) => entry.evidence),
    };
    const manifestText = canonicalJson(manifest);
    const rootRef: EvidenceRef = {
      evidenceId: this.ids.newEvidenceId(),
      kind: 'dom',
      sha256: await sha256Hex(manifestText),
    };
    return {
      side: this.side,
      journeyId,
      targetId: this.targetId,
      driver,
      entries: [...this.entries],
      byCaptureId: this.byCaptureId,
      pageAtStep: new Map(this.pageAtStep),
      networkAtStep: new Map(this.networkAtStep),
      rootRef,
      manifestText,
    };
  }
}

// ---------------------------------------------------------------------------
// Storage inventory builders (the honest per-driver subsets)
// ---------------------------------------------------------------------------

export interface ObservedCookie {
  name: string;
  value: string;
  path?: string;
}

/** Parses an observed Set-Cookie header value into its comparable parts. */
export function parseSetCookie(header: string): ObservedCookie {
  const [pair, ...attributes] = header.split(';');
  const pairText = pair ?? '';
  const separator = pairText.indexOf('=');
  const name = separator === -1 ? pairText.trim() : pairText.slice(0, separator).trim();
  const value = separator === -1 ? '' : pairText.slice(separator + 1).trim();
  const pathAttr = attributes
    .map((attribute) => attribute.trim())
    .find((attribute) => attribute.toLowerCase().startsWith('path='));
  const cookie: ObservedCookie = { name, value };
  if (pathAttr !== undefined) {
    cookie.path = pathAttr.slice('path='.length);
  }
  return cookie;
}

/**
 * The replayer-dom post-run inventory: cookies observed via Set-Cookie
 * response headers ONLY. localStorage/sessionStorage stay EMPTY — the dom
 * applier does not execute page scripts, so no entry is ever fabricated.
 */
export function responseHeaderStorageInventory(
  origin: string,
  networkPayloads: NetworkCapturePayload[],
): StorageCapturePayload {
  const cookies: ObservedCookie[] = [];
  for (const payload of networkPayloads) {
    for (const header of payload.setCookie) {
      cookies.push(parseSetCookie(header));
    }
  }
  return {
    subkind: 'storage-inventory',
    origin,
    source: 'response-headers',
    cookies,
    localStorage: [],
    sessionStorage: [],
  };
}

/**
 * The replayer-playwright post-run inventory: a real browser inventory
 * (context cookies + in-page localStorage/sessionStorage reads).
 */
export function browserStorageInventory(
  origin: string,
  cookies: ObservedCookie[],
  localStorage: Record<string, string>,
  sessionStorage: Record<string, string>,
): StorageCapturePayload {
  return {
    subkind: 'storage-inventory',
    origin,
    source: 'browser-inventory',
    cookies,
    localStorage: Object.entries(localStorage).map(([key, value]) => ({ key, value })),
    sessionStorage: Object.entries(sessionStorage).map(([key, value]) => ({ key, value })),
  };
}
