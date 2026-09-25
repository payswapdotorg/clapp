/**
 * @clapp/codegen — public API (CLAPP-031).
 *
 * Package-aware codegen: renders a SynthesisPlan (synthesis-contract v0.1
 * MIRROR in ./synthesis-contract.ts; canonical owner @clapp/plan,
 * CLAPP-030) into a COMPLETE, RUNNABLE candidate web app — a
 * zero-dependency node/bun-stdlib HTTP server serving server-rendered
 * HTML pages (preserved testids / roles / accessible names / forms) plus
 * a mock backend for the plan's api endpoints — emitted as a well-formed
 * file tree that also auto-joins a bun workspace when materialized under
 * packages/*.
 *
 * Quick start:
 *
 *   import { generateApp, writeApp } from '@clapp/codegen';
 *
 *   const app = generateApp(plan);            // { files, manifest }
 *   const root = await writeApp(app, dir);    // materialize (idempotent)
 *   // then: cd <dir> && bun server.ts        (PORT env var overrides)
 *
 * The acceptance oracle: the generated app must replay the plan's source
 * journeys cleanly through @clapp/journey's createDomApplier — the test
 * battery replays all four seeded b01 journeys against the generated
 * golden app end-to-end.
 */

export * from './synthesis-contract';

export { generateApp } from './generate';

export type { GenerateOptions, GeneratedApp, GeneratedFile, AppManifest } from './types';
export { CODEGEN_ADAPTER_INFO, CODEGEN_PACKAGE_PREFIX } from './types';

export { writeApp } from './write-app';

export { renderPageHtml } from './render-page';
export { resolveStorage, storageWriteScript, storageCookieValue } from './storage';
export type { ResolvedStorage } from './storage';
export { buildApiTable, matchApiRoute, matchApiRoutes, selectApiRoute, methodMatches, apiEndpointLabel, patternSegments, pathSegments, segmentsMatch } from './mock-backend';
export type { ApiRouteEntry, ApiSelection, MockEntry } from './mock-backend';
