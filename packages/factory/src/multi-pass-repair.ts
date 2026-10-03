/**
 * @clapp/factory — the multi-pass repair scheduler (CLAPP-088, the P9
 * fourth lane — Worker 1, Observation and Platform Adapters, per
 * docs/WORKER_HANDOFFS.md; the factory lane's owner).
 *
 * docs/WORK_ITEMS.md P9: "The factory turns a build request into a
 * classified target, explores within adaptive budgets, synthesizes the
 * package graph, repairs multi-pass, and holds the release for the human
 * gate." THIS module is the factory's FOURTH component: the tier-capped
 * pass scheduler that drives bounded repair rounds until convergence,
 * budget exhaustion, or an honest stop.
 *
 * THE SEAM (scheduled, never re-implemented — the no-fork law):
 * packages/repair/src/loop.ts's frozen round model is READ-ONLY law to
 * this lane: "ONE REPORT PER RUN... the orchestrator re-runs the paired
 * runner, rebuilds the report, and re-invokes the loop — each invocation
 * is one bounded repair round." THIS module IS that orchestrator shape
 * as a scheduler: one {@link RepairRoundRunner} invocation per pass,
 * each running ONE bounded repair round (the loop invocation plus the
 * rebuilt report) and reporting its own facts. The runner is
 * DUCK-TYPED — everything repair-specific (the loop, the directives,
 * the report, the oracle, RerunVerdict) enters through the seam and is
 * consumed as DATA. This module NEVER imports @clapp/repair (not a
 * dependency of this package — the import-discipline test pins the set:
 * @clapp/core + @clapp/observe at runtime, @clapp/learn TYPE-ONLY, and
 * nothing else); it never re-implements the loop, never clusters
 * findings, never consults an oracle, never edits a candidate tree.
 *
 * THE BINDING (consumed, never forked): the source classification —
 * this package's own ./target-classification — enters as DATA,
 * duck-validated on exactly the three fields this lane consumes
 * (targetVersion, budgetTier, id), with a named error for every
 * malformation, and its tcls_ id carried VERBATIM as the schedule's
 * classificationId (the provenance binding; the 086 resolver's law).
 *
 * THE PASS-CAP LAW (the 086 tier-table discipline, binding): the
 * tier→pass-cap table is FROZEN v0.1 (minimal 2, standard 4, extended
 * 8) — a quiet edit is a contract break. The cap is resolved by a FRESH
 * read of the table on every schedule, and it is a LAW, not a
 * suggestion: passes run 1..cap and the schedule stops AT the cap — a
 * runner offering more rounds is simply not asked for them. Budget
 * exhaustion is honest: convergence is NEVER inferred from a low or
 * zero remaining-findings count (the repair loop's own convergence iff
 * is its frozen business; this lane only ever carries a round's OWN
 * honest flag).
 *
 * THE STOP LAWS (derived from each round's own facts, never guessed):
 * - CONVERGENCE IS TERMINAL: a pass whose facts.converged is true stops
 *   the schedule — converged passes are spent reaching convergence, no
 *   more are spent after it.
 * - A REGRESSION IS AN HONEST STOP: a pass whose remainingFindings rose
 *   stops the schedule — never spend more passes on a diverging
 *   candidate.
 * - Budget exhaustion stops naturally at the cap.
 *
 * THE LAWS (the 060–087 house discipline, binding):
 * - Fail closed: scheduling errors are collected — ALL of them, each
 *   naming its field and carrying the OBSERVED VALUE — into
 *   { ok: false, errors }; results, never exceptions; nothing is
 *   scheduled from partial data. (The VALIDATION layer only: a runner
 *   that THROWS mid-schedule is the caller's failure — it propagates
 *   loudly, never swallowed, never a synthetic pass record.)
 * - Derived, never guessed: each pass's outcome is DERIVED from the
 *   round's own facts by comparison — 'converged' when the round
 *   reported convergence; otherwise 'improved' when remainingFindings
 *   fell vs the PRIOR pass's, 'stalled' when equal, 'regressed' when it
 *   rose (the FIRST pass compares vs the schedule's initialFindings,
 *   the caller-supplied findings count BEFORE the first pass). The
 *   outcome vocabulary is this lane's own derivation — never reported
 *   by the seam. totalRounds is MEASURED (passes.length); the
 *   schedule's converged is true ONLY when some pass's facts.converged
 *   was true — never inferred from remainingFindings alone.
 * - Determinism: no clock (scheduledAt is CALLER-injected), no
 *   randomness, no network, no filesystem. The schedule id is
 *   content-addressed — 'mpass_' + sha256Hex(canonicalJson(schedule
 *   minus id minus scheduledAt)) — so scheduling the same inputs twice
 *   yields deep-equal schedules with identical ids, and a different
 *   caller clock never changes the id (the 085 tcls_ / 087 pgraph_
 *   discipline). The 'mpass_' prefix is a DISTINCT identity in the
 *   repo's tcls_/pgraph_/cgraph_/comp_/repd_ prefix discipline — the
 *   repair lane's own ids are its own, never re-used here.
 * - The facts are carried verbatim by value (a fresh flat copy — the
 *   075 sealed-record law: the runner's object is never aliased into
 *   the schedule, and a runner that reuses its fact object across
 *   rounds never rewrites an earlier pass's record).
 */

