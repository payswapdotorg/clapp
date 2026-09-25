/**
 * @clapp/explore — the exploration loop (CLAPP-022).
 *
 * `explore()` walks an authorized app from its entrypoints under a budget:
 * navigate → walk DOM → record a 'dom' capture → enumerate actionables →
 * the policy picks → assert-visible probe → apply → record a 'user' capture
 * → new screen? → dom capture + extend the graph. It returns a Behavioral-IR
 * state-graph fragment (every transition cites recorded evidence), one
 * replayable Journey per discovered screen, an honest report, and every
 * evidence ref recorded during the walk.
 *
 * Division of labor (declared design):
 * - The POLICY owns budgets and choosing. The explorer executes decisions and
 *   never exceeds what the policy issues (the policy only issues decisions
 *   whose full action cost fits the remaining step budget).
 * - The APPLIER is the executor of record: every navigate/click/fill goes
 *   through the injected ActionApplier, and every act target is verified
 *   FIRST with an assert-visible action executed through the applier. Failed
 *   applies are recorded as 'skipped'/'assert-failed' user captures and
 *   exploration NEVER aborts on them.
 * - The WALKER only chooses: because the frozen applier does not expose its
 *   internal DOM state, the explorer maintains its own DOM view by making
 *   read-only GET fetches of the pages the applier navigates (the same pages,
 *   from the same baseUrl) and parsing them with the zero-dep html-walker.
 *   For deterministic servers — the declared v0 scope — the explorer's view
 *   and the applier's parse see identical bytes; the assert-visible probes
 *   verify every acted-upon target against the applier's own parse.
 * - The ROUTE LEDGER mirrors the applier's DOCUMENTED navigation semantics
 *   (navigate resolution, fragment-only no-refetch, click-on-anchor, form
 *   submission with collected parameters) so the explorer knows where the
 *   applier is without the applier reporting it. A server that returns
 *   different bytes per request would desync the mirror — out of scope,
 *   documented in the README.
 *
 * Evidence discipline (canonical capture contract):
 * - every visited screen → one 'dom' capture (first visit only), payload
 *   { subkind: 'dom-tree', root, nodeCount, truncated } (SerializedNode
 *   shape, observe-compatible semantics);
 * - every applied action (navigates, assert probes, fills, clicks, and
 *   backtrack prefix replays) → one 'user' capture, payload
 *   { subkind: 'action', action, outcome, route, errorCode? } with outcome
 *   'applied' | 'assert-failed' | 'skipped' — this closes the declared
 *   action-evidence gap of pure observation runs;
 * - every applied form submission → one 'storage' inventory capture
 *   { subkind: 'storage-inventory', keys }. HONEST LIMITATION: the frozen
 *   applier surface exposes NO storage channel, so the observable inventory
 *   is always empty; the capture records that the check ran, no storage key
 *   can ever "appear in the run", and therefore no route-preserving action
 *   ever emits a self-transition. The mechanism is implemented (the emitter
 *   emits a self-transition iff a NEW storage key appears) — it simply fires
 *   never in v0.
 */

import type { EvidenceKind, EvidenceRef } from '@clapp/core';
import type { CaptureRecord, EvidenceRecorder } from '@clapp/evidence';
import {
  createRecorder,
  JourneyReplayError,
  validateJourneyDetailed,
} from '@clapp/journey';
import type { ActionApplier, Journey, JourneyAction, TargetSelector } from '@clapp/journey';
import type { IrApplication, IrModel } from './ir-contract';
import type { ActionableElement, WalkedPage, WalkerElement } from './html-walker';
import { closest, elementPathOf, textContent, walkHtml, walkElements } from './html-walker';
import type { ExplorationPolicy, ExplorationState, PendingScreen } from './policy';
import type { ExplorationReport } from './report';
import { emitIrModel, type ActionOutcome, type JourneyRecord, type ScreenRecord } from './ir-emitter';

