// CLAPP-010 e2e — full observation session over a sandboxed fixture server
// under a REAL Playwright chromium browser.
//
// Acceptance surface (criteria 1 + 2):
//  - a fixture page served by launchServerInSandbox yields a COMPLETE
//    session: DOM capture, semantics/a11y roles, screenshot artifact bytes,
//    console/runtime records, network request/response records, WebSocket
//    frame records, storage inventory records, service-worker registration
//    awareness, static asset inventory — every channel producing
//    CaptureRecords through the EvidenceRecorder port with redaction
//    applied;
//  - every record carries ts/kind/payload/redacted with canonical-JSON
//    serializable payloads.
//
// Browser-gated: skips cleanly when no browser binary is available
// (describe.skipIf(!browserAvailable)).

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { ProcessSandboxExecutor } from '@clapp/sandbox';
import { EVIDENCE_KINDS } from '@clapp/core';
import { canonicalJson } from '../canonical-json';
import type { ConsoleCapturePayload } from '../logs/runtime';
import type { NetworkCapturePayload, NetworkResponsePayload, WebSocketFramePayload } from '../logs/network';
import type { StorageInventoryPayload } from '../logs/storage';
import type { StaticInventoryPayload } from '../static-inventory';
import { createPlaywrightDriverFactory } from '../playwright-session';
import { ObservationRunner, type ObservationScript } from '../runner';
import type { LaunchedServer } from '../sandbox-server';
import { launchServerInSandbox } from '../sandbox-server';
import { browserAvailable, FakeEvidenceRecorder, fixtureEmailParts, fixtureJwtHead, launchE2eBrowser, loadServerFixtures } from '../testing';
import type { Browser } from 'playwright';

const canRun = await browserAvailable();

