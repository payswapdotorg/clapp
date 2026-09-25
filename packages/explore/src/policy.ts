/**
 * @clapp/explore — deterministic frontier policy (CLAPP-022).
 *
 * The policy is the brain of the exploration loop: given the explorer's
 * bookkeeping state it decides the next step — 'navigate' to an unvisited
 * internal route, 'act' on an untried actionable (the explorer then probes
 * with assert-visible before applying click/fill), 'backtrack' by replaying
 * a recorded journey prefix, or 'done'.
 *
 * Determinism: all tie-breaks (which frontier route, which actionable, which
 * backtrack candidate) go through a seeded splitmix32 PRNG carried inside
 * the policy object, so the same seed walks the same walk: feeding two
 * policies the same decision-state sequence yields byte-identical decision
 * sequences. No global state, no Date/Math.random.
 *
 * Budget enforcement is THE POLICY'S JOB — the explorer executes decisions
 * and never exceeds what the policy issues:
 * - a decision is issued only when its full action cost fits the remaining
 *   step budget (act = assert probe + apply = 2 actions; navigate = 1;
 *   backtrack = the prefix length), so `maxSteps` can never be overshot;
 * - `maxScreens` halts ALL work once the screen budget is reached —
 *   deliberately conservative (v0): clicks and submits can navigate, so
 *   continuing to act could exceed the screen budget; fill-only continuation
 *   under a screen cap is a possible future refinement;
 * - `maxActionsPerScreen` caps act attempts per screen; when the only
 *   remaining work is cap-blocked, exploration ends with the
 *   'max-actions-per-screen' stop.
 *
 * Act priority (declared v0 policy): within a screen, fill-class candidates
 * (journey role textbox/searchbox — the applier can fill those) are tried
 * before click-class candidates (journey role button), because filling form
 * fields before submitting them produces more faithful journeys. Links are
 * NOT act targets — they feed the frontier as navigate candidates (the
 * applier resolves their hrefs directly); comboboxes/checkboxes/radios are
 * listed by the walker but not actable through the frozen applier's verbs.
 */

import type { ActionableElement } from './html-walker';

// ---------------------------------------------------------------------------
// Seeded PRNG (splitmix32 — deterministic, dependency-free)
// ---------------------------------------------------------------------------

