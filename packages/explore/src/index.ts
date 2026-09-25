/**
 * @clapp/explore — public API (CLAPP-022).
 *
 * Exploration policy for the CLAPP program: budgeted walks of an authorized
 * app that discover screens, record journeys AND action-level evidence
 * through the frozen @clapp/journey applier, and emit a Behavioral-IR
 * state-graph fragment (ir-contract v0.1 mirror below) whose every
 * transition cites recorded evidence.
 *
 * This module is the package's ONLY public entry point (see package.json
 * exports). Everything else under src/ is internal — including
 * ir-emitter.ts's checkIrLiteral, which exists for the colocated test
 * battery and the emitter's own self-check, not for package consumers.
 *
 * Quick start (see README.md for the full walkthrough):
 *
 *   import { RecordingSession } from '@clapp/evidence';
 *   import {
 *     createDomApplier, resolveFixtureRoot, startFixtureServer,
 *   } from '@clapp/journey';
 *   import { createExplorationPolicy, explore } from '@clapp/explore';
 *
 *   const server = await startFixtureServer({ root: resolveFixtureRoot() });
 *   const session = await RecordingSession.start(stores, {
 *     targetId: 'bench/b01-static',
 *   });
 *   const result = await explore({
 *     baseUrl: server.url,
 *     applier: createDomApplier({ baseUrl: server.url }),
 *     recorder: session,
 *     policy: createExplorationPolicy({
 *       entrypoints: ['/'], maxSteps: 100, maxScreens: 12,
 *       maxActionsPerScreen: 8, seed: 20260925,
 *     }),
 *     application: {
 *       id: 'app_b01', name: 'b01-static', platform: 'web',
 *       entrypoints: ['/'],
 *     },
 *   });
 *   // result.model — IrModel fragment; result.journeys — replayable;
 *   // result.report — honest counters; result.refs — recorded evidence.
 */

// ---- shared contract mirror (canonical owner: @clapp/ir, CLAPP-020) -------
export * from './ir-contract';

// ---- html walker ------------------------------------------------------------
export {
  ACTIONABLE_CAPTURE_ROLES,
  CAPTURE_ATTR_ALLOWLIST,
  CAPTURE_ATTR_PREFIXES,
  collapseWhitespace,
  elementPathOf,
  journeyAccessibleName,
  journeyImplicitRole,
  journeyRole,
  parseHtml,
  roleForCapture,
  serializeForCapture,
  walkHtml,
} from './html-walker';
export type {
  ActionableElement,
  DomCaptureTree,
  WalkedPage,
  WalkerElement,
  WalkerText,
} from './html-walker';

// ---- policy -------------------------------------------------------------------
export { createExplorationPolicy, createPrng } from './policy';
export type {
  ExplorationDecision,
  ExplorationPolicy,
  ExplorationPolicyOptions,
  ExplorationState,
  PendingScreen,
} from './policy';

// ---- explorer -------------------------------------------------------------------
export { explore, normalizeRoute } from './explorer';
export { ExplorationError } from './explorer';
export type { ExploreOptions, ExploreResult } from './explorer';

// ---- report ----------------------------------------------------------------------
export type { ExplorationReport } from './report';

// ---- IR emission -------------------------------------------------------------------
export { EXPLORE_ADAPTER_INFO, describeAction, emitIrModel } from './ir-emitter';
export type {
  ActionOutcome,
  EmitIrModelInput,
  JourneyRecord,
  ScreenRecord,
} from './ir-emitter';
