import { describe, expect, it } from 'bun:test';
import type { EvidenceRef, RunEvent } from './index';
import {
  ARTIFACT_KINDS,
  EVIDENCE_KINDS,
  RUN_STATUSES,
  assertMonotonicSeq,
  validateRunEvent,
} from './index';

const RUN_ID = 'run_0f0e0d0c-0b0a-4908-8976-a5b4c3d2e1f0';
const OTHER_RUN_ID = 'run_11111111-2222-4333-8444-555555555555';

function validEvent(overrides: Partial<RunEvent> = {}): RunEvent {
  const base: RunEvent = {
    runId: RUN_ID,
    seq: 0,
    ts: '2026-01-02T03:04:05.678Z',
    kind: 'log',
    payload: { message: 'observation' },
  };
  return Object.assign(base, overrides);
}

describe('packages/core assertMonotonicSeq', () => {
  it('accepts an empty event list', () => {
    expect(() => assertMonotonicSeq([])).not.toThrow();
  });

  it('accepts strictly increasing seq within a single run', () => {
    const events = [0, 1, 2, 5, 9].map((seq) => validEvent({ seq }));
    expect(() => assertMonotonicSeq(events)).not.toThrow();
  });

  it('throws on a duplicate (non-increasing) seq', () => {
    const events = [validEvent({ seq: 0 }), validEvent({ seq: 1 }), validEvent({ seq: 1 })];
    expect(() => assertMonotonicSeq(events)).toThrow(/non-increasing seq/);
  });

  it('throws on a decreasing seq', () => {
    const events = [validEvent({ seq: 3 }), validEvent({ seq: 2 })];
    expect(() => assertMonotonicSeq(events)).toThrow(/non-increasing seq/);
  });

  it('throws when an event carries the wrong runId', () => {
    const events = [validEvent({ seq: 0 }), validEvent({ seq: 1, runId: OTHER_RUN_ID })];
    expect(() => assertMonotonicSeq(events)).toThrow(/runId mismatch/);
  });
});

describe('packages/core validateRunEvent', () => {
  it('returns no violations for a contract-conformant event', () => {
    expect(validateRunEvent(validEvent())).toEqual([]);
  });

  it('returns no violations when evidenceRefs are well-formed', () => {
    const refs: EvidenceRef[] = [
      { evidenceId: 'ev_00000000-0000-4000-8000-000000000000', kind: 'dom', sha256: 'a'.repeat(64) },
      { evidenceId: 'ev_11111111-1111-4111-8111-111111111111', kind: 'screenshot', sha256: '0'.repeat(64) },
    ];
    expect(validateRunEvent(validEvent({ evidenceRefs: refs }))).toEqual([]);
  });

  it('accepts an unknown (extensible) event kind as valid data', () => {
    expect(validateRunEvent(validEvent({ kind: 'dom.mutated.observed' }))).toEqual([]);
  });

  it('flags an unparseable ts', () => {
    const violations = validateRunEvent(validEvent({ ts: 'not-a-timestamp' }));
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('ts must be a parseable ISO-8601 timestamp');
  });

  it('flags an empty kind', () => {
    const violations = validateRunEvent(validEvent({ kind: '' }));
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('kind must be a non-empty string');
  });

  it('flags negative, fractional, and NaN seq values', () => {
    expect(validateRunEvent(validEvent({ seq: -1 }))).toHaveLength(1);
    expect(validateRunEvent(validEvent({ seq: 1.5 }))).toHaveLength(1);
    expect(validateRunEvent(validEvent({ seq: Number.NaN }))).toHaveLength(1);
  });

  it('flags an empty runId', () => {
    const violations = validateRunEvent(validEvent({ runId: '' }));
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('runId must be a non-empty string');
  });

  it('flags each malformed field of an evidenceRefs entry', () => {
    // Deliberately invalid runtime shapes — this is exactly what the
    // validator exists to catch.
    const bad = [
      { evidenceId: '', kind: 'dom', sha256: 'a'.repeat(64) },
      { evidenceId: 'ev_x', kind: 'psychic', sha256: 'a'.repeat(64) },
      { evidenceId: 'ev_x', kind: 'dom', sha256: 'not-hex' },
    ] as unknown as EvidenceRef[];

    const violations = validateRunEvent(validEvent({ evidenceRefs: bad }));
    expect(violations).toHaveLength(3);
    expect(violations[0]).toContain('evidenceId must be a non-empty string');
    expect(violations[1]).toContain('kind must be one of');
    expect(violations[2]).toContain('sha256 must be 64 lowercase hex chars');
  });

  it('flags a non-array evidenceRefs value without throwing', () => {
    const violations = validateRunEvent(
      validEvent({ evidenceRefs: 'nope' as unknown as EvidenceRef[] }),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('evidenceRefs must be an array');
  });

  it('is total over non-object runtime input (never throws)', () => {
    expect(validateRunEvent(null as unknown as RunEvent)).toHaveLength(1);
    expect(validateRunEvent(42 as unknown as RunEvent)).toHaveLength(1);
  });
});

describe('packages/core closed vocabularies match the contract unions', () => {
  it('RUN_STATUSES lists the declared RunStatus values', () => {
    expect([...RUN_STATUSES]).toEqual(['planned', 'running', 'completed', 'failed', 'cancelled']);
  });

  it('EVIDENCE_KINDS lists the declared EvidenceKind values', () => {
    expect([...EVIDENCE_KINDS]).toEqual([
      'dom',
      'runtime',
      'network',
      'storage',
      'screenshot',
      'static',
      'user',
    ]);
  });

  it('ARTIFACT_KINDS lists the declared ArtifactKind values', () => {
    expect([...ARTIFACT_KINDS]).toEqual([
      'screenshot',
      'dom-snapshot',
      'har',
      'trace',
      'ir',
      'report',
      'bundle',
    ]);
  });
});