import { sha256Hex } from '@clapp/core';
import { canonicalJson } from '@clapp/observe';

import { TARGET_CLASS_VERSION } from './target-classification';

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

/** A non-negative-integer guard (MEASURED finding counts are never negative or fractional). */
function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * Own-key membership in the frozen pass-cap table (prototype-safe: an
 * inherited 'toString' key is NOT a tier — Object.hasOwn, never `in`).
 */
function isKnownTier(tier: unknown): tier is string {
  return typeof tier === 'string' && Object.hasOwn(TIER_PASS_CAPS, tier);
}

/**
 * The duck-typed runner admission: an object whose runRound is callable.
 * Everything repair-specific enters HERE — the seam is consumed as
 * DATA, never imported, never re-implemented.
 */
function isRoundRunner(value: unknown): value is RepairRoundRunner {
  return isObject(value) && typeof value['runRound'] === 'function';
}

/** DERIVE one pass's outcome from its own facts vs the prior remaining count — never a seam report. */
function deriveOutcome(facts: RoundFacts, priorRemaining: number): PassOutcome {
  if (facts.converged) return 'converged';
  if (facts.remainingFindings < priorRemaining) return 'improved';
  if (facts.remainingFindings === priorRemaining) return 'stalled';
  return 'regressed';
}

// ---- the multi-pass repair contract v0.1 --------------------------------------------

/** The multi-pass repair contract version (bumps only via a tech-lead declaration wave). */
export const MULTI_PASS_REPAIR_VERSION = '0.1';

/** The frozen v0.1 tier→pass-cap table (a quiet edit is a contract break). */
export const TIER_PASS_CAPS: Readonly<Record<string, number>> = {
  minimal: 2,
  standard: 4,
  extended: 8,
};

/** The frozen tier names (the table's own keys, in table order — the message vocabulary). */
const TIER_NAMES: readonly string[] = Object.keys(TIER_PASS_CAPS);

/**
 * The schedule-id prefix — THIS lane's frozen identity in the
 * `tcls_` / `pgraph_` / `cgraph_` / `comp_` / `repd_` prefix
 * discipline: `mpass_` + 64 lowercase hex chars. Changing it changes
 * every minted id and requires a contract version bump.
 */
const MULTI_PASS_ID_PREFIX = 'mpass_';

/** One round's own reported facts (the seam's output — consumed as DATA). */
export interface RoundFacts {
  /** The round's honest convergence flag. */
  converged: boolean;
  /** MEASURED by the round: the findings remaining after the round. */
  remainingFindings: number;
}

/**
 * The round-runner seam: everything repair-specific enters HERE
 * (duck-typed — the test fakes it). One invocation runs ONE bounded
 * repair round — the repair lane's frozen loop invocation plus the
 * rebuilt report — and reports the round's own facts.
 */
export interface RepairRoundRunner {
  /** Run ONE bounded repair round (the loop invocation + the rebuilt report). */
  runRound(passNumber: number): Promise<RoundFacts>;
}

/** The pass-outcome vocabulary (DERIVED from the round facts, never reported by the seam). */
export type PassOutcome = 'converged' | 'improved' | 'stalled' | 'regressed';

/** One pass's record — the MEASURED facts + the derived outcome. */
export interface PassRecord {
  /** 1-based pass number (the execution order). */
  passNumber: number;
  /** The round's facts, carried verbatim (by value — the sealed-record law). */
  facts: RoundFacts;
  /**
   * DERIVED from the facts, never reported by the seam: 'converged'
   * when facts.converged; else 'improved' when remainingFindings fell
   * vs the prior pass's; 'stalled' when equal; 'regressed' when it
   * rose. The FIRST pass (no prior) derives vs the schedule's input
   * failure count (carried in the schedule's initialFindings).
   */
  outcome: PassOutcome;
}

