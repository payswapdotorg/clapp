/**
 * @clapp/journey — sandbox-execution proof harness (CLAPP-012).
 *
 * This script is executed INSIDE an isolated @clapp/sandbox execution
 * profile (isolated cwd, filtered env, deny-all declared network posture,
 * duration budget) by sandbox-proof.test.ts. It:
 *
 *   1. starts the b01 fixture server on an ephemeral loopback port,
 *   2. loads every seeded journey from fixtures/journeys/,
 *   3. replays each journey through the DOM ActionApplier against the
 *      in-profile server,
 *   4. prints one machine-readable JSON line to stdout summarizing every
 *      journey (and, with --out, writes the same JSON inside the profile
 *      cwd — proving from within that the child ran in the profile root),
 *   5. exits 0 iff every journey replayed cleanly.
 *
 * It imports ONLY relative package sources and node/bun stdlib — no
 * node_modules resolution is needed at runtime, which keeps the proof
 * fully self-contained (and consistent with the deny-all posture; the v0
 * child-process sandbox honestly reports networkEnforced=false — see
 * @clapp/sandbox types and README).
 *
 * CLI: bun proof.ts [--journeys DIR] [--root DIR] [--out FILE]
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  createDomApplier,
  JourneyReplayError,
  replayJourney,
  resolveFixtureRoot,
  resolveSeededJourneysDir,
  startFixtureServer,
  validateJourney,
  validateJourneyDetailed,
} from '../index';
import type { Journey } from '../index';

interface JourneyProofResult {
  id: string;
  file: string;
  name: string;
  actions: number;
  ok: boolean;
  durationMs: number;
  error?: {
    code: string;
    message: string;
    actionIndex?: number;
    details?: unknown;
  };
}

interface ProofResult {
  ok: boolean;
  serverUrl: string;
  serverPort: number;
  profileCwd: string;
  journeys: JourneyProofResult[];
}

async function main(): Promise<void> {
  const { values: args } = parseArgs({
    args: process.argv.slice(2),
    options: {
      journeys: { type: 'string' },
      root: { type: 'string' },
      out: { type: 'string' },
    },
  });
  const root = args.root ?? resolveFixtureRoot();
  const journeysDir = args.journeys ?? resolveSeededJourneysDir();

  const server = await startFixtureServer({ root, port: 0 });
  const applier = createDomApplier({ baseUrl: server.url });

  const files = (await readdir(journeysDir)).filter((file) => file.endsWith('.json')).sort();
  const results: JourneyProofResult[] = [];

  for (const file of files) {
    const journey: unknown = JSON.parse(await readFile(join(journeysDir, file), 'utf8'));
    if (!validateJourney(journey)) {
      results.push({
        id: '(unparseable)',
        file,
        name: file,
        actions: 0,
        ok: false,
        durationMs: 0,
        error: {
          code: 'journey-invalid',
          message: 'seeded journey failed structural validation',
          details: validateJourneyDetailed(journey).errors,
        },
      });
      continue;
    }
    const validJourney = journey as Journey;
    try {
      const summary = await replayJourney(validJourney, applier);
      results.push({
        id: validJourney.id,
        file,
        name: validJourney.name,
        actions: summary.actionsApplied,
        ok: true,
        durationMs: summary.durationMs,
      });
    } catch (error) {
      const replayError = error instanceof JourneyReplayError ? error : null;
      results.push({
        id: validJourney.id,
        file,
        name: validJourney.name,
        actions: validJourney.actions.length,
        ok: false,
        durationMs: 0,
        error: {
          code: replayError?.code ?? 'action-failed',
          message: replayError?.message ?? String(error),
          actionIndex: replayError?.actionIndex,
          details: replayError?.details,
        },
      });
    }
  }

  await server.close();

  const result: ProofResult = {
    ok: results.length > 0 && results.every((entry) => entry.ok),
    serverUrl: server.url,
    serverPort: server.port,
    profileCwd: process.cwd(),
    journeys: results,
  };
  const line = JSON.stringify(result);
  if (args.out !== undefined) {
    // Written relative to the child cwd (= the profile rootDir), proving
    // from within that the execution happened inside the profile.
    await writeFile(args.out, `${line}\n`, 'utf8');
  }
  process.stdout.write(`${line}\n`);
  process.exitCode = result.ok ? 0 : 1;
}

main().catch((error: unknown) => {
  process.stderr.write(`proof: fatal: ${String(error)}\n`);
  process.exitCode = 1;
});
