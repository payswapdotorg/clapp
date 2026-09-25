// CLAPP-010 unit tests — ObservationRunner wiring through the recorder
// port with a FAKE driver + FAKE recorder (no browser, no network).
//
// This is the "recorder-port wiring" acceptance surface: it proves the
// script → funnel → SessionCore → onFlush → EvidenceRecorder pipeline,
// target resolution driving fake interactions, redaction at the funnel,
// and the deterministic record order — all without Playwright.

import { describe, expect, test } from 'bun:test';
import { newEvidenceId, newRunId, sha256Hex, type EvidenceRef } from '@clapp/core';
import { canonicalJson } from './canonical-json';
import type { CaptureRecord, EvidenceRecorder } from './capture-contract';
import { CLICK_BY_PATH_FN, DOM_TREE_FN, SET_VALUE_BY_PATH_FN, STATIC_LINKS_FN } from './dom-kit';
import type { DriverCookie, RawStorageSnapshot, ServiceWorkerRegisteredPayload } from './logs/storage';
import type { NetworkCapturePayload } from './logs/network';
import { ObservationRunner, type ObservationScript } from './runner';
import type { PageDriver } from './page-driver';
import type { CaptureSink } from './session-core';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

/** Implements EvidenceRecorder exactly like @clapp/evidence will: canonical
 *  bytes hashed with @clapp/core sha256Hex, refs returned per record. */
class FakeRecorder implements EvidenceRecorder {
  readonly runId = newRunId();
  readonly records: CaptureRecord[] = [];
  readonly refs: EvidenceRef[] = [];
  flushCalls = 0;
  recordShouldFail = false;

  async record(capture: CaptureRecord): Promise<EvidenceRef> {
    if (this.recordShouldFail) throw new Error('recorder down');
    const canonical = canonicalJson(capture.payload); // throws if not canonicalizable
    const ref: EvidenceRef = { evidenceId: newEvidenceId(), kind: capture.kind, sha256: await sha256Hex(canonical) };
    this.records.push(capture);
    this.refs.push(ref);
    return ref;
  }

  async flush(): Promise<EvidenceRef[]> {
    this.flushCalls++;
    return this.refs;
  }
}

/** Fake page driver: canned DOM/storage/links, scripted live events. */
class FakeDriver implements PageDriver {
  readonly calls: string[] = [];
  private sink: CaptureSink | null = null;
  private drainCount = 0;

  constructor(
    private readonly domEnvelope: { root: unknown; truncated: boolean; nodeCount: number },
    private readonly storage: RawStorageSnapshot,
    private readonly cookieJar: DriverCookie[],
    private readonly links: Record<string, string[]>,
    private readonly firstDrain: NetworkCapturePayload[],
  ) {}

  wireCapture(sink: CaptureSink): void {
    this.sink = sink;
  }

  async navigate(url: string): Promise<void> {
    this.calls.push(`navigate:${url}`);
    // the page "loads": one console record + one pending network pair
    this.sink?.('runtime.console', { subkind: 'console', level: 'log', text: 'fixture:load v1' });
    this.firstDrainPending = true;
  }

  private firstDrainPending = false;

  async evaluate<T = unknown>(fnSource: string, arg?: unknown): Promise<T> {
    if (fnSource === DOM_TREE_FN) return this.domEnvelope as T;
    if (fnSource === STATIC_LINKS_FN) return this.links as T;
    if (fnSource === CLICK_BY_PATH_FN) {
      this.calls.push(`click:${JSON.stringify(arg)}`);
      return { ok: true, tag: 'button' } as T;
    }
    if (fnSource === SET_VALUE_BY_PATH_FN) {
      this.calls.push(`fill:${JSON.stringify(arg)}`);
      return { ok: true, tag: 'input' } as T;
    }
    throw new Error(`FakeDriver: unexpected evaluate source: ${fnSource.slice(0, 40)}`);
  }

  async screenshotPng(fullPage: boolean): Promise<Uint8Array> {
    this.calls.push(`screenshot:${String(fullPage)}`);
    return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  }

  async pressKey(key: string): Promise<void> {
    this.calls.push(`press:${key}`);
  }

  drainPendingNetwork(): NetworkCapturePayload[] {
    this.drainCount++;
    if (this.firstDrainPending) {
      this.firstDrainPending = false;
      return this.firstDrain;
    }
    return [];
  }

