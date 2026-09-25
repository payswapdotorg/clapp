/**
 * @clapp/gentests — public API (CLAPP-032).
 *
 * Renders a SynthesisPlan (contract v0.1 MIRROR, canonical owner
 * @clapp/plan, CLAPP-030) into an EXECUTABLE bun-test suite that verifies
 * a candidate app conforming to the plan.
 *
 * Quick start:
 *
 *   import { createConformingServer, generateTestSuite, writeSuite } from '@clapp/gentests';
 *
 *   const server = await createConformingServer(plan);          // reference candidate
 *   const suite = generateTestSuite(plan, { baseUrl: server.url, journeyRecords });
 *   const root = await writeSuite(suite, '.tmp-suite');          // inside the workspace
 *   // then: bun test .tmp-suite  (needs '@clapp/journey' resolvable)
 *   await server.close();
 *
 * This module is the package's ONLY public entry point (see package.json
 * exports). Everything else under src/ is internal.
 */

// The synthesis-contract MIRROR, re-exported whole (byte-identical file:
// canonical owner @clapp/plan, CLAPP-030; pinned by the mirror test).
export * from './synthesis-contract';

export { generateTestSuite, GentestsError } from './generate';
export type {
  GenerateTestsOptions,
  GeneratedFile,
  GeneratedTestSuite,
  SuiteManifest,
} from './generate';

export { writeSuite } from './write-suite';

export { createConformingServer } from './conforming-server';
export type {
  ConformingServerHandle,
  ConformingServerOptions,
} from './conforming-server';

export { GENTESTS_ADAPTER_INFO } from './adapter-info';
export type { GentestsAdapterInfo } from './adapter-info';
