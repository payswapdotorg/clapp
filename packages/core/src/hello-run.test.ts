import { describe, expect, it } from 'bun:test';
import { assertMonotonicSeq, buildHelloRun, validateRunEvent } from './index';

describe('packages/core buildHelloRun (Phase 0 hello-run seed)', () => {
  const { run, events } = buildHelloRun();

  it('returns a complete RunMeta for a completed hello run', () => {
    expect(run.id).toMatch(/^run_[0-9a-f-]{36}$/);
    expect(run.targetId).toBe('bench/b00-hello');
    expect(run.kind).toBe('hello');
    expect(run.status).toBe('completed');
    expect(Number.isNaN(Date.parse(run.startedAt))).toBe(false);
    expect(run.endedAt).toBeDefined();
    expect(typeof run.environment.runtime).toBe('string');
    expect(typeof run.environment.runtimeVersion).toBe('string');
    expect(run.budget?.maxDurationMs).toBeGreaterThan(0);
  });

  it('emits exactly run.started, log, run.completed in order', () => {
    expect(events.map((event) => event.kind)).toEqual(['run.started', 'log', 'run.completed']);
  });

  it('uses 0-based strictly increasing seq and a single run-scoped id', () => {
    expect(events.map((event) => event.seq)).toEqual([0, 1, 2]);
    expect(new Set(events.map((event) => event.runId)).size).toBe(1);
    expect(events[0]!.runId).toBe(run.id);
    expect(() => assertMonotonicSeq(events)).not.toThrow();
  });

  it('keeps timestamps ordered and consistent with the RunMeta window', () => {
    if (run.endedAt === undefined) throw new Error('hello run must define endedAt');
    expect(events[0]!.ts).toBe(run.startedAt);
    expect(events[2]!.ts).toBe(run.endedAt);
    const timestamps = events.map((event) => Date.parse(event.ts));
    expect(timestamps[1]!).toBeGreaterThan(timestamps[0]!);
    expect(timestamps[2]!).toBeGreaterThan(timestamps[1]!);
  });

  it('produces events that pass validateRunEvent with no violations', () => {
    for (const event of events) {
      expect(validateRunEvent(event)).toEqual([]);
    }
  });
});
