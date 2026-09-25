/**
 * CLAPP-022 test battery — the explorer against the REAL b01 corpus.
 *
 * Full exploration from '/' over stdlib HTTP on 127.0.0.1 (the frozen
 * startFixtureServer + createDomApplier — no browser), a RecordingSession
 * over memory stores, and the killer acceptance: every discovered screen
 * has a dom-capture-backed IrScreen, every transition cites recorded
 * evidence, ≥6 journeys each validateJourney-clean AND each REPLAYABLE via
 * replayJourney against a FRESH fixture server instance — exploration
 * output is executable later.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { buildBundle, loadRunFromStores, RecordingSession } from '@clapp/evidence';
import type { EvidenceBundle } from '@clapp/evidence';
import {
  createDomApplier,
  replayJourney,
  resolveFixtureRoot,
  startFixtureServer,
  validateJourney,
} from '@clapp/journey';
import { MemoryArtifactStore, MemoryRunStore } from '@clapp/store';
import type { ArtifactStore, RunStore } from '@clapp/store';
import { createExplorationPolicy, explore } from '../src/index';
import type { ExploreResult } from '../src/index';
import type { IrModel } from '../src/ir-contract';

const SEED = 20260925;
const FULL_BUDGET = {
  entrypoints: ['/'],
  maxSteps: 120,
  maxScreens: 12,
  maxActionsPerScreen: 8,
  seed: SEED,
};

const EXPECTED_ROUTES = [
  '/',
  '/contact',
  '/contact-success',
  '/features',
  '/newsletter-success',
  '/pricing',
];

const APPLICATION = {
  id: 'app_b01-static-exploration',
  name: 'b01-static',
  platform: 'web' as const,
  entrypoints: ['/'],
};

interface Harness {
  result: ExploreResult;
  stores: { runStore: RunStore; artifactStore: ArtifactStore };
  session: RecordingSession;
}

let server: Awaited<ReturnType<typeof startFixtureServer>>;
let harness: Harness;

beforeAll(async () => {
  server = await startFixtureServer({ root: resolveFixtureRoot() });
  const stores = { runStore: new MemoryRunStore(), artifactStore: new MemoryArtifactStore() };
  const session = await RecordingSession.start(stores, {
    targetId: 'bench/b01-static',
    environment: { engine: 'bun', explorer: '@clapp/explore' },
  });
  const result = await explore({
    baseUrl: server.url,
    applier: createDomApplier({ baseUrl: server.url }),
    recorder: session,
    policy: createExplorationPolicy(FULL_BUDGET),
    application: APPLICATION,
  });
  harness = { result, stores, session };
}, 60_000);

afterAll(async () => {
  await server.close();
});

/** Route of a screen id inside the model. */
function routeOfScreenId(model: IrModel, screenId: string): string {
  const screen = model.screens.find((candidate) => candidate.id === screenId);
  if (screen === undefined) throw new Error(`no screen ${screenId}`);
  return screen.route;
}