/** Creates a deterministic 0..1 float generator from a 32-bit seed. */
export function createPrng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x9e3779b9) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 16), 0x21f0aaad);
    t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
    return ((t ^ (t >>> 15)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// State + decisions
// ---------------------------------------------------------------------------

/**
 * The explorer's bookkeeping snapshot the policy decides against. All fields
 * are plain data so tests can drive the policy with hand-built states.
 * `untried` should contain ACT candidates only (journey role
 * textbox/searchbox/button with a resolvable target); the policy defensively
 * filters to those classes anyway, so stray entries are ignored, never acted
 * on.
 */
export interface ExplorationState {
  /** Actions attempted through the applier so far (all kinds, incl. probes). */
  stepsUsed: number;
  /** Current normalized route ('' before the first arrival). */
  currentRoute: string;
  /** Distinct normalized routes visited so far, first-visit order. */
  screensVisited: string[];
  /** Discovered internal routes not yet visited (deduped, discovery order). */
  frontier: string[];
  /** Untried ACT candidates on the current screen (document order). */
  untried: ActionableElement[];
  /** Act attempts made on the current screen so far. */
  triedOnCurrentScreen: number;
  /** Other visited screens that still have untried act candidates. */
  pending: PendingScreen[];
}

/** A visited (non-current) screen that still has untried act candidates. */
export interface PendingScreen {
  route: string;
  /** Act candidates never attempted there. */
  untriedCount: number;
  /** Act attempts made there so far (vs maxActionsPerScreen). */
  triedCount: number;
  /** Journey-prefix length — the action cost of backtracking there. */
  journeyLength: number;
}

/** One policy decision. */
export type ExplorationDecision =
  | { type: 'navigate'; route: string }
  | { type: 'act'; actionable: ActionableElement }
  | { type: 'backtrack'; route: string }
  | {
      type: 'done';
      /** Why exploration ended (human-readable). */
      reason: string;
      /** Budget stops that fired ('max-steps' | 'max-screens' | 'max-actions-per-screen'). */
      budgetStops: string[];
      /** True iff no work remained (frontier empty AND no untried act candidates anywhere). */
      frontierExhausted: boolean;
    };

/** Options for {@link createExplorationPolicy}. */
export interface ExplorationPolicyOptions {
  /** Normalized entrypoint routes; exploration starts from the first pick. */
  entrypoints: string[];
  /** Max actions attempted through the applier (assert probes included). */
  maxSteps: number;
  /** Max distinct screens (normalized routes) visited. */
  maxScreens: number;
  /** Max act attempts per screen. */
  maxActionsPerScreen: number;
  /** PRNG seed — same seed + same state sequence ⇒ same decisions. */
  seed: number;
}

/** The decision interface the explorer drives. */
export interface ExplorationPolicy {
  nextAction(state: ExplorationState): ExplorationDecision;
}

/** Journey roles the applier can fill (fill-class act candidates). */
const FILL_ROLES = new Set(['textbox', 'searchbox']);
/** Journey roles the applier can click (click-class act candidates). */
const CLICK_ROLES = new Set(['button']);

/** Action cost of one act decision: assert-visible probe + apply. */
const ACT_COST = 2;
/** Action cost of one navigate decision. */
const NAVIGATE_COST = 1;

function actClass(actionable: ActionableElement): 'fill' | 'click' | null {
  // The ELEMENT's journey role decides the class (testId-anchored selectors
  // carry no role field — ActionableElement.journeyRole is the signal).
  const role = actionable.journeyRole;
  if (role === null) return null;
  if (FILL_ROLES.has(role)) return 'fill';
  if (CLICK_ROLES.has(role)) return 'click';
  return null;
}

function isActCandidate(actionable: ActionableElement): boolean {
  return actionable.target !== undefined && actClass(actionable) !== null;
}

/**
 * Creates a deterministic exploration policy. The returned object is
 * stateful only through its PRNG; all other decision inputs arrive via the
 * state snapshot, keeping decisions reproducible in tests.
 *
 * The `entrypoints` option seeds navigation only until the first screen is
 * visited (screensVisited is empty) — after that, the state's frontier is
 * the single source of unvisited routes, so entrypoints can never re-issue
 * an already-visited route and cause a loop.
 */
export function createExplorationPolicy(options: ExplorationPolicyOptions): ExplorationPolicy {
  const maxSteps = options.maxSteps;
  const maxScreens = options.maxScreens;
  const maxActionsPerScreen = options.maxActionsPerScreen;
  const prng = createPrng(options.seed);

  const pickIndex = (length: number): number => {
    if (length <= 1) return 0;
    return Math.min(length - 1, Math.floor(prng() * length));
  };

  return {
    nextAction(state: ExplorationState): ExplorationDecision {
      // --- hard budget stops ---------------------------------------------
      const hardStops: string[] = [];
      if (state.stepsUsed >= maxSteps) hardStops.push('max-steps');
      if (state.screensVisited.length >= maxScreens) hardStops.push('max-screens');
      if (hardStops.length > 0) {
        return {
          type: 'done',
          reason: `budget reached: ${hardStops.join(', ')}`,
          budgetStops: hardStops,
          frontierExhausted: false,
        };
      }

      let stepsBlockedWork = false;

      // --- act on the current screen -------------------------------------
      const fillClass = state.untried.filter((candidate) => actClass(candidate) === 'fill');
      const clickClass = state.untried.filter((candidate) => actClass(candidate) === 'click');
      const currentHasUntried = fillClass.length > 0 || clickClass.length > 0;
      const currentCapped = currentHasUntried && state.triedOnCurrentScreen >= maxActionsPerScreen;
      if (currentHasUntried && !currentCapped) {
        if (state.stepsUsed + ACT_COST <= maxSteps) {
          const pool = fillClass.length > 0 ? fillClass : clickClass;
          const actionable = pool[pickIndex(pool.length)];
          if (actionable !== undefined) {
            return { type: 'act', actionable };
          }
        } else {
          stepsBlockedWork = true;
        }
      }

      // --- backtrack to a screen with untried work ------------------------
      const affordablePending = state.pending.filter(
        (pending) =>
          pending.untriedCount > 0 &&
          pending.triedCount < maxActionsPerScreen &&
          state.stepsUsed + pending.journeyLength <= maxSteps,
      );
      if (affordablePending.length > 0) {
        const chosen = affordablePending[pickIndex(affordablePending.length)];
        if (chosen !== undefined) {
          return { type: 'backtrack', route: chosen.route };
        }
      } else if (state.pending.some((pending) => pending.untriedCount > 0 && pending.triedCount < maxActionsPerScreen)) {
        // Work exists on other screens but no prefix fits the remaining budget.
        stepsBlockedWork = true;
      }

      // --- navigate the frontier ------------------------------------------
      // Before the first screen exists the frontier may legitimately be
      // empty (the explorer has not walked anything yet) — the entrypoint
      // queue seeds that first navigation. Afterwards only the state's
      // frontier (built from walked links, minus visited routes) navigates.
      const frontier =
        state.frontier.length > 0
          ? state.frontier
          : state.screensVisited.length === 0
            ? options.entrypoints
            : [];
      if (frontier.length > 0) {
        if (state.stepsUsed + NAVIGATE_COST <= maxSteps) {
          const route = frontier[pickIndex(frontier.length)];
          if (route !== undefined) {
            return { type: 'navigate', route };
          }
        } else {
          stepsBlockedWork = true;
        }
      }

      // --- nothing left — assemble the honest termination ------------------
      const stops: string[] = [];
      if (stepsBlockedWork) stops.push('max-steps');
      const cappedWork =
        state.pending.some((pending) => pending.untriedCount > 0 && pending.triedCount >= maxActionsPerScreen) ||
        currentCapped;
      if (cappedWork) stops.push('max-actions-per-screen');
      const untriedAnywhere =
        state.untried.some(isActCandidate) || state.pending.some((pending) => pending.untriedCount > 0);
      const frontierExhausted = state.frontier.length === 0 && !untriedAnywhere;
      const reason =
        stops.length > 0
          ? `no affordable work remained: ${stops.join(', ')}`
          : 'all discovered routes visited and all act candidates tried';
      return { type: 'done', reason, budgetStops: stops, frontierExhausted };
    },
  };
}
