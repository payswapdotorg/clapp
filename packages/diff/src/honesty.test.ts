/**
 * @clapp/diff tests — honesty: adapter disclosure, absence semantics,
 * foreign-run degradation, and options validation (CLAPP-040).
 *
 * - DIFF_ADAPTER_INFO describes the per-driver capture capabilities and
 *   the deliberate limits (the ls/ss rule, the visual/network/repair
 *   ownership boundaries);
 * - absent stepPageIds entries are ABSENT (undefined in memory), never
 *   null, and survive the canonical round-trip;
 * - diff() on a hand-constructed PairedRun (no captures) yields
 *   run-integrity findings only — no page comparison is invented;
 * - createPairedRunner validates its options honestly (DiffRunnerError
 *   with a clear message, never a silent guess).
 */

import { afterAll, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateApp, writeApp } from '@clapp/codegen';
import { resolveFixtureRoot, startFixtureServer, type FixtureServer } from '@clapp/journey';
import { validateSynthesisPlanDetailed } from '@clapp/plan';
import { createPairedRunner, DiffRunnerError } from './paired-runner';
import { createDeterministicDiffIdFactory } from './ids';
import { DIFF_ADAPTER_INFO } from './adapter-info';
import { serializeDiffReport } from './report';
import {
  GOLDEN_CANDIDATE_APP_ID,
  b01CorpusRootHash,
  buildGoldenB01Plan,
  loadSeededB01Journeys,
} from './golden-plan';
import { spawnCandidate } from './test-support';
import type { DiffReport, PairedRun } from './diff-contract';

const FIXED_NOW = () => new Date('2026-09-27T00:00:00.000Z');

const scratchDirs: string[] = [];
let leftServer: FixtureServer | undefined;

