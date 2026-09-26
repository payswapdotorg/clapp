/**
 * @clapp/repair tests — full-loop scenario harness (CLAPP-042).
 *
 * Wraps the killer/budget/determinism flows: golden plan + seeded
 * journeys → candidate (pristine + declared mutations, committed) →
 * paired servers → synthesized contract-shaped report. The caller then
 * runs runRepairLoop with a rerun oracle built from the same deps.
 */

import { startFixtureServer, resolveFixtureRoot, type FixtureServer } from '@clapp/journey';
import type { SynthesisPlan } from '@clapp/plan';
import type { DiffReport } from '../../src/diff-contract';
import {
  buildCandidate,
  removeCandidate,
  type CandidateHandle,
  type Mutation,
} from './candidate';
import { spawnCandidate, type SpawnedCandidate } from './spawn-app';
import { synthesizeReport } from './synth';
import { buildGoldenB01Plan, corpusRootHash, loadSeededB01Journeys } from '../../fixtures/golden-b01-plan';
import type { Journey } from '@clapp/journey';

export interface Scenario {
  plan: SynthesisPlan;
  journeys: Journey[];
  baselineRootHash: string;
  candidate: CandidateHandle;
  report: DiffReport;
}

/** Builds a full scenario: candidate (with mutations) + synthesized report. */
export async function buildScenario(
  label: string,
  mutations: Mutation[],
  options: { cleanStale?: boolean; findingIdPrefix?: string } = {},
): Promise<Scenario> {
  const plan = await buildGoldenB01Plan();
  const journeys = await loadSeededB01Journeys();
  const baselineRootHash = await corpusRootHash();
  const candidate = await buildCandidate(plan, label, mutations, {
    cleanStale: options.cleanStale ?? true,
  });

  let left: FixtureServer | null = null;
  let right: SpawnedCandidate | null = null;
  try {
    left = await startFixtureServer({ root: resolveFixtureRoot() });
    right = await spawnCandidate(candidate.root);
    const report = await synthesizeReport({
      left: { url: left.url },
      right: { url: right.url },
      plan,
      journeys,
      baselineRootHash,
      findingIdPrefix: options.findingIdPrefix ?? label,
    });
    return { plan, journeys, baselineRootHash, candidate, report };
  } finally {
    await right?.close();
    await left?.close();
  }
}

/** Tears a scenario down (removes the candidate scratch tree). */
export async function teardownScenario(scenario: Scenario): Promise<void> {
  await removeCandidate(scenario.candidate.root);
}
