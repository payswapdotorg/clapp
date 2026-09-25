/**
 * @clapp/journey — Playwright ActionApplier (browser-backed replay).
 *
 * The DOM applier (replayer.ts) is the DEFAULT, always-available adapter.
 * This applier drives a REAL browser page when one is available, executing
 * the same journey actions with full layout, CSS, and script execution —
 * the parity reference the DOM applier approximates.
 *
 * `playwright-core` is a devDependency of this package; the module loads
 * it LAZILY (dynamic import inside the factory), so importing
 * `@clapp/journey` — and the sandbox proof child — never requires a
 * browser or the playwright runtime. Tests using this applier are
 * skipIf-gated on browser availability; the contract's guaranteed
 * coverage is the DOM applier path (see replayer-dom.test.ts and
 * sandbox-proof.test.ts).
 *
 * Selector mapping (documented approximation of the DOM applier's rules):
 * - testId → `getByTestId` (default data-testid attribute);
 * - role (+name, exact match) → `getByRole`;
 * - name only → `getByText` (exact);
 * - an empty selector → `locator('*')` (strict mode makes multi-matches
 *   ambiguous, mirroring the DOM applier's default strictness);
 * - `nth` → `locator.nth(nth)`.
 * When several anchors are present, testId wins, then role+name, then
 * name — additional fields are not ANDed (unlike the DOM applier).
 *
 * Error mapping: Playwright strict-mode violations map to
 * `target-ambiguous`; element-resolution timeouts map to
 * `target-not-found` (or `assert-visible-failed` when the element exists
 * but is not visible); everything else wraps as `action-failed` (or
 * `fill-not-supported` for fill on non-fillable elements) with the
 * original error as `cause`.
 */

import type { Browser, Locator, Page } from 'playwright-core';
import type { ActionApplier, JourneyAction, TargetSelector } from './journey-contract';
import { JourneyReplayError, type ReplayErrorCode } from './replayer';

export interface PlaywrightApplierOptions {
  /** Drive an existing page (caller owns its lifecycle). */
  page?: Page;
  /**
   * Chromium launch options when no page is passed (headless by default).
   */
  launch?: { headless?: boolean };
  /**
   * Base URL relative `navigate` actions resolve against. Required for
   * relative URLs when driving your own page; ignored (derived) otherwise.
   */
  baseUrl?: string;
  /** Default per-action timeout; default 5_000 ms. */
  timeoutMs?: number;
}

/** A browser-backed ActionApplier; `close()` shuts down a launched browser. */
export interface PlaywrightApplier extends ActionApplier {
  close(): Promise<void>;
}

function isStrictViolation(error: unknown): boolean {
  return error instanceof Error && /strict mode violation/i.test(error.message);
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && /timeout/i.test(error.message);
}

function describeTarget(target: TargetSelector): string {
  return JSON.stringify(target);
}

/**
 * Creates a Playwright-backed ActionApplier. Loads playwright-core lazily;
 * throws a plain Error (not a replay error) if the runtime is missing.
 */