describe('explorer — b01 full coverage', () => {
  it('reaches ALL 6 corpus routes from "/" (forms included)', () => {
    const { report } = harness.result;
    expect([...report.screensVisited].sort()).toEqual(EXPECTED_ROUTES);
    // contact-success + newsletter-success REQUIRE form submissions — plain
    // link navigation cannot reach them.
    expect(report.screensVisited).toContain('/contact-success');
    expect(report.screensVisited).toContain('/newsletter-success');
  });

  it('completes naturally within the budget (no budget stops)', () => {
    const { report } = harness.result;
    expect(report.budgetStops).toEqual([]);
    expect(report.frontierExhausted).toBe(true);
    expect(report.actionsSkipped).toBe(0); // every probe/apply resolved
    expect(report.actionsApplied).toBeGreaterThan(10);
    expect(report.stepsUsed).toBeLessThanOrEqual(FULL_BUDGET.maxSteps);
    expect(report.stepsUsed).toBe(
      harness.result.model.evidence.filter((entry) => entry.ref.kind === 'user').length,
    );
  });

  it('every discovered screen has a dom-capture-backed IrScreen', () => {
    const { model, report } = harness.result;
    expect(model.screens.map((screen) => screen.route).sort()).toEqual(EXPECTED_ROUTES);
    const refIds = new Set(model.evidence.map((entry) => entry.ref.evidenceId));
    for (const screen of model.screens) {
      expect(screen.treeRef).toBeDefined();
      if (screen.treeRef === undefined) continue;
      expect(screen.treeRef.kind).toBe('dom');
      expect(refIds.has(screen.treeRef.evidenceId)).toBe(true);
      expect(screen.provenance.level).toBe('derived');
      expect(screen.provenance.confidence.evidenceRefs.length).toBeGreaterThan(0);
    }
    // one dom capture per visited screen, exactly
    const domCaptures = model.evidence.filter((entry) => entry.ref.kind === 'dom');
    expect(domCaptures).toHaveLength(report.screensVisited.length);
  });

  it('every transition cites at least one recorded ref and maps real edges', () => {
    const { model } = harness.result;
    expect(model.state.transitions.length).toBeGreaterThanOrEqual(6);
    const refIds = new Set(model.evidence.map((entry) => entry.ref.evidenceId));
    for (const transition of model.state.transitions) {
      expect(transition.provenance.confidence.evidenceRefs.length).toBeGreaterThan(0);
      for (const ref of transition.provenance.confidence.evidenceRefs) {
        expect(refIds.has(ref.evidenceId)).toBe(true);
      }
      expect(transition.trigger.type).toBe('action');
      expect(transition.fromScreenId).not.toBe(transition.toScreenId); // no self-transitions in b01
    }
    // The contact form submission edge exists with the honest side effect.
    // NOTE (hand-verified for this seed): the policy exhausted the seeded
    // button order on /contact before clicking the contact submit — the
    // click happens after a BACKTRACK, whose replay is the recorded journey
    // PREFIX of /contact ([navigate /contact]) — fills from the earlier
    // visit are not part of that prefix, so the submitted parameters are
    // honestly empty. Fills flowing into submits is pinned below on the
    // index → newsletter-success edge, which happens on the first visit.
    const contactSubmit = model.state.transitions.find(
      (transition) =>
        routeOfScreenId(model, transition.fromScreenId) === '/contact' &&
        routeOfScreenId(model, transition.toScreenId) === '/contact-success',
    );
    expect(contactSubmit).toBeDefined();
    expect(contactSubmit?.sideEffects).toEqual(['submits form contact-form']);
    expect(contactSubmit?.trigger).toEqual({ type: 'action', action: 'click' });
    expect(contactSubmit?.input).toEqual({
      name: '',
      email: '',
      topic: 'general',
      message: '',
    });
    // The newsletter submission from the INDEX carries the filled probe value
    // (fill-class candidates run before click-class ones on a fresh visit).
    const newsletterSubmit = model.state.transitions.find(
      (transition) =>
        routeOfScreenId(model, transition.fromScreenId) === '/' &&
        routeOfScreenId(model, transition.toScreenId) === '/newsletter-success',
    );
    expect(newsletterSubmit).toBeDefined();
    expect(newsletterSubmit?.input).toEqual({ email: 'explorer@example.com' });
    expect(newsletterSubmit?.sideEffects).toEqual(['submits form html>body>footer>form']);
  });

  it('emits components from walker actionables with applier-executable events', () => {
    const { model } = harness.result;
    expect(model.components.length).toBeGreaterThan(30);
    const contactScreen = model.screens.find((screen) => screen.route === '/contact');
    expect(contactScreen).toBeDefined();
    const contactComponents = model.components.filter(
      (component) => component.screenId === contactScreen?.id,
    );
    const roles = contactComponents.map((component) => component.role);
    expect(roles).toContain('form');
    expect(roles).toContain('combobox'); // the topic select is listed...
    expect(roles).toContain('textbox');
    expect(roles).toContain('button');
    // ...but its events list is empty — the applier has no verb for it.
    const topic = contactComponents.find((component) => component.role === 'combobox');
    expect(topic?.events).toEqual([]);
    const message = contactComponents.find(
      (component) => component.properties['name'] === 'Message',
    );
    expect(message?.events).toEqual(['fill']);
  });
});

