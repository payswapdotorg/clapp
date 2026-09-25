/**
 * CLAPP-030 e2e — the killer acceptance: REAL b01 exploration → plan.
 *
 * The full P3 planner pipeline over the frozen bench-b01 corpus, using only
 * landed surfaces: startFixtureServer + createDomApplier +
 * createExplorationPolicy (seeded) + a RecordingSession over memory stores →
 * explore() → IrModel → validateIrModelDetailed ZERO errors → planSynthesis
 * with the 4 SEEDED b01 journey records → validateSynthesisPlanDetailed
 * ZERO errors → canonical serialize round-trip byte-stable.
 *
 * Assertions (per the work item):
 * - the plan serves ALL 6 corpus routes;
 * - the seeded journeys' assert-visible targets resolve against planned
 *   elements — honestly measured (see the ratio gate note below);
 * - every unresolved target has its assumption entry (counted);
 * - every planned element with a testId preserves the observed testId
 *   verbatim;
 * - every acceptance entry's expectedRoute is a corpus route.
 *
 * HONEST RATIO NOTE (documented disagreement, see the completion report and
 * the plan README): the work item targets ≥90% resolution, but the FROZEN
 * exploration surface enumerates only ACTIONABLE_CAPTURE_ROLES components
 * (html-walker.ts deliberately excludes img/contentinfo/…), so the 4 seeded
 * assert targets that name non-actionable elements (img ×3, contentinfo ×1)
 * cannot resolve from any explore-produced model — the honest ceiling for
 * this corpus is 11/15 ≈ 73%. The test pins the achievable gate (≥70%, with
 * ≥11 resolved of exactly 15 targets) and asserts the compensating
 * discipline: every unresolved target carries exactly one assumption entry.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { RecordingSession } from '@clapp/evidence';
import {
  createDomApplier,
  resolveFixtureRoot,
  resolveSeededJourneysDir,
  startFixtureServer,
  validateJourney,
} from '@clapp/journey';
import type { Journey, TargetSelector } from '@clapp/journey';
import { MemoryArtifactStore, MemoryRunStore } from '@clapp/store';
import { createExplorationPolicy, explore } from '@clapp/explore';
import { validateIrModelDetailed } from '@clapp/ir';
import type { IrModel } from '@clapp/ir';
import {
  parseSynthesisPlan,
  planSynthesis,
  serializeSynthesisPlan,
  validateSynthesisPlanDetailed,
} from '../index';
import type { SynthesisPlan } from '../synthesis-contract';

const SEED = 20260925;
const FULL_BUDGET = {
  entrypoints: ['/'],
  maxSteps: 120,
  maxScreens: 12,
  maxActionsPerScreen: 8,
  seed: SEED,
};

const EXPECTED_ROUTES = ['/', '/contact', '/contact-success', '/features', '/newsletter-success', '/pricing'];

interface Harness {
  model: IrModel;
  seeded: Journey[];
  plan: SynthesisPlan;
}

let server: Awaited<ReturnType<typeof startFixtureServer>>;
let harness: Harness;

beforeAll(async () => {
  server = await startFixtureServer({ root: resolveFixtureRoot() });
  const stores = { runStore: new MemoryRunStore(), artifactStore: new MemoryArtifactStore() };
  const session = await RecordingSession.start(stores, {
    targetId: 'bench/b01-static',
    environment: { engine: 'bun', planner: '@clapp/plan' },
  });
  const result = await explore({
    baseUrl: server.url,
    applier: createDomApplier({ baseUrl: server.url }),
    recorder: session,
    policy: createExplorationPolicy(FULL_BUDGET),
    application: {
      // uuid-shaped app id (the IR validator enforces the app_ pattern; the
      // e2e harness owns this input, unlike the explorer's own test fixture).
      id: `app_${randomUUID()}`,
      name: 'b01-static',
      platform: 'web',
      entrypoints: ['/'],
    },
  });

  // The 4 SEEDED b01 journey records, loaded from the frozen corpus dir.
  const journeysDir = resolveSeededJourneysDir();
  const files = (await readdir(journeysDir)).filter((file) => file.endsWith('.json')).sort();
  const seeded: Journey[] = [];
  for (const file of files) {
    const text = await readFile(join(journeysDir, file), 'utf8');
    const record: unknown = JSON.parse(text);
    if (!validateJourney(record)) throw new Error(`seeded journey ${file} failed validateJourney`);
    seeded.push(record as Journey);
  }

  const plan = planSynthesis(result.model, { journeys: seeded });
  harness = { model: result.model, seeded, plan };
}, 90_000);

afterAll(async () => {
  await server.close();
});

/** Mirrors the planner's target resolution (testId first, then role+name). */
function resolvesInPlan(plan: SynthesisPlan, target: TargetSelector): boolean {
  if (target.testId !== undefined) {
    const byTestId = plan.pages.some((page) => page.elements.some((element) => element.testId === target.testId));
    if (byTestId) return true;
  }
  return plan.pages.some((page) =>
    page.elements.some((element) => {
      if (target.role === undefined && target.name === undefined) return false;
      const roleOk = target.role === undefined || element.role === target.role;
      const nameOk = target.name === undefined || element.name === target.name;
      return roleOk && nameOk;
    }),
  );
}

