// CLAPP-042 — clusterFindings unit tests (pure; no servers, no fs).

import { describe, expect, test } from 'bun:test';
import { clusterFindings } from '../src/directives';
import { countingDirectiveIdFactory } from '../src/ids';
import type { DiffFinding, DiffReport } from '../src/diff-contract';


function finding(init: {
  id: string;
  severity: DiffFinding['severity'];
  expected?: unknown;
  actual?: unknown;
  stepIndex?: number;
}): DiffFinding {
  const { expected, actual } = init;
  return {
    id: init.id,
    dimension: 'semantic',
    severity: init.severity,
    summary: `synthetic finding ${init.id}`,
    anchors: [{ stepIndex: init.stepIndex ?? 0, sourceIds: ['screen_test'] }],
    ...(expected === undefined ? {} : { expected }),
    ...(actual === undefined ? {} : { actual }),
  };
}

function report(findings: DiffFinding[]): DiffReport {
  return {
    id: 'diffr_unit',
    diffVersion: '0.1',
    candidateAppId: 'appsyn_unit',
    baselineRootHash: '0'.repeat(64),
    runs: [],
    findings,
    counts: { critical: 0, major: 0, minor: 0, info: 0 },
    verdict: findings.length === 0 ? 'equivalent' : 'divergent',
    generatedAt: '2026-09-25T00:00:00.000Z',
  };
}

