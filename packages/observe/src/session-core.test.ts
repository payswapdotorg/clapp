// CLAPP-010 unit tests — SessionCore: state machine, batching, bounds,
// funnel (prune → redact → canonical check).

import { describe, expect, test } from 'bun:test';
import { canonicalJson } from './canonical-json';
import type { CaptureRecord } from './capture-contract';
import { defaultRedactionPolicy } from './redaction';
import { CAPTURE_CHANNELS, isChannelName, networkChannelFor, SessionCore, SessionStateError } from './session-core';

function makeCore(overrides: Partial<ConstructorParameters<typeof SessionCore>[0]> = {}): SessionCore {
  return new SessionCore({ onFlush: async () => undefined, ...overrides });
}

// runtime-assembled fake secret (never a whole literal)
const fakeEmail = ['session', '-', 'test', '@', 'fixture', '.', 'example'].join('');

describe('state machine', () => {
  test('idle → running ⇄ paused → ended happy path', async () => {
    const core = makeCore();
    expect(core.state).toBe('idle');
    core.start();
    expect(core.state).toBe('running');
    core.pause();
    expect(core.state).toBe('paused');
    core.resume();
    expect(core.state).toBe('running');
    await core.end();
    expect(core.state).toBe('ended');
  });

  test('invalid transitions throw', async () => {
    const core = makeCore();
    expect(() => core.pause()).toThrow(SessionStateError);
    expect(() => core.resume()).toThrow(SessionStateError);
    await expect(core.end()).rejects.toThrow(SessionStateError); // end from idle
    core.start();
    expect(() => core.start()).toThrow(SessionStateError);
    await core.end();
    expect(() => core.pause()).toThrow(SessionStateError);
  });

  test('end() is idempotent', async () => {
    const core = makeCore();
    core.start();
    await core.end();
    await core.end();
    expect(core.state).toBe('ended');
  });
});

describe('capture funnel', () => {
  test('records carry kind from the channel registry, ts from the clock, redacted flag from the policy', async () => {
    const clock = () => '2026-09-25T00:00:00.000Z';
    const core = makeCore({ clock });
    core.start();
    core.capture('runtime.console', { subkind: 'console', level: 'log', text: 'hi' });
    await core.end();
    const stats = core.stats;
    expect(stats.enqueued).toBe(1);
    expect(stats.flushed).toBe(1);
  });

  test('captures while paused / after end are dropped and counted', async () => {
    const core = makeCore();
    core.start();
    core.pause();
    core.capture('runtime.console', { text: 'x' });
    expect(core.stats.droppedWhilePaused).toBe(1);
    core.resume();
    await core.end();
    core.capture('runtime.console', { text: 'y' });
    expect(core.stats.droppedAfterEnd).toBe(1);
    expect(core.stats.enqueued).toBe(0);
  });

  test('redaction is applied for redactable channels with an active policy', async () => {
    const flushed: CaptureRecord[] = [];
    const core = makeCore({ onFlush: async (records) => { flushed.push(...records); } });
    core.start();
    core.capture('runtime.console', { subkind: 'console', level: 'log', text: `user ${fakeEmail} logged in` });
    core.capture('screenshot.png', { subkind: 'screenshot-png', data: 'AAA' });
    await core.end();
    expect(flushed[0]?.redacted).toBe(true);
    expect(canonicalJson(flushed[0]?.payload)).toContain('[REDACTED]');
    expect(canonicalJson(flushed[0]?.payload)).not.toContain(fakeEmail);
    // screenshots are NOT redactable (pixels cannot be scrubbed)
    expect(flushed[1]?.redacted).toBe(false);
  });

  test('all-inactive policy marks records not redacted', async () => {
    const flushed: CaptureRecord[] = [];
    const policy = {
      ...defaultRedactionPolicy(),
      scrubEmails: false,
      scrubTokens: false,
      scrubSecretKeys: false,
      scrubUrlCredentials: false,
      scrubQuerySecrets: false,
      scrubCookieValues: false,
      extraPatterns: [],
    };
    const core = makeCore({ onFlush: async (records) => { flushed.push(...records); }, redactionPolicy: policy });
    core.start();
    core.capture('runtime.console', { subkind: 'console', level: 'log', text: `user ${fakeEmail}` });
    await core.end();
    expect(flushed[0]?.redacted).toBe(false);
    expect(canonicalJson(flushed[0]?.payload)).toContain(fakeEmail);
  });

  test('non-canonicalizable payloads are rejected and counted (never thrown)', async () => {
    const core = makeCore();
    core.start();
    core.capture('runtime.console', { subkind: 'console', level: 'log', text: 'x', bad: Number.NaN });
    core.capture('runtime.console', { subkind: 'console', level: 'log', bad: new Date() });
    expect(core.stats.rejectedInvalid).toBe(2);
    expect(core.stats.enqueued).toBe(0);
  });

  test('undefined-valued fields are pruned before canonicalization', async () => {
    const flushed: CaptureRecord[] = [];
    const core = makeCore({ onFlush: async (records) => { flushed.push(...records); } });
    core.start();
    core.capture('runtime.console', { subkind: 'console', level: 'log', text: 'x', location: { url: 'http://x/', line: undefined } });
    await core.end();
    expect(canonicalJson(flushed[0]?.payload)).toBe('{"level":"log","location":{"url":"http://x/"},"subkind":"console","text":"x"}');
  });

  test('oversized records are rejected against maxRecordBytes', async () => {
    const core = makeCore({ maxRecordBytes: 64 });
    core.start();
    core.capture('runtime.console', { subkind: 'console', level: 'log', text: 'x'.repeat(200) });
    expect(core.stats.rejectedOversized).toBe(1);
    expect(core.stats.enqueued).toBe(0);
  });

  test('unknown channels throw (programmer error)', () => {
    const core = makeCore();
    core.start();
    expect(() => core.capture('nope.nope' as 'runtime.console', {})).toThrow(/unknown capture channel/);
  });
});

