// CLAPP-042 — finding-shape conformance tests.
//
// The consumed reports and produced attempts/directives/results are
// validated against the MIRROR types at runtime by the scenario tests
// (killer, unrepairable, scope, budget, determinism all call the
// validators). This file exercises the validators THEMSELVES:
//
// - optional fields stay ABSENT, never null (a null optional is a
//   contract violation, flagged loudly);
// - corrupted shapes (null expected, wrong severity, dishonest counts,
//   converged ≠ remaining-empty, unexpected fields) are all rejected;
// - well-formed shapes with absent optionals pass cleanly.
//
// The validators live in test/helpers/shape.ts and are pure.

import { describe, expect, test } from 'bun:test';
import {
  validateDiffFinding,
  validateDiffReport,
  validateRepairAttempt,
  validateRepairDirective,
  validateRepairLoopResult,
} from './helpers/shape';
import type { DiffFinding, DiffReport, RepairAttempt, RepairDirective, RepairLoopResult } from '../src/diff-contract';
import type { EvidenceRef } from '@clapp/core';

const asRecord = (value: unknown): Record<string, unknown> => structuredClone(value) as Record<string, unknown>;

const ev: EvidenceRef = { evidenceId: 'ev_shape', kind: 'static', sha256: '0'.repeat(64) };

function textFinding(): DiffFinding {
  return {
    id: 'diff_shape_1',
    dimension: 'semantic',
    severity: 'critical',
    summary: 'A well-formed text finding.',
    anchors: [{ stepIndex: 3, leftEvidence: ev, rightEvidence: ev, sourceIds: ['route_x'] }],
    expected: { kind: 'text', route: '/x.html', text: 'expected' },
    actual: { kind: 'text', route: '/x.html', text: 'actual' },
  };
}

function structuralFinding(): DiffFinding {
  return {
    id: 'diff_shape_2',
    dimension: 'semantic',
    severity: 'critical',
    summary: 'A well-formed structural finding (expected/actual ABSENT).',
    anchors: [{ stepIndex: 1, sourceIds: ['journey_x'] }],
  };
}

function report(findings: DiffFinding[]): DiffReport {
  const counts = { critical: 0, major: 0, minor: 0, info: 0 };
  for (const finding of findings) {
    counts[finding.severity] += 1;
  }
  return {
    id: 'diffr_shape',
    diffVersion: '0.1',
    candidateAppId: 'appsyn_shape',
    baselineRootHash: '0'.repeat(64),
    runs: [],
    findings,
    counts,
    verdict: findings.length === 0 ? 'equivalent' : 'divergent',
    generatedAt: '2026-09-25T00:00:00.000Z',
  };
}

