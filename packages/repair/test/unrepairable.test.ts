// CLAPP-042 — unrepairable honesty tests.
//
// 1. ELEMENT DELETION (full synthesis flow): the entire pricing h1 line is
//    deleted from the candidate page module. The server still boots; the
//    nav journey fails at the pricing assert; the synthesis compares the
//    heading lists (ordinal + level + text) and emits a STRUCTURAL finding
//    (expected/actual absent — the contract's "absent when structural").
//    No strategy can express the repair → the directive aborts with
//    verdict 'error', the loop records it honestly, converged=false, and
//    remainingCriticalFindings lists the finding. NEVER a fake
//    convergence.
//
// 2. DELETED PAGE FILE (the packet's named example): pages/pricing.html.ts
//    itself is deleted. The generated server imports all page modules at
//    startup, so the candidate cannot boot — the test-side synthesis
//    (which needs a live candidate) cannot run; the report is therefore
//    handcrafted (contract-shaped) with a critical text finding for that
//    route. The repair engine's strategy targets the missing file, the
//    read fails, the attempt aborts 'error' scope-violation-free, the
//    loop never consults the oracle (nothing changed), and the file stays
//    deleted. Honest non-convergence again.

import { describe, expect, test } from 'bun:test';
import { runRepairLoop } from '../src/loop';
import { countingDirectiveIdFactory } from '../src/ids';
import { git, gitHead, gitStatusPorcelain } from '../src/git';
import type { DiffReport } from '../src/diff-contract';
import { buildScenario, teardownScenario, type Scenario } from './helpers/scenario';
import { makeRerunOracle } from './helpers/oracle';
import { buildCandidate, readCandidateFile, removeCandidate } from './helpers/candidate';
import { validateDiffReport, validateRepairLoopResult } from './helpers/shape';
import { buildGoldenB01Plan, corpusRootHash, loadSeededB01Journeys } from '../fixtures/golden-b01-plan';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';

const LINE_TO_DELETE = '    <h1 data-testid="pricing-heading" role="heading">Simple, honest pricing</h1>\n';

