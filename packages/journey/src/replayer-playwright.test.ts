/**
 * CLAPP-012 test battery — Playwright applier (SKIP-IF-GATED).
 *
 * These tests run ONLY when a real chromium is launchable in this
 * environment; they are the bonus parity path. The contract's GUARANTEED
 * coverage is the DOM applier (replayer-dom.test.ts) and the never-skipped
 * sandbox-execution proof (sandbox-proof.test.ts) — a green battery never
 * depends on this file's tests running.
 *
 * When a browser IS available, these tests replay every SEEDED journey in
 * a real browser against the real fixture server: full layout, CSS, and
 * page scripts execute, proving the corpus + journeys are valid for real
 * browsers and not just for the DOM shim.
 */

import { afterAll, describe, expect, it } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser } from 'playwright-core';
import { createPlaywrightApplier } from './replayer-playwright';
import { JourneyReplayError, replayJourney } from './replayer';
import { resolveFixtureRoot, resolveSeededJourneysDir, startFixtureServer } from './fixtures/server';
import type { Journey } from './journey-contract';

// Lazy + guarded: a missing package or missing browser binaries degrade to
// `null` and the tests below skip — the module never throws at load time.
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

function loadSeededJourneys(): Journey[] {
  const dir = resolveSeededJourneysDir();
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(dir, name), 'utf8')) as Journey);
}

describe('playwright applier (browser-gated — skips when no browser)', () => {
  it.skipIf(browser === null)(
    'replays EVERY seeded journey in a real browser against the real fixture server',
    async () => {
      const server = await startFixtureServer({ root: resolveFixtureRoot() });
      const page = browser !== null ? await browser.newPage() : null;
      expect(page).not.toBeNull();
      const applier = await createPlaywrightApplier({ page: page ?? undefined, baseUrl: server.url });
      try {
        const journeys = loadSeededJourneys();
        expect(journeys.length).toBeGreaterThanOrEqual(3);
        for (const journey of journeys) {
          const summary = await replayJourney(journey, applier);
          expect(summary.actionsApplied).toBe(journey.actions.length);
        }
      } finally {
        await applier.close(); // no-op: caller-owned page
        await page?.close();
        await server.close();
      }
    },
    90_000,
  );

  it.skipIf(browser === null)(
    'assert-visible on a missing target is a machine-readable failure',
    async () => {
      const server = await startFixtureServer({ root: resolveFixtureRoot() });
      const page = browser !== null ? await browser.newPage() : null;
      expect(page).not.toBeNull();
      const applier = await createPlaywrightApplier({ page: page ?? undefined, baseUrl: server.url });
      try {
        const error = await replayJourney(
          {
            id: 'journey_00000000-0000-4000-8000-000000000000',
            name: 'browser failure probe',
            targetId: 'bench/b01-static',
            actions: [
              { type: 'navigate', url: '/' },
              { type: 'assert-visible', target: { testId: 'no-such-element' } },
            ],
          },
          applier,
        ).then(
          () => undefined,
          (error_: unknown) => error_,
        );
        expect(error).toBeInstanceOf(JourneyReplayError);
        const replayError = error as JourneyReplayError;
        expect(['target-not-found', 'assert-visible-failed']).toContain(replayError.code);
        expect(replayError.actionIndex).toBe(1);
      } finally {
        await applier.close(); // no-op: caller-owned page
        await page?.close();
        await server.close();
      }
    },
    60_000,
  );
});
