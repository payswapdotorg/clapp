/**
 * CLAPP-041 test battery — THE NETWORK KILLER ACCEPTANCE (browser-
 * independent; the green spine of this package).
 *
 * The golden b01-shaped plan (fixtures/golden-b01-plan.ts — 6 corpus
 * routes + TWO api endpoints: GET /api/notes MOCKED, GET /api/items/:id
 * UNMOCKED) is rendered by @clapp/codegen (devDependency) into a REAL
 * candidate app, materialized, spawned, and probed over real HTTP:
 *
 * POSITIVE PATH — every probe behaves per the plan spec, the dom-driver
 * fetch records capture the traffic, and compareNetworkTraffic returns
 * ZERO findings:
 *   - GET /api/notes (right method + pattern) → 200 + exact mock body;
 *   - GET /api/items/42 (unmocked, parameterized) → 501 JSON naming the
 *     endpoint id;
 *   - POST /api/notes (wrong method) → 405;
 *   - GET /api/unknown (unknown pattern) → 404;
 *   - GET /api/items/42/x (two segments where the pattern takes one) → 404
 *     (pins the ":id = exactly one segment" semantics end-to-end).
 *
 * NEGATIVE CONTROLS — the GENERATED SERVER SOURCE is mutated before the
 * server starts (simulating a broken candidate), and each mutation MUST
 * surface as a 'network' finding with machine-checkable expected/actual:
 *   A. mock status 200 → 500          → status-mismatch finding;
 *   B. mock body sentinel changed     → body-mismatch finding;
 *   C. the 501 handler removed on the
 *      unmocked endpoint (serves 200) → spec-violation finding.
 *
 * Every spawned server is stopped in finally (no leaked processes).
 */

import { afterAll, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateApp, writeApp, type GeneratedApp } from '@clapp/codegen';
import {
  API_ITEMS_ID,
  API_NOTES_ID,
  GOLDEN_MOCK_SENTINEL,
  buildGoldenPlan,
} from '../fixtures/golden-b01-plan';
import { compareNetworkTraffic } from '../src/network';
import { createDomNetworkRecorder } from '../src/capture';
import { spawnApp, type SpawnedApp } from './helpers/spawn-app';
import type { DiffAnchor } from '../src/diff-contract';

const PLAN = buildGoldenPlan();
const ANCHOR: DiffAnchor = { stepIndex: 0, sourceIds: [PLAN.application.id] };

const spawnedApps: SpawnedApp[] = [];
const tempDirs: string[] = [];

