/**
 * @clapp/journey — DOM action applier + journey replayer (journey contract v0).
 *
 * `createDomApplier` is the DEFAULT, ALWAYS-AVAILABLE ActionApplier: it
 * fetches pages (via the injectable fetch implementation), parses them with
 * the dependency-free minidom shim, and executes journey actions in order:
 *
 * - navigate           → GET the URL (relative URLs resolve against the
 *                        current page URL), replace the current document.
 * - click              → resolve the target; if it (or an ancestor) is an
 *                        <a href>, navigate; if it is a form submitter,
 *                        submit the form (GET → action?params, POST →
 *                        form-urlencoded body); otherwise a no-op success
 *                        (no script execution — see limitations).
 * - fill               → resolve the target; set the value of a text-like
 *                        <input> or <textarea>. Other elements throw.
 * - press              → approximation: Enter submits the form of the most
 *                        recently interacted element; every other key is a
 *                        no-op success (no script execution, no focus model).
 * - wait               → sleep the given milliseconds.
 * - assert-visible     → resolve the target; it must exist and not be
 *                        hidden (hidden attribute, inline
 *                        display:none/visibility:hidden on self or an
 *                        ancestor, or input[type=hidden]) — otherwise a
 *                        machine-readable JourneyReplayError is thrown.
 *
 * Selector resolution: role/name/testId fields AND together; `nth` picks
 * among matches. In strict mode (default) a selector without `nth` that
 * matches more than one element is an ambiguity error; elements with
 * aria-hidden="true" never match.
 *
 * Honest limitations (full list in README):
 * - No script execution and no layout engine: page JS never runs, and
 *   visibility ignores external stylesheets (CSS files are not evaluated).
 * - Cross-origin navigation is BLOCKED by default (deny-all posture
 *   alignment); opt in with `allowCrossOrigin: true`.
 * - `res.url` after redirects is trusted when the runtime provides it.
 */

import type { ActionApplier, Journey, JourneyAction, TargetSelector } from './journey-contract';
import { accessibleName, collapseWhitespace, effectiveRole } from './a11y';
import { parseHtml, type MiniDocument, type MiniElement } from './minidom';
import { validateJourney, validateJourneyDetailed } from './validate';

// ---------------------------------------------------------------------------
// Machine-readable replay errors
// ---------------------------------------------------------------------------

export type ReplayErrorCode =
  | 'journey-invalid'
  | 'navigate-failed'
  | 'navigate-blocked'
  | 'navigate-unsupported'
  | 'target-not-found'
  | 'target-ambiguous'
  | 'assert-visible-failed'
  | 'fill-not-supported'
  | 'action-failed';

export interface JourneyReplayErrorOptions {
  action?: JourneyAction;
  actionIndex?: number;
  details?: Record<string, unknown>;
  cause?: unknown;
}

/**
 * Error thrown by the replayer. Carries a machine-readable `code`, the
 * offending `action`/`actionIndex` (annotated by replayJourney), and a
 * JSON-serializable `details` record — see {@link toJSON}.
 */
export class JourneyReplayError extends Error {
  readonly code: ReplayErrorCode;
  action?: JourneyAction;
  actionIndex?: number;
  readonly details?: Record<string, unknown>;

  constructor(code: ReplayErrorCode, message: string, options: JourneyReplayErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'JourneyReplayError';
    this.code = code;
    if (options.action !== undefined) this.action = options.action;
    if (options.actionIndex !== undefined) this.actionIndex = options.actionIndex;
    if (options.details !== undefined) this.details = options.details;
  }

  /** Machine-readable serialization (kept loss-free for the fields that matter). */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      action: this.action,
      actionIndex: this.actionIndex,
      details: this.details,
    };
  }
}

// ---------------------------------------------------------------------------
// Applier options
// ---------------------------------------------------------------------------

export interface DomApplierOptions {
  /** Origin pages are fetched from, e.g. `http://127.0.0.1:PORT/`. */
  baseUrl: string;
  /** Fetch implementation (injectable for tests); defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /**
   * Strict selector mode (default true): a selector without `nth` matching
   * more than one element throws `target-ambiguous` instead of using the
   * first match.
   */
  strict?: boolean;
  /** Allow navigating to origins other than baseUrl (default false). */
  allowCrossOrigin?: boolean;
}

