// CLAPP-074 — the production readiness gate tests (the tech lead's lane).
//
// The evidence fixtures are measured-fact literals (the gate's contract:
// it weighs the caller's numbers, never re-measures). The unmet-check
// naming and the zero-leak absolutism are asserted by recomputation.

import { describe, expect, test } from 'bun:test';

import { EVALUATED_BY, READINESS_VERSION, evaluateReadiness } from '../src/readiness';
import type { ReadinessEvidence } from '../src/readiness';

const EVALUATED_AT = '2026-10-03T08:00:00Z';

/** Full-green evidence: every surface's positive and negative paths exercised. */
const greenEvidence: ReadinessEvidence = {
  authorization: { sessionsAdmitted: 3, observationRefusals: 2 },
  redaction: { fieldsRedacted: 12, rawSecretLeaks: 0 },
  isolation: { zoneWrites: 7, crossOriginRefusals: 1 },
  audit: { eventsRecorded: 25, cancellationCycles: 2 },
};

describe('the production readiness gate (CLAPP-074)', () => {
  test('the gate is deterministic — identical evidence and options produce identical reports', async () => {
    const first = await evaluateReadiness(greenEvidence, { evaluatedAt: EVALUATED_AT });
    const second = await evaluateReadiness(greenEvidence, { evaluatedAt: EVALUATED_AT });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.report).toEqual(first.report);
      expect(second.report.id).toBe(first.report.id);
    }
  });

  test('malformed evidence or options fail closed with named errors — never an exception', async () => {
    const cases: Array<[unknown, unknown]> = [
      ['not-an-object', { evaluatedAt: EVALUATED_AT }],
      [{ authorization: 'not-object' }, { evaluatedAt: EVALUATED_AT }],
      [greenEvidence, 'not-options'],
      [greenEvidence, { evaluatedAt: 'not-a-date' }],
      [greenEvidence, { evaluatedAt: '2026-02-30T00:00:00Z' }],
      [{ ...greenEvidence, audit: { eventsRecorded: -1, cancellationCycles: 1 } }, { evaluatedAt: EVALUATED_AT }],
      [{ ...greenEvidence, redaction: { ...greenEvidence.redaction, fieldsRedacted: 'many' } }, { evaluatedAt: EVALUATED_AT }],
    ];
    for (const [evidence, options] of cases) {
      const result = await evaluateReadiness(evidence, options);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  test('all eight checks met yields ready with the frozen check order', async () => {
    const result = await evaluateReadiness(greenEvidence, { evaluatedAt: EVALUATED_AT });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.report.verdict).toBe('ready');
      expect(result.report.checks.map((c) => c.requirement)).toEqual([
        'sessionsAdmitted >= 1',
        'observationRefusals >= 1',
        'fieldsRedacted >= 1',
        'rawSecretLeaks === 0 (absolute)',
        'zoneWrites >= 1',
        'crossOriginRefusals >= 1',
        'eventsRecorded >= 1',
        'cancellationCycles >= 1',
      ]);
      expect(result.report.checks.every((c) => c.met)).toBe(true);
    }
  });

  test('any unmet check yields not-ready with EVERY unmet check named and measured', async () => {
    const partial: ReadinessEvidence = {
      authorization: { sessionsAdmitted: 1, observationRefusals: 0 },
      redaction: { fieldsRedacted: 5, rawSecretLeaks: 0 },
      isolation: { zoneWrites: 0, crossOriginRefusals: 0 },
      audit: { eventsRecorded: 9, cancellationCycles: 0 },
    };
    const result = await evaluateReadiness(partial, { evaluatedAt: EVALUATED_AT });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.report.verdict).toBe('not-ready');
      expect(result.report.reasons.some((r) => r.includes('observationRefusals >= 1') && r.includes('measured 0'))).toBe(true);
      expect(result.report.reasons.some((r) => r.includes('zoneWrites >= 1') && r.includes('measured 0'))).toBe(true);
      expect(result.report.reasons.some((r) => r.includes('crossOriginRefusals >= 1') && r.includes('measured 0'))).toBe(true);
      expect(result.report.reasons.some((r) => r.includes('cancellationCycles >= 1') && r.includes('measured 0'))).toBe(true);
      expect(result.report.reasons.some((r) => r.includes('sessionsAdmitted'))).toBe(false);
    }
  });

  test('the zero-leak law is absolute — any measured leak is not-ready regardless of the rest', async () => {
    const leaking: ReadinessEvidence = {
      ...greenEvidence,
      redaction: { fieldsRedacted: 100, rawSecretLeaks: 1 },
    };
    const result = await evaluateReadiness(leaking, { evaluatedAt: EVALUATED_AT });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.report.verdict).toBe('not-ready');
      expect(result.report.reasons.some((r) => r.includes('rawSecretLeaks') && r.includes('measured 1'))).toBe(true);
    }
  });

  test('measured values ride verbatim — the report carries the evidence numbers, never re-measured', async () => {
    const result = await evaluateReadiness(greenEvidence, { evaluatedAt: EVALUATED_AT });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const byReq = new Map(result.report.checks.map((c) => [c.requirement, c.measured]));
      expect(byReq.get('sessionsAdmitted >= 1')).toBe(greenEvidence.authorization.sessionsAdmitted);
      expect(byReq.get('observationRefusals >= 1')).toBe(greenEvidence.authorization.observationRefusals);
      expect(byReq.get('fieldsRedacted >= 1')).toBe(greenEvidence.redaction.fieldsRedacted);
      expect(byReq.get('rawSecretLeaks === 0 (absolute)')).toBe(greenEvidence.redaction.rawSecretLeaks);
      expect(byReq.get('zoneWrites >= 1')).toBe(greenEvidence.isolation.zoneWrites);
      expect(byReq.get('crossOriginRefusals >= 1')).toBe(greenEvidence.isolation.crossOriginRefusals);
      expect(byReq.get('eventsRecorded >= 1')).toBe(greenEvidence.audit.eventsRecorded);
      expect(byReq.get('cancellationCycles >= 1')).toBe(greenEvidence.audit.cancellationCycles);
    }
  });

  test('report ids are content-addressed — any evidence change moves the id', async () => {
    const first = await evaluateReadiness(greenEvidence, { evaluatedAt: EVALUATED_AT });
    const changed: ReadinessEvidence = {
      ...greenEvidence,
      audit: { ...greenEvidence.audit, eventsRecorded: 26 },
    };
    const second = await evaluateReadiness(changed, { evaluatedAt: EVALUATED_AT });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.report.id).toMatch(/^ready_[0-9a-f]{64}$/);
      expect(second.report.id).not.toBe(first.report.id);
      expect(second.report.verdict).toBe(first.report.verdict);
    }
  });

  test('evaluatedAt is caller-injected and validated — the gate never reads a clock', async () => {
    const first = await evaluateReadiness(greenEvidence, { evaluatedAt: '2026-10-03T08:00:00Z' });
    const second = await evaluateReadiness(greenEvidence, { evaluatedAt: '2026-10-03T09:30:00Z' });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.report.evaluatedAt).toBe('2026-10-03T09:30:00Z');
      expect(second.report.id).not.toBe(first.report.id);        // the timestamp is content
      expect(second.report.checks).toEqual(first.report.checks); // the weighed facts are clock-free
      expect(second.report.verdict).toBe(first.report.verdict);
      expect(second.report.evaluatedBy).toBe(EVALUATED_BY);
      expect(second.report.readinessVersion).toBe(READINESS_VERSION);
    }
  });
});
