// CLAPP-089 — human release gate fixtures.
//
// The CLAPP-088 schedule DATA: a MINIMAL-tier and an EXTENDED-tier
// MultiPassSchedule, each minted by the ACTUAL scheduleMultiPassRepair
// over the 088 fixtures' tier classifications (real content-addressed
// mpass_ ids and honest tcls_ provenance — not invented strings); the
// fixtures import @clapp/factory's own contracts for TYPES ONLY, never
// runtime values. The minimal schedule converges honestly on its capped
// second pass; the extended schedule exhausts its 8-pass cap WITHOUT
// converging (findings falling, then stalling) — so the pair covers
// both convergence facts the gate must carry VERBATIM (never
// re-derived, never blocked on).
//
// The mpass_ ids are OPAQUE fixture data to this lane: the gate
// duck-validates exactly the fields it consumes (multiPassVersion /
// id / budgetTier / converged / classificationId / totalRounds) and
// carries the id VERBATIM as the provenance chain's scheduleId — it
// never recomputes or asserts the id's content (this lane mints only
// its own 'rgate_' gate ids, whose determinism the tests measure). The
// malformed builder overrides the minimal fixture with contract-
// violating DATA on purpose — one named field error per demonstration.
//
// The verdicts need no fixtures: the two-value vocabulary ('approved' /
// 'rejected') is CALLER-PRESENTED data — the tests present the literal
// strings themselves, exactly as the human caller's argument would
// arrive at the seam (the gate never derives a verdict, so a verdict
// fixture would be a lie about where verdicts come from).

import type { MultiPassSchedule } from '../../src/multi-pass-repair';

/** Fixed caller-injected gate/release timestamps (fixtures never read the clock). */
export const GATED_AT_A = '2026-10-03T09:00:00Z';
export const GATED_AT_B = '2026-10-03T10:30:00Z';
export const RELEASED_AT_A = '2026-10-03T12:00:00Z';
export const RELEASED_AT_B = '2026-10-03T13:15:00Z';

// ---- the schedule fixtures (REAL CLAPP-088 outputs, one per convergence fact) ------

/**
 * The minimal-tier schedule — minted by the actual CLAPP-088 scheduler
 * over the 088 fixtures' MINIMAL_CLASSIFICATION (tcls_0b43…, the real
 * content-addressed digest of that body): findings 4 → 2 → 0, converging
 * honestly on the capped second pass (totalRounds 2, converged true).
 */
export const MINIMAL_SCHEDULE: MultiPassSchedule = {
  multiPassVersion: '0.1',
  classificationId: 'tcls_0b43529d4c00ef0c4e76e1b4215e2bcf143a6ff5479906e46439cabdf4b63a99',
  budgetTier: 'minimal',
  maxPasses: 2,
  initialFindings: 4,
  passes: [
    {
      passNumber: 1,
      facts: {
        converged: false,
        remainingFindings: 2,
      },
      outcome: 'improved',
    },
    {
      passNumber: 2,
      facts: {
        converged: true,
        remainingFindings: 0,
      },
      outcome: 'converged',
    },
  ],
  totalRounds: 2,
  converged: true,
  id: 'mpass_42a9f1155ac2267474323cbc5809d4404297d0108ef06374069c936ae096d4a2',
  scheduledAt: '2026-10-03T08:00:00Z',
};

/**
 * The extended-tier schedule — minted by the actual CLAPP-088 scheduler
 * over the 088 fixtures' EXTENDED_CLASSIFICATION (tcls_d234…, the real
 * content-addressed digest of that body): findings 9 → 9 → 6 → 4 → 4 →
 * 3 → 3 → 3 → 3, exhausting the 8-pass cap WITHOUT converging — honest
 * budget exhaustion, convergence never inferred (totalRounds 8,
 * converged false).
 */
export const EXTENDED_SCHEDULE: MultiPassSchedule = {
  multiPassVersion: '0.1',
  classificationId: 'tcls_d2348576e123ad0182b1a9a48efc2ef9a60b93122682275e1bf3ac3bb4269af5',
  budgetTier: 'extended',
  maxPasses: 8,
  initialFindings: 9,
  passes: [
    {
      passNumber: 1,
      facts: {
        converged: false,
        remainingFindings: 9,
      },
      outcome: 'stalled',
    },
    {
      passNumber: 2,
      facts: {
        converged: false,
        remainingFindings: 6,
      },
      outcome: 'improved',
    },
    {
      passNumber: 3,
      facts: {
        converged: false,
        remainingFindings: 4,
      },
      outcome: 'improved',
    },
    {
      passNumber: 4,
      facts: {
        converged: false,
        remainingFindings: 4,
      },
      outcome: 'stalled',
    },
    {
      passNumber: 5,
      facts: {
        converged: false,
        remainingFindings: 3,
      },
      outcome: 'improved',
    },
    {
      passNumber: 6,
      facts: {
        converged: false,
        remainingFindings: 3,
      },
      outcome: 'stalled',
    },
    {
      passNumber: 7,
      facts: {
        converged: false,
        remainingFindings: 3,
      },
      outcome: 'stalled',
    },
    {
      passNumber: 8,
      facts: {
        converged: false,
        remainingFindings: 3,
      },
      outcome: 'stalled',
    },
  ],
  totalRounds: 8,
  converged: false,
  id: 'mpass_44b8b7690d4fbac2599da4700daafa2eaea769b89cd2d46284748b22d8db74ab',
  scheduledAt: '2026-10-03T08:00:00Z',
};

/** The well-formed schedule fixture (the minimal tier). */
export const VALID_SCHEDULE: MultiPassSchedule = MINIMAL_SCHEDULE;

/**
 * Overriding builder: the valid fixture with contract-violating DATA
 * injected on purpose (one named field error per demonstration — the
 * same discipline as the 088 fixtures' malformedClassification). Also
 * used for WELL-FORMED single-field variations (the determinism
 * isolation checks): the override is schedule-shaped DATA, and the gate
 * duck-validates exactly the fields it reads.
 */
export function malformedSchedule(patch: Record<string, unknown>): unknown {
  return { ...MINIMAL_SCHEDULE, ...patch };
}