const FILLABLE_INPUT_TYPES = new Set([
  'text',
  'email',
  'tel',
  'password',
  'number',
  'search',
  'url',
  'date',
  'datetime-local',
  'month',
  'week',
  'time',
  'color',
  'range',
]);

const SUBMITTER_INPUT_TYPES = new Set(['submit', 'image']);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeSelector(target: TargetSelector): string {
  return JSON.stringify(target);
}

function describeElement(element: MiniElement): string {
  const testId = element.getAttribute('data-testid');
  return testId !== null ? `${element.tagName}[data-testid=${testId}]` : element.tagName;
}

/** Reason an element is considered hidden, or null when it is visible. */
function hiddenReason(element: MiniElement): string | null {
  if (
    element.tagName === 'input' &&
    (element.getAttribute('type') ?? 'text').toLowerCase() === 'hidden'
  ) {
    return 'input type=hidden';
  }
  let current: MiniElement | null = element;
  while (current !== null) {
    if (current.hasAttribute('hidden')) {
      return 'hidden attribute';
    }
    const style = current.getAttribute('style');
    if (style !== null) {
      for (const declaration of style.split(';')) {
        const colon = declaration.indexOf(':');
        if (colon === -1) continue;
        const prop = declaration.slice(0, colon).trim().toLowerCase();
        const value = declaration.slice(colon + 1).trim().toLowerCase();
        if (prop === 'display' && value === 'none') {
          return 'inline style display:none';
        }
        if (prop === 'visibility' && value === 'hidden') {
          return 'inline style visibility:hidden';
        }
      }
    }
    current = current.parentNode;
  }
  return null;
}

function isSubmitter(element: MiniElement): boolean {
  if (element.tagName === 'button') {
    const type = (element.getAttribute('type') ?? 'submit').toLowerCase();
    return type !== 'button' && type !== 'reset';
  }
  if (element.tagName === 'input') {
    const type = (element.getAttribute('type') ?? '').toLowerCase();
    return SUBMITTER_INPUT_TYPES.has(type);
  }
  return false;
}

/** Collects submit-style name/value pairs from a form's controls. */
function collectFormParams(form: MiniElement): URLSearchParams {
  const params = new URLSearchParams();
  for (const element of form.walk()) {
    if (element === form) continue;
    if (element.hasAttribute('disabled')) continue;
    const name = element.getAttribute('name');
    if (name === null || name === '') continue;
    if (element.tagName === 'input') {
      const type = (element.getAttribute('type') ?? 'text').toLowerCase();
      if (type === 'submit' || type === 'reset' || type === 'button' || type === 'image') {
        continue;
      }
      if (type === 'checkbox' || type === 'radio') {
        if (element.hasAttribute('checked')) {
          params.append(name, element.getAttribute('value') ?? 'on');
        }
        continue;
      }
      params.append(name, element.getAttribute('value') ?? '');
    } else if (element.tagName === 'textarea') {
      params.append(name, element.textContent);
    } else if (element.tagName === 'select') {
      const options = [...element.walk()].filter((candidate) => candidate.tagName === 'option');
      const selected = options.find((option) => option.hasAttribute('selected')) ?? options[0];
      if (selected !== undefined) {
        params.append(name, selected.getAttribute('value') ?? selected.textContent);
      }
    }
  }
  return params;
}

function stripHash(url: URL): string {
  const copy = new URL(url.href);
  copy.hash = '';
  return copy.href;
}

// ---------------------------------------------------------------------------
// DOM applier
// ---------------------------------------------------------------------------