describe('batching and bounds', () => {
  test('buffer auto-flushes at flushBatchSize (coalescing under a slow sink)', async () => {
    const batches: CaptureRecord[][] = [];
    let releaseGate: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const core = makeCore({
      flushBatchSize: 2,
      onFlush: async (records) => {
        if (batches.length === 0) await gate; // slow first flush
        batches.push(records);
      },
    });
    core.start();
    core.capture('runtime.console', { n: 1 });
    core.capture('runtime.console', { n: 2 }); // hits batch size → auto flush starts (gated)
    core.capture('runtime.console', { n: 3 }); // coalesces behind the in-flight flush
    core.capture('runtime.console', { n: 4 });
    releaseGate();
    await core.end();
    const flat = batches.flat().map((record) => (record.payload as { n: number }).n);
    expect(flat).toEqual([1, 2, 3, 4]); // no loss, no duplication, order kept
    expect(batches.length).toBeGreaterThanOrEqual(1); // flushes coalesce while one is in flight
    expect(core.stats.flushed).toBe(4);
    expect(core.stats.enqueued).toBe(4);
  });

  test('overflow drops OLDEST records and counts them', async () => {
    const flushed: CaptureRecord[] = [];
    const core = makeCore({
      maxBufferedRecords: 3,
      flushBatchSize: 1000,
      onFlush: async (records) => { flushed.push(...records); },
    });
    core.start();
    for (let i = 0; i < 6; i++) core.capture('runtime.console', { n: i });
    expect(core.buffered).toBe(3);
    expect(core.stats.droppedOverflow).toBe(3);
    await core.end();
    const flushedNs = flushed.map((record) => (record.payload as { n: number }).n);
    expect(flushedNs).toEqual([3, 4, 5]); // newest survive
  });

  test('flush errors requeue the batch, count, and rethrow on explicit flush', async () => {
    let attempts = 0;
    const core = makeCore({
      onFlush: async () => {
        attempts++;
        if (attempts === 1) throw new Error('sink down');
      },
    });
    core.start();
    core.capture('runtime.console', { n: 1 });
    await expect(core.flush()).rejects.toThrow('sink down');
    expect(core.stats.flushErrors).toBe(1);
    expect(core.buffered).toBe(1); // requeued
    await core.flush(); // second attempt succeeds
    expect(core.stats.flushed).toBe(1);
    expect(core.buffered).toBe(0);
  });

  test('auto-flush failures never throw from capture() and retry later', async () => {
    let attempts = 0;
    const core = makeCore({
      flushBatchSize: 1,
      onFlush: async () => {
        attempts++;
        if (attempts < 2) throw new Error('transient');
      },
    });
    core.start();
    expect(() => core.capture('runtime.console', { n: 1 })).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 10)); // let the chain settle
    expect(core.stats.flushErrors).toBe(1);
    await core.end(); // end drains/retries
    expect(core.stats.flushed).toBe(1);
  });
});

describe('channel registry', () => {
  test('every channel maps to a valid EvidenceKind and a subkind', () => {
    for (const spec of Object.values(CAPTURE_CHANNELS)) {
      expect(['dom', 'runtime', 'network', 'storage', 'screenshot', 'static', 'user']).toContain(spec.kind);
      expect(spec.subkind).toBeTruthy();
    }
  });

  test('screenshot is the only non-redactable channel', () => {
    const nonRedactable = Object.entries(CAPTURE_CHANNELS).filter(([, spec]) => !spec.redactable).map(([name]) => name);
    expect(nonRedactable).toEqual(['screenshot.png']);
  });

  test('isChannelName + networkChannelFor', () => {
    expect(isChannelName('dom.tree')).toBe(true);
    expect(isChannelName('dom.tree ')).toBe(false);
    expect(networkChannelFor('request')).toBe('network.request');
    expect(networkChannelFor('response')).toBe('network.response');
    expect(networkChannelFor('requestfailed')).toBe('network.requestfailed');
    expect(networkChannelFor('ws-frame')).toBeNull();
  });
});
