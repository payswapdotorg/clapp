/**
 * CLAPP-012 test battery — JourneyRecorder sequencing and determinism.
 */

import { describe, expect, it } from 'bun:test';
import { createRecorder } from './recorder';
import type { JourneyAction } from './journey-contract';
import { validateJourney } from './validate';

const NAVIGATE: JourneyAction = { type: 'navigate', url: '/' };
const CLICK: JourneyAction = { type: 'click', target: { testId: 'nav-pricing' } };
const WAIT: JourneyAction = { type: 'wait', ms: 5 };

describe('createRecorder — happy path', () => {
  it('start/record/finish produces a well-formed, validating Journey', () => {
    const recorder = createRecorder({ name: 'b01 smoke' });
    recorder.start('bench/b01-static');
    recorder.record(NAVIGATE);
    recorder.record(CLICK);
    recorder.record(WAIT);
    const journey = recorder.finish();

    expect(validateJourney(journey)).toBe(true);
    expect(journey.name).toBe('b01 smoke');
    expect(journey.targetId).toBe('bench/b01-static');
    expect(journey.actions).toEqual([NAVIGATE, CLICK, WAIT]);
    expect(journey.id).toMatch(/^journey_[0-9a-f-]{36}$/);
  });

  it('orders actions exactly as recorded', () => {
    const recorder = createRecorder();
    recorder.start('bench/b01-static');
    const actions = Array.from({ length: 25 }, (_, index): JourneyAction => ({
      type: 'wait',
      ms: index,
    }));
    for (const action of actions) recorder.record(action);
    const journey = recorder.finish();
    expect(journey.actions.map((action) => (action as { ms: number }).ms)).toEqual([
      ...Array(25).keys(),
    ]);
  });

  it('generates a fresh journey_ id per finish (uuid v4 shape)', () => {
    const recorder = createRecorder();
    recorder.start('bench/b01-static');
    recorder.record(NAVIGATE);
    const first = recorder.finish();
    recorder.start('bench/b01-static');
    recorder.record(NAVIGATE);
    const second = recorder.finish();
    expect(first.id).toMatch(/^journey_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(second.id).not.toBe(first.id);
  });

  it('defaults the name to a deterministic target-derived name', () => {
    const recorder = createRecorder();
    recorder.start('bench/b01-static');
    recorder.record(NAVIGATE);
    expect(recorder.finish().name).toBe('Recorded journey for bench/b01-static');
  });

  it('uses an injected id generator (determinism hook)', () => {
    const recorder = createRecorder({ newId: () => 'journey_00000000-0000-4000-8000-000000000001' });
    recorder.start('t');
    recorder.record(NAVIGATE);
    expect(recorder.finish().id).toBe('journey_00000000-0000-4000-8000-000000000001');
  });

  it('deep-copies recorded actions (later caller mutation cannot rewrite history)', () => {
    const recorder = createRecorder();
    recorder.start('bench/b01-static');
    const action: JourneyAction = { type: 'fill', target: { testId: 'email' }, value: 'a@example.net' };
    recorder.record(action);
    (action as { value: string }).value = 'mutated@example.net';
    const journey = recorder.finish();
    expect(journey.actions[0]).toEqual({ type: 'fill', target: { testId: 'email' }, value: 'a@example.net' });
  });

  it('two recorders fed the same sequence produce identical journeys (modulo id)', () => {
    const sequence = [NAVIGATE, CLICK, WAIT];
    const first = createRecorder({ newId: () => 'journey_00000000-0000-4000-8000-000000000000' });
    const second = createRecorder({ newId: () => 'journey_00000000-0000-4000-8000-000000000000' });
    for (const recorder of [first, second]) {
      recorder.start('bench/b01-static');
      for (const action of sequence) recorder.record(action);
    }
    expect(first.finish()).toEqual(second.finish());
  });
});

describe('createRecorder — sequencing rules', () => {
  it('record() before start() throws', () => {
    const recorder = createRecorder();
    expect(() => recorder.record(NAVIGATE)).toThrow(/while idle — call start\(\) first/);
  });

  it('finish() before start() throws', () => {
    const recorder = createRecorder();
    expect(() => recorder.finish()).toThrow(/while not recording/);
  });

  it('start() while recording throws', () => {
    const recorder = createRecorder();
    recorder.start('bench/b01-static');
    expect(() => recorder.start('bench/b01-static')).toThrow(/while recording — call finish\(\) first/);
  });

  it('record() after finish() throws', () => {
    const recorder = createRecorder();
    recorder.start('bench/b01-static');
    recorder.record(NAVIGATE);
    recorder.finish();
    expect(() => recorder.record(CLICK)).toThrow(/after finish\(\)/);
  });

  it('finish() twice throws', () => {
    const recorder = createRecorder();
    recorder.start('bench/b01-static');
    recorder.finish();
    expect(() => recorder.finish()).toThrow(/while not recording/);
  });

  it('start() after finish() begins a fresh session (previous actions dropped)', () => {
    const recorder = createRecorder();
    recorder.start('bench/first');
    recorder.record(NAVIGATE);
    recorder.finish();
    recorder.start('bench/second');
    recorder.record(WAIT);
    const journey = recorder.finish();
    expect(journey.targetId).toBe('bench/second');
    expect(journey.actions).toEqual([WAIT]);
  });

  it('start() rejects an empty targetId', () => {
    const recorder = createRecorder();
    expect(() => recorder.start('')).toThrow(/non-empty string/);
  });

  it('record() rejects a structurally invalid action with precise messages', () => {
    const recorder = createRecorder();
    recorder.start('bench/b01-static');
    expect(() => recorder.record({ type: 'wait', ms: -1 } as JourneyAction)).toThrow(
      /refusing to record an invalid action — ms: expected a non-negative integer, got -1/,
    );
  });
});
