/**
 * @clapp/observe — PageDriver: the structural port the ObservationRunner
 * drives a page through.
 *
 * PlaywrightSession implements it against a real browser; tests implement
 * it with fakes (runner wiring is unit-testable without a browser). The
 * port is deliberately minimal: navigate, evaluate (string-function
 * convention, see dom-kit), screenshot, keyboard, cookie access, and the
 * deterministic network drain used at settlement points.
 */

import type { DriverCookie, RawStorageSnapshot, ServiceWorkerRegisteredPayload } from './logs/storage';
import type { NetworkCapturePayload } from './logs/network';
import type { CaptureSink } from './session-core';

export type NavigateWaitUntil = 'load' | 'domcontentloaded' | 'networkidle';

export interface PageDriver {
  /** goto url, waiting for the given lifecycle point. */
  navigate(url: string, waitUntil?: NavigateWaitUntil): Promise<void>;
  /**
   * Evaluate a dom-kit function-source string with a JSON-able argument
   * (self-invoking expression convention — see dom-kit module header).
   */
  evaluate<T = unknown>(fnSource: string, arg?: unknown): Promise<T>;
  /** Full-viewport or full-page PNG bytes. */
  screenshotPng(fullPage: boolean): Promise<Uint8Array>;
  /** Press a key on the page keyboard (e.g. 'Enter', 'Control+A'). */
  pressKey(key: string): Promise<void>;
  /**
   * Drain settled network activity at a settlement point: response and
   * failure records for requests initiated so far, in request-initiation
   * order (deterministic); in-flight requests stay pending for the next
   * drain.
   */
  drainPendingNetwork(): NetworkCapturePayload[];
  /** Drain pending service-worker registration events (after network drain). */
  drainPendingServiceWorkers(): ServiceWorkerRegisteredPayload[];
  /** Structured cookies visible to this browser context. */
  cookies(): Promise<DriverCookie[]>;
  /** Page-side raw storage snapshot (in-page STORAGE_SNAPSHOT_FN result). */
  storageSnapshot(): Promise<RawStorageSnapshot>;
  /** Close the page/context (NOT the browser — caller owns it). */
  close(): Promise<void>;
}

/** Factory the runner uses to open a driver per observation session. */
export type PageDriverFactory = (opts: { targetId: string }) => Promise<PageDriver>;

/** Optional capability: subscribe live capture events into the runner's funnel. */
export interface CaptureCapableDriver extends PageDriver {
  /** Wire live subscriptions (console/network/WS/SW/CDP) to the sink. Throws on double-wiring. */
  wireCapture(sink: CaptureSink): void;
}