afterAll(async () => {
  await leftServer?.close().catch(() => undefined);
  for (const dir of scratchDirs) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

describe('DIFF_ADAPTER_INFO — the honesty summary', () => {
  it('declares the owned dimensions and the ownership boundaries', () => {
    expect(DIFF_ADAPTER_INFO.adapterId).toBe('@clapp/diff');
    expect(DIFF_ADAPTER_INFO.supportedContractVersions).toContain('0.1');
    expect([...DIFF_ADAPTER_INFO.dimensions]).toEqual(['semantic', 'state']);
    // The visual/network dimensions and the repair loop are OTHER packages'.
    expect(DIFF_ADAPTER_INFO.unsupportedConstructs.join('\n')).toContain('@clapp/diffext');
    expect(DIFF_ADAPTER_INFO.unsupportedConstructs.join('\n')).toContain('@clapp/repair');
  });

  it('describes per-driver capture capabilities AND limitations for both drivers', () => {
    const dom = DIFF_ADAPTER_INFO.perDriverCapture['replayer-dom'];
    const playwright = DIFF_ADAPTER_INFO.perDriverCapture['replayer-playwright'];
    expect(dom.captures.length).toBeGreaterThan(0);
    expect(dom.limitations.length).toBeGreaterThan(0);
    expect(playwright.captures.length).toBeGreaterThan(0);
    expect(playwright.limitations.length).toBeGreaterThan(0);
    // The dom driver's ls/ss honesty rule is explicit.
    expect(dom.limitations.join('\n')).toContain('no script execution');
    expect(dom.limitations.join('\n')).toContain('localStorage/sessionStorage');
    // The playwright driver's browser-optional posture is explicit.
    expect(playwright.limitations.join('\n')).toContain('lazily imported');
    // The degradation behavior names the absence discipline.
    expect(DIFF_ADAPTER_INFO.degradationBehavior).toContain('ABSENT, never null');
  });
});

describe('absence semantics — absent entries are absent, never null', () => {
  it(
    'non-capturing steps carry undefined page/network ids in memory and null only in canonical JSON',
    async () => {
      const [plan, journeys, baselineRootHash] = await Promise.all([
        buildGoldenB01Plan(),
        loadSeededB01Journeys(),
        b01CorpusRootHash(),
      ]);
      if (leftServer === undefined) {
        leftServer = await startFixtureServer({ root: resolveFixtureRoot() });
      }
      const app = generateApp(plan);
      const dir = await mkdtemp(join(tmpdir(), 'clapp-040-honesty-'));
      scratchDirs.push(dir);
      const root = await writeApp(app, dir);
      const candidate = await spawnCandidate(root, app.manifest);
      try {
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

        const newsletter = journeys.find((journey) => journey.name.includes('newsletter'))!;
        const run = await runner.runPair(newsletter.id);
        // The newsletter journey: navigate(0), fill(1), press(2), assert(3), wait(4).
        // Steps 1 and 4 capture nothing under the dom driver → ABSENT entries.
        expect(run.runs.left.stepPageIds).toEqual([
          run.runs.left.stepPageIds[0],
          undefined,
          run.runs.left.stepPageIds[2],
          undefined,
          undefined,
        ]);
        expect(run.runs.right.stepPageIds).toEqual([
          run.runs.right.stepPageIds[0],
          undefined,
          run.runs.right.stepPageIds[2],
          undefined,
          undefined,
        ]);
        for (const ids of [run.runs.left.stepNetworkIds, run.runs.right.stepNetworkIds]) {
          expect(ids).toHaveLength(5);
          expect(ids[1]).toBeUndefined();
          expect(ids[3]).toBeUndefined();
          expect(ids[4]).toBeUndefined();
        }
        // In canonical JSON, absence renders as null (the only JSON form of a
        // positionally-absent array element) and parses back to undefined.
        const report = await runner.report([run]);
        const text = serializeDiffReport(report);
        const parsed: DiffReport = JSON.parse(text);
        expect(parsed.runs[0]!.runs.left.stepPageIds[1]).toBeNull();
        expect(parsed.runs[0]!.runs.left.stepPageIds).toHaveLength(5);
        // And the left side's honest empty storage inventory (b01 sets nothing).
        expect(run.runs.left.storageIds).toEqual([]);
      } finally {
        await candidate.close().catch(() => undefined);
        await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      }
    },
    60_000,
  );
});

describe('foreign runs — diff degrades to run-integrity findings only', () => {
  it('a hand-constructed PairedRun (no captures) diffs structurally, never inventing page comparisons', async () => {
    const [plan, journeys, baselineRootHash] = await Promise.all([
      buildGoldenB01Plan(),
      loadSeededB01Journeys(),
      b01CorpusRootHash(),
    ]);
    // No servers needed: the foreign run is hand-constructed.
    const runner = createPairedRunner({
      journeys,
      left: { side: 'left', baseUrl: 'http://127.0.0.1:1/', targetId: 'bench/b01-static', driver: 'replayer-dom' },
      right: { side: 'right', baseUrl: 'http://127.0.0.1:2/', targetId: GOLDEN_CANDIDATE_APP_ID, driver: 'replayer-dom' },
      candidateAppId: GOLDEN_CANDIDATE_APP_ID,
      baselineRootHash,
      plan,
      ids: createDeterministicDiffIdFactory(),
      now: FIXED_NOW,
    });
    const evidence = {
      evidenceId: 'ev_00000000-0000-4000-8000-000000000001',
      kind: 'dom' as const,
      sha256: 'c'.repeat(64),
    };
    const foreign: PairedRun = {
      journeyId: journeys[0]!.id,
      transitionIds: [],
      left: { side: 'left', baseUrl: 'http://127.0.0.1:1/', targetId: 'bench/b01-static', driver: 'replayer-dom' },
      right: { side: 'right', baseUrl: 'http://127.0.0.1:2/', targetId: GOLDEN_CANDIDATE_APP_ID, driver: 'replayer-dom' },
      runs: {
        left: {
          side: 'left',
          journeyId: journeys[0]!.id,
          completed: true,
          stepsCompleted: journeys[0]!.actions.length,
          evidenceRef: evidence,
          stepPageIds: journeys[0]!.actions.map(() => undefined),
          stepNetworkIds: journeys[0]!.actions.map(() => undefined),
          storageIds: [],
        },
        right: {
          side: 'right',
          journeyId: journeys[0]!.id,
          completed: false,
          stepsCompleted: 2,
          failure: 'target-not-found: selector unmatched (foreign run fixture)',
          evidenceRef: evidence,
          stepPageIds: journeys[0]!.actions.slice(0, 3).map(() => undefined),
          stepNetworkIds: journeys[0]!.actions.slice(0, 3).map(() => undefined),
          storageIds: [],
        },
      },
    };
    const findings = await runner.diff(foreign);
    // Run-integrity findings only — the incomplete right side is critical;
    // no page/feature comparison exists (nothing is fabricated).
    expect(findings.length).toBe(1);
    expect(findings[0]!.dimension).toBe('semantic');
    expect(findings[0]!.severity).toBe('critical');
    expect(findings[0]!.summary).toContain('failed to complete');
    expect(findings[0]!.anchors[0]!.leftEvidence).toBe(evidence);
    expect(findings[0]!.anchors[0]!.rightEvidence).toBe(evidence);
  });
});

describe('options validation — fail fast, honestly', () => {
  const base = async () => {
    const [plan, journeys, baselineRootHash] = await Promise.all([
      buildGoldenB01Plan(),
      loadSeededB01Journeys(),
      b01CorpusRootHash(),
    ]);
    return {
      journeys,
      left: { side: 'left', baseUrl: 'http://127.0.0.1:1/', targetId: 'bench/b01-static', driver: 'replayer-dom' },
      right: { side: 'right', baseUrl: 'http://127.0.0.1:2/', targetId: GOLDEN_CANDIDATE_APP_ID, driver: 'replayer-dom' },
      candidateAppId: GOLDEN_CANDIDATE_APP_ID,
      baselineRootHash,
      plan,
      ids: createDeterministicDiffIdFactory(),
      now: FIXED_NOW,
    } as const;
  };

  it('rejects an empty journey list', async () => {
    const options = await base();
    expect(() => createPairedRunner({ ...options, journeys: [] })).toThrow(DiffRunnerError);
  });

  it('rejects swapped or mismatched sides and asymmetric drivers', async () => {
    const options = await base();
    expect(() =>
      createPairedRunner({ ...options, left: { ...options.left, side: 'right' } }),
    ).toThrow(/side/);
    expect(() =>
      createPairedRunner({
        ...options,
        right: { ...options.right, driver: 'replayer-playwright' as const },
      }),
    ).toThrow(/same driver/);
  });

  it('rejects a candidateAppId that is not the planned-application shape, or disagrees with right.targetId', async () => {
    const options = await base();
    expect(() => createPairedRunner({ ...options, candidateAppId: 'appsyn_not-uuid' })).toThrow(DiffRunnerError);
    expect(() =>
      createPairedRunner({ ...options, right: { ...options.right, targetId: 'appsyn_00000000-0000-4000-8000-00000000dead' } }),
    ).toThrow(/targetId must equal/);
  });

  it('rejects a malformed baselineRootHash', async () => {
    const options = await base();
    expect(() => createPairedRunner({ ...options, baselineRootHash: 'nope' })).toThrow(/baselineRootHash/);
  });

  it('rejects an invalid plan (and the golden plan is valid)', async () => {
    const options = await base();
    expect(validateSynthesisPlanDetailed(options.plan).valid).toBe(true);
    const broken = structuredClone(options.plan) as typeof options.plan;
    broken.routes = [];
    expect(() => createPairedRunner({ ...options, plan: broken })).toThrow(/plan validation/);
  });

  it('rejects unknown journeys in runPair and unknown keys in irAnchors', async () => {
    const options = await base();
    const runner = createPairedRunner(options);
    expect(runner.runPair('journey_unknown')).rejects.toThrow(/unknown journey id/);
    expect(() =>
      createPairedRunner({ ...options, irAnchors: { 'journey_unknown': [] } }),
    ).toThrow(/irAnchors/);
  });

  it('carries provided IR anchors on the paired run (absence is honest absence)', async () => {
    const options = await base();
    const transitionId = 'trans_00000000-0000-4000-8000-000000000001';
    const anchored = createPairedRunner({
      ...options,
      irAnchors: { [options.journeys[0]!.id]: [transitionId] },
    });
    const run = await anchored.runPair(options.journeys[0]!.id);
    expect(run.transitionIds).toEqual([transitionId]);
    const unanchored = await createPairedRunner(options).runPair(options.journeys[1]!.id);
    expect(unanchored.transitionIds).toEqual([]);
  });
});
