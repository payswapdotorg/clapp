/**
 * CLAPP-041 test battery — NETWORK SYMMETRY ON THE CORPUS (browser-
 * independent, always runs).
 *
 * The LEFT side of the paired run is the bench-b01 corpus: a STATIC site
 * with NO APIs (honest fact — packages/journey/fixtures/b01 carries six
 * HTML pages + static assets and not one api endpoint; the b01 corpus is
 * an offline benchmark, so there is no API baseline to verify against).
 *
 * This battery proves the left-side capture + comparison path behaves
 * exactly as that truth demands: all four SEEDED b01 journeys are
 * replayed against the REAL fixture server through @clapp/journey's
 * createDomApplier with the recording fetch (the 'replayer-dom' driver),
 * and the captured traffic is compared against an ENDPOINT-LESS plan api
 * section — the honest b01 network baseline.
 *
 * Expected: every captured request is document/static-shaped (no /api/
 * path among them), and every finding is 'info'-grade (documents served
 * outside an api spec are recorded observations, never errors) — or
 * there are no findings at all.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createDomApplier,
  replayJourney,
  resolveFixtureRoot,
  resolveSeededJourneysDir,
  startFixtureServer,
  type FixtureServer,
  type Journey,
} from '@clapp/journey';
import { compareNetworkTraffic } from '../src/network';
import { createDomNetworkRecorder } from '../src/capture';
import { requestPathOf } from '../src/network';
import type { DiffAnchor } from '../src/diff-contract';

let server: FixtureServer | null = null;

beforeAll(async () => {
  server = await startFixtureServer({ root: resolveFixtureRoot() });
});

afterAll(async () => {
  await server?.close();
});

function loadSeededJourneys(): Journey[] {
  const dir = resolveSeededJourneysDir();
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(dir, name), 'utf8')) as Journey);
}

describe('network symmetry on the b01 corpus (left side, static, no APIs)', () => {
  it(
    'the 4 seeded journeys replay cleanly against the real fixture server through the recording fetch',
    async () => {
      const journeys = loadSeededJourneys();
      expect(journeys.length).toBe(4);
      expect(server).not.toBeNull();
      const recorder = createDomNetworkRecorder();

      for (const journey of journeys) {
        // A fresh applier per journey (page state resets); ONE recorder
        // accumulates the whole paired-run footprint.
        const applier = createDomApplier({ baseUrl: server!.url, fetchImpl: recorder.fetch });
        const summary = await replayJourney(journey, applier);
        expect(summary.actionsApplied).toBe(journey.actions.length);
      }

      const requests = recorder.requests();
      expect(requests.length).toBeGreaterThanOrEqual(6); // every journey navigates at least once

      // --- captured traffic is static-asset/document requests ONLY ---
      for (const request of requests) {
        const path = requestPathOf(request.url);
        expect(path.startsWith('/api/')).toBe(false); // b01 carries NO APIs
        expect(request.status).toBe(200); // the corpus serves every page it serves
        expect(request.method).toBe('GET'); // static corpus: GET documents only
        expect(request.headers?.['content-type']).toContain('text/html');
      }
      // The corpus pages the journeys actually visit were all captured.
      const paths = new Set(requests.map((request) => requestPathOf(request.url)));
      for (const expected of ['/', '/features.html', '/pricing.html', '/contact.html', '/contact-success.html', '/newsletter-success.html']) {
        expect(paths.has(expected)).toBe(true);
      }
    },
    30_000,
  );

  it('compareNetworkTraffic against an endpoint-less plan api → info-grade entries only (or none)', async () => {
    expect(server).not.toBeNull();
    const recorder = createDomNetworkRecorder();
    const applier = createDomApplier({ baseUrl: server!.url, fetchImpl: recorder.fetch });
    const journeys = loadSeededJourneys();
    for (const journey of journeys) {
      await replayJourney(journey, applier);
    }

    const anchor: DiffAnchor = { stepIndex: 0, sourceIds: ['bench/b01-static'] };
    // The HONEST b01 network baseline: an endpoint-less api section.
    const findings = compareNetworkTraffic(recorder.requests(), [], [], anchor);

    expect(findings.length).toBeGreaterThan(0); // the page documents ARE recorded…
    for (const finding of findings) {
      expect(finding.dimension).toBe('network');
      expect(finding.severity).toBe('info'); // …but only as info-grade observations
      expect(finding.summary).toContain('no consequence established');
      expect(finding.expected).toEqual({ statusCode: 404 });
      expect(finding.actual).toEqual({ statusCode: 200 });
      expect(finding.anchors[0]?.sourceIds).toEqual(['bench/b01-static']);
    }

    // Evidence refs for the whole corpus run are well-formed.
    const refs = await recorder.evidenceRefs();
    expect(refs.length).toBe(recorder.requests().length);
    for (const ref of refs) {
      expect(ref.kind).toBe('network');
      expect(ref.evidenceId).toMatch(/^ev_[0-9a-f-]{36}$/);
      expect(ref.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});
