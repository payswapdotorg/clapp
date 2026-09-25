/**
 * @clapp/observe — PlaywrightSession: page/context lifecycle + capture
 * subscriptions (CLAPP-010 adapter).
 *
 * Owns, per observation session:
 *  - a fresh BrowserContext + Page (the caller owns the Browser — closing
 *    the session closes the context only);
 *  - a CDP session attach (chromium; non-chromium falls back to no CDP —
 *    `cdpAttached` reports honestly) wired to Log.entryAdded, filtered by
 *    level policy (default: error-level only — see README for why);
 *  - every live subscription: console, pageerror, request/response/
 *    requestfailed, WebSocket frames, service-worker starts;
 *  - the pending-network map drained deterministically at settlement
 *    points (request-initiation order, responses batched; see
 *    logs/network.ts for the determinism rationale).
 *
 * Ordering guarantee: ALL event→sink work runs through ONE ordered async
 * queue (queueJob). Events that need async data (console args via
 * jsonValue, response headers/bodies) would otherwise reorder against
 * each other — the queue preserves event-arrival order exactly, which is
 * what makes capture sequences replay-comparable for deterministic apps.
 */

import type { Browser, BrowserContext, BrowserContextOptions, CDPSession, ConsoleMessage, Page } from 'playwright';
import { STORAGE_SNAPSHOT_FN } from './dom-kit';
import {
  buildRequestFailedPayload,
  buildRequestPayload,
  buildResponsePayload,
  MAX_BODY_BYTES,
  type NetworkCapturePayload,
} from './logs/network';
import { buildBrowserLogPayload, buildPageErrorPayload, sanitizeConsoleArg } from './logs/runtime';
import type { DriverCookie, RawStorageSnapshot, ServiceWorkerRegisteredPayload } from './logs/storage';
import type { NavigateWaitUntil, PageDriver } from './page-driver';
import type { CaptureSink } from './session-core';

export interface PlaywrightSessionOptions {
  browser: Browser;
  contextOptions?: BrowserContextOptions;
  /** CDP Log.entryAdded levels to capture (default ['error']). */
  cdpLogLevels?: readonly string[];
  /** timeout for navigation/screenshot operations (default 30_000 ms). */
  defaultTimeoutMs?: number;
}

interface PendingNetworkEntry {
  url: string;
  method: string;
  resourceType: string;
  postData: string | null;
  response?: {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    mimeType?: string;
    bodyPreview?: string;
    fromServiceWorker: boolean;
    sizeBytes?: number;
  };
  failure?: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_CDP_LOG_LEVELS: readonly string[] = ['error'];

/**
 * The self-invoking-expression evaluate convention (see dom-kit header):
 * wraps the function source and inlines the JSON argument.
 */
export function evaluateFnSource(fnSource: string, arg?: unknown): string {
  const argJson = arg === undefined ? '' : JSON.stringify(arg);
  return `(${fnSource})(${argJson})`;
}

/** Opens a session: context + page + CDP attach. */
export class PlaywrightSession implements PageDriver {
  private readonly context: BrowserContext;
  private readonly page: Page;
  private readonly cdp: CDPSession | null;
  private readonly cdpLogLevels: readonly string[];
  private readonly timeoutMs: number;
  private sink: CaptureSink | null = null;
  private readonly pending = new Map<object, PendingNetworkEntry>();
  private readonly pendingServiceWorkers: Array<{ scriptUrl: string }> = [];
  private tail: Promise<void> = Promise.resolve();
  private captureErrors = 0;
  private lastCaptureErrorMessage: string | undefined;

