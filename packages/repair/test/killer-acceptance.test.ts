/**
 * CLAPP-042 — THE KILLER ACCEPTANCE (evidence-driven convergence,
 * browser-independent).
 *
 * Construct the b01-shaped golden plan → generateApp + writeApp to a
 * scratch git repo → commit the PRISTINE candidate → MUTATE it three
 * ways (one heading text changed; one data-testid removed; one mock
 * status changed — the plan literal carries the api endpoint + mock) →
 * commit the mutations → start the candidate's server + the corpus
 * fixture server → synthesize the DiffReport by replaying the SEEDED
 * journeys via createDomApplier and turning every failed
 * postcondition/assert-visible into a contract-shaped finding (expected =
 * the corpus-side truth, actual = the candidate-side observation) plus
 * the network probe → runRepairLoop with maxIterations 5 and a rerun
 * oracle that replays + re-synthesizes.
 *
 * The loop must CONVERGE: attempts ≤ 5, every attempt committed with
 * baseSha/changedPaths recorded, final rerun 'equivalent',
 * remainingCriticalFindings empty — AND the candidate tree's diff vs the
 * pristine candidate is EXACTLY the inverse of the mutations: the three
 * defects are gone, nothing else changed (`git diff` between the
 * pristine commit and the final head is EMPTY, and the three touched
 * files are byte-identical to their pristine versions).
 *
 * The loop NEVER sees the SynthesisPlan — only the report, the candidate
 * files, and the oracle verdict (non-degeneracy; asserted by construction:
 * runRepairLoop's options carry no plan).
 */

import { describe, expect, test } from 'bun:test';
import { runRepairLoop } from '../src/loop';
import { countingDirectiveIdFactory } from '../src/ids';
import { git, gitHead, gitStatusPorcelain } from '../src/git';
import type { RepairAttempt, RepairLoopResult } from '../src/diff-contract';
import { buildScenario, teardownScenario, type Scenario } from './helpers/scenario';
import { makeRerunOracle } from './helpers/oracle';
import { gitShowFile, readCandidateFile } from './helpers/candidate';
import { validateDiffReport, validateRepairAttempt, validateRepairLoopResult } from './helpers/shape';

const MUTATIONS = [
  {
    path: 'pages/pricing.html.ts',
    find: 'Simple, honest pricing',
    replace: 'Simple, dishonest pricing',
    label: 'pricing h1 text',
  },
  {
    path: 'pages/contact-success.html.ts',
    find: ' data-testid="contact-success"',
    replace: '',
    label: 'contact-success testid removed',
  },
  {
    path: 'server.ts',
    find: 'statusCode: 200',
    replace: 'statusCode: 500',
    label: 'api mock status 500',
  },
];

