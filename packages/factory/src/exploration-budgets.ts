/**
 * @clapp/factory — adaptive exploration budgets (CLAPP-086, the P9 second
 * lane — Worker 1, Observation and Platform Adapters, per
 * docs/WORKER_HANDOFFS.md; the factory lane's owner).
 *
 * docs/WORK_ITEMS.md P9: "The factory turns a build request into a
 * classified target, explores within adaptive budgets, synthesizes the
 * package graph, repairs multi-pass, and holds the release for the human
 * gate." THIS module is the factory's SECOND component: the frozen v0.1
 * tier table that spends CLAPP-085's budget-tier tags as exploration
 * caps, plus the fail-closed ledger that accounts exploration spend.
 *
 * THE BINDING (consumed, never forked): CLAPP-085's TargetClassification
 * — this package's own first component (./target-classification) — enters
 * as DATA. The resolver duck-validates exactly the three fields this lane
 * consumes (targetVersion, budgetTier, id), with a named error for every
 * malformation, and carries the classification's id VERBATIM as the
 * provenance binding (classificationId) — the tcls_ identity of the
 * target whose exploration this budget caps. The shape is referenced
 * TYPE-ONLY and pinned structurally by the compile-time
 * ResolvedClassificationBinding assertion below: the three consumed
 * fields of a real resolved classification are exactly the strings the
 * duck-check validates.
 *
 * THE EXPLORE-POLICY AXES (TYPE-ONLY understanding — never imported,
 * never redefined): packages/explore/src/policy.ts's
 * ExplorationPolicyOptions carries the three budget axes the exploration
 * loop spends — maxSteps (actions attempted through the applier, assert
 * probes included), maxScreens (distinct screens, i.e. normalized
 * routes, visited), maxActionsPerScreen (act attempts per screen). This
 * lane's ExplorationCaps mirrors those three axis NAMES as its own
 * frozen DATA shape; the module NEVER imports @clapp/explore (not a
 * dependency of this package — the import-discipline test pins the set:
 * @clapp/core + @clapp/observe at runtime, @clapp/learn TYPE-ONLY, and
 * nothing else). The tier table maps CLAPP-085's tags to caps; the
 * explorer consumes the caps as data through its own frozen options.
 *
 * THE ACCOUNTING LAW (CLAPP-075, packages/security/src/budgets.ts,
 * binding): the ledger accounts fail-closed. A spend is admitted only
 * when its steps fit the remaining steps AND its screens fit the
 * remaining screens; a spend that exceeds EITHER axis is REFUSED with a
 * named error (the axis, the request, the remaining) and THE REFUSAL
 * NEVER CONSUMES; remaining never goes negative; a spend that lands
 * EXACTLY at the cap is allowed (remaining 0 — the next positive spend
 * on that axis refuses); a zero spend is a valid no-op at any remaining,
 * zero included. The caps are a LAW, not a suggestion.
 *
 * THE LAWS (the 060–085 house discipline, binding):
 * - Fail closed: resolution and ledger admission collect EVERY error —
 *   each naming its field and carrying the OBSERVED VALUE — into
 *   { ok: false, errors }; results, never exceptions; nothing is
 *   resolved or accounted from partial data; a rejected spend consumes
 *   nothing.
 * - Measured, never asserted: the ledger's remaining is computed from
 *   the caps it was GIVEN (caps.maxSteps − stepsSpent), never looked up
 *   from the tier name; every accepted spend increments spent by the
 *   EXACT amounts and recomputes remaining; the spend result carries the
 *   MEASURED remaining (the 075 { ok: true, remaining } precedent, one
 *   field per accounted axis).
 * - Fresh copies, never aliases: the resolver's caps are a FRESH copy of
 *   the table's entry (mutating a returned caps NEVER mutates the frozen
 *   table); the ledger stores its budget by value and hands out a fresh
 *   copy on every read (the 075 sealed-account law — no caller can
 *   rewrite the ledger's law through an object they were handed, in
 *   either direction).
 * - Determinism: no clock, no randomness, no network, no filesystem, no
 *   module-level mutable state — the closure is the ledger's boundary,
 *   separate ledgers share NOTHING. The same classification resolves to
 *   deep-equal budgets every time. This lane mints no new ids: the tcls_
 *   classification id is carried verbatim, and a budget is identified
 *   only by its classificationId provenance binding.
 * - The vocabularies are frozen: the tier table's keys ARE the CLAPP-085
 *   BUDGET_TIERS vocabulary ('minimal', 'standard', 'extended'); a quiet
 *   edit to the table is a contract break.
 */