  private constructor(context: BrowserContext, page: Page, cdp: CDPSession | null, options: PlaywrightSessionOptions) {
    this.context = context;
    this.page = page;
    this.cdp = cdp;
    this.cdpLogLevels = options.cdpLogLevels ?? DEFAULT_CDP_LOG_LEVELS;
    this.timeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  static async open(options: PlaywrightSessionOptions): Promise<PlaywrightSession> {
    const context = await options.browser.newContext(options.contextOptions ?? { viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    let cdp: CDPSession | null = null;
    try {
      cdp = await context.newCDPSession(page);
      await cdp.send('Log.enable');
    } catch {
      cdp = null; // non-chromium or CDP unavailable — reported via cdpAttached
    }
    return new PlaywrightSession(context, page, cdp, options);
  }

  get cdpAttached(): boolean {
    return this.cdp !== null;
  }

  get captureErrorCount(): number {
    return this.captureErrors;
  }

  get lastCaptureError(): string | undefined {
    return this.lastCaptureErrorMessage;
  }

  /**
   * Subscribes every live capture channel to the sink. Idempotent guard:
   * double wiring would double every record — throws instead.
   */
  wireCapture(sink: CaptureSink): void {
    if (this.sink !== null) {
      throw new Error('PlaywrightSession.wireCapture: sink already wired');
    }
    this.sink = sink;

    this.page.on('console', (message: ConsoleMessage) => {
      this.queueJob(async () => {
        const args: unknown[] = [];
        for (const handle of message.args()) {
          try {
            args.push(sanitizeConsoleArg(await handle.jsonValue()));
          } catch {
            args.push('[unserializable]');
          }
        }
        const location = message.location();
        this.emit('runtime.console', {
          subkind: 'console',
          level: message.type(),
          text: message.text(),
          args,
          location: { url: location.url, line: location.line, column: location.column },
        });
      });
    });

    this.page.on('pageerror', (error: Error) => {
      this.queueJob(() => {
        this.emit('runtime.pageerror', buildPageErrorPayload(error.message, error.stack));
      });
    });

    this.page.on('request', (request) => {
      this.queueJob(() => {
        const entry: PendingNetworkEntry = {
          url: request.url(),
          method: request.method(),
          resourceType: request.resourceType(),
          postData: request.postData(),
        };
        this.pending.set(request, entry);
        this.emit(
          'network.request',
          buildRequestPayload({
            url: entry.url,
            method: entry.method,
            resourceType: entry.resourceType,
            headers: { ...request.headers() },
            postData: entry.postData,
          }),
        );
      });
    });

    this.page.on('response', (response) => {
      this.queueJob(async () => {
        const entry = this.pending.get(response.request());
        if (entry === undefined) return;
        let headers: Record<string, string> = {};
        try {
          headers = { ...response.headers() };
        } catch {
          headers = {};
        }
        const contentType = headers['content-type'] ?? '';
        const contentLengthHeader = headers['content-length'] ?? '';
        const contentLength = Number.parseInt(contentLengthHeader, 10);
        let bodyPreview: string | undefined;
        if (isTextualMime(contentType) && (Number.isNaN(contentLength) || contentLength <= MAX_BODY_BYTES)) {
          try {
            const body = await response.body();
            if (body.byteLength <= MAX_BODY_BYTES) {
              bodyPreview = new TextDecoder('utf-8', { fatal: false }).decode(body);
            }
          } catch {
            // redirect responses and friends have no body — preview stays absent
          }
        }
        entry.response = {
          status: response.status(),
          statusText: response.statusText(),
          headers,
          mimeType: contentType.split(';')[0]?.trim() === '' ? undefined : contentType.split(';')[0]?.trim(),
          bodyPreview,
          fromServiceWorker: response.fromServiceWorker(),
          sizeBytes: Number.isNaN(contentLength) ? undefined : contentLength,
        };
      });
    });

    this.page.on('requestfailed', (request) => {
      this.queueJob(() => {
        const entry = this.pending.get(request);
        if (entry !== undefined) {
          entry.failure = request.failure()?.errorText ?? 'unknown';
        }
      });
    });

    this.page.on('websocket', (websocket) => {
      const url = websocket.url();
      websocket.on('framesent', (frame) => {
        this.queueJob(() => {
          this.emit('network.ws-frame', {
            subkind: 'ws-frame',
            url,
            direction: 'sent',
            payload: typeof frame.payload === 'string' ? frame.payload : new TextDecoder().decode(frame.payload),
            byteLength:
              typeof frame.payload === 'string'
                ? new TextEncoder().encode(frame.payload).byteLength
                : frame.payload.byteLength,
            isBinary: typeof frame.payload !== 'string',
          });
        });
      });
      websocket.on('framereceived', (frame) => {
        this.queueJob(() => {
          this.emit('network.ws-frame', {
            subkind: 'ws-frame',
            url,
            direction: 'received',
            payload: typeof frame.payload === 'string' ? frame.payload : new TextDecoder().decode(frame.payload),
            byteLength:
              typeof frame.payload === 'string'
                ? new TextEncoder().encode(frame.payload).byteLength
                : frame.payload.byteLength,
            isBinary: typeof frame.payload !== 'string',
          });
        });
      });
    });

    this.context.on('serviceworker', (worker) => {
      this.queueJob(() => {
        this.pendingServiceWorkers.push({ scriptUrl: worker.url() });
      });
    });

    if (this.cdp !== null) {
      this.cdp.on('Log.entryAdded', (event: unknown) => {
        this.queueJob(() => {
          const payload = buildBrowserLogPayload(event);
          if (payload === null) return;
          if (!this.cdpLogLevels.includes(payload.level)) return;
          this.emit('runtime.browser-log', payload);
        });
      });
    }
  }

  // --- PageDriver ---------------------------------------------------------

  async navigate(url: string, waitUntil: NavigateWaitUntil = 'load'): Promise<void> {
    await this.page.goto(url, { waitUntil, timeout: this.timeoutMs });
  }

  async evaluate<T = unknown>(fnSource: string, arg?: unknown): Promise<T> {
    return (await this.page.evaluate(evaluateFnSource(fnSource, arg))) as T;
  }

  async screenshotPng(fullPage: boolean): Promise<Uint8Array> {
    const buffer = await this.page.screenshot({ type: 'png', fullPage, animations: 'disabled', timeout: this.timeoutMs });
    return new Uint8Array(buffer);
  }

  async pressKey(key: string): Promise<void> {
    await this.page.keyboard.press(key);
  }

  drainPendingNetwork(): NetworkCapturePayload[] {
    const drained: NetworkCapturePayload[] = [];
    for (const [request, entry] of this.pending) {
      if (entry.response !== undefined) {
        drained.push(
          buildResponsePayload({
            url: entry.url,
            method: entry.method,
            resourceType: entry.resourceType,
            status: entry.response.status,
            statusText: entry.response.statusText,
            headers: entry.response.headers,
            mimeType: entry.response.mimeType,
            bodyPreview: entry.response.bodyPreview,
            fromServiceWorker: entry.response.fromServiceWorker,
            sizeBytes: entry.response.sizeBytes,
          }),
        );
        this.pending.delete(request);
      } else if (entry.failure !== undefined) {
        drained.push(
          buildRequestFailedPayload({
            url: entry.url,
            method: entry.method,
            resourceType: entry.resourceType,
            errorText: entry.failure,
          }),
        );
        this.pending.delete(request);
      }
    }
    return drained;
  }

  /**
   * Drains service-worker registration events accumulated since the last
   * drain. Called AFTER drainPendingNetwork at settlement points so the
   * record position is deterministic (network records, then SW events).
   */
  drainPendingServiceWorkers(): ServiceWorkerRegisteredPayload[] {
    return this.pendingServiceWorkers.splice(0).map((registration) => ({
      subkind: 'sw-registered',
      scriptUrl: registration.scriptUrl,
    }));
  }

  async cookies(): Promise<DriverCookie[]> {
    const cookies = await this.context.cookies();
    return cookies.map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      expires: cookie.expires,
      httpOnly: cookie.httpOnly,
      secure: cookie.secure,
      sameSite: cookie.sameSite,
    }));
  }