/** The multi-pass schedule — the MEASURED record. */
export interface MultiPassSchedule {
  /** MULTI_PASS_REPAIR_VERSION ('0.1'). */
  multiPassVersion: string;
  /**
   * Content-addressed: 'mpass_' + sha256Hex(canonicalJson(schedule
   * minus id minus scheduledAt)) — deterministic, no uuid, no clock.
   * Excluding scheduledAt means a different caller clock never changes
   * the id.
   */
  id: string;
  /** The source classification's id, carried VERBATIM (the provenance binding). */
  classificationId: string;
  /** The tier whose pass cap governed the schedule. */
  budgetTier: string;
  /** The resolved pass cap (from TIER_PASS_CAPS). */
  maxPasses: number;
  /** MEASURED: the findings count BEFORE the first pass (caller-supplied, carried verbatim). */
  initialFindings: number;
  /** In execution order; EMPTY when the schedule refused before any pass. */
  passes: PassRecord[];
  /** MEASURED: passes.length. */
  totalRounds: number;
  /** Honest: true ONLY when some pass's facts.converged was true. */
  converged: boolean;
  /** RFC3339 — CALLER-injected; the scheduler never reads a clock. */
  scheduledAt: string;
}

/** Fail-closed scheduling: a result, never an exception. */
export type MultiPassResult =
  | { ok: true; schedule: MultiPassSchedule }
  | { ok: false; errors: string[] };

// ---- the pass scheduler --------------------------------------------------------------

/**
 * Schedules ONE multi-pass repair: the tier-capped sequence of bounded
 * repair rounds driven through the duck-typed runner seam until
 * convergence (terminal), a regression (an honest stop), or pass-cap
 * exhaustion. Async because the schedule id hashes (sha256Hex over the
 * canonical schedule body) and the seam is async (each round runs the
 * repair loop's own async work).
 *
 * Fail closed: a non-object classification, a targetVersion other than
 * TARGET_CLASS_VERSION ('0.1'), a budgetTier absent from the frozen
 * pass-cap table (named with the observed value), an empty
 * classification id, a runner without a callable runRound, a negative
 * or fractional initialFindings, or an empty scheduledAt is a
 * collected, field-named error carrying the observed value — ALL
 * errors, never just the first; results, never exceptions; nothing is
 * scheduled from partial data. Extra classification fields (platform,
 * primaryArchetype, …) are the caller's business — the scheduler
 * validates exactly the fields it reads.
 *
 * On success the schedule is DERIVED, honest, never guessed: the pass
 * cap is resolved by a FRESH read of the frozen table (the cap is a
 * LAW); passes run in order (passNumber 1..cap), each stopped-before by
 * the prior state (a prior 'converged' pass is terminal; a prior
 * 'regressed' pass is an honest stop — never spend more passes on a
 * diverging candidate); each pass's outcome is DERIVED from its own
 * facts (the first vs initialFindings); totalRounds and the pass
 * records are MEASURED; converged is true ONLY when a pass reported
 * it. A THROWING runner propagates loudly (a mid-schedule runner
 * failure is the caller's failure — never swallowed, never a synthetic
 * pass record). Deterministic: the same inputs + caller timestamp
 * produce a deep-equal schedule with an identical id, and a different
 * caller clock never moves the id (scheduledAt is excluded from the
 * minting body). The scheduler never mutates its inputs and touches
 * nothing but the classification, the runner, the findings count, and
 * the timestamp given.
 */
