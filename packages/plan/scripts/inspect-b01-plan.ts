/**
 * @clapp/plan — b01 e2e inspection script (CLAPP-030).
 *
 * Runs the full e2e pipeline (real b01 exploration over the local fixture
 * server → IrModel → planSynthesis with the 4 seeded journey records) and
 * prints the verified facts the completion report cites: model/plan
 * validation, served routes, acceptance expectations, section counts, and
 * the seeded assert-target resolution ratio with its assumption entries.
 *
 * Usage: bun run scripts/inspect-b01-plan.ts   (from packages/plan)
 * Sibling precedent: packages/extract/scripts/inspect-e2e.ts (CLAPP-021).
 */

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
import {
  parseSynthesisPlan,
  planStats,
  planSynthesis,
  serializeSynthesisPlan,
  validateSynthesisPlanDetailed,
} from '../src/index';
import type { SynthesisPlan } from '../src/index';

/** Mirrors the e2e test's target resolution (testId first, then role+name). */
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

const server = await startFixtureServer({ root: resolveFixtureRoot() });
try {
  const stores = { runStore: new MemoryRunStore(), artifactStore: new MemoryArtifactStore() };
  const session = await RecordingSession.start(stores, { targetId: 'bench/b01-static' });
  const result = await explore({
    baseUrl: server.url,
    applier: createDomApplier({ baseUrl: server.url }),
    recorder: session,
    policy: createExplorationPolicy({
      entrypoints: ['/'],
      maxSteps: 120,
      maxScreens: 12,
      maxActionsPerScreen: 8,
      seed: 20260925,
    }),
    application: { id: `app_${randomUUID()}`, name: 'b01-static', platform: 'web', entrypoints: ['/'] },
  });
  const modelCheck = validateIrModelDetailed(result.model);
  console.log('model valid:', modelCheck.valid, '| errors:', modelCheck.errors.length);

  const journeysDir = resolveSeededJourneysDir();
  const files = (await readdir(journeysDir)).filter((file) => file.endsWith('.json')).sort();
  const seeded: Journey[] = [];
  for (const file of files) {
    const record: unknown = JSON.parse(await readFile(join(journeysDir, file), 'utf8'));
    if (!validateJourney(record)) throw new Error(`invalid seeded journey ${file}`);
    seeded.push(record as Journey);
  }
  console.log('seeded journeys:', seeded.length);

  const plan = planSynthesis(result.model, { journeys: seeded });
  const planCheck = validateSynthesisPlanDetailed(plan);
  console.log('plan valid:', planCheck.valid, '| errors:', planCheck.errors.length);
  console.log('routes:', plan.routes.map((route) => route.path).sort().join(','));
  console.log('acceptance:', plan.acceptance.map((entry) => `${entry.journeyId.slice(0, 12)}…→${entry.expectedRoute}`).join(' | '));
  console.log('assumptions:', plan.assumptions.length);

  const stats = planStats(plan);
  console.log('elements:', stats.elements, JSON.stringify(stats.elementsByKind));
  console.log('navigation:', stats.transitions, '| storage:', stats.storageBindings, '| endpoints:', stats.endpoints, '| mocks:', stats.mocks);

  let total = 0;
  let unresolved = 0;
  for (const journey of seeded) {
    for (const action of journey.actions) {
      if (action.type !== 'assert-visible') continue;
      total += 1;
      if (!resolvesInPlan(plan, action.target)) unresolved += 1;
    }
  }
  console.log(`assert targets: total=${total} unresolved=${unresolved} resolved=${total - unresolved} ratio=${((total - unresolved) / total).toFixed(4)}`);
  const unresolvedAssumptions = plan.assumptions.filter((entry) => entry.startsWith('unresolved assert target'));
  console.log('unresolved-target assumption entries:', unresolvedAssumptions.length);
  for (const entry of unresolvedAssumptions) console.log('  -', entry.slice(0, 120));

  const text = serializeSynthesisPlan(plan);
  console.log('round-trip byte-stable:', serializeSynthesisPlan(parseSynthesisPlan(text)) === text);
  console.log('serialized plan bytes:', Buffer.byteLength(text, 'utf8'));
} finally {
  await server.close();
}