  drainPendingServiceWorkers(): ServiceWorkerRegisteredPayload[] {
    return this.drainCount === 1 ? [{ subkind: 'sw-registered', scriptUrl: 'http://127.0.0.1:1/sw.js' }] : [];
  }

  async cookies(): Promise<DriverCookie[]> {
    return this.cookieJar;
  }

  async storageSnapshot(): Promise<RawStorageSnapshot> {
    return this.storage;
  }

  async close(): Promise<void> {
    this.calls.push('close');
  }
}

// ---------------------------------------------------------------------------
// Fixture data (fake secret assembled at runtime per constitution)
// ---------------------------------------------------------------------------

const fakeEmail = ['wiring', '@', 'fixture', '.', 'example'].join('');

const fakeDom = {
  root: {
    tag: 'html',
    children: [
      {
        tag: 'body',
        children: [
          { tag: 'h1', text: 'Fixture' },
          { tag: 'button', attrs: { 'data-testid': 'load-data' }, text: 'Load data' },
          { tag: 'input', attrs: { 'data-testid': 'note-input', type: 'text' } },
        ],
      },
    ],
  },
  truncated: false,
  nodeCount: 5,
};

const fakeStorage: RawStorageSnapshot = {
  origin: 'http://127.0.0.1:1',
  localStorage: { 'fixture:theme': 'dark' },
  sessionStorage: {},
  serviceWorkers: [{ scopeUrl: 'http://127.0.0.1:1/', scriptUrl: 'http://127.0.0.1:1/sw.js' }],
  caches: [],
  indexedDB: [],
};

const fakeCookies: DriverCookie[] = [
  { name: 'fixture_session', value: 'token-value-x', domain: '127.0.0.1', path: '/' },
];

const fakeLinks = {
  scripts: ['http://127.0.0.1:1/app.js'],
  stylesheets: ['http://127.0.0.1:1/style.css'],
  images: ['http://127.0.0.1:1/logo.svg'],
  manifests: ['http://127.0.0.1:1/manifest.webmanifest'],
  icons: [],
  fonts: [],
};

const fakeFirstDrain: NetworkCapturePayload[] = [
  { subkind: 'response', url: 'http://127.0.0.1:1/app.js', method: 'GET', status: 200, resourceType: 'script', headers: { 'content-type': 'text/javascript' }, mimeType: 'text/javascript', sizeBytes: 100 },
  { subkind: 'response', url: 'http://127.0.0.1:1/', method: 'GET', status: 200, resourceType: 'document', headers: { 'content-type': 'text/html' }, mimeType: 'text/html' },
];