/** Thrown when exploration infrastructure fails (not failed actions — those
 * are recorded and skipped): a page the explorer needs for walking cannot be
 * fetched, or the defensive loop cap trips. */
export class ExplorationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExplorationError';
  }
}

/** Options for {@link explore}. */
export interface ExploreOptions {
  /** Origin under exploration, e.g. a fixture-server URL. */
  baseUrl: string;
  /** The executor of record (createDomApplier or an equivalent ActionApplier). */
  applier: ActionApplier;
  /** Recording port; every capture the explorer makes flows through here. */
  recorder: EvidenceRecorder;
  /** The decision policy (createExplorationPolicy or an equivalent). */
  policy: ExplorationPolicy;
  /** App identity for the emitted model; its entrypoints seed the frontier. */
  application: IrApplication;
}

/** What one exploration produced. */
export interface ExploreResult {
  model: IrModel;
  journeys: Journey[];
  report: ExplorationReport;
  refs: EvidenceRef[];
}

/** Defensive bound on loop iterations — protects against a misbehaving
 * injected policy that issues decisions without consuming steps. */
const MAX_LOOP_ITERATIONS = 10_000;

// ---------------------------------------------------------------------------
// Route normalization
// ---------------------------------------------------------------------------

/**
 * Normalizes a URL to a screen route: query and hash are dropped,
 * '/index.html' collapses to '/', a trailing '.html' is stripped, and the
 * path always starts with '/' (and never ends with '/' except the root).
 * Screens are identified by this normalized route.
 */
export function normalizeRoute(url: URL): string {
  let path = url.pathname;
  if (path.endsWith('/index.html')) {
    path = path.slice(0, -'index.html'.length) || '/';
  } else if (path.endsWith('.html')) {
    path = path.slice(0, -'.html'.length);
  }
  if (!path.startsWith('/')) path = `/${path}`;
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  return path;
}

function stripHash(url: URL): string {
  const copy = new URL(url.href);
  copy.hash = '';
  return copy.href;
}

// ---------------------------------------------------------------------------
// Mirrors of the frozen applier's documented semantics
// (packages/journey/src/replayer.ts — see its header comment)
// ---------------------------------------------------------------------------

const SUBMITTER_INPUT_TYPES = new Set(['submit', 'image']);

/** Mirror of the applier's isSubmitter: <button> defaults to submit;
 * <input type=submit|image> are submitters. */
function isSubmitter(element: WalkerElement): boolean {
  if (element.tag === 'button') {
    const type = (element.attrs['type'] ?? 'submit').toLowerCase();
    return type !== 'button' && type !== 'reset';
  }
  if (element.tag === 'input') {
    const type = (element.attrs['type'] ?? '').toLowerCase();
    return SUBMITTER_INPUT_TYPES.has(type);
  }
  return false;
}

/** Mirror of the applier's collectFormParams (GET query / POST body pairs). */
function collectFormParams(form: WalkerElement): Array<[string, string]> {
  const params: Array<[string, string]> = [];
  for (const element of walkElements(form)) {
    if (element === form) continue;
    if (element.attrs['disabled'] !== undefined) continue;
    const name = element.attrs['name'];
    if (name === undefined || name === '') continue;
    if (element.tag === 'input') {
      const type = (element.attrs['type'] ?? 'text').toLowerCase();
      if (type === 'submit' || type === 'reset' || type === 'button' || type === 'image') {
        continue;
      }
      if (type === 'checkbox' || type === 'radio') {
        if (element.attrs['checked'] !== undefined) {
          params.push([name, element.attrs['value'] ?? 'on']);
        }
        continue;
      }
      params.push([name, element.attrs['value'] ?? '']);
    } else if (element.tag === 'textarea') {
      params.push([name, textContent(element)]);
    } else if (element.tag === 'select') {
      const options = [...walkElements(element)].filter((candidate) => candidate.tag === 'option');
      const selected = options.find((option) => option.attrs['selected'] !== undefined) ?? options[0];
      if (selected !== undefined) {
        params.push([name, selected.attrs['value'] ?? textContent(selected)]);
      }
    }
  }
  return params;
}