import { TARGET_CLASS_VERSION } from './target-classification';
import type { TargetClassification } from './target-classification';

// ---- internal shared helpers (module-level; NOT re-exported by src/index.ts) ------

/** Plain-object guard (arrays are NOT objects here — the house helper). */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Human preview of an unknown value, for error messages. */
function preview(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'undefined') return 'undefined';
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** Renders a frozen vocabulary for an error message (the preview discipline). */
function vocabulary(words: readonly string[]): string {
  return `[${words.map((word) => `'${word}'`).join(', ')}]`;
}

/** A non-negative-integer guard (MEASURED spend quantities and cap values are never negative or fractional). */
function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * Own-key membership in the frozen tier table (prototype-safe: an
 * inherited 'toString' key is NOT a tier — Object.hasOwn, never `in`).
 */
function isKnownTier(tier: unknown): tier is string {
  return typeof tier === 'string' && Object.hasOwn(TIER_CAPS, tier);
}

/** All three cap axes present (post-validation completeness — no cast needed). */
function isCompleteCaps(partial: Partial<ExplorationCaps>): partial is ExplorationCaps {
  return (
    partial.maxSteps !== undefined &&
    partial.maxScreens !== undefined &&
    partial.maxActionsPerScreen !== undefined
  );
}

// ---- the exploration-budget contract v0.1 ------------------------------------------

/** The exploration-budget contract version (bumps only via a tech-lead declaration wave). */
export const EXPLORATION_BUDGET_VERSION = '0.1';

/** One tier's frozen exploration caps (the explore policy's three budget axes, as data). */
export interface ExplorationCaps {
  /** Max actions attempted through the applier (assert probes included). */
  maxSteps: number;
  /** Max distinct screens (normalized routes) visited. */
  maxScreens: number;
  /** Max act attempts per screen. */
  maxActionsPerScreen: number;
}

/** The frozen v0.1 tier table (a quiet edit is a contract break). */
export const TIER_CAPS: Readonly<Record<string, ExplorationCaps>> = {
  minimal: { maxSteps: 40, maxScreens: 8, maxActionsPerScreen: 3 },
  standard: { maxSteps: 120, maxScreens: 20, maxActionsPerScreen: 5 },
  extended: { maxSteps: 400, maxScreens: 50, maxActionsPerScreen: 8 },
};

/** The frozen tier names (the table's own keys, in table order — the message vocabulary). */
const TIER_NAMES: readonly string[] = Object.keys(TIER_CAPS);

/** The three frozen cap axes, in contract order (the validation loop's order). */
const CAP_AXES: readonly (keyof ExplorationCaps)[] = ['maxSteps', 'maxScreens', 'maxActionsPerScreen'];

/** What each cap axis means, for error messages (the observed-value law's context). */
const AXIS_DESCRIPTIONS: Readonly<Record<keyof ExplorationCaps, string>> = {
  maxSteps: 'the step cap — max actions attempted through the applier, assert probes included',
  maxScreens: 'the screen cap — max distinct screens (normalized routes) visited',
  maxActionsPerScreen: 'the per-screen cap — max act attempts per screen',
};

/** The resolved budget for one target classification. */
export interface ExplorationBudget {
  /** EXPLORATION_BUDGET_VERSION ('0.1'). */
  budgetVersion: string;
  /** The tier this budget resolved (one of CLAPP-085's BUDGET_TIERS). */
  budgetTier: string;
  /** The resolved caps — a FRESH copy of the table's entry (never the table's own object). */
  caps: ExplorationCaps;
  /** The source classification's id, carried VERBATIM (the provenance binding). */
  classificationId: string;
}

/** Fail-closed resolution: a result, never an exception. */
export type ExplorationBudgetResult =
  | { ok: true; budget: ExplorationBudget }
  | { ok: false; errors: string[] };

/** The ledger's spend request (each axis independently spendable). */
export interface SpendRequest {
  /** Steps to spend (a non-negative integer; 0 is a valid no-op spend). */
  steps: number;
  /** Screens to spend (a non-negative integer). */
  screens: number;
}

/**
 * One ledger — fail-closed accounting over a resolved budget. The five
 * data fields are MEASURED live state (recomputed from the recorded
 * spends on every read); {@link BudgetLedger.spend} is the ONLY mutation
 * channel, under the CLAPP-075 law.
 */