function makeDriver(): FakeDriver {
  return new FakeDriver(fakeDom, fakeStorage, fakeCookies, fakeLinks, fakeFirstDrain);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ObservationRunner — recorder-port wiring (fake driver + fake recorder)', () => {
  test('a full script produces the exact expected record sequence through the recorder', async () => {
    const recorder = new FakeRecorder();
    const driver = makeDriver();
    const script: ObservationScript = {
      targetId: 'bench/fake-wiring',
      steps: [
        { type: 'navigate', url: 'http://127.0.0.1:1/' },
        { type: 'settle', ms: 1 },
        { type: 'capture-dom' },
        { type: 'action', action: { type: 'click', target: { testId: 'load-data' } } },
        { type: 'action', action: { type: 'fill', target: { testId: 'note-input' }, value: 'hello note' } },
        { type: 'action', action: { type: 'press', key: 'Enter' } },
        { type: 'action', action: { type: 'wait', ms: 1 } },
        { type: 'action', action: { type: 'assert-visible', target: { role: 'heading', name: 'Fixture' } } },
        { type: 'capture-storage' },
        { type: 'capture-static' },
        { type: 'screenshot' },
        { type: 'flush' },
      ],
    };
    const runner = new ObservationRunner({ recorder, sessionFactory: async () => driver, script });
    const result = await runner.run();

    // exact record sequence: navigate emits console; settle drains 2 responses + 1 sw;
    // then dom; then captures; screenshot last before flush
    const sequence = recorder.records.map((record) => [record.kind, (record.payload as { subkind?: string }).subkind]);
    expect(sequence).toEqual([
      ['runtime', 'console'], // navigate → live console
      ['network', 'response'], // settle drain (request-initiation order)
      ['network', 'response'],
      ['storage', 'sw-registered'], // settle drain, after network records
      ['dom', 'dom-tree'], // capture-dom
      ['storage', 'storage-inventory'], // capture-storage
      ['static', 'static-inventory'], // capture-static
      ['screenshot', 'screenshot-png'], // screenshot
    ]);

    // every record is contract-shaped and canonicalizable (FakeRecorder enforced by hashing)
    for (const record of recorder.records) {
      expect(typeof record.ts).toBe('string');
      expect(Number.isNaN(Date.parse(record.ts))).toBe(false);
      expect(typeof record.redacted).toBe('boolean');
      expect(() => canonicalJson(record.payload)).not.toThrow();
    }

    // interactions resolved through dom-semantics and acted by path
    expect(driver.calls).toEqual([
      'navigate:http://127.0.0.1:1/',
      'click:{"path":[0,1]}', // html > body > button#load-data
      'fill:{"path":[0,2],"value":"hello note"}', // html > body > input#note-input
      'press:Enter',
      'screenshot:false',
      'close',
    ]);

    // result carries refs + stats + step outcomes
    expect(result.refs.length).toBe(recorder.records.length);
    expect(result.recordCount).toBe(recorder.records.length);
    expect(result.stats.rejectedInvalid).toBe(0);
    expect(result.stats.rejectedOversized).toBe(0);
    expect(result.cleanupNotes).toEqual([]);
    expect(result.steps.every((step) => step.ok)).toBe(true);
    expect(recorder.flushCalls).toBe(1);
  });

  test('redaction scrubs secret-shaped console text before it reaches the recorder', async () => {
    const recorder = new FakeRecorder();
    const driver = new (class SecretLeakingDriver extends FakeDriver {
      private liveSink: CaptureSink | null = null;
      override wireCapture(sink: CaptureSink): void {
        this.liveSink = sink;
      }
      override async navigate(url: string): Promise<void> {
        this.calls.push(`navigate:${url}`);
        // the observed app logs a secret-bearing line on load
        this.liveSink?.('runtime.console', { subkind: 'console', level: 'log', text: `user ${fakeEmail} logged in` });
      }
      override drainPendingServiceWorkers(): ServiceWorkerRegisteredPayload[] {
        return []; // this scenario has no service worker
      }
    })(fakeDom, fakeStorage, fakeCookies, fakeLinks, []);

    const runner = new ObservationRunner({
      recorder,
      sessionFactory: async () => driver,
      script: { targetId: 'bench/redaction', steps: [{ type: 'navigate', url: 'http://127.0.0.1:1/' }] },
    });
    await runner.run();
    expect(recorder.records.length).toBe(1);
    const text = canonicalJson(recorder.records[0]?.payload);
    expect(text).toContain('[REDACTED]');
    expect(text).not.toContain(fakeEmail);
    expect(recorder.records[0]?.redacted).toBe(true);
  });

  test('step failure throws ObservationRunError with a partial result, and cleanup still runs', async () => {
    const recorder = new FakeRecorder();
    const driver = makeDriver();
    const script: ObservationScript = {
      targetId: 'bench/failure',
      steps: [
        { type: 'navigate', url: 'http://127.0.0.1:1/' },
        { type: 'action', action: { type: 'click', target: { testId: 'does-not-exist' } } },
        { type: 'screenshot' }, // never reached
      ],
    };
    const runner = new ObservationRunner({ recorder, sessionFactory: async () => driver, script });
    let caught: unknown = null;
    try {
      await runner.run();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain('target resolution failed');
    expect((caught as { stepIndex?: number }).stepIndex).toBe(1);
    expect(driver.calls).toContain('close');
    expect(recorder.flushCalls).toBe(1); // recorder still flushed in cleanup
  });

  test('recorder failure during the final flush fails the run (cleanup error)', async () => {
    const recorder = new FakeRecorder();
    recorder.recordShouldFail = true;
    const driver = makeDriver();
    const runner = new ObservationRunner({
      recorder,
      sessionFactory: async () => driver,
      script: { targetId: 'bench/recorder-down', steps: [{ type: 'navigate', url: 'http://127.0.0.1:1/' }] },
    });
    let caught: unknown = null;
    try {
      await runner.run();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain('observation cleanup failed');
    expect((caught as { stepIndex?: number }).stepIndex).toBe(-1);
    // driver still closed, notes recorded
    expect(driver.calls).toContain('close');
    expect((caught as { partial: { cleanupNotes: string[] } }).partial.cleanupNotes.length).toBeGreaterThan(0);
  });
});
