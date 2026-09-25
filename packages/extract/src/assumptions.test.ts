// CLAPP-021 unit — assumption collector: dedupe, clamping, cited evidence.

import { describe, expect, test } from 'bun:test';
import { AssumptionCollector, ASSUMPTION_CONFIDENCE_CEILING } from './assumptions';
import type { EvidenceRef } from '@clapp/core';

const ref: EvidenceRef = { evidenceId: 'ev_00000000-0000-4000-8000-000000000001', kind: 'dom', sha256: 'a'.repeat(64) };

describe('AssumptionCollector', () => {
  test('records assumptions at level assumed with confidence <= 0.5', () => {
    const collector = new AssumptionCollector();
    collector.note('the preview is truncated');
    const [assumption] = collector.list();
    expect(assumption!.statement).toBe('the preview is truncated');
    expect(assumption!.id.startsWith('assume_')).toBe(true);
    expect(assumption!.provenance.level).toBe('assumed');
    expect(assumption!.provenance.confidence.value).toBeLessThanOrEqual(ASSUMPTION_CONFIDENCE_CEILING);
    expect(assumption!.provenance.confidence.evidenceRefs).toEqual([]); // empty legal only for assumed
  });

  test('duplicate statements collapse to one entry', () => {
    const collector = new AssumptionCollector();
    collector.note('same degradation');
    collector.note('same degradation');
    collector.note('other degradation');
    expect(collector.size).toBe(2);
    expect(collector.list().map((assumption) => assumption.statement)).toEqual(['same degradation', 'other degradation']);
  });

  test('confidence is clamped to [0, ceiling] even when a caller over-requests', () => {
    const collector = new AssumptionCollector();
    collector.note('over-confident request', { confidence: 0.95 });
    collector.note('negative request', { confidence: -1 });
    const [first, second] = collector.list();
    expect(first!.provenance.confidence.value).toBe(ASSUMPTION_CONFIDENCE_CEILING);
    expect(second!.provenance.confidence.value).toBe(0);
  });

  test('evidence refs are cited when available (more honest than nothing)', () => {
    const collector = new AssumptionCollector();
    collector.note('degradation with evidence', { evidenceRefs: [ref] });
    const [assumption] = collector.list();
    expect(assumption!.provenance.confidence.evidenceRefs).toEqual([ref]);
  });

  test('returned assumptions are detached copies', () => {
    const collector = new AssumptionCollector();
    collector.note('detach me', { evidenceRefs: [ref] });
    const first = collector.list();
    first[0]!.provenance.confidence.evidenceRefs[0]!.evidenceId = 'ev_mutated';
    const second = collector.list();
    expect(second[0]!.provenance.confidence.evidenceRefs[0]!.evidenceId).toBe(ref.evidenceId);
  });

  test('empty statements are ignored (an unfindable assumption is worse than none)', () => {
    const collector = new AssumptionCollector();
    collector.note('');
    expect(collector.size).toBe(0);
  });
});
