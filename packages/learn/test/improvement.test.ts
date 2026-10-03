// CLAPP-064 — the improvement-benchmark tests (the tech lead's lane).
//
// The family fixtures use the corpusManifest builder (the composition
// lane's frozen fixture vocabulary) so the frozen machinery produces KNOWN
// plans; every aggregate and delta in the tests is RECOMPUTED
// independently from the plans rather than asserted from the report.

import { describe, expect, test } from 'bun:test';

import { planComposition } from '../src/composition';
import { BENCHMARKED_BY, BENCHMARK_VERSION, runImprovementBenchmark } from '../src/improvement';
import { corpusManifest } from './fixtures/failure-fixtures';

const BENCHMARKED_AT = '2026-10-03T04:00:00Z';

/** A full-coverage web query over the given capability set. */
const webQuery = (capabilities: string[]) => ({
  target: 'web',
  requiredCapabilities: capabilities,
});

describe('the improvement benchmark (CLAPP-064)', () => {
  test('the benchmark is deterministic — identical family and options produce identical reports', async () => {
    const grown = corpusManifest({ idSeed: 'a1', capabilities: ['form'] });
    const family = {
      name: 'determinism-family',
      queries: [webQuery(['form'])],
      snapshots: [[], [grown]],
    };
    const first = await runImprovementBenchmark(family, { benchmarkedAt: BENCHMARKED_AT });
    const second = await runImprovementBenchmark(family, { benchmarkedAt: BENCHMARKED_AT });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.report).toEqual(first.report);
      expect(second.report.id).toBe(first.report.id);
    }
  });

  test('malformed families or options fail closed with named errors — never an exception', async () => {
    const cases: Array<[unknown, unknown]> = [
      ['not-an-object', { benchmarkedAt: BENCHMARKED_AT }],
      [{ name: '', queries: [], snapshots: [] }, { benchmarkedAt: BENCHMARKED_AT }],
      [{ name: 'x', queries: 'not-array', snapshots: [] }, { benchmarkedAt: BENCHMARKED_AT }],
      [{ name: 'x', queries: [], snapshots: 'not-array' }, { benchmarkedAt: BENCHMARKED_AT }],
      [{ name: 'x', queries: [], snapshots: [] }, 'not-options'],
      [{ name: 'x', queries: [], snapshots: [] }, { benchmarkedAt: 'not-a-date' }],
      [{ name: 'x', queries: [], snapshots: [] }, { benchmarkedAt: '2026-02-30T00:00:00Z' }],
    ];
    for (const [family, options] of cases) {
      const result = await runImprovementBenchmark(family, options);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.length).toBeGreaterThan(0);
    }
    // a broken corpus/query carries the frozen machinery's own errors verbatim
    const badCorpus = await runImprovementBenchmark(
      { name: 'x', queries: [webQuery(['form'])], snapshots: [['not-a-manifest']] },
      { benchmarkedAt: BENCHMARKED_AT },
    );
    expect(badCorpus.ok).toBe(false);
    if (!badCorpus.ok) {
      expect(badCorpus.errors.some((e) => e.includes('query[0] snapshot[0]'))).toBe(true);
    }
  });

  test('per-snapshot aggregates are measured from the actual plans', async () => {
    const a = corpusManifest({ idSeed: 'c3', capabilities: ['form'], evidenceCount: 5 });
    const family = {
      name: 'measured-family',
      queries: [webQuery(['form'])],
      snapshots: [[], [a]],
    };
    const result = await runImprovementBenchmark(family, { benchmarkedAt: BENCHMARKED_AT });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // recompute independently via the frozen planner
      const emptyPlan = await planComposition([], webQuery(['form']), { plannedAt: BENCHMARKED_AT });
      const grownPlan = await planComposition([a], webQuery(['form']), { plannedAt: BENCHMARKED_AT });
      if (emptyPlan.ok && grownPlan.ok) {
        expect(result.report.aggregates[0]?.totalSelected).toBe(emptyPlan.plan.selected.length);
        expect(result.report.aggregates[1]?.totalSelected).toBe(grownPlan.plan.selected.length);
        expect(result.report.aggregates[1]?.totalConsidered).toBe(grownPlan.plan.considered);
        expect(result.report.aggregates[1]?.meanSelectedScore).toBe(
          grownPlan.plan.selected.reduce((sum, c) => sum + c.score, 0) / grownPlan.plan.selected.length,
        );
      }
    }
  });

  test('a grown library with covering packages shows improvement-detected', async () => {
    const grown = corpusManifest({ idSeed: 'd4', capabilities: ['form', 'route'] });
    const family = {
      name: 'growth-family',
      queries: [webQuery(['form'])],
      snapshots: [[], [grown]],
    };
    const result = await runImprovementBenchmark(family, { benchmarkedAt: BENCHMARKED_AT });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.report.verdict).toBe('improvement-detected');
      expect(result.report.deltas[0]?.selectedDelta).toBe(1);
      expect(result.report.reasons.some((r) => r.includes('totalSelected +1'))).toBe(true);
    }
  });

  test('a query regression is named honestly — verdict regression', async () => {
    const good = corpusManifest({ idSeed: 'e5', capabilities: ['form'] });
    // the later snapshot loses the covering package but gains a non-covering one
    const unrelated = corpusManifest({ idSeed: 'f6', capabilities: ['navigation'] });
    const family = {
      name: 'regression-family',
      queries: [webQuery(['form'])],
      snapshots: [[good], [unrelated]],
    };
    const result = await runImprovementBenchmark(family, { benchmarkedAt: BENCHMARKED_AT });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.report.verdict).toBe('regression');
      expect(result.report.reasons.some((r) => r.includes('regression: query[0]'))).toBe(true);
    }
  });

  test('no improvement is honest — identical snapshots yield no-improvement', async () => {
    const pkg = corpusManifest({ idSeed: '17', capabilities: ['form'] });
    const family = {
      name: 'flat-family',
      queries: [webQuery(['form'])],
      snapshots: [[pkg], [pkg]],
    };
    const result = await runImprovementBenchmark(family, { benchmarkedAt: BENCHMARKED_AT });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.report.verdict).toBe('no-improvement');
      expect(result.report.deltas[0]?.selectedDelta).toBe(0);
    }
  });

  test('the single-snapshot and zero-query families are legal and honest — nothing measured', async () => {
    const pkg = corpusManifest({ idSeed: 'a8', capabilities: ['form'] });
    const single = await runImprovementBenchmark(
      { name: 'single', queries: [webQuery(['form'])], snapshots: [[pkg]] },
      { benchmarkedAt: BENCHMARKED_AT },
    );
    expect(single.ok).toBe(true);
    if (single.ok) {
      expect(single.report.verdict).toBe('no-improvement');
      expect(single.report.deltas).toEqual([]);
      expect(single.report.reasons.some((r) => r.includes('nothing to compare'))).toBe(true);
    }
    const zeroQuery = await runImprovementBenchmark(
      { name: 'zero', queries: [], snapshots: [[], []] },
      { benchmarkedAt: BENCHMARKED_AT },
    );
    expect(zeroQuery.ok).toBe(true);
    if (zeroQuery.ok) {
      expect(zeroQuery.report.verdict).toBe('no-improvement');
    }
  });

  test('report ids are content-addressed and benchmarkedAt is caller-injected — the harness never reads a clock', async () => {
    const grown = corpusManifest({ idSeed: 'b9', capabilities: ['form'] });
    const family = {
      name: 'identity-family',
      queries: [webQuery(['form'])],
      snapshots: [[], [grown]],
    };
    const first = await runImprovementBenchmark(family, { benchmarkedAt: '2026-10-03T04:00:00Z' });
    const second = await runImprovementBenchmark(family, { benchmarkedAt: '2026-10-03T05:30:00Z' });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.report.id).toMatch(/^bench_[0-9a-f]{64}$/);
      // the timestamp is content: a different benchmarkedAt moves the id
      expect(second.report.id).not.toBe(first.report.id);
      expect(second.report.benchmarkedAt).toBe('2026-10-03T05:30:00Z');
      expect(second.report.benchmarkedBy).toBe(BENCHMARKED_BY);
      expect(second.report.benchmarkVersion).toBe(BENCHMARK_VERSION);
      // the MEASURED facts are clock-free: aggregates identical
      expect(second.report.aggregates).toEqual(first.report.aggregates);
      expect(second.report.deltas).toEqual(first.report.deltas);
      expect(second.report.verdict).toBe(first.report.verdict);
    }
  });
});
