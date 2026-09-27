/**
 * @clapp/diff — public API (CLAPP-040).
 *
 * The paired differential runner + the SEMANTIC and STATE diff dimensions,
 * and the CANONICAL OWNER of the Differential Verification contract v0.1
 * (src/diff-contract.ts — the byte-identical tech-lead declaration;
 * @clapp/diffext (CLAPP-041) and @clapp/repair (CLAPP-042) carry mirrors;
 * the tech lead byte-checks at integration and freezes. Changes require an
 * ADR).
 *
 * One journey, replayed against BOTH the observed original (left) and the
 * synthesized candidate (right) with the SAME driver vocabulary
 * (@clapp/journey appliers), captured symmetrically, diffed per dimension,
 * and rolled up into a DiffReport with computed counts + an honest verdict.
 *
 * Quick start:
 *
 *   import {
 *     createPairedRunner, parseDiffReport, serializeDiffReport,
 *   } from '@clapp/diff';
 *
 *   const runner = createPairedRunner({
 *     journeys,
 *     left:  { side: 'left',  baseUrl: fixtureServer.url, targetId: 'bench/b01-static', driver: 'replayer-dom' },
 *     right: { side: 'right', baseUrl: candidate.url,     targetId: plan.application.id, driver: 'replayer-dom' },
 *     candidateAppId: plan.application.id,
 *     baselineRootHash,
 *     plan,                    // optional: the state baseline + plan-id anchoring
 *   });
 *   const run = await runner.runPair(journey.id);
 *   const findings = await runner.diff(run);
 *   const report = await runner.report([run]);
 *   const text = serializeDiffReport(report);   // canonical, deterministic
 *   const back = parseDiffReport(text);         // validated, byte-stable
 *
 * Sibling packages must import `@clapp/diff` and never reach into deeper
 * paths. The golden-plan and test-support modules are test-facing internals
 * (not exported here; same discipline as @clapp/plan's test-utils).
 */

// ---- canonical contract (canonical owner: this package) ---------------------
export * from './diff-contract';

// ---- paired runner ------------------------------------------------------------
export { createPairedRunner, DiffRunnerError } from './paired-runner';
export type { PairedRunnerOptions } from './paired-runner';

// ---- report serialization -------------------------------------------------------
export { DiffReportError, parseDiffReport, serializeDiffReport } from './report';

// ---- identity factories (deterministic pipelines) ---------------------------------
export { createDeterministicDiffIdFactory, createDiffIdFactory } from './ids';
export type { DiffIdFactory, DiffMintedIdKind } from './ids';

// ---- adapter honesty summary --------------------------------------------------------
export { DIFF_ADAPTER_INFO } from './adapter-info';
export type { DiffDriverCapabilities } from './adapter-info';
