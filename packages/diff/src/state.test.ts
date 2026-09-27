/**
 * @clapp/diff tests — the STATE dimension (CLAPP-040).
 *
 * Per the packet:
 * - a plan with a COOKIE storage binding (writtenOn a route) → the
 *   dom-driver pair records the Set-Cookie observation as a no-finding or
 *   'info' entry per the rules;
 * - a plan with a LOCALSTORAGE binding → the ls entry is honestly
 *   absent-or-info under the dom driver (documented limitation, NO
 *   fabricated inventory);
 * - no storage baseline (the golden plan) → zero state findings;
 * - a binding whose writtenOn route the journey never visits → 'info'
 *   (not exercised — absence of evidence is not evidence of absence).
 */

import { afterAll, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateApp, writeApp } from '@clapp/codegen';
import { resolveFixtureRoot, startFixtureServer, type FixtureServer } from '@clapp/journey';
import { createPairedRunner } from './paired-runner';
import { createDeterministicDiffIdFactory } from './ids';
import {
  GOLDEN_CANDIDATE_APP_ID,
  NAV_IDS,
  b01CorpusRootHash,
  buildGoldenB01Plan,
  loadSeededB01Journeys,
  withCookieBinding,
  withLocalStorageBinding,
} from './golden-plan';
import { spawnCandidate } from './test-support';
import type { PlannedStorageBinding, SynthesisPlan } from '@clapp/plan';

const FIXED_NOW = () => new Date('2026-09-27T00:00:00.000Z');

const scratchDirs: string[] = [];
let leftServer: FixtureServer | undefined;

afterAll(async () => {
  await leftServer?.close().catch(() => undefined);
  for (const dir of scratchDirs) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

/** A storage-binding literal for the not-exercised case. */
function cookieBindingOn(key: string, writtenOn: string): PlannedStorageBinding {
  return {
    id: 'store_00000000-0000-4000-8000-000000000510',
    key,
    storage: 'cookie',
    entityFieldNames: [],
    writtenOn: [writtenOn],
    sourceEntityIds: [],
    provenance: {
      level: 'planned',
      rationale: 'Fixture-declared cookie binding (the state-dimension test supply).',
      sourceIds: [],
      evidenceRefs: [],
    },
  };
}

async function runStatePair(plan: SynthesisPlan, journeyNamePart: string) {
  if (leftServer === undefined) {
    leftServer = await startFixtureServer({ root: resolveFixtureRoot() });
  }
  const [journeys, baselineRootHash] = await Promise.all([
    loadSeededB01Journeys(),
    b01CorpusRootHash(),
  ]);
  const app = generateApp(plan);
  const dir = await mkdtemp(join(tmpdir(), 'clapp-040-state-'));
  scratchDirs.push(dir);
  const root = await writeApp(app, dir);
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
  const journey = journeys.find((candidate) => candidate.name.includes(journeyNamePart));
  if (journey === undefined) {
    throw new Error(`state test: journey containing ${JSON.stringify(journeyNamePart)} not found`);
  }
  try {
    const run = await runner.runPair(journey.id);
    const findings = await runner.diff(run);
    const report = await runner.report([run]);
    return { run, findings, report };
  } finally {
    await candidate.close().catch(() => undefined);
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

describe('state dimension — cookie binding (dom driver)', () => {
  it(
    'records the Set-Cookie observation on the writtenOn route as an info entry (no finding inflation)',
    async () => {
      const plan = withCookieBinding(await buildGoldenB01Plan());
      const { run, findings, report } = await runStatePair(plan, 'navigation');

      // The nav journey visits /pricing.html on both sides.
      expect(run.runs.left.completed).toBe(true);
      expect(run.runs.right.completed).toBe(true);

      const state = findings.filter((finding) => finding.dimension === 'state');
      expect(state.length).toBe(1);
      expect(state[0]!.severity).toBe('info');
      expect(state[0]!.summary).toContain('b01-visit');
      expect(state[0]!.summary).toContain('/pricing.html');
      // The observation carries the real header as its actual.
      const actual = state[0]!.actual as { setCookie: string[] };
      expect(actual.setCookie[0]).toContain('b01-visit=');
      // The binding + its writtenOn transition anchor the finding.
      expect(state[0]!.anchors[0]!.sourceIds).toContain(plan.storage[0]!.id);
      expect(state[0]!.anchors[0]!.sourceIds).toContain(NAV_IDS.homeToPricing);
      // The cookie observation is sealed as the right side's storage inventory.
      expect(run.runs.right.storageIds.length).toBe(1);
      // The left (b01 corpus) sets no cookies: honest empty inventory.
      expect(run.runs.left.storageIds).toEqual([]);
      // No critical anywhere; the observation does not flip the verdict.
      expect(report.verdict).toBe('equivalent');
      expect(report.counts.info).toBe(1);
      expect(report.counts.critical).toBe(0);
    },
    60_000,
  );
});

describe('state dimension — localStorage binding (dom driver honesty rule)', () => {
  it(
    'is honestly NOT VERIFIABLE under replayer-dom — an info limitation, never a fabricated inventory',
    async () => {
      const plan = withLocalStorageBinding(await buildGoldenB01Plan());
      const { run, findings, report } = await runStatePair(plan, 'newsletter');

      expect(run.runs.left.completed).toBe(true);
      expect(run.runs.right.completed).toBe(true);

      const state = findings.filter((finding) => finding.dimension === 'state');
      expect(state.length).toBe(1);
      expect(state[0]!.severity).toBe('info');
      expect(state[0]!.summary).toContain('NOT VERIFIABLE under replayer-dom');
      expect(state[0]!.summary).toContain('newsletter-email');
      const actual = state[0]!.actual as { verified: boolean; limitation: string };
      expect(actual.verified).toBe(false);
      expect(actual.limitation).toContain('no page scripts');
      // NO fabricated inventory: the right side observed NOTHING under the
      // dom driver (the inline write never executes).
      expect(run.runs.right.storageIds).toEqual([]);
      expect(run.runs.left.storageIds).toEqual([]);
      expect(report.verdict).toBe('equivalent');
    },
    60_000,
  );
});

describe('state dimension — no baseline / not exercised', () => {
  it(
    'the golden plan (no storage bindings) yields zero state findings',
    async () => {
      const plan = await buildGoldenB01Plan();
      const { findings } = await runStatePair(plan, 'navigation');
      expect(findings.filter((finding) => finding.dimension === 'state')).toEqual([]);
    },
    60_000,
  );

  it(
    'a cookie binding whose writtenOn route the journey never visits is an honest not-exercised info entry',
    async () => {
      const plan = await buildGoldenB01Plan();
      const withBinding: SynthesisPlan = {
        ...plan,
        storage: [...plan.storage, cookieBindingOn('never-exercised', NAV_IDS.homeToNewsletterSuccess)],
      };
      // The nav journey never visits /newsletter-success.html.
      const { run, findings } = await runStatePair(withBinding, 'navigation');
      expect(run.runs.right.completed).toBe(true);
      const state = findings.filter((finding) => finding.dimension === 'state');
      expect(state.length).toBe(1);
      expect(state[0]!.severity).toBe('info');
      expect(state[0]!.summary).toContain('was not exercised');
    },
    60_000,
  );
});