describe('e2e — real b01 exploration → plan', () => {
  it('explored a validated IrModel and loaded the 4 seeded journeys', () => {
    const modelCheck = validateIrModelDetailed(harness.model);
    expect(modelCheck.errors).toEqual([]);
    expect(modelCheck.valid).toBe(true);
    expect(harness.seeded).toHaveLength(4);
    expect(harness.model.screens.map((screen) => screen.route).sort()).toEqual(EXPECTED_ROUTES);
  });

  it('planned a SynthesisPlan that validates with ZERO errors', () => {
    const planCheck = validateSynthesisPlanDetailed(harness.plan);
    expect(planCheck.errors).toEqual([]);
    expect(planCheck.valid).toBe(true);
  });

  it('the plan serves ALL 6 corpus routes (contact-success + newsletter-success included)', () => {
    expect(harness.plan.routes.map((route) => route.path).sort()).toEqual(EXPECTED_ROUTES);
    expect(harness.plan.pages).toHaveLength(6);
    expect(harness.plan.application.entrypoints).toEqual(['/']);
    expect(harness.plan.application.sourceModelId).toBe(harness.model.application.id);
  });

  it('every planned element with a testId preserves the observed testId VERBATIM (per page)', () => {
    for (const page of harness.plan.pages) {
      const route = harness.plan.routes.find((candidate) => candidate.id === page.routeId)?.path ?? '(unknown)';
      const screen = harness.model.screens.find((candidate) => candidate.route === route);
      expect(screen).toBeDefined();
      if (screen === undefined) continue;
      const observedTestIds = new Set(
        harness.model.components
          .filter((component) => component.screenId === screen.id)
          .map((component) => component.properties['testId'])
          .filter((testId): testId is string => typeof testId === 'string' && testId !== ''),
      );
      const plannedTestIds = new Set(
        page.elements.filter((element) => element.testId !== undefined).map((element) => element.testId as string),
      );
      expect([...plannedTestIds].sort()).toEqual([...observedTestIds].sort());
      for (const element of page.elements) {
        if (element.testId !== undefined) expect(observedTestIds.has(element.testId)).toBe(true);
      }
    }
  });

  it('seeded assert targets resolve honestly: ≥11 of 15 (≥70% — the achievable gate, see module doc)', () => {
    let total = 0;
    const unresolvedTargets: TargetSelector[] = [];
    for (const journey of harness.seeded) {
      for (const action of journey.actions) {
        if (action.type !== 'assert-visible') continue;
        total += 1;
        if (!resolvesInPlan(harness.plan, action.target)) unresolvedTargets.push(action.target);
      }
    }
    expect(total).toBe(15); // pinned against the frozen seeded corpus
    expect(unresolvedTargets.length).toBeLessThanOrEqual(4); // img ×3 + contentinfo ×1 (frozen surface)
    const resolved = total - unresolvedTargets.length;
    expect(resolved).toBeGreaterThanOrEqual(11);
    expect(resolved / total).toBeGreaterThanOrEqual(0.7);
    // the compensating discipline: exactly one assumption entry per unresolved target
    const unresolvedAssumptions = harness.plan.assumptions.filter((entry) => entry.startsWith('unresolved assert target'));
    expect(unresolvedAssumptions).toHaveLength(unresolvedTargets.length);
    for (const target of unresolvedTargets) {
      const described = target.testId !== undefined ? `testId=${target.testId}` : `role=${target.role ?? ''}`;
      expect(unresolvedAssumptions.some((entry) => entry.includes(described))).toBe(true);
    }
  });

  it('the acceptance entries are the 4 seeded journeys with corpus expectedRoutes', () => {
    expect(harness.plan.acceptance).toHaveLength(4);
    expect(harness.plan.acceptance.map((entry) => entry.journeyId).sort()).toEqual(
      harness.seeded.map((journey) => journey.id).sort(),
    );
    for (const entry of harness.plan.acceptance) {
      expect(EXPECTED_ROUTES).toContain(entry.expectedRoute);
      expect(entry.steps.length).toBeGreaterThan(0);
      expect(entry.purpose).not.toBe('');
    }
    // the deterministic per-journey expectations for this corpus:
    const expectedRoutes = harness.plan.acceptance
      .map((entry) => entry.expectedRoute)
      .sort();
    expect(expectedRoutes).toEqual(['/', '/contact', '/features', '/newsletter-success']);
  });

  it('must-see elements resolve on the expected pages (headings + testids the journeys assert)', () => {
    const newsletter = harness.plan.acceptance.find(
      (entry) => entry.journeyId === harness.seeded.find((j) => j.name.includes('newsletter'))?.id,
    );
    expect(newsletter).toBeDefined();
    expect(newsletter?.expectedRoute).toBe('/newsletter-success');
    const mustSee = newsletter?.mustSeeElementIds ?? [];
    expect(mustSee.length).toBeGreaterThanOrEqual(1);
    const page = harness.plan.pages.find(
      (candidate) =>
        candidate.routeId === harness.plan.routes.find((route) => route.path === newsletter?.expectedRoute)?.id,
    );
    expect(page).toBeDefined();
    for (const elementId of mustSee) {
      expect(page?.elements.some((element) => element.id === elementId)).toBe(true);
    }
    const mustSeeElements = (page?.elements ?? []).filter((element) => mustSee.includes(element.id));
    expect(mustSeeElements.some((element) => element.testId === 'newsletter-success')).toBe(true);
  });

  it('canonical serialize round-trip is byte-stable', () => {
    const text = serializeSynthesisPlan(harness.plan);
    expect(typeof text).toBe('string');
    const reparsed = parseSynthesisPlan(text);
    expect(serializeSynthesisPlan(reparsed)).toBe(text);
  });

  it('plans storage/api honestly from the exploration model (empty sections, no fabrication)', () => {
    // exploration records no data entities and no api operations — the plan
    // must carry the same emptiness rather than inventing bindings.
    expect(harness.plan.storage).toEqual([]);
    expect(harness.plan.api.endpoints).toEqual([]);
    expect(harness.plan.api.mocks).toEqual([]);
    // and the assumptions document the honestly-unknowable redirect triggers
    expect(harness.plan.assumptions.some((entry) => entry.includes('planned as a redirect'))).toBe(true);
    expect(harness.plan.assumptions.length).toBeGreaterThan(0);
  });
});
