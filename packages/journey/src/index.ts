/**
 * @clapp/journey — public API (CLAPP-012).
 *
 * Journey recording, structural validation, and replay for the CLAPP
 * journey contract v0 (canonical contract in ./journey-contract.ts), plus
 * the bench-b01 fixture corpus and its stdlib-only HTTP server.
 *
 * This module is the package's ONLY public entry point (see package.json
 * exports). Everything else under src/ is internal. The sandbox proof
 * harness (src/fixtures/proof.ts) is deliberately reachable as an internal
 * file (it is spawned by path inside an isolated execution profile, not
 * imported through the package boundary).
 *
 * Quick start:
 *
 *   import {
 *     createDomApplier, createRecorder, replayJourney,
 *     startFixtureServer, validateJourney,
 *   } from '@clapp/journey';
 *
 *   const recorder = createRecorder({ name: 'b01 nav' });
 *   recorder.start('bench/b01-static');
 *   recorder.record({ type: 'navigate', url: '/' });
 *   recorder.record({ type: 'click', target: { testId: 'nav-pricing' } });
 *   const journey = recorder.finish();
 *   validateJourney(journey); // => true
 *
 *   const server = await startFixtureServer({ root: resolveFixtureRoot() });
 *   const summary = await replayJourney(journey, createDomApplier({ baseUrl: server.url }));
 *   await server.close();
 */

export type {
  ActionApplier,
  Journey,
  JourneyAction,
  JourneyRecorder,
  TargetSelector,
} from './journey-contract';

export {
  JOURNEY_ID_PATTERN,
  validateJourney,
  validateJourneyDetailed,
  validateJourneyAction,
  validateTargetSelector,
} from './validate';
export type { JourneyValidationResult } from './validate';

export { newJourneyId } from './ids';

export { createRecorder } from './recorder';
export type { RecorderOptions } from './recorder';

export {
  createDomApplier,
  JourneyReplayError,
  replayJourney,
} from './replayer';
export type {
  DomApplierOptions,
  ReplayErrorCode,
  ReplaySummary,
} from './replayer';

export {
  resolveFixtureRoot,
  resolveSeededJourneysDir,
  startFixtureServer,
  waitForFixtureServer,
} from './fixtures/server';
export type {
  FixtureServer,
  FixtureServerOptions,
  WaitForFixtureServerOptions,
} from './fixtures/server';
