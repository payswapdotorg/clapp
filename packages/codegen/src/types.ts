/**
 * @clapp/codegen — public types + adapter honesty declaration (CLAPP-031).
 *
 * The generated-app types (GeneratedFile / GeneratedApp / AppManifest) and
 * the IrAdapterInfo-SHAPED honesty summary CODEGEN_ADAPTER_INFO. The shape
 * mirrors @clapp/ir's IrAdapterInfo (adapterId / supportedModelVersions /
 * emittedCapabilities / unsupportedConstructs / degradationBehavior) without
 * importing @clapp/ir — the codegen depends only on the plan contract
 * (mirror) and @clapp/core types, per its worker packet.
 */

import { PLAN_VERSION } from './synthesis-contract';

/**
 * Prefix for generated app package names. A plan application named
 * "Nimbus Notes" becomes the package `clapp-app-nimbus-notes`. The prefix
 * marks the package as a CLAPP-synthesized candidate app (never conflated
 * with hand-written @clapp/* workspace packages, which use the @clapp/
 * scope instead of a bare name).
 */
export const CODEGEN_PACKAGE_PREFIX = 'clapp-app-';

/** Options for {@link ./generate.ts generateApp}. */
export interface GenerateOptions {
  /**
   * Overrides the plan's PlannedServerSpec.port in the generated server's
   * default (the PORT env var still wins at runtime) and in the manifest.
   * Absent → the planned port is used verbatim.
   */
  port?: number;
}

/** One emitted file; `path` is relative to the app package root, forward slashes. */
export interface GeneratedFile {
  path: string;
  contents: string;
}

/** Summary of the generated app's shape (mirrors the plan's server spec + routes). */
export interface AppManifest {
  packageName: string;
  startCommand: string;
  port: number;
  healthPath: string;
  routePaths: string[];
  apiEndpoints: string[];
}

/** The whole generation result: a deterministic file tree + its manifest. */
export interface GeneratedApp {
  files: GeneratedFile[];
  manifest: AppManifest;
}

/**
 * Honesty declaration, IrAdapterInfo-shaped (see module doc). `supported`
 * here means plan contract versions this codegen renders — the SynthesisPlan
 * is this adapter's "model".
 */
export const CODEGEN_ADAPTER_INFO: {
  adapterId: string;
  supportedModelVersions: string[];
  emittedCapabilities: string[];
  unsupportedConstructs: string[];
  degradationBehavior: string;
} = {
  adapterId: '@clapp/codegen',
  supportedModelVersions: [PLAN_VERSION],
  emittedCapabilities: [
    'candidate-app file tree (package.json + zero-dep server.ts + per-route page modules + generated README)',
    'server-rendered HTML pages preserving testids, roles, accessible names, headings, links and forms',
    'mock backend for planned api endpoints (pattern-matched, first-mock-by-declaration-order, 501 without mocks)',
    'storage bindings: cookies via Set-Cookie, local/session via inline scripts, on the writtenOn transition routes',
    'app manifest (package name, start command, port, health path, route paths, api endpoints)',
  ],
  unsupportedConstructs: [
    'element nesting (the flat PlannedElement list renders as landmark-grouped siblings; document order and landmarks are preserved, parent/child structure is not encoded by the plan contract)',
    'client-side scripting beyond declared storage writes (no observed page scripts are replayed)',
    "storage: 'server' bindings (documented in the generated README; the mock backend is stateless)",
    'api request/response schema validation (mock bodies are served verbatim; schemas are documented, not enforced)',
    'dynamic data and request-body handling (pages are static pre-rendered HTML; request bodies are never read)',
  ],
  degradationBehavior:
    'Unsupported constructs are skipped and documented in the generated README and CODEGEN_ADAPTER_INFO; generation itself only throws on structurally malformed plans (version mismatch, duplicate route paths, dangling page/form references, invalid heading levels) — never to approximate behavior it cannot render honestly.',
};
