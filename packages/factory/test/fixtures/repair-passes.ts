// CLAPP-088 — multi-pass repair fixtures.
//
// Two sections: the CLAPP-085 classification DATA (full frozen v0.1
// TargetClassification shapes — one per frozen tier, each carrying a
// REAL content-addressed tcls_ id minted by the actual classifyTarget
// over the 085 fixtures' VALID_REQUEST, so the ids are honest
// provenance for each tier's body, not invented strings; the fixtures
// import @clapp/factory's own contracts for TYPES ONLY, never runtime
// values) and the repair-pass fixtures over them (the round-facts
// builders + the SCRIPTED fake round runners — the duck-typed seam
// faked as DATA, relative TYPE-ONLY imports from src, the house
// discipline).
//
// The tcls_ ids are OPAQUE fixture data to this lane: the scheduler
// duck-validates exactly the fields it consumes (targetVersion /
// budgetTier / id) and carries the id VERBATIM as the provenance
// binding — it never recomputes or asserts the id's content (this lane
// mints only its own 'mpass_' schedule ids, whose determinism the tests
// measure). The scripted fact sequences mirror what a real orchestrator
// would measure across bounded repair rounds (findings falling,
// stalling, regressing, converging), so the fixtures are honest
// round-shaped DATA, not invented verdicts — the runner fake NEVER
// reports a derived outcome (that is this lane's own derivation, and
// the tests pin that the seam's facts are consumed as DATA).

import type { TargetClassification } from '../../src/target-classification';
import type { RepairRoundRunner, RoundFacts } from '../../src/multi-pass-repair';

/** Fixed caller-injected schedule timestamps (fixtures never read the clock). */
export const SCHEDULED_AT_A = '2026-10-03T06:00:00Z';
export const SCHEDULED_AT_B = '2026-10-03T07:00:00Z';

// ---- the classification fixtures (REAL CLAPP-085 outputs, one per tier) -------------

/**
 * The minimal-tier classification — the 085 VALID_REQUEST (linux, the
 * two-match learn classification) resolved with budgetTier 'minimal';
 * the tcls_ id is the real content-addressed digest of that body.
 */
export const MINIMAL_CLASSIFICATION: TargetClassification = {
  targetVersion: '0.1',
  platform: 'linux',
  primaryArchetype: 'api-backed-app',
  matchCount: 2,
  budgetTier: 'minimal',
  outcome: 'classified',
  id: 'tcls_0b43529d4c00ef0c4e76e1b4215e2bcf143a6ff5479906e46439cabdf4b63a99',
  classifiedAt: '2026-10-03T02:00:00Z',
};

/**
 * The standard-tier classification — the 085 VALID_REQUEST resolved
 * with budgetTier 'standard' (the well-formed fixture this lane's tests
 * default to); the tcls_ id is the real content-addressed digest of
 * that body.
 */
export const STANDARD_CLASSIFICATION: TargetClassification = {
  targetVersion: '0.1',
  platform: 'linux',
  primaryArchetype: 'api-backed-app',
  matchCount: 2,
  budgetTier: 'standard',
  outcome: 'classified',
  id: 'tcls_348dd61862f09e4a1df8c7815d47665a798785be395da4c346d3b9507ef9c7f8',
  classifiedAt: '2026-10-03T02:00:00Z',
};

/**
 * The extended-tier classification — the 085 VALID_REQUEST resolved
 * with budgetTier 'extended'; the tcls_ id is the real content-addressed
 * digest of that body.
 */
export const EXTENDED_CLASSIFICATION: TargetClassification = {
  targetVersion: '0.1',
  platform: 'linux',
  primaryArchetype: 'api-backed-app',
  matchCount: 2,
  budgetTier: 'extended',
  outcome: 'classified',
  id: 'tcls_d2348576e123ad0182b1a9a48efc2ef9a60b93122682275e1bf3ac3bb4269af5',
  classifiedAt: '2026-10-03T02:00:00Z',
};

/** The well-formed classification fixture (the standard tier). */
export const VALID_CLASSIFICATION: TargetClassification = STANDARD_CLASSIFICATION;

/** Overriding builder: the valid fixture with contract-violating DATA injected on purpose. */
export function malformedClassification(patch: Record<string, unknown>): unknown {
  return { ...STANDARD_CLASSIFICATION, ...patch };
}

// ---- the round-facts fixtures (the seam's output shapes, consumed as DATA) -----------

/** One scripted round's facts — the round's own honest report. */
export function roundFacts(remainingFindings: number, converged = false): RoundFacts {
  return { converged, remainingFindings };
}

// ---- the scripted fake round runners (the duck-typed seam, faked as DATA) ------------

/**
 * A fake round runner with a SCRIPTED fact sequence (the duck-typed
 * seam, faked): each `runRound(passNumber)` returns the next entry's
 * facts and records the pass number in `calls` (so tests MEASURE which
 * passes the scheduler actually spent). When the script runs dry the
 * LAST entry repeats — a never-converging script honestly never
 * converges, and a script whose convergence sits past a stop law or the
 * cap is simply never asked for it.
 *
 * The fake NEVER reports a derived outcome — only the round's own
 * facts; every outcome in the schedule is the scheduler's own
 * derivation.
 */
export function scriptedRunner(
  factSequence: RoundFacts[],
): RepairRoundRunner & { calls: number[] } {
  let index = 0;
  const calls: number[] = [];
  return {
    calls,
    runRound: async (passNumber: number): Promise<RoundFacts> => {
      calls.push(passNumber);
      const scripted = factSequence[Math.min(index, factSequence.length - 1)];
      const facts: RoundFacts = scripted ?? { converged: false, remainingFindings: 0 };
      index += 1;
      return { converged: facts.converged, remainingFindings: facts.remainingFindings };
    },
  };
}

/**
 * A fake round runner that THROWS from runRound — for the loud-
 * propagation law (a mid-schedule runner failure is the caller's
 * failure: never swallowed, never a synthetic pass record).
 */
export function throwingRunner(message = 'the runner exploded mid-schedule'): RepairRoundRunner {
  return {
    runRound: async (): Promise<RoundFacts> => {
      throw new Error(message);
    },
  };
}
