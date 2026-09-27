/**
 * @clapp/diff tests — THE KILLER ACCEPTANCE + negative controls (CLAPP-040).
 *
 * KILLER ACCEPTANCE: the b01-shaped golden plan (src/golden-plan.ts — this
 * package's own fixture, same corpus truth as @clapp/journey's frozen
 * fixtures) is generated into a candidate app (@clapp/codegen), its server
 * spawned (ephemeral port, manifest health path), and the LEFT side is the
 * real b01 fixture corpus (startFixtureServer). For EVERY one of the four
 * seeded b01 journey records: runPair + diff + report must show BOTH sides
 * completing every action with zero errors, ZERO critical findings, and an
 * 'equivalent' verdict. The golden pair is full-fidelity on every compared
 * group, so the honest total finding count is zero — asserted as the
 * stronger claim it is.
 *
 * NEGATIVE CONTROLS (a differ that always says equivalent is worthless):
 * 1. mutate one generated route's heading text before starting the server
 *    → ≥1 semantic finding with severity critical/major, dimension
 *    'semantic', expected/actual carrying the left/right texts, anchors
 *    citing BOTH sides' evidence refs, verdict 'divergent';
 * 2. drop the asserted data-testid from a generated page → ≥1 critical
 *    finding anchored to the page-capture step;
 * 3. drop a NON-asserted data-testid → both sides still complete, but a
 *    minor finding catches the silent divergence (the differ is not merely
 *    replay-failure detection).
 * The positive assertions above are NEVER weakened to make these pass.
 *
 * Resource discipline: one SHARED left fixture server per file; every
 * spawned candidate is closed inside its own test (nothing accumulates) —
 * the battery runs alongside the sibling packages' e2e tests.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateApp, writeApp } from '@clapp/codegen';
import { resolveFixtureRoot, startFixtureServer, type FixtureServer } from '@clapp/journey';
import { createPairedRunner } from './paired-runner';
import { createDeterministicDiffIdFactory } from './ids';
import { serializeDiffReport } from './report';
import {
  GOLDEN_CANDIDATE_APP_ID,
  b01CorpusRootHash,
  buildGoldenB01Plan,
  loadSeededB01Journeys,
} from './golden-plan';
import { mutateGeneratedFile, spawnCandidate } from './test-support';
import type { Journey } from '@clapp/journey';
import type { PairedRunner } from './diff-contract';

const FIXED_NOW = () => new Date('2026-09-27T00:00:00.000Z');

const scratchDirs: string[] = [];
let leftServer: FixtureServer | undefined;

afterAll(async () => {
  await leftServer?.close().catch(() => undefined);
  for (const dir of scratchDirs) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

interface Harness {
  runner: PairedRunner;
  journeys: Journey[];
  close: () => Promise<void>;
}

/** Builds a harness against the SHARED left server; caller MUST close(). */
async function buildHarness(mutations: Array<[file: string, replacements: Array<[string, string]>]> = []): Promise<Harness> {
  if (leftServer === undefined) {
    leftServer = await startFixtureServer({ root: resolveFixtureRoot() });
  }
  const [plan, journeys, baselineRootHash] = await Promise.all([
    buildGoldenB01Plan(),
    loadSeededB01Journeys(),
    b01CorpusRootHash(),
  ]);
  const app = generateApp(plan);
  const dir = await mkdtemp(join(tmpdir(), 'clapp-040-runner-'));
  scratchDirs.push(dir);
  const root = await writeApp(app, dir);
  for (const [file, replacements] of mutations) {
    await mutateGeneratedFile(root, file, replacements);
  }
  const candidate = await spawnCandidate(root, app.manifest);
  const runner = createPairedRunner({
    journeys,
    left: { side: 'left', baseUrl: leftServer.url, targetId: 'bench/b01-static', driver: 'replayer-dom' },
    right: { side: 'right', baseUrl: candidate.url, targetId: GOLDEN_CANDIDATE_APP_ID, driver: 'replayer-dom' },
    candidateAppId: GOLDEN_CANDIDATE_APP_ID,
    baselineRootHash,
    plan,
    ids: createDeterministicDiffIdFactory(),
    now: FIXED_NOW,
  });
  return {
    runner,
    journeys,
    close: async () => {
      await candidate.close().catch(() => undefined);
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}

describe('killer acceptance — every seeded b01 journey pairs clean, golden plan ⇒ equivalent', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await buildHarness();
  }, 60_000);
  afterAll(async () => {
    await harness?.close();
  });

  it(
    'runPair + diff + report for EVERY seeded journey: both sides complete, zero critical, verdict equivalent',
    async () => {
      expect(harness.journeys.length).toBe(4);
      const runs = [];
      for (const journey of harness.journeys) {
        const run = await harness.runner.runPair(journey.id);
        runs.push(run);

        // BOTH sides complete: full step count, zero errors.
        expect(run.journeyId).toBe(journey.id);
        expect(run.runs.left.completed).toBe(true);
        expect(run.runs.right.completed).toBe(true);
        expect(run.runs.left.stepsCompleted).toBe(journey.actions.length);
        expect(run.runs.right.stepsCompleted).toBe(journey.actions.length);
        expect('failure' in run.runs.left).toBe(false);
        expect('failure' in run.runs.right).toBe(false);
        expect(run.runs.left.stepPageIds.length).toBe(journey.actions.length);
        expect(run.runs.right.stepPageIds.length).toBe(journey.actions.length);

        // Captures exist on both sides at the navigation steps.
        for (const [index, action] of journey.actions.entries()) {
          if (action.type === 'navigate') {
            expect(run.runs.left.stepPageIds[index]).toBeDefined();
            expect(run.runs.right.stepPageIds[index]).toBeDefined();
          }
        }

        const findings = await harness.runner.diff(run);
        expect(findings.filter((finding) => finding.severity === 'critical')).toEqual([]);
        // The golden pair is full-fidelity: the honest TOTAL is zero too.
        expect(findings).toEqual([]);
      }

      const report = await harness.runner.report(runs);
      expect(report.verdict).toBe('equivalent');
      expect(report.counts).toEqual({ critical: 0, major: 0, minor: 0, info: 0 });
      expect(report.candidateAppId).toBe(GOLDEN_CANDIDATE_APP_ID);
      expect(report.runs.length).toBe(4);
      // The report is contract-valid and canonically serializable.
      expect(() => serializeDiffReport(report)).not.toThrow();
    },
    60_000,
  );
});

