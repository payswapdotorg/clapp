/**
 * @clapp/diff tests — the browser-backed paired run (SKIP-IF-GATED).
 *
 * These tests run ONLY when a real chromium is launchable in this
 * environment — the @clapp/journey replayer-playwright precedent. The
 * contract's GUARANTEED coverage is the replayer-dom path (the other test
 * files); a green battery never depends on this file's tests running.
 *
 * When a browser IS available, this proves the playwright driver end to
 * end: both sides driven through createPlaywrightApplier with per-action
 * page.content() captures, network captures from the response listener,
 * and a REAL post-run browser storage inventory — the planned cookie is
 * observed via Set-Cookie AND the planned localStorage key (an inline
 * script write the browser actually executes) is observed in the
 * inventory, with zero semantic findings on the golden pair.
 */

import { afterAll, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser } from 'playwright-core';
import { generateApp, writeApp } from '@clapp/codegen';
import { resolveFixtureRoot, startFixtureServer } from '@clapp/journey';
import { createPairedRunner } from './paired-runner';
import { createDeterministicDiffIdFactory } from './ids';
import { serializeDiffReport } from './report';
import {
  GOLDEN_CANDIDATE_APP_ID,
  b01CorpusRootHash,
  buildGoldenB01Plan,
  loadSeededB01Journeys,
  withCookieBinding,
  withLocalStorageBinding,
} from './golden-plan';
import { spawnCandidate } from './test-support';

// Lazy + guarded: a missing package or missing browser binaries degrade to
// null and the tests below skip — the module never throws at load time.
const playwright: typeof import('playwright-core') | null = await import('playwright-core').then(
  (mod) => mod,
  () => null,
);

const browser: Browser | null =
  playwright !== null
    ? await playwright.chromium.launch({ headless: true }).then(
        (launched) => launched,
        () => null,
      )
    : null;

afterAll(async () => {
  if (browser !== null) {
    await browser.close().catch(() => undefined);
  }
});

describe('paired run under replayer-playwright (browser-gated — skips when no browser)', () => {
  it.skipIf(browser === null)(
    'every seeded journey pairs clean with real browser captures; planned cookie AND localStorage observed',
    async () => {
      const plan = withLocalStorageBinding(withCookieBinding(await buildGoldenB01Plan()));
      const [journeys, baselineRootHash] = await Promise.all([
        loadSeededB01Journeys(),
        b01CorpusRootHash(),
      ]);
      const left = await startFixtureServer({ root: resolveFixtureRoot() });
      const app = generateApp(plan);
      const dir = await mkdtemp(join(tmpdir(), 'clapp-040-playwright-'));
      const root = await writeApp(app, dir);
      const candidate = await spawnCandidate(root, app.manifest);
      try {
        const runner = createPairedRunner({
          journeys,
          left: { side: 'left', baseUrl: left.url, targetId: 'bench/b01-static', driver: 'replayer-playwright' },
          right: { side: 'right', baseUrl: candidate.url, targetId: GOLDEN_CANDIDATE_APP_ID, driver: 'replayer-playwright' },
          candidateAppId: GOLDEN_CANDIDATE_APP_ID,
          baselineRootHash,
          plan,
          ids: createDeterministicDiffIdFactory(),
          now: () => new Date('2026-09-27T00:00:00.000Z'),
          playwrightBrowser: browser ?? undefined,
        });

        // The SHORTEST journey keeps this bonus file's concurrent browser
        // footprint minimal on small machines (the guaranteed battery is
        // the dom-driver path; the sibling packages' browser tests coexist
        // with it unchanged).
        const newsletter = journeys.find((journey) => journey.name.includes('newsletter'))!;
        const run = await runner.runPair(newsletter.id);
        expect(run.runs.left.completed).toBe(true);
        expect(run.runs.right.completed).toBe(true);
        expect(run.runs.left.stepsCompleted).toBe(newsletter.actions.length);
        expect(run.runs.right.stepsCompleted).toBe(newsletter.actions.length);
        // The playwright driver captures the live DOM after EVERY action.
        expect(run.runs.left.stepPageIds.every((id) => typeof id === 'string')).toBe(true);
        expect(run.runs.right.stepPageIds.every((id) => typeof id === 'string')).toBe(true);
        // A real browser inventory is sealed on both sides.
        expect(run.runs.left.storageIds).toHaveLength(1);
        expect(run.runs.right.storageIds).toHaveLength(1);
        const findings = await runner.diff(run);
        expect(findings.filter((finding) => finding.dimension === 'semantic')).toEqual([]);


        // The planned localStorage key (an inline script write the browser
        // actually executed) is observed in the post-run browser inventory;
        // the planned cookie is honestly not exercised by this journey
        // (its writtenOn route /pricing.html is never visited).
        const lsFinding = findings.find((finding) => finding.summary.includes('newsletter-email'));
        expect(lsFinding).toBeDefined();
        expect(lsFinding!.severity).toBe('info');
        expect(lsFinding!.summary).toContain('post-run browser inventory');
        const cookieFinding = findings.find((finding) => finding.summary.includes('b01-visit'));
        expect(cookieFinding).toBeDefined();
        expect(cookieFinding!.severity).toBe('info');
        expect(cookieFinding!.summary).toContain('was not exercised');

        const report = await runner.report([run]);
        expect(report.verdict).toBe('equivalent');
        expect(report.counts.critical).toBe(0);
        expect(() => serializeDiffReport(report)).not.toThrow();
      } finally {
        await candidate.close().catch(() => undefined);
        await rm(dir, { recursive: true, force: true }).catch(() => undefined);
        await left.close().catch(() => undefined);
      }
    },
    120_000,
  );
});