export async function createPlaywrightApplier(
  options: PlaywrightApplierOptions = {},
): Promise<PlaywrightApplier> {
  const playwright = await import('playwright-core');

  let browser: Browser | null = null;
  let page: Page | null = options.page ?? null;
  if (page === null) {
    browser = await playwright.chromium.launch({
      headless: options.launch?.headless ?? true,
    });
    page = await browser.newPage();
  }
  const activePage: Page = page;
  const timeoutMs = options.timeoutMs ?? 5_000;
  activePage.setDefaultTimeout(timeoutMs);
  const baseUrl = options.baseUrl !== undefined ? new URL(options.baseUrl) : null;

  function locatorFor(target: TargetSelector): Locator {
    let locator: Locator;
    if (target.testId !== undefined) {
      locator = activePage.getByTestId(target.testId);
    } else if (target.role !== undefined) {
      // The journey contract allows arbitrary role strings; unknown roles
      // simply match nothing. Cast for playwright's literal-union typing.
      const role = target.role as Parameters<Page['getByRole']>[0];
      locator = activePage.getByRole(role, { name: target.name, exact: true });
    } else if (target.name !== undefined) {
      locator = activePage.getByText(target.name, { exact: true });
    } else {
      locator = activePage.locator('*');
    }
    return target.nth !== undefined ? locator.nth(target.nth) : locator;
  }

  function wrap(error: unknown, action: JourneyAction, fallback: ReplayErrorCode): JourneyReplayError {
    const target: TargetSelector =
      action.type === 'click' || action.type === 'fill' || action.type === 'assert-visible'
        ? action.target
        : {};
    if (isStrictViolation(error)) {
      return new JourneyReplayError(
        'target-ambiguous',
        `Selector ${describeTarget(target)} matched multiple elements (Playwright strict mode).`,
        { action, details: { cause: String(error) }, cause: error },
      );
    }
    if (isTimeout(error)) {
      return new JourneyReplayError(
        'target-not-found',
        `Selector resolution timed out for action ${action.type}: ${String(
          error instanceof Error ? error.message.split('\n')[0] : error,
        )}`,
        { action, details: { cause: String(error) }, cause: error },
      );
    }
    return new JourneyReplayError(
      fallback,
      `Action ${action.type} failed in the browser: ${
        error instanceof Error ? error.message.split('\n')[0] : String(error)
      }`,
      { action, details: { cause: String(error) }, cause: error },
    );
  }

  async function attempt<TValue>(
    fn: () => Promise<TValue>,
    action: JourneyAction,
    fallback: ReplayErrorCode,
  ): Promise<TValue> {
    try {
      return await fn();
    } catch (error) {
      throw wrap(error, action, fallback);
    }
  }

  return {
    async apply(action: JourneyAction): Promise<void> {
      switch (action.type) {
        case 'navigate': {
          let href: string;
          try {
            href = (baseUrl !== null ? new URL(action.url, baseUrl) : new URL(action.url)).href;
          } catch {
            throw new JourneyReplayError(
              'navigate-failed',
              `Cannot resolve url ${JSON.stringify(action.url)} (relative urls require baseUrl).`,
              { action, details: { url: action.url } },
            );
          }
          await attempt(
            () => activePage.goto(href, { waitUntil: 'load' }),
            action,
            'navigate-failed',
          );
          return;
        }
        case 'click':
          await attempt(() => locatorFor(action.target).click(), action, 'action-failed');
          return;
        case 'fill':
          await attempt(() => locatorFor(action.target).fill(action.value), action, 'fill-not-supported');
          return;
        case 'press':
          await attempt(() => activePage.keyboard.press(action.key), action, 'action-failed');
          return;
        case 'wait':
          await activePage.waitForTimeout(action.ms);
          return;
        case 'assert-visible': {
          const locator = locatorFor(action.target);
          try {
            await locator.waitFor({ state: 'visible', timeout: timeoutMs });
            return;
          } catch (error) {
            if (isStrictViolation(error)) {
              throw wrap(error, action, 'assert-visible-failed');
            }
            const count = await locator.count().catch(() => 0);
            if (count === 0) {
              throw new JourneyReplayError(
                'target-not-found',
                `No element matched selector ${describeTarget(action.target)} on ${activePage.url()}.`,
                { action, details: { selector: action.target, url: activePage.url() }, cause: error },
              );
            }
            throw new JourneyReplayError(
              'assert-visible-failed',
              `Target matched ${count} element(s) but none became visible on ${activePage.url()}.`,
              { action, details: { selector: action.target, url: activePage.url() }, cause: error },
            );
          }
        }
      }
    },

    async close(): Promise<void> {
      if (browser !== null) {
        await browser.close();
        browser = null;
      }
    },
  };
}