  async storageSnapshot(): Promise<RawStorageSnapshot> {
    return this.evaluate<RawStorageSnapshot>(STORAGE_SNAPSHOT_FN);
  }

  async close(): Promise<void> {
    await this.context.close();
  }

  // --- internals ----------------------------------------------------------

  private emit(channel: Parameters<CaptureSink>[0], payload: unknown): void {
    if (this.sink === null) return;
    this.sink(channel, payload);
  }

  private queueJob(job: () => Promise<void> | void): void {
    this.tail = this.tail.then(job).catch((error: unknown) => {
      this.captureErrors++;
      this.lastCaptureErrorMessage = error instanceof Error ? error.message : String(error);
    });
  }
}

function isTextualMime(mimeType: string): boolean {
  const lower = mimeType.toLowerCase();
  return (
    lower.startsWith('text/') ||
    lower.includes('json') ||
    lower.includes('javascript') ||
    lower.includes('xml') ||
    lower.includes('form-urlencoded')
  );
}

/**
 * Default driver factory: one PlaywrightSession per observation run.
 * The runner never imports playwright directly — consumers wire this in.
 */
export function createPlaywrightDriverFactory(options: PlaywrightSessionOptions): (opts: { targetId: string }) => Promise<PageDriver> {
  return async () => PlaywrightSession.open(options);
}