export async function scheduleMultiPassRepair(
  classification: unknown,
  runner: unknown,
  initialFindings: number,
  scheduledAt: string,
): Promise<MultiPassResult> {
  const errors: string[] = [];

  // ---- caller-injected schedule time — the scheduler never reads a clock ----
  if (typeof scheduledAt !== 'string' || scheduledAt.length === 0) {
    errors.push(
      `scheduledAt: expected a non-empty string (caller-injected — the scheduler never reads a clock), got ${preview(scheduledAt)}`,
    );
  }

  // ---- initialFindings: the MEASURED count before the first pass, a non-negative integer ----
  if (!isNonNegativeInteger(initialFindings)) {
    errors.push(
      `initialFindings: expected a non-negative integer (the findings count BEFORE the first pass — caller-supplied, carried verbatim as the schedule's baseline), got ${preview(initialFindings)}`,
    );
  }

  // ---- the runner: the duck-typed seam (an object with a callable runRound) ----
  if (!isRoundRunner(runner)) {
    errors.push(
      `runner: expected an object with a callable runRound (the duck-typed seam: everything repair-specific enters here — ONE bounded repair round per invocation, the loop's own business, never re-implemented here), got ${preview(runner)}`,
    );
  }

  // ---- the classification admission shape (a plain object) ----
  if (!isObject(classification)) {
    errors.push(
      `classification: expected an object (a resolved CLAPP-085 TargetClassification: targetVersion, budgetTier, id), got ${preview(classification)}`,
    );
    return { ok: false, errors };
  }

  // ---- targetVersion: the frozen classification contract this lane consumes ----
  const targetVersion = classification['targetVersion'];
  if (targetVersion !== TARGET_CLASS_VERSION) {
    errors.push(
      `classification.targetVersion: expected '0.1' (TARGET_CLASS_VERSION — the frozen classification contract this lane consumes; a mismatch is a named error, never a guess), got ${preview(targetVersion)}`,
    );
  }

  // ---- budgetTier: one of the frozen tiers the pass-cap table spends ----
  const budgetTier = classification['budgetTier'];
  if (!isKnownTier(budgetTier)) {
    errors.push(
      `classification.budgetTier: expected a string from the frozen pass-cap tiers ${vocabulary(TIER_NAMES)} (the tiers CLAPP-085 tags and this lane's table spends), got ${preview(budgetTier)}`,
    );
  }

  // ---- id: the tcls_ provenance, a non-empty string ----
  const classificationId = classification['id'];
  if (typeof classificationId !== 'string' || classificationId.length === 0) {
    errors.push(
      `classification.id: expected a non-empty string (the source classification's tcls_ identity — carried verbatim as the provenance binding), got ${preview(classificationId)}`,
    );
  }

  // ---- fail closed: nothing is scheduled unless every field admitted ----
  if (
    errors.length > 0 ||
    !isKnownTier(budgetTier) ||
    typeof classificationId !== 'string' ||
    classificationId.length === 0 ||
    !isRoundRunner(runner)
  ) {
    return { ok: false, errors };
  }

  // ---- the pass cap: a FRESH read of the frozen table each schedule (the cap is a LAW) ----
  // The table's entry by OWN key (prototype-safe); isKnownTier guaranteed
  // membership, but the undefined guard is kept as the last line of
  // defense (the 060/061/062 precedent).
  const tableCap = TIER_PASS_CAPS[budgetTier];
  if (tableCap === undefined) {
    return {
      ok: false,
      errors: [
        `classification.budgetTier: ${preview(budgetTier)} is not a tier in the frozen pass-cap table (the membership guard was bypassed — refusing rather than guessing)`,
      ],
    };
  }
  const maxPasses = tableCap;

  // ---- the passes: DERIVED, honest, never guessed ----
  // priorRemaining starts at the schedule's own baseline: the FIRST
  // pass's outcome derives vs initialFindings (the caller-supplied
  // failure count before any pass), every later pass vs the PRIOR
  // pass's remainingFindings.
  const passes: PassRecord[] = [];
  let priorRemaining = initialFindings;

  for (let passNumber = 1; passNumber <= maxPasses; passNumber += 1) {
    // ---- before each pass, the prior state decides (the stop laws) ----
    const prior = passes.length > 0 ? passes[passes.length - 1] : null;
    if (prior?.outcome === 'converged') {
      break; // convergence is terminal
    }
    if (prior?.outcome === 'regressed') {
      break; // an honest stop — never spend more passes on a diverging candidate
    }

    // ---- ONE bounded repair round through the seam ----
    // A THROWING runner propagates loudly: results-never-exceptions
    // governs the VALIDATION layer; a runner that throws mid-schedule
    // is the caller's failure — never swallowed, never a synthetic
    // pass record.
    const facts = await runner.runRound(passNumber);

    // The facts carried VERBATIM by value (a fresh flat copy — the
    // sealed-record law: the runner's object is never aliased into the
    // schedule). The outcome is DERIVED, never reported by the seam.
    passes.push({
      passNumber,
      facts: { converged: facts.converged, remainingFindings: facts.remainingFindings },
      outcome: deriveOutcome(facts, priorRemaining),
    });
    priorRemaining = facts.remainingFindings;
  }

  // ---- the MEASURED record ----
  const converged = passes.some((pass) => pass.facts.converged); // ONLY a round's own flag
  const totalRounds = passes.length; // MEASURED

  // ---- the content-addressed schedule identity ----
  // The schedule MINUS its id and scheduledAt is the minting input
  // (the tcls_/pgraph_ discipline with the clock excluded): same id ⇔
  // identical canonical schedule bytes — any measured change (the tier,
  // the cap, the baseline, a pass's facts, the rounds, the convergence)
  // moves the id, while a different caller clock never does.
  const scheduleBody: Omit<MultiPassSchedule, 'id' | 'scheduledAt'> = {
    multiPassVersion: MULTI_PASS_REPAIR_VERSION,
    classificationId,
    budgetTier,
    maxPasses,
    initialFindings,
    passes,
    totalRounds,
    converged,
  };

  // The last line of defense (the 085 precedent): a canonicalization
  // refusal is a NAMED error — never an escaped exception. (The body is
  // built from validated primitives and fact copies, so this cannot
  // fire in practice — the discipline is kept unconditional anyway.)
  let canonical: string;
  try {
    canonical = canonicalJson(scheduleBody);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      errors: [
        `schedule minting: the derived schedule is not canonical-JSON serializable (${detail})`,
      ],
    };
  }
  const id = `${MULTI_PASS_ID_PREFIX}${await sha256Hex(canonical)}`;

  return { ok: true, schedule: { ...scheduleBody, id, scheduledAt } };
}
