/**
 * CLAPP-032 — THE KILLER ACCEPTANCE (self-verification end-to-end).
 *
 * Build the b01-shaped golden plan (6 routes, nav testids, exact b01
 * heading texts, exact image alt texts, the footer, multiple links named
 * "Features" for the seeded nth selectors, the contact + newsletter forms,
 * the success pages) + the 4 SEEDED b01 journey records → generateTestSuite
 * → writeSuite to a scratch dir inside this package (so '@clapp/journey'
 * resolves) → start createConformingServer(plan) → RUN THE GENERATED SUITE
 * against it (`bun test` as a subprocess) → ALL generated tests PASS
 * (route tests, api tests, and the 4 acceptance replays) → stop the server.
 *
 * This is the proof that the generated suite is genuinely executable and
 * verifies a conforming app end-to-end; at integration the tech-lead gate
 * re-runs the same generated suite against the real @clapp/codegen app.
 */

import { describe, expect, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { createConformingServer } from './conforming-server';
import { generateTestSuite } from './generate';
import { writeSuite } from './write-suite';
import { buildGoldenPlan, loadSeededB01Journeys } from './golden-plan';
import { makeScratchDir, runSubprocess } from './test-utils';

describe('KILLER — the generated b01 golden suite passes against the conforming server', () => {
  test(
    'generate → write → serve → `bun test` subprocess → all 13 tests pass',
    async () => {
      const plan = await buildGoldenPlan();
      const records = await loadSeededB01Journeys();
      expect(records).toHaveLength(4);

      // Generate against an EPHEMERAL server (baseUrl override points the
      // suite at it; the plan's own port never matters here).
      const server = await createConformingServer(plan, { port: 0 });
      const suite = generateTestSuite(plan, { baseUrl: server.url, journeyRecords: records });

      // Manifest is exact before anything runs.
      expect(suite.manifest).toEqual({
        testCount: 13,
        routeTestCount: 7,
        apiTestCount: 2,
        acceptanceTestCount: 4,
        skippedAcceptanceIds: [],
      });
      expect(suite.files.map((file) => file.path)).toEqual([
        'routes.test.ts',
        'api.test.ts',
        'acceptance.test.ts',
      ]);

      const root = await makeScratchDir('killer');
      try {
        await writeSuite(suite, root);
        const result = await runSubprocess(process.execPath, ['test'], { cwd: root, timeoutMs: 120_000 });

        // The subprocess must succeed outright.
        expect(result.code).toBe(0);
        // Nothing was skipped and nothing failed.
        expect(result.output).toContain('13 pass');
        expect(result.output).toContain('0 fail');
        expect(result.output).toContain('Ran 13 tests across 3 files');
        expect(result.output).not.toContain('skip');

        // Every acceptance replay actually ran (the seeded journeys).
        for (const id of ['acc_nav', 'acc_media', 'acc_newsletter', 'acc_contact']) {
          expect(result.output).toContain(id);
        }
        // Every group ran.
        expect(result.output).toContain('routes — Nimbus Notes (b01 golden fixture)');
        expect(result.output).toContain('api — Nimbus Notes (b01 golden fixture)');
        expect(result.output).toContain('acceptance — Nimbus Notes (b01 golden fixture)');
      } finally {
        await server.close();
        await rm(root, { recursive: true, force: true });
      }
    },
    180_000,
  );

  test('the golden plan mirrors the b01 corpus selectors the journeys rely on', async () => {
    const plan = await buildGoldenPlan();
    const records = await loadSeededB01Journeys();

    // Every route path the journeys navigate exists in the plan.
    const paths = new Set(plan.routes.map((route) => route.path));
    expect(paths).toEqual(
      new Set(['/', '/features.html', '/pricing.html', '/contact.html', '/contact-success.html', '/newsletter-success.html']),
    );

    // Every acceptance locates exactly one seeded record by journeyId.
    for (const acceptance of plan.acceptance) {
      const matching = records.filter((record) => record.id === acceptance.journeyId);
      expect(matching).toHaveLength(1);
    }
    expect(plan.acceptance.map((acceptance) => acceptance.id)).toEqual([
      'acc_nav',
      'acc_media',
      'acc_newsletter',
      'acc_contact',
    ]);

    // The exact corpus texts the seeded journeys assert are all planned.
    const allText = JSON.stringify(plan);
    for (const exact of [
      'Capture every idea, calmly',
      'Everything you need to stay organized',
      'Simple, honest pricing',
      "We'd love to hear from you",
      'Thanks for reaching out!',
      "You're on the list!",
      'Nimbus Notes logo',
      'Illustration of notes organized among clouds',
    ]) {
      expect(allText).toContain(exact);
    }
  });
});
