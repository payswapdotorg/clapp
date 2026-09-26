// CLAPP-042 — determinism tests.
//
// Same report + same candidate (bytes) → identical directive clustering
// AND byte-identical final trees, with directive ids minted from
// injectable factories (documented in README): run the full killer
// scenario twice on two byte-identical mutated candidates with the SAME
// report object and fresh counting id factories, then deep-compare the
// directives and compare every file byte-for-byte. (Commit SHAs may
// differ — timestamps are not part of the tree — so attempts are
// compared on everything except baseSha.)

import { describe, expect, test } from 'bun:test';
import { runRepairLoop } from '../src/loop';
import { clusterFindings } from '../src/directives';
import { countingDirectiveIdFactory } from '../src/ids';
import { buildScenario, teardownScenario } from './helpers/scenario';
import { makeRerunOracle } from './helpers/oracle';
import { listTreeFiles, readCandidateFile } from './helpers/candidate';
import type { RepairAttempt } from '../src/diff-contract';

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

function stripBaseSha(attempts: RepairAttempt[]): Array<Omit<RepairAttempt, 'baseSha'>> {
  return attempts.map((attempt) => ({
    directiveId: attempt.directiveId,
    iteration: attempt.iteration,
    changedPaths: attempt.changedPaths,
    rerunVerdict: attempt.rerunVerdict,
    resolvedFindingIds: attempt.resolvedFindingIds,
  }));
}

describe('determinism — same report + same candidate bytes → identical outcomes', () => {
  test(
    'identical directives, identical attempt records (minus SHAs), byte-identical final trees',
    async () => {
      let roots: string[] = [];
      try {
        // Candidate A (with the mutation flow + report synthesis).
        const scenarioA = await buildScenario('determinism-a', MUTATIONS, {
          findingIdPrefix: 'determinism',
        });
        roots = [scenarioA.candidate.root];

        // Candidate B: byte-identical mutations, built WITHOUT wiping A.
        const { buildCandidate } = await import('./helpers/candidate');
        const candidateB = await buildCandidate(scenarioA.plan, 'determinism-b', MUTATIONS, {
          cleanStale: false,
        });
        roots.push(candidateB.root);

        // The candidates start byte-identical.
        const filesA = await listTreeFiles(scenarioA.candidate.root);
        const filesB = await listTreeFiles(candidateB.root);
        expect(filesA).toEqual(filesB);
        for (const file of filesA) {
          expect(await readCandidateFile(candidateB.root, file)).toBe(
            await readCandidateFile(scenarioA.candidate.root, file),
          );
        }

        // Clustering is identical with fresh counting factories.
        const directivesA = clusterFindings(scenarioA.report, {
          idFactory: countingDirectiveIdFactory(),
        });
        const directivesB = clusterFindings(scenarioA.report, {
          idFactory: countingDirectiveIdFactory(),
        });
        expect(directivesA).toEqual(directivesB);
        expect(directivesA).toHaveLength(3);

        // The full loop, twice: same report object, same oracle
        // construction, fresh counting factories.
        const oracleFor = (root: string) => {
          const oracle = makeRerunOracle({
            plan: scenarioA.plan,
            journeys: scenarioA.journeys,
            baselineRootHash: scenarioA.baselineRootHash,
            baselineFindingCount: scenarioA.report.findings.length,
            findingIdPrefix: 'determinism_oracle',
          });
          return oracle.rerun(root);
        };
        const resultA = await runRepairLoop({
          report: scenarioA.report,
          candidateRoot: scenarioA.candidate.root,
          rerun: oracleFor,
          maxIterations: 5,
          idFactory: countingDirectiveIdFactory(),
        });
        const resultB = await runRepairLoop({
          report: scenarioA.report, // the SAME report object
          candidateRoot: candidateB.root,
          rerun: oracleFor,
          maxIterations: 5,
          idFactory: countingDirectiveIdFactory(), // a FRESH counter
        });

        // Identical loop outcomes (baseSha excluded: commit timestamps
        // make SHAs differ between repos; the TREES are the claim).
        expect(resultA.converged).toBe(true);
        expect(resultB.converged).toBe(true);
        expect(resultA.maxIterations).toBe(resultB.maxIterations);
        expect(resultA.remainingCriticalFindings).toEqual(resultB.remainingCriticalFindings);
        expect(stripBaseSha(resultA.attempts)).toEqual(stripBaseSha(resultB.attempts));
        expect(resultA.attempts.map((a) => a.directiveId)).toEqual([
          'repd_000001',
          'repd_000002',
          'repd_000003',
        ]);
        expect(resultB.attempts.map((a) => a.directiveId)).toEqual([
          'repd_000001',
          'repd_000002',
          'repd_000003',
        ]);

        // BYTE-identical final trees.
        const finalA = await listTreeFiles(scenarioA.candidate.root);
        const finalB = await listTreeFiles(candidateB.root);
        expect(finalA).toEqual(finalB);
        for (const file of finalA) {
          expect(await readCandidateFile(candidateB.root, file)).toBe(
            await readCandidateFile(scenarioA.candidate.root, file),
          );
        }
        // …and both restored the pristine bytes (the repair is the exact
        // inverse of the mutations, reproducibly).
        for (const mutation of MUTATIONS) {
          const restored = await readCandidateFile(scenarioA.candidate.root, mutation.path);
          expect(restored).not.toContain('Simple, dishonest pricing');
          expect(restored).not.toContain('statusCode: 500');
        }
        expect(await readCandidateFile(scenarioA.candidate.root, 'pages/contact-success.html.ts')).toBe(
          await readCandidateFile(candidateB.root, 'pages/contact-success.html.ts'),
        );

        await teardownScenario(scenarioA);
      } finally {
        for (const root of roots) {
          await import('./helpers/candidate').then((mod) => mod.removeCandidate(root));
        }
      }
    },
    180_000,
  );
});
