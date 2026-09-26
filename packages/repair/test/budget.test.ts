// CLAPP-042 — budget enforcement tests.
//
// A scenario whose convergence requires iteration 3 (three CRITICAL
// defects on three different routes — each independently observed by its
// own seeded journey: the contact-success testid, the newsletter-success
// testid, and the pricing heading text) is run with maxIterations 2.
// The loop must stop at the budget with HONEST non-convergence: partial
// progress recorded in the attempts (two findings edit-verified
// resolved, with commits), the third mutation still broken, its critical
// finding listed in remainingCriticalFindings, converged=false, and the
// recorded rerun verdicts 'divergent' (never a fabricated 'equivalent').
//
// The same scenario with a sufficient budget (3) converges — proving the
// non-convergence is the BUDGET's honest verdict, not an unrepairable
// candidate.

import { describe, expect, test } from 'bun:test';
import { runRepairLoop } from '../src/loop';
import { countingDirectiveIdFactory } from '../src/ids';
import type { RepairLoopResult } from '../src/diff-contract';
import { buildScenario, teardownScenario, type Scenario } from './helpers/scenario';
import { makeRerunOracle } from './helpers/oracle';
import { readCandidateFile } from './helpers/candidate';
import { validateRepairLoopResult } from './helpers/shape';

const MUTATIONS = [
  {
    path: 'pages/contact-success.html.ts',
    find: ' data-testid="contact-success"',
    replace: '',
    label: 'contact-success testid removed',
  },
  {
    path: 'pages/newsletter-success.html.ts',
    find: ' data-testid="newsletter-success"',
    replace: '',
    label: 'newsletter-success testid removed',
  },
  {
    path: 'pages/pricing.html.ts',
    find: 'Simple, honest pricing',
    replace: 'Simple, dishonest pricing',
    label: 'pricing h1 text',
  },
];

async function runBudgeted(maxIterations: number): Promise<{
  scenario: Scenario;
  result: RepairLoopResult;
}> {
  const scenario = await buildScenario('budget', MUTATIONS, { findingIdPrefix: 'budget' });
  const oracle = makeRerunOracle({
    plan: scenario.plan,
    journeys: scenario.journeys,
    baselineRootHash: scenario.baselineRootHash,
    baselineFindingCount: scenario.report.findings.length,
    findingIdPrefix: 'budget_oracle',
  });
  const result = await runRepairLoop({
    report: scenario.report,
    candidateRoot: scenario.candidate.root,
    rerun: oracle.rerun,
    maxIterations,
    idFactory: countingDirectiveIdFactory(),
  });
  return { scenario, result };
}

describe('budget enforcement — honest non-convergence at the iteration cap', () => {
  test(
    'three critical defects, budget 2 → the third mutation would be repaired only on iteration 3',
    async () => {
      let scenario: Scenario | null = null;
      try {
        const run = await runBudgeted(2);
        scenario = run.scenario;
        const { result } = run;

        // Three independent critical findings — all visible to the report.
        expect(run.scenario.report.counts.critical).toBe(3);
        expect(run.scenario.report.counts.major).toBe(0);
        expect(run.scenario.report.findings.map((f) => f.id)).toEqual([
          'diff_budget_1',
          'diff_budget_2',
          'diff_budget_3',
        ]);

        // The budget stopped the loop at 2 attempts (of 3 directives).
        expect(result.maxIterations).toBe(2);
        expect(result.attempts).toHaveLength(2);
        // Verdicts are honest: still divergent after each partial repair.
        expect(result.attempts.map((attempt) => attempt.rerunVerdict)).toEqual([
          'divergent',
          'divergent',
        ]);

        // Partial progress is recorded: each attempt committed its edit
        // and resolved its own finding (directive order is by scope path:
        // contact-success < newsletter-success < pricing).
        expect(result.attempts[0]?.changedPaths).toEqual(['pages/contact-success.html.ts']);
        expect(result.attempts[0]?.resolvedFindingIds).toEqual(['diff_budget_3']);
        expect(result.attempts[1]?.changedPaths).toEqual(['pages/newsletter-success.html.ts']);
        expect(result.attempts[1]?.resolvedFindingIds).toEqual(['diff_budget_2']);

        // The third mutation (pricing) remains: honest non-convergence.
        expect(result.converged).toBe(false);
        expect(result.remainingCriticalFindings).toEqual(['diff_budget_1']);
        const resultErrors: string[] = [];
        validateRepairLoopResult(result, resultErrors);
        expect(resultErrors).toEqual([]);

        // The candidate carries the partial progress: two defects gone,
        // the third still present.
        const contactSuccess = await readCandidateFile(
          scenario.candidate.root,
          'pages/contact-success.html.ts',
        );
        expect(contactSuccess).toContain('data-testid="contact-success"');
        const newsletterSuccess = await readCandidateFile(
          scenario.candidate.root,
          'pages/newsletter-success.html.ts',
        );
        expect(newsletterSuccess).toContain('data-testid="newsletter-success"');
        const pricing = await readCandidateFile(scenario.candidate.root, 'pages/pricing.html.ts');
        expect(pricing).toContain('Simple, dishonest pricing'); // still broken
      } finally {
        if (scenario !== null) {
          await teardownScenario(scenario);
        }
      }
    },
    120_000,
  );

  test(
    'the same scenario with budget 3 converges (the cap, not the candidate, caused the non-convergence)',
    async () => {
      let scenario: Scenario | null = null;
      try {
        const run = await runBudgeted(3);
        scenario = run.scenario;
        const { result } = run;
        expect(result.attempts).toHaveLength(3);
        expect(result.attempts.map((attempt) => attempt.rerunVerdict)).toEqual([
          'divergent',
          'divergent',
          'equivalent',
        ]);
        expect(result.converged).toBe(true);
        expect(result.remainingCriticalFindings).toEqual([]);
        const pricing = await readCandidateFile(scenario.candidate.root, 'pages/pricing.html.ts');
        expect(pricing).toContain('Simple, honest pricing');
      } finally {
        if (scenario !== null) {
          await teardownScenario(scenario);
        }
      }
    },
    120_000,
  );
});