/** Creates the default, dependency-free DOM ActionApplier. */
export function createDomApplier(options: DomApplierOptions): ActionApplier {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const strict = options.strict ?? true;
  const allowCrossOrigin = options.allowCrossOrigin ?? false;
  const baseUrl = new URL(options.baseUrl);

  let currentUrl: URL = new URL(baseUrl.href);
  let currentDoc: MiniDocument | null = null;
  let lastInteracted: MiniElement | null = null;

  function resolveTarget(target: TargetSelector, action: JourneyAction): MiniElement {
    const doc = currentDoc;
    if (doc === null) {
      throw new JourneyReplayError('target-not-found', 'No page has been navigated to yet.', {
        action,
        details: { selector: target, matchCount: 0, url: currentUrl.href },
      });
    }
    let candidates = [...doc.root.walk()].filter(
      (element) => element.getAttribute('aria-hidden') !== 'true',
    );
    if (target.testId !== undefined) {
      candidates = candidates.filter(
        (element) => element.getAttribute('data-testid') === target.testId,
      );
    }
    if (target.role !== undefined) {
      const wantedRole = target.role.trim().toLowerCase();
      candidates = candidates.filter((element) => effectiveRole(element) === wantedRole);
    }
    if (target.name !== undefined) {
      const wantedName = collapseWhitespace(target.name);
      candidates = candidates.filter(
        (element) => accessibleName(element, doc.root) === wantedName,
      );
    }
    if (candidates.length === 0) {
      throw new JourneyReplayError(
        'target-not-found',
        `No element matched selector ${describeSelector(target)} on ${currentUrl.href}.`,
        {
          action,
          details: { selector: target, matchCount: 0, url: currentUrl.href },
        },
      );
    }
    if (target.nth !== undefined) {
      const element = candidates[target.nth];
      if (element === undefined) {
        throw new JourneyReplayError(
          'target-not-found',
          `Selector ${describeSelector(target)} matched ${candidates.length} element(s) on ${currentUrl.href}; nth=${target.nth} is out of range.`,
          {
            action,
            details: { selector: target, matchCount: candidates.length, nth: target.nth, url: currentUrl.href },
          },
        );
      }
      return element;
    }
    if (candidates.length > 1 && strict) {
      const sample = candidates.slice(0, 3).map((element) => describeElement(element));
      throw new JourneyReplayError(
        'target-ambiguous',
        `Selector ${describeSelector(target)} matched ${candidates.length} elements on ${currentUrl.href} (${sample.join(', ')}${candidates.length > 3 ? ', ...' : ''}); provide nth to disambiguate.`,
        {
          action,
          details: { selector: target, matchCount: candidates.length, sample, url: currentUrl.href },
        },
      );
    }
    const first = candidates[0];
    if (first === undefined) {
      // Unreachable (candidates.length > 0 checked above); kept for the type checker.
      throw new JourneyReplayError('target-not-found', 'No element matched selector.', {
        action,
        details: { selector: target, matchCount: 0 },
      });
    }
    return first;
  }

  async function loadDocument(url: URL, action: JourneyAction, init?: RequestInit): Promise<void> {
    let response: Response;
    try {
      response = await fetchImpl(url, { redirect: 'follow', ...init });
    } catch (error) {
      throw new JourneyReplayError('navigate-failed', `Fetch failed for ${url.href}.`, {
        action,
        details: { url: url.href, error: String(error) },
        cause: error,
      });
    }
    if (!response.ok) {
      throw new JourneyReplayError(
        'navigate-failed',
        `Navigation to ${url.href} returned HTTP ${response.status}.`,
        { action, details: { url: url.href, status: response.status } },
      );
    }
    currentDoc = parseHtml(await response.text());
    currentUrl = response.url !== '' ? new URL(response.url) : url;
    lastInteracted = null;
  }

  async function navigate(rawUrl: string, action: JourneyAction): Promise<void> {
    const url = new URL(rawUrl, currentUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new JourneyReplayError(
        'navigate-unsupported',
        `Navigation to non-HTTP protocol is not supported: ${url.protocol}`,
        { action, details: { url: url.href, protocol: url.protocol } },
      );
    }
    if (url.origin !== baseUrl.origin && !allowCrossOrigin) {
      throw new JourneyReplayError(
        'navigate-blocked',
        `Cross-origin navigation blocked by default (from ${baseUrl.origin} to ${url.origin}); pass allowCrossOrigin: true to permit it.`,
        { action, details: { from: baseUrl.origin, to: url.origin, url: url.href } },
      );
    }
    if (currentDoc !== null && stripHash(url) === stripHash(currentUrl)) {
      // Fragment-only navigation: real browsers do not refetch the page.
      currentUrl = url;
      return;
    }
    await loadDocument(url, action);
  }

  async function submitForm(form: MiniElement, action: JourneyAction): Promise<void> {
    const method = (form.getAttribute('method') ?? 'get').toUpperCase();
    const actionAttr = form.getAttribute('action');
    const target = actionAttr !== null && actionAttr !== '' ? actionAttr : currentUrl.href;
    const params = collectFormParams(form);
    if (method === 'POST') {
      const url = new URL(target, currentUrl);
      await loadDocument(url, action, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded;charset=utf-8' },
        body: params.toString(),
      });
      return;
    }
    const url = new URL(target, currentUrl);
    url.search = params.toString();
    await loadDocument(url, action);
  }

  async function clickElement(element: MiniElement, action: JourneyAction): Promise<void> {
    lastInteracted = element;
    const anchor = element.closest('a');
    if (anchor !== null) {
      const href = anchor.getAttribute('href');
      if (href !== null && href !== '') {
        await navigate(href, action);
      }
      return;
    }
    const form = element.closest('form');
    if (form !== null && isSubmitter(element)) {
      await submitForm(form, action);
      return;
    }
    // Non-interactive click: no-op success (no script execution — README).
  }

  function fillElement(element: MiniElement, value: string, action: JourneyAction): void {
    if (element.tagName === 'textarea') {
      element.childNodes.length = 0;
      element.appendText(value);
      lastInteracted = element;
      return;
    }
    if (
      element.tagName === 'input' &&
      FILLABLE_INPUT_TYPES.has((element.getAttribute('type') ?? 'text').toLowerCase())
    ) {
      element.setAttribute('value', value);
      lastInteracted = element;
      return;
    }
    throw new JourneyReplayError(
      'fill-not-supported',
      `Cannot fill ${describeElement(element)}: only text-like <input> elements and <textarea> are fillable (selects, checkboxes, radios, buttons and non-form elements are not — see README).`,
      {
        action,
        details: {
          tagName: element.tagName,
          inputType: element.getAttribute('type'),
          url: currentUrl.href,
        },
      },
    );
  }

  async function pressElement(key: string, action: JourneyAction): Promise<void> {
    if (key !== 'Enter' || lastInteracted === null) {
      // No focus model / script execution: non-Enter keys are no-ops (README).
      return;
    }
    const form = lastInteracted.closest('form');
    if (form !== null) {
      await submitForm(form, action);
    }
  }

  function assertVisible(
    element: MiniElement,
    action: Extract<JourneyAction, { type: 'assert-visible' }>,
  ): void {
    const reason = hiddenReason(element);
    if (reason !== null) {
      throw new JourneyReplayError(
        'assert-visible-failed',
        `Target ${describeElement(element)} is not visible on ${currentUrl.href} (${reason}).`,
        { action, details: { reason, url: currentUrl.href, selector: action.target } },
      );
    }
  }

  return {
    async apply(action: JourneyAction): Promise<void> {
      switch (action.type) {
        case 'navigate':
          await navigate(action.url, action);
          return;
        case 'click':
          await clickElement(resolveTarget(action.target, action), action);
          return;
        case 'fill':
          fillElement(resolveTarget(action.target, action), action.value, action);
          return;
        case 'press':
          await pressElement(action.key, action);
          return;
        case 'wait':
          await sleep(action.ms);
          return;
        case 'assert-visible':
          assertVisible(resolveTarget(action.target, action), action);
          return;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Journey replay orchestration
// ---------------------------------------------------------------------------

/** Summary of a successful replay. */
export interface ReplaySummary {
  journeyId: string;
  actionsApplied: number;
  durationMs: number;
  startedAt: string;
  endedAt: string;
}

/**
 * Replays a journey's actions in order through the given applier. Throws a
 * {@link JourneyReplayError} (annotated with `actionIndex`/`action`) on the
 * first failure; rejects structurally invalid journeys with code
 * `journey-invalid`.
 */
export async function replayJourney(journey: Journey, applier: ActionApplier): Promise<ReplaySummary> {
  if (!validateJourney(journey)) {
    const { errors } = validateJourneyDetailed(journey);
    throw new JourneyReplayError(
      'journey-invalid',
      `Journey failed structural validation: ${errors.join('; ')}`,
      { details: { errors } },
    );
  }
  const startedAt = new Date();
  for (const [index, action] of journey.actions.entries()) {
    try {
      await applier.apply(action);
    } catch (error) {
      if (error instanceof JourneyReplayError) {
        error.actionIndex = index;
        error.action = action;
        throw error;
      }
      throw new JourneyReplayError(
        'action-failed',
        `Action ${index} (${action.type}) failed: ${String(error)}`,
        { action, actionIndex: index, details: { cause: String(error) }, cause: error },
      );
    }
  }
  const endedAt = new Date();
  return {
    journeyId: journey.id,
    actionsApplied: journey.actions.length,
    durationMs: Math.max(0, endedAt.getTime() - startedAt.getTime()),
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
  };
}