export interface BudgetLedger {
  /** The budget the ledger accounts (carried verbatim — a fresh sealed copy per read). */
  budget: ExplorationBudget;
  /** MEASURED: the steps spent so far. */
  stepsSpent: number;
  /** MEASURED: the screens spent so far. */
  screensSpent: number;
  /** MEASURED: the remaining steps (caps.maxSteps - stepsSpent). */
  stepsRemaining: number;
  /** MEASURED: the remaining screens. */
  screensRemaining: number;
  /**
   * Spend against the ledger (the CLAPP-075 accounting law): fail-closed
   * input check (steps and screens non-negative integers); a spend that
   * fits BOTH axes is ACCEPTED (spent incremented by the exact amounts,
   * remaining recomputed MEASURED); a spend that exceeds EITHER axis is
   * REFUSED naming the axis, the request, and the remaining — and the
   * refusal NEVER consumes.
   */
  spend(request: unknown): SpendResult;
}

/** Fail-closed ledger creation: a result, never an exception. */
export type LedgerResult =
  | { ok: true; ledger: BudgetLedger }
  | { ok: false; errors: string[] };

/** The result of one spend request: the MEASURED remaining on success, named errors on refusal. */
export type SpendResult =
  | { ok: true; stepsRemaining: number; screensRemaining: number }
  | { ok: false; errors: string[] };

/**
 * The TYPE-ONLY seam pin (compile-time only — no runtime artifact, and
 * never a fork): the three fields this lane duck-validates on an
 * incoming classification are exactly the CLAPP-085
 * TargetClassification's own, as strings — a real resolved
 * classification fits the resolver's input as-is. If the classification
 * contract ever breaks its frozen v0.1 shape, this line stops compiling
 * — the consumed seam is checked, not conventional.
 */
export type ResolvedClassificationBinding = StaticAssign<
  Pick<TargetClassification, 'targetVersion' | 'budgetTier' | 'id'>,
  { targetVersion: string; budgetTier: string; id: string }
>;

/** Compile-time assignability assertion: TFits must extend TSlot. */
type StaticAssign<TFits extends TSlot, TSlot> = TFits;

// ---- the budget resolver ------------------------------------------------------------

/**
 * Resolves ONE CLAPP-085 target classification into the exploration
 * budget its tier spends. Synchronous and pure (this lane mints no ids,
 * hashes nothing, reads no clock).
 *
 * Fail closed: a non-object classification, a targetVersion other than
 * TARGET_CLASS_VERSION ('0.1'), a budgetTier absent from the frozen tier
 * table, or an empty id is a collected, field-named error carrying the
 * observed value — ALL errors, never just the first; results, never
 * exceptions; nothing is resolved from partial data. Extra
 * classification fields (platform, primaryArchetype, …) are the
 * caller's business — the resolver validates exactly the fields it
 * reads.
 *
 * On success the budget is DERIVED, never guessed: the caps are a FRESH
 * copy of the table's entry (mutating the returned caps NEVER mutates
 * the frozen table); the tier and the classification's id are carried
 * VERBATIM (the provenance binding). Deterministic: the same
 * classification resolves to deep-equal budgets every time, and the
 * resolver never mutates its inputs.
 */
export function resolveExplorationBudget(classification: unknown): ExplorationBudgetResult {
  const errors: string[] = [];

  // ---- the admission shape (a plain object) ----
  if (!isObject(classification)) {
    return {
      ok: false,
      errors: [
        `classification: expected an object (a resolved CLAPP-085 TargetClassification: targetVersion, budgetTier, id), got ${preview(classification)}`,
      ],
    };
  }

  // ---- targetVersion: the frozen classification contract this lane consumes ----
  const targetVersion = classification['targetVersion'];
  if (targetVersion !== TARGET_CLASS_VERSION) {
    errors.push(
      `classification.targetVersion: expected '0.1' (TARGET_CLASS_VERSION — the frozen classification contract this lane consumes; a mismatch is a named error, never a guess), got ${preview(targetVersion)}`,
    );
  }

  // ---- budgetTier: one of the frozen tiers the table spends ----
  const budgetTier = classification['budgetTier'];
  if (!isKnownTier(budgetTier)) {
    errors.push(
      `classification.budgetTier: expected a string from the frozen exploration-budget tiers ${vocabulary(TIER_NAMES)} (the tiers CLAPP-085 tags and this lane's table spends), got ${preview(budgetTier)}`,
    );
  }

  // ---- id: the tcls_ provenance, a non-empty string ----
  const id = classification['id'];
  if (typeof id !== 'string' || id.length === 0) {
    errors.push(
      `classification.id: expected a non-empty string (the source classification's tcls_ identity — carried verbatim as the provenance binding), got ${preview(id)}`,
    );
  }

  // ---- fail closed: nothing is resolved unless every field admitted ----
  if (
    errors.length > 0 ||
    !isKnownTier(budgetTier) ||
    typeof id !== 'string' ||
    id.length === 0
  ) {
    return { ok: false, errors };
  }

  // ---- the resolved budget (derived, never guessed) ----
  // The table's entry by OWN key (prototype-safe); isKnownTier guaranteed
  // membership, but the undefined guard is kept as the last line of
  // defense (the 060/061/062 precedent).
  const tableCaps = TIER_CAPS[budgetTier];
  if (tableCaps === undefined) {
    return {
      ok: false,
      errors: [
        `classification.budgetTier: ${preview(budgetTier)} is not a tier in the frozen table (the membership guard was bypassed — refusing rather than guessing)`,
      ],
    };
  }

  // A FRESH copy — never the table's own object: mutating the returned
  // caps NEVER mutates the frozen table.
  const caps: ExplorationCaps = { ...tableCaps };

  return {
    ok: true,
    budget: {
      budgetVersion: EXPLORATION_BUDGET_VERSION,
      budgetTier,
      caps,
      classificationId: id,
    },
  };
}