interface ClickOutcome {
  kind: 'navigate' | 'submit' | 'noop';
  url: URL;
  form?: string;
  params?: Array<[string, string]>;
}

/** Mirror of the applier's click semantics: ancestor <a href> navigates;
 * a submitter inside a form submits it (GET → action?params, POST → action
 * URL); anything else is a no-op success. */
function computeClickOutcome(element: WalkerElement, currentUrl: URL): ClickOutcome {
  const anchor = closest(element, 'a');
  if (anchor !== null) {
    const href = anchor.attrs['href'];
    if (href !== undefined && href !== '') {
      return { kind: 'navigate', url: new URL(href, currentUrl) };
    }
  }
  const form = closest(element, 'form');
  if (form !== null && isSubmitter(element)) {
    const method = (form.attrs['method'] ?? 'get').toUpperCase();
    const actionAttr = form.attrs['action'];
    const target = actionAttr !== undefined && actionAttr !== '' ? actionAttr : currentUrl.href;
    const params = collectFormParams(form);
    const url = new URL(target, currentUrl);
    if (method === 'POST') {
      // The applier POSTs the params as a body; the arrival URL is the action.
      return { kind: 'submit', url, form: formIdentityOf(form), params };
    }
    url.search = new URLSearchParams(params).toString();
    return { kind: 'submit', url, form: formIdentityOf(form), params };
  }
  return { kind: 'noop', url: currentUrl };
}

/** Form identity for side-effect labels — the same identity the walker's
 * ActionableElement.form uses (testId, else id, else element path). */
function formIdentityOf(form: WalkerElement): string {
  const testId = form.attrs['data-testid'];
  if (testId !== undefined && testId !== '') return testId;
  const id = form.attrs['id'];
  if (id !== undefined && id !== '') return id;
  return elementPathOf(form);
}

// ---------------------------------------------------------------------------
// Bookkeeping records
// ---------------------------------------------------------------------------

interface ScreenLedger {
  route: string;
  /** Dom-capture ref from the first visit; null never happens in practice
   * (registration records the capture first) — typed optional for honesty. */
  treeRef: EvidenceRef | null;
  /** First-visit page model (actionables + parse tree). */
  walkedPage: WalkedPage;
  /** First-visit arrival URL. */
  url: URL;
  /** Act-candidate identity keys attempted on this screen. */
  triedKeys: Set<string>;
  triedCount: number;
  /** The action prefix that first reached this screen. */
  journeyPrefix: JourneyAction[];
  /** User-capture refs of the prefix actions (first application). */
  journeyRefs: EvidenceRef[];
}

/** One applied-or-failed action, in execution order — the emitter's input. */
export interface ActionRecord {
  action: JourneyAction;
  outcome: ActionOutcome;
  routeBefore: string;
  routeAfter: string;
  ref: EvidenceRef | null;
  /** Present when this action submitted a form. */
  submittedForm?: string;
  /** The submitted parameters (observed input), when this action submitted a form. */
  submitParams?: Array<[string, string]>;
  /** Present on actions followed by a storage inventory check. */
  storageKeysAfter?: string[];
}

function identityKey(actionable: ActionableElement): string {
  return `${JSON.stringify(actionable.target ?? null)}\u0000${actionable.path}`;
}

function isActCandidate(actionable: ActionableElement): boolean {
  const role = actionable.journeyRole;
  return (
    actionable.target !== undefined &&
    (role === 'textbox' || role === 'searchbox' || role === 'button')
  );
}

/** Deterministic probe values for fills (no secret-shaped literals). */
function probeValue(actionable: ActionableElement): string {
  if (actionable.tag === 'textarea') return 'Explorer probe message.';
  if (actionable.inputType === 'email') return 'explorer@example.com';
  return 'Explorer probe';
}

/** Fill-class check by the ELEMENT's journey role (testId selectors carry none). */
function journeyRoleIsFill(actionable: ActionableElement): boolean {
  return actionable.journeyRole === 'textbox' || actionable.journeyRole === 'searchbox';
}