describe('shape validators (consumed + produced objects vs the MIRROR types)', () => {
  test('well-formed findings with ABSENT optionals pass; null optionals are rejected', () => {
    const errors: string[] = [];
    validateDiffFinding(textFinding(), errors, 'finding');
    validateDiffFinding(structuralFinding(), errors, 'finding');
    expect(errors).toEqual([]);

    // Null optional fields are contract violations (absent, never null).
    const withNullExpected = asRecord(textFinding());
    withNullExpected['expected'] = null;
    const nullErrors: string[] = [];
    validateDiffFinding(withNullExpected, nullErrors, 'finding');
    expect(nullErrors.some((error) => error.includes('expected is null'))).toBe(true);

    const withNullLeftEvidence = asRecord(textFinding());
    (withNullLeftEvidence['anchors'] as Array<Record<string, unknown>>)[0]!['leftEvidence'] = null;
    const anchorErrors: string[] = [];
    validateDiffFinding(withNullLeftEvidence, anchorErrors, 'finding');
    expect(anchorErrors.some((error) => error.includes('leftEvidence is null'))).toBe(true);
  });

  test('corrupted finding shapes are rejected loudly', () => {
    const badSeverity = asRecord(textFinding());
    badSeverity['severity'] = 'catastrophic';
    const severityErrors: string[] = [];
    validateDiffFinding(badSeverity, severityErrors, 'finding');
    expect(severityErrors.some((error) => error.includes('severity'))).toBe(true);

    const badDimension = asRecord(textFinding());
    badDimension['dimension'] = 'vibes';
    const dimensionErrors: string[] = [];
    validateDiffFinding(badDimension, dimensionErrors, 'finding');
    expect(dimensionErrors.some((error) => error.includes('dimension'))).toBe(true);

    const emptyAnchors = asRecord(textFinding());
    emptyAnchors['anchors'] = [];
    const anchorErrors2: string[] = [];
    validateDiffFinding(emptyAnchors, anchorErrors2, 'finding');
    expect(anchorErrors2.some((error) => error.includes('anchors'))).toBe(true);

    const unexpectedField = asRecord(textFinding());
    unexpectedField['bonus'] = 1;
    const extraErrors: string[] = [];
    validateDiffFinding(unexpectedField, extraErrors, 'finding');
    expect(extraErrors.some((error) => error.includes('unexpected field'))).toBe(true);
  });

  test('report counts must be computed, never asserted; verdict must match findings', () => {
    const goodErrors: string[] = [];
    validateDiffReport(report([textFinding(), structuralFinding()]), goodErrors);
    expect(goodErrors).toEqual([]);

    const dishonestCounts = asRecord(report([textFinding()]));
    (dishonestCounts['counts'] as Record<string, unknown>)['critical'] = 7;
    const countErrors: string[] = [];
    validateDiffReport(dishonestCounts, countErrors);
    expect(countErrors.some((error) => error.includes('counts.critical'))).toBe(true);

    const equivalentWithFindings = asRecord(report([textFinding()]));
    equivalentWithFindings['verdict'] = 'equivalent';
    const verdictErrors: string[] = [];
    validateDiffReport(equivalentWithFindings, verdictErrors);
    expect(verdictErrors.some((error) => error.includes("verdict is 'equivalent' but findings exist"))).toBe(true);
  });

  test('directives, attempts, and loop results validate (and converged iff holds)', () => {
    const directive: RepairDirective = {
      id: 'repd_shape_1',
      findingIds: ['diff_shape_1'],
      scopePaths: ['pages/x.html.ts'],
      acceptance: 'Replay of the paired verification must re-establish: the text "expected" must be observed on /x.html.',
    };
    const directiveErrors: string[] = [];
    validateRepairDirective(directive, directiveErrors, 'directive');
    expect(directiveErrors).toEqual([]);

    const badDirective = asRecord(directive);
    badDirective['id'] = 'not-prefixed';
    const badDirectiveErrors: string[] = [];
    validateRepairDirective(badDirective, badDirectiveErrors, 'directive');
    expect(badDirectiveErrors.some((error) => error.includes('repd_'))).toBe(true);

    const attempt: RepairAttempt = {
      directiveId: 'repd_shape_1',
      iteration: 1,
      baseSha: '0'.repeat(40),
      changedPaths: ['pages/x.html.ts'],
      rerunVerdict: 'divergent',
      resolvedFindingIds: ['diff_shape_1'],
    };
    const attemptErrors: string[] = [];
    validateRepairAttempt(attempt, attemptErrors, 'attempt');
    expect(attemptErrors).toEqual([]);

    const result: RepairLoopResult = {
      maxIterations: 5,
      attempts: [attempt],
      remainingCriticalFindings: [],
      converged: true,
    };
    const resultErrors: string[] = [];
    validateRepairLoopResult(result, resultErrors);
    expect(resultErrors).toEqual([]);

    // converged must be true IFF remainingCriticalFindings is empty.
    const fakeConverged = asRecord(result);
    fakeConverged['remainingCriticalFindings'] = ['diff_shape_1'];
    const fakeErrors: string[] = [];
    validateRepairLoopResult(fakeConverged, fakeErrors);
    expect(fakeErrors.some((error) => error.includes('converged must be true iff'))).toBe(true);

    // Attempts beyond the budget are rejected.
    const overBudget = asRecord(result);
    overBudget['maxIterations'] = 0;
    const budgetErrors: string[] = [];
    validateRepairLoopResult(overBudget, budgetErrors);
    expect(budgetErrors.some((error) => error.includes('exceed the budget'))).toBe(true);
  });

  test('the killer scenario report shape is exercised end-to-end elsewhere (registry)', () => {
    // Cross-file registry check: the scenario tests (killer, unrepairable,
    // scope, budget, determinism) each run validateDiffReport /
    // validateRepairAttempt / validateRepairLoopResult over their live
    // objects — asserted by their own expect(...).toEqual([]) calls.
    // This placeholder keeps the intent explicit in one place.
    expect(typeof validateDiffReport).toBe('function');
    expect(typeof validateRepairLoopResult).toBe('function');
  });
});