describe('negative control 1 — mutated heading text ⇒ divergent with a semantic finding', () => {
  it(
    'the pricing heading mutation yields a critical semantic finding carrying the left/right texts with both sides cited',
    async () => {
      const harness = await buildHarness([
        ['pages/pricing.html.ts', [['Simple, honest pricing', 'Simple, honest pricing!']]],
      ]);
      try {
        const navJourney = harness.journeys.find((journey) => journey.name.includes('navigation'));
        expect(navJourney).toBeDefined();

        const run = await harness.runner.runPair(navJourney!.id);
        // The right side honestly fails the mutated heading's assert (step 5).
        expect(run.runs.left.completed).toBe(true);
        expect(run.runs.right.completed).toBe(false);
        expect(run.runs.right.stepsCompleted).toBe(5);
        expect(run.runs.right.failure).toContain('target-not-found');

        const findings = await harness.runner.diff(run);
        const semantic = findings.filter((finding) => finding.dimension === 'semantic');
        expect(semantic.length).toBeGreaterThan(0);

        // ≥1 semantic finding with severity critical|major, expected/actual
        // carrying the left/right texts, anchors citing BOTH sides.
        const headingFinding = semantic.find(
          (finding) =>
            (finding.severity === 'critical' || finding.severity === 'major') &&
            finding.expected !== undefined &&
            finding.actual !== undefined,
        );
        expect(headingFinding).toBeDefined();
        const expected = headingFinding!.expected as { level: number; text: string };
        const actual = headingFinding!.actual as { level: number; text: string };
        expect(expected.text).toBe('Simple, honest pricing');
        expect(actual.text).toBe('Simple, honest pricing!');
        expect(headingFinding!.anchors.length).toBeGreaterThan(0);
        expect(headingFinding!.anchors[0]!.leftEvidence).toBeDefined();
        expect(headingFinding!.anchors[0]!.rightEvidence).toBeDefined();
        // Plan anchoring: the finding cites the pricing route/page ids.
        expect(headingFinding!.anchors[0]!.sourceIds.length).toBeGreaterThan(0);

        // The candidate contradicted the journey postcondition: critical.
        expect(findings.some((finding) => finding.severity === 'critical' && finding.dimension === 'semantic')).toBe(true);

        const report = await harness.runner.report([run]);
        expect(report.verdict).toBe('divergent');
        expect(report.counts.critical).toBeGreaterThanOrEqual(1);
        expect(() => serializeDiffReport(report)).not.toThrow();
      } finally {
        await harness.close();
      }
    },
    60_000,
  );
});