describe('unrepairable honesty — the strategy table cannot express everything', () => {
  test(
    'deleted ELEMENT → structural finding, abort verdicts, no fake convergence',
    async () => {
      let scenario: Scenario | null = null;
      try {
        scenario = await buildScenario('unrepairable-element', [
          {
            path: 'pages/pricing.html.ts',
            find: LINE_TO_DELETE,
            replace: '',
            label: 'pricing h1 element deleted',
          },
        ], { findingIdPrefix: 'unrepairable' });

        // The report is contract-shaped and carries ONE STRUCTURAL finding.
        const reportErrors: string[] = [];
        validateDiffReport(scenario.report, reportErrors);
        expect(reportErrors).toEqual([]);
        expect(scenario.report.findings).toHaveLength(1);
        const finding = scenario.report.findings[0]!;
        expect(finding.severity).toBe('critical');
        expect(finding.dimension).toBe('semantic');
        expect('expected' in finding).toBe(false); // ABSENT, never null
        expect('actual' in finding).toBe(false);
        expect(finding.summary).toContain('Simple, honest pricing');

        const oracle = makeRerunOracle({
          plan: scenario.plan,
          journeys: scenario.journeys,
          baselineRootHash: scenario.baselineRootHash,
          baselineFindingCount: 1,
          findingIdPrefix: 'unrepairable_oracle',
        });
        let oracleCalls = 0;
        const result = await runRepairLoop({
          report: scenario.report,
          candidateRoot: scenario.candidate.root,
          rerun: async (root) => {
            oracleCalls += 1;
            return oracle.rerun(root);
          },
          maxIterations: 5,
          idFactory: countingDirectiveIdFactory(),
        });

        // The single directive (empty scope, no strategy) aborts honestly.
        expect(result.attempts).toHaveLength(1);
        expect(result.attempts[0]?.rerunVerdict).toBe('error');
        expect(result.attempts[0]?.changedPaths).toEqual([]);
        expect(result.attempts[0]?.resolvedFindingIds).toEqual([]);
        expect(result.attempts[0]?.baseSha).toBe(scenario.candidate.mutatedSha);
        // Nothing changed → the oracle was never consulted for the abort.
        expect(oracleCalls).toBe(0);

        // NEVER a fake convergence.
        expect(result.converged).toBe(false);
        expect(result.remainingCriticalFindings).toEqual([finding.id]);
        const resultErrors: string[] = [];
        validateRepairLoopResult(result, resultErrors);
        expect(resultErrors).toEqual([]);

        // The candidate is untouched: no new commits, clean tree, the h1
        // is still gone.
        const log = await git(['log', '--oneline'], scenario.candidate.root);
        expect(log.stdout.trim().split('\n')).toHaveLength(2); // pristine + mutation only
        expect(await gitStatusPorcelain(scenario.candidate.root)).toEqual([]);
        const pricing = await readCandidateFile(scenario.candidate.root, 'pages/pricing.html.ts');
        expect(pricing).not.toContain('Simple, honest pricing');
      } finally {
        if (scenario !== null) {
          await teardownScenario(scenario);
        }
      }
    },
    120_000,
  );

  test(
    'deleted PAGE FILE → strategy target missing, abort verdicts, no fake convergence',
    async () => {
      const plan = await buildGoldenB01Plan();
      const root = (await buildCandidate(plan, 'unrepairable-file', [])).root;
      try {
        // Delete the page module and commit the deletion.
        await rm(join(root, 'pages/pricing.html.ts'));
        const commit = await git(
          ['commit', '-am', 'test: delete pages/pricing.html.ts (unrepairable mutation)'],
          root,
        );
        expect(commit.code).toBe(0);
        const mutatedSha = await gitHead(root);
        expect(mutatedSha).not.toBeNull();

        // The candidate cannot boot (server.ts imports every page module),
        // so the paired synthesis cannot run — the report is HANDCRAFTED,
        // contract-shaped, with a critical text finding for that route.
        const report: DiffReport = {
          id: 'diffr_unrepairable_file',
          diffVersion: '0.1',
          candidateAppId: plan.application.id,
          baselineRootHash: await corpusRootHash(),
          runs: [],
          findings: [
            {
              id: 'diff_unrepairable_file_1',
              dimension: 'semantic',
              severity: 'critical',
              summary:
                'Candidate heading text on /pricing.html diverges from the original: the page module is deleted.',
              anchors: [{ stepIndex: 5, sourceIds: ['route_pricing'] }],
              expected: { kind: 'text', route: '/pricing.html', text: 'Simple, honest pricing' },
              actual: { kind: 'text', route: '/pricing.html', text: 'Simple, dishonest pricing' },
            },
          ],
          counts: { critical: 1, major: 0, minor: 0, info: 0 },
          verdict: 'divergent',
          generatedAt: '2026-09-25T00:00:00.000Z',
        };
        const reportErrors: string[] = [];
        validateDiffReport(report, reportErrors);
        expect(reportErrors).toEqual([]);

        const journeys = await loadSeededB01Journeys();
        const oracle = makeRerunOracle({
          plan,
          journeys,
          baselineRootHash: report.baselineRootHash,
          baselineFindingCount: 1,
          findingIdPrefix: 'unrepairable_file_oracle',
        });
        const result = await runRepairLoop({
          report,
          candidateRoot: root,
          rerun: oracle.rerun,
          maxIterations: 5,
          idFactory: countingDirectiveIdFactory(),
        });

        // The strategy's target file is missing → the read fails → the
        // attempt aborts 'error', scope-violation-free, honestly recorded.
        expect(result.attempts).toHaveLength(1);
        expect(result.attempts[0]?.rerunVerdict).toBe('error');
        expect(result.attempts[0]?.changedPaths).toEqual([]);
        expect(result.attempts[0]?.resolvedFindingIds).toEqual([]);
        expect(result.converged).toBe(false);
        expect(result.remainingCriticalFindings).toEqual(['diff_unrepairable_file_1']);
        const resultErrors: string[] = [];
        validateRepairLoopResult(result, resultErrors);
        expect(resultErrors).toEqual([]);

        // The file stays deleted; the tree stays clean; no repair commits.
        const status = await gitStatusPorcelain(root);
        expect(status).toEqual([]);
        const log = await git(['log', '--oneline'], root);
        expect(log.stdout.trim().split('\n')).toHaveLength(2);
        let fileExists = true;
        try {
          await readCandidateFile(root, 'pages/pricing.html.ts');
        } catch {
          fileExists = false;
        }
        expect(fileExists).toBe(false);
      } finally {
        await removeCandidate(root);
      }
    },
    120_000,
  );
});