describe('explorer — journeys are executable later', () => {
  it('produces ≥6 journeys, one per discovered screen, all validateJourney-clean', () => {
    const { journeys, report } = harness.result;
    expect(journeys.length).toBeGreaterThanOrEqual(6);
    expect(journeys.length).toBe(report.screensVisited.length);
    for (const journey of journeys) {
      expect(validateJourney(journey)).toBe(true);
      expect(journey.actions.length).toBeGreaterThan(0);
      expect(journey.actions[0]?.type).toBe('navigate'); // self-contained replays
    }
  });

  it('every journey REPLAYS via replayJourney against a FRESH fixture server', async () => {
    const { journeys } = harness.result;
    for (const journey of journeys) {
      const fresh = await startFixtureServer({ root: resolveFixtureRoot() });
      try {
        const summary = await replayJourney(journey, createDomApplier({ baseUrl: fresh.url }));
        expect(summary.journeyId).toBe(journey.id);
        expect(summary.actionsApplied).toBe(journey.actions.length);
      } finally {
        await fresh.close();
      }
    }
  }, 120_000);

  it('IrJourney summaries cite the user captures of their actions', () => {
    const { model } = harness.result;
    const refIds = new Set(model.evidence.map((entry) => entry.ref.evidenceId));
    expect(model.journeys.length).toBeGreaterThanOrEqual(6);
    for (const journey of model.journeys) {
      expect(journey.purpose).toMatch(/^reach \//);
      expect(journey.steps.length).toBeGreaterThan(0);
      expect(journey.preconditions).toEqual([]);
      expect(journey.provenance.confidence.evidenceRefs.length).toBeGreaterThan(0);
      for (const ref of journey.provenance.confidence.evidenceRefs) {
        expect(refIds.has(ref.evidenceId)).toBe(true);
        expect(ref.kind).toBe('user');
      }
    }
  });
});

describe('explorer — evidence discipline', () => {
  it('records dom/user/storage captures and every model citation resolves', async () => {
    const { result, stores, session } = harness;
    const kinds = new Map(result.model.evidence.map((entry) => [entry.ref.evidenceId, entry.ref.kind]));
    expect([...kinds.values()].filter((kind) => kind === 'dom')).toHaveLength(6);
    expect([...kinds.values()].filter((kind) => kind === 'user').length).toBeGreaterThan(20);
    // storage inventories were recorded after form submissions (honestly empty)
    expect([...kinds.values()].filter((kind) => kind === 'storage').length).toBeGreaterThanOrEqual(2);
    // ExploreResult.refs is the recorder's flush(): everything the run emitted
    expect(result.refs).toEqual(await session.flush());
    // zero fabricated refs: every ref is backed by a persisted artifact
    for (const ref of result.refs) {
      const record = await stores.artifactStore.getBySha256(ref.sha256, session.runId);
      expect(record).not.toBeNull();
      expect(record?.kind).toBe(
        ref.kind === 'dom' ? 'dom-snapshot' : ref.kind === 'user' ? 'user' : 'storage',
      );
    }
  });

  it('user captures carry the action + outcome pairs (read back from the store)', async () => {
    const { result, stores, session } = harness;
    const outcomes = new Map<string, number>();
    let sawFill = false;
    let sawSubmitClick = false;
    for (const entry of result.model.evidence) {
      if (entry.ref.kind !== 'user') continue;
      const record = await stores.artifactStore.getBySha256(entry.ref.sha256, session.runId);
      expect(record).not.toBeNull();
      if (record === null) continue;
      const bytes = await stores.artifactStore.readBytes(record.id);
      expect(bytes).not.toBeNull();
      const capture = JSON.parse(new TextDecoder().decode(bytes as Uint8Array)) as {
        kind: string;
        payload: { subkind: string; action: { type: string }; outcome: string };
      };
      expect(capture.kind).toBe('user');
      expect(capture.payload.subkind).toBe('action');
      outcomes.set(capture.payload.outcome, (outcomes.get(capture.payload.outcome) ?? 0) + 1);
      if (capture.payload.action.type === 'fill') sawFill = true;
      if (capture.payload.action.type === 'click' && capture.payload.outcome === 'applied') {
        sawSubmitClick = true;
      }
    }
    expect(outcomes.get('applied')).toBeGreaterThan(20);
    expect(outcomes.get('assert-failed') ?? 0).toBe(0);
    expect(outcomes.get('skipped') ?? 0).toBe(0);
    expect(sawFill).toBe(true);
    expect(sawSubmitClick).toBe(true);
  });

  it('seals into a tamper-evident EvidenceBundle whose evidence covers the model', async () => {
    const { result, stores, session } = harness;
    const loaded = await loadRunFromStores(stores, session.runId);
    expect(loaded).not.toBeNull();
    const bundle: EvidenceBundle = await buildBundle(loaded as NonNullable<typeof loaded>);
    expect(bundle.rootHash).toMatch(/^[0-9a-f]{64}$/);
    const bundledIds = new Set(bundle.manifest.evidence.map((ref) => ref.evidenceId));
    for (const ref of result.refs) {
      expect(bundledIds.has(ref.evidenceId)).toBe(true);
    }
  });
});

describe('explorer — budget honesty (maxScreens 2)', () => {
  it(
    'stops cleanly at the screen budget with populated budgetStops and zero fabricated refs',
    async () => {
      const stores = {
        runStore: new MemoryRunStore(),
        artifactStore: new MemoryArtifactStore(),
      };
      const session = await RecordingSession.start(stores, { targetId: 'bench/b01-static' });
      const result = await explore({
        baseUrl: server.url,
        applier: createDomApplier({ baseUrl: server.url }),
        recorder: session,
        policy: createExplorationPolicy({
          entrypoints: ['/'],
          maxSteps: 120,
          maxScreens: 2,
          maxActionsPerScreen: 8,
          seed: SEED,
        }),
        application: APPLICATION,
      });
      const { report } = result;
      expect(report.screensVisited.length).toBe(2); // never exceeds the budget
      expect(report.budgetStops).toEqual(['max-screens']);
      expect(report.frontierExhausted).toBe(false); // work remained, budget stopped it
      expect(report.screensVisited).toEqual(['/', '/newsletter-success']);
      // Zero fabrication: every cited ref resolves into the run's own refs,
      // and every ref is a persisted artifact of this session.
      const ownIds = new Set(result.refs.map((ref) => ref.evidenceId));
      expect(ownIds.size).toBe(result.refs.length); // no duplicate fabrication either
      const modelIds = new Set(result.model.evidence.map((entry) => entry.ref.evidenceId));
      for (const id of modelIds) {
        expect(ownIds.has(id)).toBe(true);
      }
      for (const screen of result.model.screens) {
        expect(screen.treeRef).toBeDefined();
        if (screen.treeRef !== undefined) expect(ownIds.has(screen.treeRef.evidenceId)).toBe(true);
      }
      for (const transition of result.model.state.transitions) {
        expect(transition.provenance.confidence.evidenceRefs.length).toBeGreaterThan(0);
        for (const ref of transition.provenance.confidence.evidenceRefs) {
          expect(ownIds.has(ref.evidenceId)).toBe(true);
        }
      }
    },
    60_000,
  );
});