describe.skipIf(!canRun)('CLAPP-010 e2e — observation session over sandboxed fixture', () => {
  let browser: Browser;
  let server: LaunchedServer;

  beforeAll(async () => {
    browser = await launchE2eBrowser();
    server = await launchServerInSandbox(new ProcessSandboxExecutor(), {
      command: 'bun',
      args: ['server.ts'],
      fixtures: loadServerFixtures(),
      budget: { maxDurationMs: 120_000 },
      readyPath: '/',
      stopPath: '/__clapp/stop',
      label: 'clapp-010-e2e-observation',
    });
  }, 60_000);

  afterAll(async () => {
    if (server !== undefined) {
      const result = await server.close();
      expect(result.outcome).toEqual({ status: 'completed', exitCode: 0 });
    }
    if (browser !== undefined) {
      await browser.close();
    }
  }, 60_000);

  test(
    'full scripted session covers every capture channel with redaction, through the recorder port',
    async () => {
      const recorder = new FakeEvidenceRecorder();
      const script: ObservationScript = {
        targetId: 'bench/b01-static',
        steps: [
          { type: 'navigate', url: server.baseUrl },
          { type: 'settle', ms: 1_000 }, // load-time fetch + SW registration
          { type: 'capture-dom' },
          { type: 'capture-storage' },
          { type: 'capture-static' },
          { type: 'screenshot' },
          { type: 'action', action: { type: 'click', target: { testId: 'load-data' } } },
          { type: 'settle', ms: 400 }, // /api/user fetch
          { type: 'action', action: { type: 'click', target: { testId: 'open-ws' } } },
          { type: 'settle', ms: 700 }, // ws open/echo/close
          { type: 'action', action: { type: 'click', target: { testId: 'save-storage' } } },
          { type: 'settle', ms: 300 },
          { type: 'action', action: { type: 'fill', target: { testId: 'note-input' }, value: 'hello note' } },
          { type: 'action', action: { type: 'press', key: 'Tab' } },
          { type: 'capture-storage' },
          { type: 'screenshot' },
          { type: 'flush' },
        ],
      };

      const runner = new ObservationRunner({
        recorder,
        sessionFactory: createPlaywrightDriverFactory({ browser }),
        script,
      });
      const result = await runner.run();

      // --- sanity: clean session, everything delivered ---
      expect(result.cleanupNotes).toEqual([]);
      expect(result.stats.rejectedInvalid).toBe(0);
      expect(result.stats.rejectedOversized).toBe(0);
      expect(result.stats.droppedWhilePaused).toBe(0);
      expect(result.stats.droppedAfterEnd).toBe(0);
      expect(result.stats.droppedOverflow).toBe(0);
      expect(result.recordCount).toBe(recorder.records.length);
      expect(result.refs.length).toBe(recorder.records.length);
      expect(result.steps.every((step) => step.ok)).toBe(true);

      const records = recorder.records;
      expect(records.length).toBeGreaterThan(20); // a genuinely full session

      // --- criterion 2: record shape + canonical payloads ---
      for (const record of records) {
        expect(EVIDENCE_KINDS).toContain(record.kind);
        expect(Number.isNaN(Date.parse(record.ts))).toBe(false);
        expect(typeof record.redacted).toBe('boolean');
        expect(() => canonicalJson(record.payload)).not.toThrow(); // FakeRecorder also hashed it
      }

      // --- criterion 1: every channel present ---
      const byKind = new Map<string, number>();
      for (const record of records) byKind.set(record.kind, (byKind.get(record.kind) ?? 0) + 1);
      expect(byKind.get('dom')).toBeGreaterThanOrEqual(1);
      expect(byKind.get('runtime')).toBeGreaterThanOrEqual(5); // load/data/sw/user/ws console records
      expect(byKind.get('network')).toBeGreaterThanOrEqual(10); // requests + responses + ws frames
      expect(byKind.get('storage')).toBeGreaterThanOrEqual(3); // 2 inventories + sw-registered
      expect(byKind.get('screenshot')).toBe(2);
      expect(byKind.get('static')).toBe(1);

      // --- DOM capture + semantics ---
      const domRecords = records.filter((record) => record.kind === 'dom');
      const domPayload = domRecords[0]?.payload as { root: { tag: string; role: string; children?: unknown[] }; nodeCount: number };
      expect(domPayload.root.tag).toBe('html');
      expect(domPayload.nodeCount).toBeGreaterThan(10);
      const domText = canonicalJson(domRecords[0]?.payload);
      expect(domText).toContain('"role":"button"'); // semantics annotated
      expect(domText).toContain('"data-testid":"load-data"');
      expect(domText).not.toContain('secret-inline'); // script text never serialized

      // --- console/runtime records ---
      const consolePayloads = records
        .filter((record) => record.kind === 'runtime')
        .map((record) => record.payload as ConsoleCapturePayload);
      const consoleTexts = consolePayloads.map((payload) => payload.text);
      expect(consoleTexts.some((text) => text.startsWith('fixture:load'))).toBe(true);
      expect(consoleTexts.some((text) => text.startsWith('fixture:data'))).toBe(true);
      expect(consoleTexts.some((text) => text.startsWith('fixture:sw-registered'))).toBe(true);
      expect(consoleTexts.some((text) => text.startsWith('fixture:ws-echo'))).toBe(true);
      const userLog = consolePayloads.find((payload) => payload.text.startsWith('fixture:user'));
      expect(userLog).toBeDefined();
      expect(userLog?.args?.length).toBe(2); // 'fixture:user' + the object

      // --- network requests + responses ---
      const networkPayloads = records
        .filter((record) => record.kind === 'network')
        .map((record) => record.payload as NetworkCapturePayload);
      const requests = networkPayloads.filter((payload) => payload.subkind === 'request');
      const responses = networkPayloads.filter((payload) => payload.subkind === 'response');
      expect(requests.some((payload) => payload.url === `${server.baseUrl}/` && payload.resourceType === 'document')).toBe(true);
      expect(requests.some((payload) => payload.url.endsWith('/api/user'))).toBe(true);
      expect(responses.some((payload) => payload.url.endsWith('/api/user') && payload.status === 200)).toBe(true);
      const documentResponse = responses.find((payload) => payload.url === `${server.baseUrl}/`);
      expect(documentResponse?.mimeType).toBe('text/html');

      // --- WebSocket frames ---
      const wsFrames = networkPayloads.filter((payload) => payload.subkind === 'ws-frame') as WebSocketFramePayload[];
      expect(wsFrames.map((frame) => [frame.direction, frame.payload])).toEqual([
        ['sent', 'ping-from-fixture'],
        ['received', 'echo:ping-from-fixture'],
      ]);

      // --- storage inventories (before/after the save-storage click) ---
      const inventories = records
        .filter((record) => record.kind === 'storage' && (record.payload as { subkind: string }).subkind === 'storage-inventory')
        .map((record) => record.payload as StorageInventoryPayload);
      expect(inventories.length).toBe(2);
      expect(inventories[0]?.localStorage).toEqual([]); // before the click
      expect(inventories[1]?.localStorage.map((entry) => entry.key).sort()).toEqual(['fixture:settings', 'fixture:theme']);
      expect(inventories[1]?.sessionStorage.map((entry) => entry.key)).toEqual(['fixture:flag']);
      // cookie values never leak (wholesale replacement)
      for (const cookie of inventories.flatMap((inventory) => inventory.cookies)) {
        expect(cookie.value).toBe('[REDACTED]');
      }
      // service-worker registration awareness: event + inventory entries
      const swEvents = records.filter((record) => (record.payload as { subkind?: string }).subkind === 'sw-registered');
      expect(swEvents.length).toBe(1);
      expect((swEvents[0]?.payload as { scriptUrl: string }).scriptUrl.endsWith('/sw.js')).toBe(true);
      expect(inventories[0]?.serviceWorkers.length).toBe(1);
      expect(inventories[0]?.serviceWorkers[0]?.scopeUrl).toBe(`${server.baseUrl}/`);

      // --- static inventory ---
      const staticPayload = records.find((record) => record.kind === 'static')?.payload as StaticInventoryPayload;
      const staticUrls = staticPayload.assets.map((asset) => asset.url);
      expect(staticUrls).toContain(`${server.baseUrl}/app.js`);
      expect(staticUrls).toContain(`${server.baseUrl}/style.css`);
      expect(staticUrls).toContain(`${server.baseUrl}/logo.svg`);
      expect(staticUrls).toContain(`${server.baseUrl}/manifest.webmanifest`);
      expect(staticUrls).not.toContain(`${server.baseUrl}/api/data`); // dynamic JSON is not a static asset
      const appJs = staticPayload.assets.find((asset) => asset.url.endsWith('/app.js'));
      expect(appJs?.mimeType).toBe('text/javascript');
      expect(appJs?.sizeBytes).toBeGreaterThan(0); // enriched from the network channel

      // --- screenshots: real PNG bytes, base64-decodable ---
      const screenshots = records.filter((record) => record.kind === 'screenshot');
      for (const record of screenshots) {
        const payload = record.payload as { data: string; byteLength: number; encoding: string };
        expect(payload.encoding).toBe('base64');
        const bytes = Buffer.from(payload.data, 'base64');
        expect(bytes.byteLength).toBe(payload.byteLength);
        expect(bytes.byteLength).toBeGreaterThan(1000); // a real render, not a blank stub
        expect(bytes[0]).toBe(0x89); // PNG magic: \x89PNG
        expect(bytes[1]).toBe(0x50);
        expect(bytes[2]).toBe(0x4e);
        expect(bytes[3]).toBe(0x47);
        expect(record.redacted).toBe(false); // honest: pixels are not redactable
      }

      // --- redaction: fake fixture credentials never survive into records ---
      const allCanonical = records.map((record) => canonicalJson(record.payload)).join('\n');
      const fakeEmail = fixtureEmailParts.join('');
      expect(allCanonical).not.toContain(fakeEmail);
      expect(allCanonical).not.toContain(fixtureJwtHead);
      expect(allCanonical).not.toContain('demo-session-token-value'); // Set-Cookie value
      expect(allCanonical).not.toContain('user-session-token-here'); // document.cookie value
      // ...while the scrubbed markers DO appear where the secrets were
      expect(canonicalJson(userLog)).toContain('[REDACTED]');
      const userResponse = responses.find((payload) => payload.url.endsWith('/api/user')) as NetworkResponsePayload | undefined;
      expect(canonicalJson(userResponse)).toContain('[REDACTED]'); // body preview scrubbed
      // ...and benign content is intact (over-redaction did not nuke everything)
      expect(canonicalJson(userLog)).toContain('fixture:user');
    },
    120_000,
  );
});
