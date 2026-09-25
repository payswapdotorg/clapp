/**
 * CLAPP-022 test battery — end-to-end determinism.
 *
 * Two explorations with the same seed (fresh appliers, fresh memory-store
 * recording sessions, the same static corpus) must produce identical route
 * sets, identical transition EDGE sets (modulo ids), and identical journey
 * action sequences (modulo ids/timestamps) — the same seed walks the same
 * walk.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { RecordingSession } from '@clapp/evidence';
import { createDomApplier, resolveFixtureRoot, startFixtureServer } from '@clapp/journey';
import { MemoryArtifactStore, MemoryRunStore } from '@clapp/store';
import { createExplorationPolicy, explore } from '../src/index';
import type { ExploreResult } from '../src/index';

const SEED = 424242;
const BUDGET = {
  entrypoints: ['/'],
  maxSteps: 120,
  maxScreens: 12,
  maxActionsPerScreen: 8,
  seed: SEED,
};

const APPLICATION = {
  id: 'app_b01-determinism',
  name: 'b01-static',
  platform: 'web' as const,
  entrypoints: ['/'],
};

let server: Awaited<ReturnType<typeof startFixtureServer>>;
let runA: ExploreResult;
let runB: ExploreResult;

async function exploreOnce(): Promise<ExploreResult> {
  const stores = { runStore: new MemoryRunStore(), artifactStore: new MemoryArtifactStore() };
  const session = await RecordingSession.start(stores, { targetId: 'bench/b01-static' });
  return explore({
    baseUrl: server.url,
    applier: createDomApplier({ baseUrl: server.url }),
    recorder: session,
    policy: createExplorationPolicy(BUDGET),
    application: APPLICATION,
  });
}

beforeAll(async () => {
  server = await startFixtureServer({ root: resolveFixtureRoot() });
  runA = await exploreOnce();
  runB = await exploreOnce();
}, 120_000);

afterAll(async () => {
  await server.close();
});

function edgesOf(result: ExploreResult): string[] {
  const routeOf = new Map(result.model.screens.map((screen) => [screen.id, screen.route]));
  return result.model.state.transitions
    .map((transition) => {
      const from = routeOf.get(transition.fromScreenId);
      const to = routeOf.get(transition.toScreenId);
      return `${from} --${transition.trigger.type}:${String(transition.trigger.type === 'action' ? transition.trigger.action : '')}--> ${to}`;
    })
    .sort();
}

function journeysByTarget(result: ExploreResult): Map<string, string> {
  const byName = new Map<string, string>();
  for (const journey of result.journeys) {
    byName.set(journey.name, JSON.stringify(journey.actions));
  }
  return byName;
}

describe('explorer — determinism (same seed, same walk)', () => {
  it('produces identical route sets and visit order', () => {
    expect(runB.report.screensVisited).toEqual(runA.report.screensVisited);
    expect(runA.report.screensVisited.sort()).toEqual([
      '/',
      '/contact',
      '/contact-success',
      '/features',
      '/newsletter-success',
      '/pricing',
    ]);
  });

  it('produces identical transition edge sets (modulo ids)', () => {
    expect(edgesOf(runB)).toEqual(edgesOf(runA));
    expect(runA.model.state.transitions.length).toBeGreaterThanOrEqual(6);
  });

  it('produces identical journey action sequences (modulo ids/timestamps)', () => {
    const a = journeysByTarget(runA);
    const b = journeysByTarget(runB);
    expect(a.size).toBe(b.size);
    expect(a.size).toBeGreaterThanOrEqual(6);
    for (const [name, actions] of a) {
      expect(b.get(name)).toBe(actions);
    }
  });

  it('produces identical report counters', () => {
    expect(runB.report.actionsApplied).toBe(runA.report.actionsApplied);
    expect(runB.report.actionsSkipped).toBe(runA.report.actionsSkipped);
    expect(runB.report.stepsUsed).toBe(runA.report.stepsUsed);
    expect(runB.report.duplicateScreensSkipped).toBe(runA.report.duplicateScreensSkipped);
    expect(runB.report.budgetStops).toEqual(runA.report.budgetStops);
    expect(runB.report.frontierExhausted).toBe(runA.report.frontierExhausted);
  });

  it('produces identical evidence capture kinds in order (timestamps excluded)', () => {
    const kindsOf = (result: ExploreResult): string =>
      result.model.evidence.map((entry) => entry.ref.kind).join(',');
    expect(kindsOf(runB)).toBe(kindsOf(runA));
  });
});