async function runKiller(maxIterations: number): Promise<{
  scenario: Scenario;
  result: RepairLoopResult;
}> {
  const scenario = await buildScenario('killer', MUTATIONS, { findingIdPrefix: 'killer' });
  const oracle = makeRerunOracle({
    plan: scenario.plan,
    journeys: scenario.journeys,
    baselineRootHash: scenario.baselineRootHash,
    baselineFindingCount: scenario.report.findings.length,
    findingIdPrefix: 'killer_oracle',
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

describe('KILLER — evidence-driven convergence over a three-mutation candidate', () => {
  test(
    'synthesize → repair loop → converge → git diff vs pristine is EMPTY',
    async () => {
      let scenario: Scenario | null = null;
      try {
        const run = await runKiller(5);
        scenario = run.scenario;
        const { result } = run;

        // ---- The report is honest and contract-shaped -------------------
        const reportErrors: string[] = [];
        validateDiffReport(run.scenario.report, reportErrors);
        expect(reportErrors).toEqual([]);
        // Two critical (heading text + missing testid) + one major (mock status).
        expect(run.scenario.report.verdict).toBe('divergent');
        expect(run.scenario.report.findings.map((finding) => finding.id)).toEqual([
          'diff_killer_1',
          'diff_killer_2',
          'diff_killer_3',
        ]);
        expect(run.scenario.report.counts).toEqual({ critical: 2, major: 1, minor: 0, info: 0 });
        for (const finding of run.scenario.report.findings) {
          expect(finding.anchors[0]?.leftEvidence).toBeDefined();
          expect(finding.anchors[0]?.rightEvidence).toBeDefined();
          expect(finding.anchors[0]?.leftEvidence).not.toBeNull();
        }
        const [textFinding, testidFinding, mockFinding] = run.scenario.report.findings;
        expect(textFinding?.dimension).toBe('semantic');
        expect(textFinding?.severity).toBe('critical');
        expect(textFinding?.expected).toEqual({ kind: 'text', route: '/pricing.html', text: 'Simple, honest pricing' });
        expect(textFinding?.actual).toEqual({ kind: 'text', route: '/pricing.html', text: 'Simple, dishonest pricing' });
        expect(testidFinding?.dimension).toBe('semantic');
        expect(testidFinding?.severity).toBe('critical');
        expect(testidFinding?.expected).toEqual({
          kind: 'testid',
          route: '/contact-success.html',
          testId: 'contact-success',
          tag: 'h1',
          text: 'Thanks for reaching out!',
          matchIndex: 0,
        });
        expect((testidFinding?.actual as Record<string, unknown>)['testId']).toBeUndefined();
        expect(mockFinding?.dimension).toBe('network');
        expect(mockFinding?.severity).toBe('major');
        expect((mockFinding?.expected as Record<string, unknown>)['statusCode']).toBe(200);
        expect((mockFinding?.actual as Record<string, unknown>)['statusCode']).toBe(500);

        // ---- The loop CONVERGED within the budget ------------------------
        expect(result.converged).toBe(true);
        expect(result.remainingCriticalFindings).toEqual([]);
        expect(result.attempts.length).toBeLessThanOrEqual(5);
        expect(result.attempts.length).toBe(3); // one per directive: testid, text, mock

        // Verdict sequence: partial repairs stay divergent, the last is equivalent.
        expect(result.attempts.map((attempt) => attempt.rerunVerdict)).toEqual([
          'divergent',
          'divergent',
          'equivalent',
        ]);

        // Every attempt is a real git commit with honest records.
        const unionResolved = new Set<string>();
        for (const attempt of result.attempts as RepairAttempt[]) {
          const attemptErrors: string[] = [];
          validateRepairAttempt(attempt, attemptErrors, `attempt[${attempt.iteration - 1}]`);
          expect(attemptErrors).toEqual([]);
          expect(attempt.baseSha).toMatch(/^[0-9a-f]{40}$/);
          expect(attempt.changedPaths.length).toBeGreaterThan(0);
          expect(attempt.iteration).toBeGreaterThan(0);
          for (const id of attempt.resolvedFindingIds) {
            unionResolved.add(id);
          }
        }
        expect([...unionResolved].sort()).toEqual(['diff_killer_1', 'diff_killer_2', 'diff_killer_3']);
        const resultErrors: string[] = [];
        validateRepairLoopResult(result, resultErrors);
        expect(resultErrors).toEqual([]);

        // changedPaths stay within the directive scopes (page modules + server).
        for (const attempt of result.attempts) {
          for (const path of attempt.changedPaths) {
            expect(path === 'server.ts' || path.startsWith('pages/')).toBe(true);
          }
        }

        // The candidate repo has: pristine + mutation + 3 repair commits.
        const log = await git(['log', '--oneline'], scenario.candidate.root);
        expect(log.stdout.trim().split('\n')).toHaveLength(5);
        for (const line of log.stdout.trim().split('\n')) {
          if (line.includes('clapp-repair:')) {
            expect(line).toContain('repd_00000'); // deterministic counting ids
          }
        }
        const head = await gitHead(scenario.candidate.root);
        expect(head).not.toBeNull();

        // ---- The inverse-of-mutations property (byte-exact) -------------
        // git diff pristine..final head: EMPTY — the repairs are exactly
        // the inverse of the mutations, nothing else changed.
        const diff = await git(
          ['diff', '--name-only', `${scenario.candidate.pristineSha}..HEAD`],
          scenario.candidate.root,
        );
        expect(diff.stdout.trim()).toBe('');
        const diffStat = await git(
          ['diff', '--stat', `${scenario.candidate.pristineSha}..HEAD`],
          scenario.candidate.root,
        );
        expect(diffStat.stdout.trim()).toBe('');

        // The three mutated files are byte-identical to pristine again.
        for (const mutation of MUTATIONS) {
          const current = await readCandidateFile(scenario.candidate.root, mutation.path);
          const pristine = await gitShowFile(
            scenario.candidate.root,
            scenario.candidate.pristineSha,
            mutation.path,
          );
          expect(current).toBe(pristine);
        }

        // The working tree is clean (no leftover edits).
        const status = await gitStatusPorcelain(scenario.candidate.root);
        expect(status).toEqual([]);
      } finally {
        if (scenario !== null) {
          await teardownScenario(scenario);
        }
      }
    },
    120_000,
  );

  test(
    'the rerun oracle itself reports equivalent only when all findings are gone',
    async () => {
      // Independent oracle check: against the PRISTINE candidate the
      // synthesis finds NOTHING (equivalent); against the mutated
      // candidate it finds the three defects (divergent).
      const scenario = await buildScenario('killer-oracle', MUTATIONS, {
        findingIdPrefix: 'killer_oracle2',
      });
      try {
        const oracle = makeRerunOracle({
          plan: scenario.plan,
          journeys: scenario.journeys,
          baselineRootHash: scenario.baselineRootHash,
          baselineFindingCount: 3,
          findingIdPrefix: 'killer_oracle2',
        });
        expect(await oracle.rerun(scenario.candidate.root)).toBe('divergent');

        // Hard-reset the candidate to pristine: the oracle must flip to equivalent.
        const reset = await git(['reset', '--hard', scenario.candidate.pristineSha], scenario.candidate.root);
        expect(reset.code).toBe(0);
        expect(await oracle.rerun(scenario.candidate.root)).toBe('equivalent');
      } finally {
        await teardownScenario(scenario);
      }
    },
    60_000,
  );
});