function selectorEquals(a: TargetSelector | undefined, b: TargetSelector | undefined): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---------------------------------------------------------------------------
// explore()
// ---------------------------------------------------------------------------

/**
 * Runs one bounded exploration. See the module doc for the declared design;
 * nothing here aborts on a failed action — failures become evidence.
 */
export async function explore(options: ExploreOptions): Promise<ExploreResult> {
  const baseUrl = new URL(options.baseUrl);
  const fetchImpl: typeof fetch = globalThis.fetch;

  // ---- bookkeeping ---------------------------------------------------------
  const screens = new Map<string, ScreenLedger>();
  const screensOrder: string[] = [];
  const frontier: string[] = [];
  const routeUrls = new Map<string, string>();
  const failedRoutes = new Set<string>();
  const failedBacktracks = new Set<string>();
  const actions: ActionRecord[] = [];
  const recordedRefs: EvidenceRef[] = [];
  let stepsUsed = 0;
  let actionsApplied = 0;
  let actionsSkipped = 0;
  let duplicateScreensSkipped = 0;
  let budgetStops: string[] = [];
  let frontierExhausted = false;

  // Current applier-state mirror.
  let currentUrl = new URL(baseUrl.href);
  let currentRoute: string | null = null;
  let currentWalk: WalkedPage | null = null;
  let currentPath: JourneyAction[] = [];
  let currentPathRefs: EvidenceRef[] = [];

  // ---- capture recording ----------------------------------------------------

  async function recordCapture(kind: EvidenceKind, payload: unknown): Promise<EvidenceRef> {
    const capture: CaptureRecord = {
      kind,
      ts: new Date().toISOString(),
      payload,
      redacted: false,
    };
    const ref = await options.recorder.record(capture);
    recordedRefs.push({ ...ref });
    return ref;
  }

  function recordUser(
    action: JourneyAction,
    outcome: ActionOutcome,
    errorCode?: string,
  ): Promise<EvidenceRef> {
    const payload: Record<string, unknown> = {
      subkind: 'action',
      action,
      outcome,
      route: currentRoute ?? '',
    };
    if (errorCode !== undefined) payload.errorCode = errorCode;
    return recordCapture('user', payload);
  }

  function replayErrorCode(error: unknown): string {
    if (error instanceof JourneyReplayError) return error.code;
    return 'action-failed';
  }

  // ---- page fetching + arrival processing ------------------------------------

  async function fetchPageHtml(url: URL): Promise<string> {
    let response: Response;
    try {
      response = await fetchImpl(url, { redirect: 'follow' });
    } catch (error) {
      throw new ExplorationError(`explorer could not fetch ${url.href} for walking: ${String(error)}`);
    }
    if (!response.ok) {
      throw new ExplorationError(
        `explorer could not walk ${url.href}: HTTP ${response.status} (the applier navigated here; the walk fetch is the explorer's own read-only GET of the same URL)`,
      );
    }
    return response.text();
  }

  /**
   * Processes an arrival at `url`: updates the route ledger, walks the page,
   * merges discovered internal links into the frontier, and registers the
   * screen (dom capture + journey prefix) on first visit — or counts a
   * duplicate arrival when `countDuplicate` is set (backtrack replays are
   * deliberate revisits and are not counted).
   */
  async function arrive(url: URL, countDuplicate: boolean): Promise<void> {
    currentUrl = new URL(url.href);
    const route = normalizeRoute(currentUrl);
    const html = await fetchPageHtml(currentUrl);
    const walk = walkHtml(html);
    currentWalk = walk;
    currentRoute = route;

    // Merge discovered internal links into the frontier (deny-all posture:
    // cross-origin links are never navigated; hash/same-route links never
    // produce a new screen).
    for (const actionable of walk.actionables) {
      if (actionable.role !== 'link' || actionable.href === undefined) continue;
      let resolved: URL;
      try {
        resolved = new URL(actionable.href, currentUrl);
      } catch {
        continue;
      }
      if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') continue;
      if (resolved.origin !== baseUrl.origin) continue;
      const linkRoute = normalizeRoute(resolved);
      if (linkRoute === route) continue;
      if (screens.has(linkRoute) || frontier.includes(linkRoute) || failedRoutes.has(linkRoute)) continue;
      frontier.push(linkRoute);
      routeUrls.set(linkRoute, `${resolved.pathname}${resolved.search}`);
    }

    if (!screens.has(route)) {
      const serialized = walk.serialized;
      const treeRef = await recordCapture('dom', {
        subkind: 'dom-tree',
        root: serialized.root,
        nodeCount: serialized.nodeCount,
        truncated: serialized.truncated,
      });
      screens.set(route, {
        route,
        treeRef,
        walkedPage: walk,
        url: new URL(currentUrl.href),
        triedKeys: new Set(),
        triedCount: 0,
        journeyPrefix: [...currentPath],
        journeyRefs: [...currentPathRefs],
      });
      screensOrder.push(route);
    } else if (countDuplicate) {
      duplicateScreensSkipped += 1;
    }
    // A frontier route reached by an act (form submission) is now visited.
    const frontierIndex = frontier.indexOf(route);
    if (frontierIndex !== -1) frontier.splice(frontierIndex, 1);
  }

  // ---- ledger mirroring for applied actions ----------------------------------

  function actionableByTarget(target: TargetSelector | undefined): ActionableElement | undefined {
    if (currentWalk === null || target === undefined) return undefined;
    return currentWalk.actionables.find((candidate) => selectorEquals(candidate.target, target));
  }

  function applyFillToModel(actionable: ActionableElement, value: string): void {
    if (currentWalk === null) return;
    const element = currentWalk.elementsByPath.get(actionable.path);
    if (element === undefined) return;
    if (element.tag === 'textarea') {
      element.children = [{ nodeType: 'text', data: value }];
    } else {
      element.attrs['value'] = value;
    }
  }

  async function recordStorageInventory(record: ActionRecord): Promise<void> {
    // The frozen applier surface exposes no storage channel; the observable
    // inventory is honestly empty. The capture records that the check ran,
    // and the emitter (which tracks keys across the run in order) decides
    // whether any NEW key appeared — none ever can in v0.
    const keys: string[] = [];
    await recordCapture('storage', { subkind: 'storage-inventory', keys });
    record.storageKeysAfter = keys;
  }

  // ---- decision execution ------------------------------------------------------

  async function applyNavigate(route: string): Promise<void> {
    const url = routeUrls.get(route) ?? route;
    const action: JourneyAction = { type: 'navigate', url };
    const routeBefore = currentRoute ?? '';
    try {
      await options.applier.apply(action);
    } catch (error) {
      stepsUsed += 1;
      const ref = await recordUser(action, 'skipped', replayErrorCode(error));
      actions.push({ action, outcome: 'skipped', routeBefore, routeAfter: routeBefore, ref });
      failedRoutes.add(route);
      const frontierIndex = frontier.indexOf(route);
      if (frontierIndex !== -1) frontier.splice(frontierIndex, 1);
      return;
    }
    stepsUsed += 1;
    const ref = await recordUser(action, 'applied');
    currentPath.push(action);
    currentPathRefs.push(ref);
    // Ledger mirror of the applier's navigate(): fragment-only targets do not
    // refetch; everything else loads the document at the resolved URL.
    const resolved = new URL(url, currentUrl);
    let routeAfter = routeBefore;
    if (!(currentWalk !== null && stripHash(resolved) === stripHash(currentUrl))) {
      await arrive(resolved, true);
      routeAfter = currentRoute ?? routeBefore;
    } else {
      currentUrl = resolved;
    }
    actions.push({ action, outcome: 'applied', routeBefore, routeAfter, ref });
  }

  async function applyAct(actionable: ActionableElement): Promise<void> {
    const target = actionable.target;
    if (target === undefined) return; // policy should not pick untargetables
    const routeBefore = currentRoute ?? '';
    // Tried-marking targets the ORIGIN screen's ledger (an act may navigate
    // away before this function returns — the candidate is still consumed
    // on the screen it lived on).
    const originLedger = currentRoute !== null ? screens.get(currentRoute) : undefined;
    const markTriedOnOrigin = (): void => {
      if (originLedger === undefined) return;
      originLedger.triedKeys.add(identityKey(actionable));
      originLedger.triedCount += 1;
    };

    // 1. assert-visible probe through the applier (target verification).
    const probe: JourneyAction = { type: 'assert-visible', target };
    try {
      await options.applier.apply(probe);
    } catch (error) {
      stepsUsed += 1;
      const ref = await recordUser(probe, 'assert-failed', replayErrorCode(error));
      actions.push({ action: probe, outcome: 'assert-failed', routeBefore, routeAfter: routeBefore, ref });
      actionsSkipped += 1;
      markTriedOnOrigin();
      return;
    }
    stepsUsed += 1;
    {
      const ref = await recordUser(probe, 'applied');
      actions.push({ action: probe, outcome: 'applied', routeBefore, routeAfter: routeBefore, ref });
    }

    // 2. the state-changing action: fill for text-like inputs, click for buttons
    //   (classified by the element's journey role — see journeyRoleIsFill).
    const isFill = journeyRoleIsFill(actionable);
    const action: JourneyAction = isFill
      ? { type: 'fill', target, value: probeValue(actionable) }
      : { type: 'click', target };
    try {
      await options.applier.apply(action);
    } catch (error) {
      stepsUsed += 1;
      const ref = await recordUser(action, 'skipped', replayErrorCode(error));
      actions.push({ action, outcome: 'skipped', routeBefore, routeAfter: routeBefore, ref });
      actionsSkipped += 1;
      markTriedOnOrigin();
      return;
    }
    stepsUsed += 1;
    actionsApplied += 1;
    const ref = await recordUser(action, 'applied');
    currentPath.push(action);
    currentPathRefs.push(ref);

    let routeAfter = routeBefore;
    const record: ActionRecord = { action, outcome: 'applied', routeBefore, routeAfter, ref };
    if (action.type === 'fill') {
      applyFillToModel(actionable, action.value);
    } else if (currentWalk !== null) {
      const element = currentWalk.elementsByPath.get(actionable.path);
      if (element !== undefined) {
        const outcome = computeClickOutcome(element, currentUrl);
        if (outcome.kind === 'navigate') {
          await arrive(outcome.url, true);
          routeAfter = currentRoute ?? routeBefore;
        } else if (outcome.kind === 'submit') {
          record.submittedForm = outcome.form;
          record.submitParams = outcome.params;
          await arrive(outcome.url, true);
          routeAfter = currentRoute ?? routeBefore;
          await recordStorageInventory(record);
        }
        // kind === 'noop': the applier's documented no-op success — the page
        // and the route are unchanged; no storage check (nothing submitted).
      }
      // Element not found in the walk (non-deterministic server): the action
      // still applied through the applier; the ledger keeps the current route
      // and the walk stays on the pre-click page model — divergence is a
      // documented limitation, and the next assert-visible probe would fail
      // loudly against the applier's real parse if targets drifted.
    }
    record.routeAfter = routeAfter;
    actions.push(record);
    markTriedOnOrigin();
  }

  /**
   * Replays one journey-prefix action during a backtrack, through the same
   * evidence pipeline. Returns false when the action must NOT be applied
   * (its target cannot be mirrored against the current walk — a deterministic
   * server makes this unreachable) or when the applier rejected it; the
   * caller aborts the backtrack with the ledger at the last consistent state.
   */
  async function replayPrefixAction(action: JourneyAction): Promise<boolean> {
    const routeBefore = currentRoute ?? '';
    if (action.type === 'navigate') {
      try {
        await options.applier.apply(action);
      } catch (error) {
        stepsUsed += 1;
        const ref = await recordUser(action, 'skipped', replayErrorCode(error));
        actions.push({ action, outcome: 'skipped', routeBefore, routeAfter: routeBefore, ref });
        return false;
      }
      stepsUsed += 1;
      const ref = await recordUser(action, 'applied');
      currentPath.push(action);
      currentPathRefs.push(ref);
      const resolved = new URL(action.url, currentUrl);
      let routeAfter = routeBefore;
      if (!(currentWalk !== null && stripHash(resolved) === stripHash(currentUrl))) {
        await arrive(resolved, false);
        routeAfter = currentRoute ?? routeBefore;
      } else {
        currentUrl = resolved;
      }
      actions.push({ action, outcome: 'applied', routeBefore, routeAfter, ref });
      return true;
    }
    if (action.type === 'fill' || action.type === 'click') {
      const actionable = actionableByTarget(action.target);
      if (actionable === undefined) {
        // Cannot mirror the action against the walked page — do NOT apply it
        // blindly; abort the backtrack (documented).
        return false;
      }
      try {
        await options.applier.apply(action);
      } catch (error) {
        stepsUsed += 1;
        const ref = await recordUser(action, 'skipped', replayErrorCode(error));
        actions.push({ action, outcome: 'skipped', routeBefore, routeAfter: routeBefore, ref });
        return false;
      }
      stepsUsed += 1;
      const ref = await recordUser(action, 'applied');
      currentPath.push(action);
      currentPathRefs.push(ref);
      let routeAfter = routeBefore;
      const record: ActionRecord = { action, outcome: 'applied', routeBefore, routeAfter, ref };
      if (action.type === 'fill') {
        applyFillToModel(actionable, action.value);
      } else if (currentWalk !== null) {
        const element = currentWalk.elementsByPath.get(actionable.path);
        if (element !== undefined) {
          const outcome = computeClickOutcome(element, currentUrl);
          if (outcome.kind === 'navigate') {
            await arrive(outcome.url, false);
            routeAfter = currentRoute ?? routeBefore;
          } else if (outcome.kind === 'submit') {
            record.submittedForm = outcome.form;
            record.submitParams = outcome.params;
            await arrive(outcome.url, false);
            routeAfter = currentRoute ?? routeBefore;
            await recordStorageInventory(record);
          }
        }
      }
      record.routeAfter = routeAfter;
      actions.push(record);
      return true;
    }
    // Prefixes never contain wait/press/assert-visible (they are built from
    // state-changing actions only); anything else aborts the backtrack.
    return false;
  }

  async function applyBacktrack(route: string): Promise<void> {
    const ledger = screens.get(route);
    if (ledger === undefined || failedBacktracks.has(route)) return;
    let ok = true;
    for (const action of ledger.journeyPrefix) {
      const applied = await replayPrefixAction(action);
      if (!applied) {
        ok = false;
        break;
      }
    }
    if (ok) {
      // The authoritative prefix (and its first-application refs) becomes the
      // current path, so a screen discovered from here cites it correctly.
      currentPath = [...ledger.journeyPrefix];
      currentPathRefs = [...ledger.journeyRefs];
    } else {
      failedBacktracks.add(route);
    }
  }

  // ---- policy state assembly ----------------------------------------------------

  function untriedActCandidatesOf(route: string): ActionableElement[] {
    const ledger = screens.get(route);
    if (ledger === undefined) return [];
    return ledger.walkedPage.actionables.filter(
      (candidate) => isActCandidate(candidate) && !ledger.triedKeys.has(identityKey(candidate)),
    );
  }

  function buildState(): ExplorationState {
    const pending: PendingScreen[] = [];
    for (const route of screensOrder) {
      if (route === currentRoute) continue;
      if (failedBacktracks.has(route)) continue;
      const untried = untriedActCandidatesOf(route);
      if (untried.length === 0) continue;
      const ledger = screens.get(route);
      if (ledger === undefined) continue;
      pending.push({
        route,
        untriedCount: untried.length,
        triedCount: ledger.triedCount,
        journeyLength: ledger.journeyPrefix.length,
      });
    }
    const currentUntried =
      currentRoute !== null
        ? untriedActCandidatesOf(currentRoute)
        : [];
    return {
      stepsUsed,
      currentRoute: currentRoute ?? '',
      screensVisited: [...screensOrder],
      frontier: [...frontier],
      untried: currentUntried,
      triedOnCurrentScreen: currentRoute !== null ? (screens.get(currentRoute)?.triedCount ?? 0) : 0,
      pending,
    };
  }

  // ---- seeding + main loop --------------------------------------------------------

  // The explorer seeds its frontier from the application's entrypoints (the
  // policy's own entrypoints option exists so hand-driven policy tests can
  // start without a live explorer; in real runs the seeded frontier is
  // non-empty from the first decision, so the policy's fallback never fires).
  for (const entrypoint of options.application.entrypoints) {
    let resolved: URL;
    try {
      resolved = new URL(entrypoint, baseUrl);
    } catch {
      continue;
    }
    const route = normalizeRoute(resolved);
    if (!routeUrls.has(route)) routeUrls.set(route, entrypoint);
    if (!frontier.includes(route)) frontier.push(route);
  }

  for (let iteration = 0; iteration < MAX_LOOP_ITERATIONS; iteration += 1) {
    const decision = options.policy.nextAction(buildState());
    if (decision.type === 'done') {
      budgetStops = [...decision.budgetStops];
      frontierExhausted = decision.frontierExhausted;
      break;
    }
    if (decision.type === 'navigate') {
      await applyNavigate(decision.route);
    } else if (decision.type === 'act') {
      await applyAct(decision.actionable);
    } else {
      await applyBacktrack(decision.route);
    }
    if (iteration === MAX_LOOP_ITERATIONS - 1) {
      throw new ExplorationError(
        `exploration loop cap (${MAX_LOOP_ITERATIONS} decisions) exceeded — the injected policy is not making progress`,
      );
    }
  }

  // ---- journeys: one per discovered screen, recorded + validated -------------

  const journeys: Journey[] = [];
  const journeyRecords: JourneyRecord[] = [];
  for (const route of screensOrder) {
    const ledger = screens.get(route);
    if (ledger === undefined) continue;
    const recorder = createRecorder({ name: `explore: reach ${route}` });
    recorder.start(options.application.id);
    for (const action of ledger.journeyPrefix) {
      recorder.record(action);
    }
    const journey = recorder.finish();
    const validation = validateJourneyDetailed(journey);
    if (!validation.valid) {
      // Honest: an invalid journey is excluded, never included.
      throw new ExplorationError(
        `recorded journey for ${route} failed structural validation: ${validation.errors.join('; ')}`,
      );
    }
    journeys.push(journey);
    journeyRecords.push({ route, journey, actionRefs: ledger.journeyRefs });
  }

  // ---- the IR fragment -------------------------------------------------------------

  const screenRecords: ScreenRecord[] = screensOrder.map((route) => {
    const ledger = screens.get(route);
    // screensOrder entries always have a ledger; the fallback keeps the
    // type checker honest without fabricating data.
    if (ledger === undefined) {
      throw new ExplorationError(`internal: screen ledger missing for ${route}`);
    }
    return {
      route,
      treeRef: ledger.treeRef,
      actionables: ledger.walkedPage.actionables,
    };
  });

  const model = emitIrModel({
    application: options.application,
    refs: recordedRefs,
    screens: screenRecords,
    actions,
    journeys: journeyRecords,
  });

  // ---- the report + result ----------------------------------------------------------

  const report: ExplorationReport = {
    screensVisited: [...screensOrder],
    actionsApplied,
    actionsSkipped,
    stepsUsed,
    budgetStops,
    frontierExhausted,
    duplicateScreensSkipped,
  };

  const refs = await options.recorder.flush();

  return { model, journeys, report, refs };
}
