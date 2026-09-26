/**
 * @clapp/repair tests — the re-run verification oracle (CLAPP-042).
 *
 * The oracle stands in for the production re-run (CLAPP-040's report
 * verdict): for the candidate at its CURRENT state it starts the LEFT
 * corpus fixture server + a FRESH candidate server (the generated server
 * imports its page modules at startup, so every re-run must re-spawn to
 * observe the tree's current bytes), replays the seeded journeys through
 * createDomApplier, re-synthesizes the findings, and judges:
 *
 *   0 findings            → 'equivalent'
 *   more than baseline    → 'worse'
 *   otherwise (some)      → 'divergent'
 *   spawn/synthesis error → 'error'
 *
 * The oracle consults the plan (as the runner side owns the plan's api
 * mock spec); the repair loop under test never does.
 */

import { resolveFixtureRoot, startFixtureServer } from '@clapp/journey';
import type { SynthesisPlan } from '@clapp/plan';
import type { RerunVerdict } from '../../src/loop';
import { synthesizeFindings } from './synth';
import { spawnCandidate } from './spawn-app';
import type { Journey } from '@clapp/journey';

export interface OracleDeps {
  plan: SynthesisPlan;
  journeys: Journey[];
  baselineRootHash: string;
  /** The finding count of the initial report (worse-detection baseline). */
  baselineFindingCount: number;
  /** Deterministic finding-id prefix (distinct from the initial report's). */
  findingIdPrefix: string;
}

export interface RerunOracle {
  rerun(candidateRoot: string): Promise<RerunVerdict>;
}

/** Builds the re-run oracle (see the module doc for the verdict rules). */
export function makeRerunOracle(deps: OracleDeps): RerunOracle {
  return {
    async rerun(candidateRoot: string): Promise<RerunVerdict> {
      let left: Awaited<ReturnType<typeof startFixtureServer>> | null = null;
      let right: Awaited<ReturnType<typeof spawnCandidate>> | null = null;
      try {
        left = await startFixtureServer({ root: resolveFixtureRoot() });
        right = await spawnCandidate(candidateRoot);
        const findings = await synthesizeFindings({
          left: { url: left.url },
          right: { url: right.url },
          plan: deps.plan,
          journeys: deps.journeys,
          baselineRootHash: deps.baselineRootHash,
          findingIdPrefix: deps.findingIdPrefix,
        });
        if (findings.length === 0) {
          return 'equivalent';
        }
        return findings.length > deps.baselineFindingCount ? 'worse' : 'divergent';
      } catch {
        return 'error';
      } finally {
        await right?.close();
        await left?.close();
      }
    },
  };
}