describe('negative control 2 — dropped asserted data-testid ⇒ critical finding anchored to the step', () => {
  it(
    'removing data-testid="contact-success" yields findings anchored to the contact-success capture step',
    async () => {
      const harness = await buildHarness([
        ['pages/contact-success.html.ts', [[' data-testid="contact-success"', '']]],
      ]);
      try {
        const contactJourney = harness.journeys.find((journey) => journey.name.includes('contact'));
        expect(contactJourney).toBeDefined();

        const run = await harness.runner.runPair(contactJourney!.id);
        expect(run.runs.left.completed).toBe(true);
        expect(run.runs.right.completed).toBe(false);
        expect(run.runs.right.stepsCompleted).toBe(6);

        const findings = await harness.runner.diff(run);
        // The submit step (5) captured contact-success on both sides — the
        // testid divergence is anchored there, citing both sides' evidence.
        const testidFinding = findings.find(
          (finding) =>
            finding.dimension === 'semantic' &&
            Array.isArray(finding.expected) &&
            (finding.expected as string[]).includes('contact-success'),
        );
        expect(testidFinding).toBeDefined();
        expect(testidFinding!.severity).toBe('critical');
        expect(testidFinding!.anchors[0]!.stepIndex).toBe(5);
        expect(testidFinding!.anchors[0]!.leftEvidence).toBeDefined();
        expect(testidFinding!.anchors[0]!.rightEvidence).toBeDefined();

        const report = await harness.runner.report([run]);
        expect(report.verdict).toBe('divergent');
      } finally {
        await harness.close();
      }
    },
    60_000,
  );
});

describe('negative control 3 — dropped NON-asserted data-testid ⇒ silent divergence still caught', () => {
  it(
    'removing data-testid="cta-explore-features" keeps both sides completing but produces a minor finding',
    async () => {
      const harness = await buildHarness([
        ['pages/index.html.ts', [[' data-testid="cta-explore-features"', '']]],
      ]);
      try {
        const navJourney = harness.journeys.find((journey) => journey.name.includes('navigation'));
        expect(navJourney).toBeDefined();

        const run = await harness.runner.runPair(navJourney!.id);
        // No journey targets this testid: both sides still complete — the
        // differ must catch the divergence WITHOUT a replay failure.
        expect(run.runs.left.completed).toBe(true);
        expect(run.runs.right.completed).toBe(true);

        const findings = await harness.runner.diff(run);
        const testidFindings = findings.filter(
          (finding) =>
            finding.dimension === 'semantic' &&
            Array.isArray(finding.expected) &&
            (finding.expected as string[]).includes('cta-explore-features'),
        );
        expect(testidFindings.length).toBeGreaterThan(0);
        expect(testidFindings[0]!.severity).toBe('minor');
        // Anchored at the home capture step (0) with both sides cited.
        expect(testidFindings[0]!.anchors[0]!.stepIndex).toBe(0);
        expect(testidFindings[0]!.anchors[0]!.leftEvidence).toBeDefined();
        expect(testidFindings[0]!.anchors[0]!.rightEvidence).toBeDefined();

        // Honest severity: no critical, verdict stays equivalent.
        const report = await harness.runner.report([run]);
        expect(report.verdict).toBe('equivalent');
        expect(report.counts.critical).toBe(0);
        expect(report.counts.minor).toBeGreaterThan(0);
      } finally {
        await harness.close();
      }
    },
    60_000,
  );
});