// ---- the budget ledger (the CLAPP-075 accounting law) -------------------------------

/**
 * Mints ONE fail-closed ledger over a resolved exploration budget. The
 * budget is duck-checked as a resolved ExplorationBudget shape — the
 * same fail-closed discipline as the resolver, over the budget's own
 * fields: budgetVersion === EXPLORATION_BUDGET_VERSION, budgetTier one
 * of the frozen tiers, caps an object whose three axes are non-negative
 * integers, classificationId a non-empty string. ALL errors are
 * collected, each naming its field and carrying the observed value; a
 * rejected budget mints no ledger.
 *
 * The admitted budget is stored by value (fresh copies — the caller can
 * never rewrite the ledger's law through the object they passed in),
 * and every read hands out a fresh copy (the 075 sealed-account law).
 * The ledger starts at zero spent with remaining MEASURED from the caps
 * it was GIVEN — never asserted from the tier name (the caps are the
 * law the ledger accounts; the tier is carried as data). One in-memory
 * ledger per call — separate ledgers share NOTHING (no module-level
 * state; the closure is the boundary).
 */
export function createBudgetLedger(budget: unknown): LedgerResult {
  const errors: string[] = [];

  // ---- the admission shape (a plain object) ----
  if (!isObject(budget)) {
    return {
      ok: false,
      errors: [
        `budget: expected an object (a resolved ExplorationBudget: budgetVersion, budgetTier, caps, classificationId), got ${preview(budget)}`,
      ],
    };
  }

  // ---- budgetVersion: the frozen budget contract ----
  const budgetVersion = budget['budgetVersion'];
  if (budgetVersion !== EXPLORATION_BUDGET_VERSION) {
    errors.push(
      `budget.budgetVersion: expected '0.1' (EXPLORATION_BUDGET_VERSION — the frozen budget contract this ledger accounts; a mismatch is a named error, never a guess), got ${preview(budgetVersion)}`,
    );
  }

  // ---- budgetTier: one of the frozen tiers (carried as data; the
  // accounting NEVER asserts from the tier name — the caps are the law) ----
  const budgetTier = budget['budgetTier'];
  if (!isKnownTier(budgetTier)) {
    errors.push(
      `budget.budgetTier: expected a string from the frozen exploration-budget tiers ${vocabulary(TIER_NAMES)}, got ${preview(budgetTier)}`,
    );
  }

  // ---- caps: the three frozen axes, each a non-negative integer ----
  const rawCaps = budget['caps'];
  let caps: ExplorationCaps | null = null;
  if (!isObject(rawCaps)) {
    errors.push(
      `budget.caps: expected an object { maxSteps, maxScreens, maxActionsPerScreen } (the frozen exploration caps — the explore policy's three budget axes as data), got ${preview(rawCaps)}`,
    );
  } else {
    const validated: Partial<ExplorationCaps> = {};
    for (const axis of CAP_AXES) {
      const value = rawCaps[axis];
      if (isNonNegativeInteger(value)) {
        validated[axis] = value;
      } else {
        errors.push(
          `budget.caps.${axis}: expected a non-negative integer (${AXIS_DESCRIPTIONS[axis]}), got ${preview(value)}`,
        );
      }
    }
    if (isCompleteCaps(validated)) {
      caps = validated;
    }
  }

  // ---- classificationId: the tcls_ provenance, a non-empty string ----
  const classificationId = budget['classificationId'];
  if (typeof classificationId !== 'string' || classificationId.length === 0) {
    errors.push(
      `budget.classificationId: expected a non-empty string (the source classification's tcls_ identity, carried verbatim), got ${preview(classificationId)}`,
    );
  }

  // ---- fail closed: no ledger is minted unless every field admitted ----
  if (
    errors.length > 0 ||
    caps === null ||
    !isKnownTier(budgetTier) ||
    typeof classificationId !== 'string' ||
    classificationId.length === 0
  ) {
    return { ok: false, errors };
  }

  // ---- the ledger's private store (the closure is the boundary) ----
  // The budget VERBATIM by value — fresh copies of every field, so no
  // caller alias can rewrite the law the ledger accounts.
  const storedCaps: ExplorationCaps = { ...caps };
  const storedBudget: ExplorationBudget = {
    budgetVersion: EXPLORATION_BUDGET_VERSION,
    budgetTier,
    caps: { ...storedCaps },
    classificationId,
  };

  // The recorded spend — the ledger's whole mutable state, mutated ONLY
  // by an ACCEPTED spend, by the exact amounts.
  let stepsSpent = 0;
  let screensSpent = 0;

  const spend = (request: unknown): SpendResult => {
    // ---- fail-closed input check: nothing consumed on ANY malformation ----
    if (!isObject(request)) {
      return {
        ok: false,
        errors: [
          `spend: expected an object { steps, screens } (each axis independently spendable, non-negative integers), got ${preview(request)}`,
        ],
      };
    }

    const requestErrors: string[] = [];
    const steps = request['steps'];
    const screens = request['screens'];
    if (!isNonNegativeInteger(steps)) {
      requestErrors.push(
        `spend.steps: expected a non-negative integer (steps to spend — 0 is a valid no-op spend), got ${preview(steps)}`,
      );
    }
    if (!isNonNegativeInteger(screens)) {
      requestErrors.push(
        `spend.screens: expected a non-negative integer (screens to spend — 0 is a valid no-op spend), got ${preview(screens)}`,
      );
    }
    if (requestErrors.length > 0) {
      return { ok: false, errors: requestErrors }; // nothing consumed
    }

    // Validated above — the house cast discipline (security budgets.ts).
    const stepsToSpend = steps as number;
    const screensToSpend = screens as number;

    // ---- the accounting, against BOTH axes (the caps are the law) ----
    const stepsRemainingNow = storedCaps.maxSteps - stepsSpent;
    const screensRemainingNow = storedCaps.maxScreens - screensSpent;

    const refusals: string[] = [];
    if (stepsToSpend > stepsRemainingNow) {
      refusals.push(
        `spend.steps: the request ${stepsToSpend} exceeds the remaining ${stepsRemainingNow} (the maxSteps cap ${storedCaps.maxSteps}, ${stepsSpent} already spent) — refused, nothing consumed`,
      );
    }
    if (screensToSpend > screensRemainingNow) {
      refusals.push(
        `spend.screens: the request ${screensToSpend} exceeds the remaining ${screensRemainingNow} (the maxScreens cap ${storedCaps.maxScreens}, ${screensSpent} already spent) — refused, nothing consumed`,
      );
    }
    if (refusals.length > 0) {
      // THE REFUSAL NEVER CONSUMES: spent and remaining unchanged.
      return { ok: false, errors: refusals };
    }

    // ---- accepted: spent incremented by the EXACT amounts, remaining
    // recomputed MEASURED (a spend landing exactly at the cap is allowed
    // — remaining 0; the next positive spend on that axis refuses) ----
    stepsSpent += stepsToSpend;
    screensSpent += screensToSpend;
    return {
      ok: true,
      stepsRemaining: storedCaps.maxSteps - stepsSpent,
      screensRemaining: storedCaps.maxScreens - screensSpent,
    };
  };

  const ledger: BudgetLedger = {
    // VERBATIM, sealed: a FRESH copy per read — the caller can never
    // mutate the ledger's budget through the object they are handed
    // (the 075 sealed-account law).
    get budget(): ExplorationBudget {
      return {
        budgetVersion: storedBudget.budgetVersion,
        budgetTier: storedBudget.budgetTier,
        caps: { ...storedCaps },
        classificationId: storedBudget.classificationId,
      };
    },
    // MEASURED — recomputed from the recorded spends on every read,
    // never cached, never asserted.
    get stepsSpent() {
      return stepsSpent;
    },
    get screensSpent() {
      return screensSpent;
    },
    get stepsRemaining() {
      return storedCaps.maxSteps - stepsSpent;
    },
    get screensRemaining() {
      return storedCaps.maxScreens - screensSpent;
    },
    spend,
  };

  return { ok: true, ledger };
}