describe('clusterFindings', () => {
  test('clusters critical + major findings by derived target file; minor/info are never clustered', () => {
    const findings = [
      finding({
        id: 'diff_a',
        severity: 'critical',
        expected: { kind: 'text', route: '/pricing.html', text: 'A' },
        actual: { kind: 'text', route: '/pricing.html', text: 'B' },
      }),
      finding({
        id: 'diff_b',
        severity: 'minor',
        expected: { kind: 'text', route: '/pricing.html', text: 'C' },
        actual: { kind: 'text', route: '/pricing.html', text: 'D' },
      }),
      finding({
        id: 'diff_c',
        severity: 'major',
        expected: { kind: 'mock', method: 'GET', urlPattern: '/api/notes', statusCode: 200 },
        actual: { kind: 'mock', method: 'GET', urlPattern: '/api/notes', statusCode: 500 },
      }),
      finding({ id: 'diff_d', severity: 'info' }),
    ];
    const directives = clusterFindings(report(findings), { idFactory: countingDirectiveIdFactory() });
    expect(directives).toHaveLength(2);

    const [first, second] = directives;
    expect(first?.findingIds).toEqual(['diff_a']);
    expect(first?.scopePaths).toEqual(['pages/pricing.html.ts']);
    expect(first?.acceptance).toContain("the text \"A\" must be observed on /pricing.html");
    expect(second?.findingIds).toEqual(['diff_c']);
    expect(second?.scopePaths).toEqual(['server.ts']);
    expect(second?.acceptance).toContain('GET /api/notes must answer 200');
  });

  test('two findings sharing one route cluster into ONE directive with both ids', () => {
    const findings = [
      finding({
        id: 'diff_x',
        severity: 'critical',
        expected: { kind: 'text', route: '/contact.html', text: 'E' },
        actual: { kind: 'text', route: '/contact.html', text: 'F' },
        stepIndex: 2,
      }),
      finding({
        id: 'diff_y',
        severity: 'critical',
        expected: { kind: 'testid', route: '/contact.html', testId: 'contact-email' },
        actual: { kind: 'testid', route: '/contact.html' },
        stepIndex: 4,
      }),
    ];
    const directives = clusterFindings(report(findings), { idFactory: countingDirectiveIdFactory() });
    expect(directives).toHaveLength(1);
    expect(directives[0]?.findingIds).toEqual(['diff_x', 'diff_y']);
    expect(directives[0]?.scopePaths).toEqual(['pages/contact.html.ts']);
  });

  test('structural findings (no payload) cluster SOLO with an empty scope', () => {
    const findings = [
      finding({ id: 'diff_gone', severity: 'critical' }),
      finding({
        id: 'diff_text',
        severity: 'critical',
        expected: { kind: 'text', route: '/', text: 'G' },
        actual: { kind: 'text', route: '/', text: 'H' },
      }),
    ];
    const directives = clusterFindings(report(findings), { idFactory: countingDirectiveIdFactory() });
    expect(directives).toHaveLength(2);
    const structural = directives.find((directive) => directive.findingIds.includes('diff_gone'));
    expect(structural?.scopePaths).toEqual([]);
    expect(structural?.acceptance).toContain('finding diff_gone must no longer reproduce');
    const locatable = directives.find((directive) => directive.findingIds.includes('diff_text'));
    expect(locatable?.scopePaths).toEqual(['pages/index.html.ts']);
  });

  test('directives order criticals before majors, then by scope path, then step index', () => {
    const findings = [
      finding({
        id: 'diff_late',
        severity: 'critical',
        expected: { kind: 'text', route: '/pricing.html', text: 'I' },
        actual: { kind: 'text', route: '/pricing.html', text: 'J' },
        stepIndex: 9,
      }),
      finding({
        id: 'diff_major',
        severity: 'major',
        expected: { kind: 'mock', method: 'GET', urlPattern: '/api/notes', statusCode: 200 },
        actual: { kind: 'mock', method: 'GET', urlPattern: '/api/notes', statusCode: 500 },
      }),
      finding({
        id: 'diff_early',
        severity: 'critical',
        expected: { kind: 'text', route: '/pricing.html', text: 'K' },
        actual: { kind: 'text', route: '/pricing.html', text: 'L' },
        stepIndex: 1,
      }),
    ];
    const directives = clusterFindings(report(findings), { idFactory: countingDirectiveIdFactory() });
    // diff_early and diff_late share pages/pricing.html.ts → one directive
    // (same path, step order inside), ordered before the major's server.ts.
    expect(directives.map((directive) => directive.scopePaths[0])).toEqual([
      'pages/pricing.html.ts',
      'server.ts',
    ]);
    expect(directives[0]?.findingIds).toEqual(['diff_early', 'diff_late']);
  });

  test('nested routes map to nested page module paths', () => {
    const findings = [
      finding({
        id: 'diff_nested',
        severity: 'critical',
        expected: { kind: 'text', route: '/docs/guide.html?x=1', text: 'M' },
        actual: { kind: 'text', route: '/docs/guide.html', text: 'N' },
      }),
    ];
    const directives = clusterFindings(report(findings), { idFactory: countingDirectiveIdFactory() });
    expect(directives[0]?.scopePaths).toEqual(['pages/docs/guide.html.ts']);
  });

  test('deterministic: same report + fresh counting factory → identical directives (deep)', () => {
    const findings = [
      finding({
        id: 'diff_1',
        severity: 'critical',
        expected: { kind: 'text', route: '/pricing.html', text: 'O' },
        actual: { kind: 'text', route: '/pricing.html', text: 'P' },
      }),
      finding({
        id: 'diff_2',
        severity: 'critical',
        expected: { kind: 'testid', route: '/contact.html', testId: 't' },
        actual: { kind: 'testid', route: '/contact.html' },
      }),
      finding({ id: 'diff_3', severity: 'critical' }),
    ];
    const one = clusterFindings(report(findings), { idFactory: countingDirectiveIdFactory() });
    const two = clusterFindings(report(findings), { idFactory: countingDirectiveIdFactory() });
    expect(one).toEqual(two);
  });

  test('directive ids come from the factory; default factory mints repd_ + uuid v4 shape', () => {
    const findings = [
      finding({
        id: 'diff_z',
        severity: 'major',
        expected: { kind: 'mock', method: 'GET', urlPattern: '/api/x', statusCode: 200 },
        actual: { kind: 'mock', method: 'GET', urlPattern: '/api/x', statusCode: 500 },
      }),
    ];
    const custom = clusterFindings(report(findings), { idFactory: countingDirectiveIdFactory('repd_custom_') });
    expect(custom[0]?.id).toBe('repd_custom_000001');
    const defaults = clusterFindings(report(findings));
    expect(defaults[0]?.id).toMatch(/^repd_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});
