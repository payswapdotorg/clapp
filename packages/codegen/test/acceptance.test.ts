/**
 * @clapp/codegen tests — THE KILLER ACCEPTANCE (CLAPP-031).
 *
 * The golden b01-shaped plan is generated, written to a temp directory,
 * its server spawned (ephemeral port, health-polled), and ALL FOUR seeded
 * b01 journey records (loaded from @clapp/journey's seeded journeys dir —
 * the records are truth, never weakened) are replayed through the frozen
 * createDomApplier + replayJourney. Every journey must replay CLEAN:
 * actionsApplied equals the journey's action count, zero errors. This is
 * the end-to-end proof that the synthesized app is behaviorally
 * equivalent at the journey level to the reference b01 corpus.
 */

import { afterAll, describe, expect, it } from 'bun:test';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDomApplier, replayJourney, resolveSeededJourneysDir } from '@clapp/journey';
import type { Journey } from '@clapp/journey';
import { GOLDEN_B01_PLAN } from '../fixtures/golden-b01-plan';
import { generateApp, writeApp } from '../src/index';
import { spawnApp, type SpawnedApp } from './helpers/spawn-app';

const scratch: string[] = [];
const servers: SpawnedApp[] = [];

afterAll(async () => {
  for (const server of servers) {
    await server.close().catch(() => undefined);
  }
  for (const dir of scratch) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

describe('killer acceptance — seeded b01 journeys replay clean against the generated app', () => {
  it(
    'replays every seeded journey with zero errors',
    async () => {
      // 1. Generate + materialize the golden app.
      const app = generateApp(GOLDEN_B01_PLAN);
      expect(app.manifest.routePaths).toContain('/contact.html');
      const dir = await mkdtemp(join(tmpdir(), 'clapp-031-acceptance-'));
      scratch.push(dir);
      const root = await writeApp(app, dir);

      // 2. Start the generated server (the manifest's start command is
      //    `bun server.ts`; we spawn exactly that, with PORT=0).
      const server = await spawnApp(root);
      servers.push(server);

      // 3. Load the seeded journeys — the records are truth.
      const journeysDir = resolveSeededJourneysDir();
      const files = (await readdir(journeysDir)).filter((name) => name.endsWith('.json')).sort();
      expect(files).toEqual(['b01-contact.json', 'b01-media.json', 'b01-nav.json', 'b01-newsletter.json']);

      for (const file of files) {
        const journey = JSON.parse(await readFile(join(journeysDir, file), 'utf8')) as Journey;
        const summary = await replayJourney(journey, createDomApplier({ baseUrl: server.url }));
        expect(summary.journeyId).toBe(journey.id);
        expect(summary.actionsApplied).toBe(journey.actions.length);
        expect(summary.durationMs).toBeGreaterThanOrEqual(0);
        expect(server.stderrText()).toBe('');
      }
    },
    60_000,
  );

  it(
    'replays are repeatable: a second full pass against a fresh server is also clean',
    async () => {
      const app = generateApp(GOLDEN_B01_PLAN);
      const dir = await mkdtemp(join(tmpdir(), 'clapp-031-acceptance2-'));
      scratch.push(dir);
      const root = await writeApp(app, dir);
      const server = await spawnApp(root);
      servers.push(server);

      const journeysDir = resolveSeededJourneysDir();
      const files = (await readdir(journeysDir)).filter((name) => name.endsWith('.json')).sort();
      for (const file of files) {
        const journey = JSON.parse(await readFile(join(journeysDir, file), 'utf8')) as Journey;
        const summary = await replayJourney(journey, createDomApplier({ baseUrl: server.url }));
        expect(summary.actionsApplied).toBe(journey.actions.length);
      }
    },
    60_000,
  );
});