afterAll(async () => {
  for (const app of spawnedApps) {
    await app.close().catch(() => undefined);
  }
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

/** Materializes + spawns an app; registers cleanup. */
async function startApp(app: GeneratedApp): Promise<SpawnedApp> {
  const dir = await mkdtemp(join(tmpdir(), 'clapp-041-net-'));
  tempDirs.push(dir);
  const root = await writeApp(app, dir);
  const spawned = await spawnApp(root);
  spawnedApps.push(spawned);
  return spawned;
}

/** Applies a verified single-occurrence source mutation to server.ts. */
function mutateServerSource(app: GeneratedApp, search: string, replace: string): GeneratedApp {
  const occurrences = app.files.filter((file) => file.path === 'server.ts' && file.contents.includes(search)).length;
  if (occurrences !== 1) {
    throw new Error(`mutation calibration failed: expected the search text exactly once, found ${occurrences}`);
  }
  return {
    manifest: app.manifest,
    files: app.files.map((file) =>
      file.path === 'server.ts' ? { ...file, contents: file.contents.replace(search, replace) } : file,
    ),
  };
}

describe('network killer acceptance — golden candidate serves the plan spec exactly', () => {
  it(
    'every as-spec probe → ZERO network findings (dom-driver capture)',
    async () => {
      const app = generateApp(PLAN);
      expect(app.manifest.apiEndpoints).toEqual(['GET /api/notes', 'GET /api/items/:id']);
      const server = await startApp(app);
      const recorder = createDomNetworkRecorder();

      // --- exercise every endpoint; probe wrong-method + unknown patterns ---
      const notesResponse = await recorder.fetch(`${server.url}api/notes`);
      expect(notesResponse.status).toBe(200);
      const notesBody = (await notesResponse.json()) as Record<string, unknown>;
      expect(notesBody['source']).toBe(GOLDEN_MOCK_SENTINEL);
      expect(notesBody['ok']).toBe(true);

      const itemsResponse = await recorder.fetch(`${server.url}api/items/42`);
      expect(itemsResponse.status).toBe(501);
      const itemsBody = (await itemsResponse.json()) as Record<string, unknown>;
      expect(itemsBody['endpointId']).toBe(API_ITEMS_ID);

      const wrongMethod = await recorder.fetch(`${server.url}api/notes`, { method: 'POST' });
      expect(wrongMethod.status).toBe(405);

      const unknown = await recorder.fetch(`${server.url}api/unknown`);
      expect(unknown.status).toBe(404);

      const segmentStrict = await recorder.fetch(`${server.url}api/items/42/x`);
      expect(segmentStrict.status).toBe(404);

      // --- the capture itself: 5 exchanges, dom-driver vocabulary ---
      const requests = recorder.requests();
      expect(requests.length).toBe(5);
      for (const request of requests) {
        expect(typeof request.url).toBe('string');
        expect(request.method).toMatch(/^(GET|POST)$/);
        expect(typeof request.status).toBe('number');
        expect(request.headers).toBeDefined();
      }

      // --- the comparison: ZERO findings ---
      const findings = compareNetworkTraffic(requests, PLAN.api.endpoints, PLAN.api.mocks, ANCHOR);
      expect(findings).toEqual([]);

      // --- evidence refs are EvidenceRef-shaped (kind 'network') ---
      const refs = await recorder.evidenceRefs();
      expect(refs.length).toBe(5);
      for (const ref of refs) {
        expect(ref.kind).toBe('network');
        expect(ref.evidenceId).toMatch(/^ev_[0-9a-f-]{36}$/);
        expect(ref.sha256).toMatch(/^[0-9a-f]{64}$/);
      }
    },
    30_000,
  );
});

describe('network negative controls — mutated servers MUST surface findings', () => {
  it(
    'A: mock status mutated 200 → 500 → ≥1 network finding with expected/actual',
    async () => {
      const mutated = mutateServerSource(
        generateApp(PLAN),
        `statusCode: 200, bodyJson: {"ok":true,"source":"${GOLDEN_MOCK_SENTINEL}"`,
        `statusCode: 500, bodyJson: {"ok":true,"source":"${GOLDEN_MOCK_SENTINEL}"`,
      );
      const server = await startApp(mutated);
      const recorder = createDomNetworkRecorder();

      const badNotes = await recorder.fetch(`${server.url}api/notes`);
      expect(badNotes.status).toBe(500);
      await recorder.fetch(`${server.url}api/items/42`); // still as-spec 501

      const findings = compareNetworkTraffic(recorder.requests(), PLAN.api.endpoints, PLAN.api.mocks, ANCHOR);
      expect(findings.length).toBeGreaterThanOrEqual(1);
      const finding = findings.find((candidate) => candidate.severity === 'major');
      expect(finding).toBeDefined();
      expect(finding!.dimension).toBe('network');
      expect((finding!.expected as { statusCode: number }).statusCode).toBe(200);
      expect((finding!.actual as { statusCode: number }).statusCode).toBe(500);
      expect(finding!.anchors[0]?.sourceIds).toContain(API_NOTES_ID);
    },
    30_000,
  );

  it(
    'B: mock body mutated → ≥1 network finding with expected/actual bodies',
    async () => {
      const mutated = mutateServerSource(
        generateApp(PLAN),
        `"source":"${GOLDEN_MOCK_SENTINEL}"`,
        `"source":"mutated-by-diffext"`,
      );
      const server = await startApp(mutated);
      const recorder = createDomNetworkRecorder();

      const badNotes = await recorder.fetch(`${server.url}api/notes`);
      expect(badNotes.status).toBe(200);
      const body = (await badNotes.json()) as Record<string, unknown>;
      expect(body['source']).toBe('mutated-by-diffext');
      await recorder.fetch(`${server.url}api/items/42`);

      const findings = compareNetworkTraffic(recorder.requests(), PLAN.api.endpoints, PLAN.api.mocks, ANCHOR);
      expect(findings.length).toBeGreaterThanOrEqual(1);
      const finding = findings.find((candidate) => candidate.severity === 'major');
      expect(finding).toBeDefined();
      const actual = finding!.actual as { statusCode: number; body: { source?: string } };
      expect(actual.statusCode).toBe(200);
      expect(actual.body['source']).toBe('mutated-by-diffext');
      const expected = finding!.expected as { body: { source?: string } };
      expect(expected.body['source']).toBe(GOLDEN_MOCK_SENTINEL);
    },
    30_000,
  );

  it(
    'C: the 501 handler removed on the unmocked endpoint → ≥1 network finding',
    async () => {
      const mutated = mutateServerSource(
        generateApp(PLAN),
        [
          '        501,',
          "        'application/json; charset=utf-8',",
          "        JSON.stringify({ error: 'no mock response declared for endpoint', endpointId: apiRoute.endpointId }),",
        ].join('\n'),
        [
          '        200,',
          "        'application/json; charset=utf-8',",
          "        JSON.stringify({ hello: 'the 501 handler was removed by a diffext mutation' }),",
        ].join('\n'),
      );
      const server = await startApp(mutated);
      const recorder = createDomNetworkRecorder();

      await recorder.fetch(`${server.url}api/notes`); // still as-spec mock
      const broken = await recorder.fetch(`${server.url}api/items/42`);
      expect(broken.status).toBe(200);

      const findings = compareNetworkTraffic(recorder.requests(), PLAN.api.endpoints, PLAN.api.mocks, ANCHOR);
      expect(findings.length).toBeGreaterThanOrEqual(1);
      const finding = findings.find((candidate) => candidate.severity === 'major');
      expect(finding).toBeDefined();
      expect(finding!.summary).toContain('501');
      expect((finding!.expected as { statusCode: number }).statusCode).toBe(501);
      expect((finding!.actual as { statusCode: number }).statusCode).toBe(200);
      expect(finding!.anchors[0]?.sourceIds).toContain(API_ITEMS_ID);
    },
    30_000,
  );
});
