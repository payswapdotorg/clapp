/**
 * @clapp/explore — the exploration report (CLAPP-022).
 *
 * Every number here is honest and tested: counters are maintained by the
 * explorer as it executes policy decisions; budget stops and
 * frontierExhausted are relayed verbatim from the policy's terminating
 * 'done' decision; no field is estimated or inferred.
 */

/** What one exploration run actually did (all fields plain data). */
export interface ExplorationReport {
  /** Distinct normalized routes visited, in first-visit order. */
  screensVisited: string[];
  /** Act decisions whose state-changing action (fill/click) applied. */
  actionsApplied: number;
  /** Act decisions that did NOT apply (assert-visible failure or apply error). */
  actionsSkipped: number;
  /** Every action attempted through the applier: navigates, assert probes,
   * fills, clicks, and backtrack prefix replays — applied or failed. */
  stepsUsed: number;
  /** Budget stops that ended exploration: 'max-steps' | 'max-screens' |
   * 'max-actions-per-screen' (empty when work completed naturally). */
  budgetStops: string[];
  /** True iff exploration ended with no work remaining (frontier empty and
   * no untried act candidates on any visited screen). */
  frontierExhausted: boolean;
  /** Non-backtrack arrivals at an already-visited route (revisits via
   * navigate/act decisions; deliberate backtrack replays are excluded). */
  duplicateScreensSkipped: number;
}
