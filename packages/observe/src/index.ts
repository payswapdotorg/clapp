/**
 * @clapp/observe — CLAPP browser runner (CLAPP-010).
 *
 * Runs an authorized web app under observation and funnels every capture
 * channel (DOM, semantics, screenshots, console/runtime, network,
 * WebSocket frames, storage, service workers, static assets) through the
 * EvidenceRecorder port as typed, redacted, canonical-JSON CaptureRecords.
 *
 * Composition model:
 *   const runner = new ObservationRunner({
 *     recorder,                                    // @clapp/evidence impl (or a test fake)
 *     sessionFactory: createPlaywrightDriverFactory({ browser }),
 *     script: { targetId: 'bench/b01-static', steps: [...] },
 *   });
 *   const result = await runner.run();
 *
 * Pure core (canonical-json, redaction, dom-serializer, dom-semantics,
 * logs/*, static-inventory, session-core) has zero Playwright imports and
 * is unit-testable anywhere; the adapter (playwright-session, dom-kit,
 * sandbox-server, runner) drives it. Screenshot/driver wiring never leaks
 * into the pure core.
 *
 * Shared-contract mirrors (byte-identical, canonical ownership declared
 * in each header): capture-contract.ts (owner @clapp/evidence),
 * journey-contract.ts (owner @clapp/journey). The tech lead verifies
 * byte-equality at integration.
 */

// --- shared contract mirrors (byte-identical; re-exported for consumers) ---
export type { CaptureRecord, EvidenceRecorder } from './capture-contract';
export type { JourneyAction, Journey, JourneyRecorder, ActionApplier, TargetSelector } from './journey-contract';

// --- pure core ---
export {
  canonicalJson,
  canonicalJsonBytes,
  isCanonicalSerializable,
  pruneUndefined,
  isPlainObject,
  CanonicalJsonError,
} from './canonical-json';

export {
  defaultRedactionPolicy,
  policyIsActive,
  scrubString,
  scrubText,
  redactValue,
  redactCookieString,
} from './redaction';
export type { RedactionPolicy, RedactionResult } from './redaction';

export { normalizeDomTree, DEFAULT_ATTR_ALLOWLIST, DEFAULT_ATTR_PREFIXES } from './dom-serializer';
export type {
  RawDomNode,
  DomTreeEnvelope,
  SerializedNode,
  DomSerializationOptions,
  DomSerializationResult,
} from './dom-serializer';

export {
  ROLE_TABLE,
  ACTIONABLE_ROLES,
  isActionableRole,
  roleFor,
  collapseText,
  subtreeText,
  accessibleName,
  resolveTarget,
} from './dom-semantics';
export type { SemanticsInput, ResolvedTarget, TargetResolution, ResolveTargetOptions } from './dom-semantics';

export {
  sanitizeConsoleArg,
  buildPageErrorPayload,
  buildBrowserLogPayload,
  reduceRuntimeLog,
} from './logs/runtime';
export type {
  ConsoleCapturePayload,
  PageErrorCapturePayload,
  BrowserLogCapturePayload,
  RuntimeCapturePayload,
  RuntimeLogSummary,
} from './logs/runtime';

export {
  buildRequestPayload,
  buildResponsePayload,
  buildRequestFailedPayload,
  buildWsFramePayload,
  truncateText,
  reduceNetworkLog,
} from './logs/network';
export type {
  NetworkRequestPayload,
  NetworkResponsePayload,
  NetworkRequestFailedPayload,
  WebSocketFramePayload,
  NetworkCapturePayload,
  NetworkLogSummary,
} from './logs/network';

export { buildStorageInventory, reduceStorage } from './logs/storage';
export type {
  RawStorageSnapshot,
  DriverCookie,
  StorageEntryPreview,
  CookieInventoryEntry,
  ServiceWorkerInventoryEntry,
  CacheInventoryEntry,
  IndexedDbInventoryEntry,
  StorageInventoryPayload,
  ServiceWorkerRegisteredPayload,
  StorageSummary,
} from './logs/storage';

export { classifyStaticAsset, buildStaticInventory, networkResponsesForInventory } from './static-inventory';
export type {
  StaticAssetCategory,
  StaticAsset,
  DomAssetLinks,
  StaticInventoryPayload,
  NetworkResponseLike,
} from './static-inventory';

export {
  SessionCore,
  SessionStateError,
  CAPTURE_CHANNELS,
  isChannelName,
  networkChannelFor,
} from './session-core';
export type {
  ChannelSpec,
  ChannelName,
  SessionState,
  SessionStats,
  SessionCoreOptions,
  CaptureSink,
} from './session-core';

// --- adapter ---
export { DOM_TREE_FN, STATIC_LINKS_FN, STORAGE_SNAPSHOT_FN, CLICK_BY_PATH_FN, SET_VALUE_BY_PATH_FN } from './dom-kit';

export type { PageDriver, PageDriverFactory, NavigateWaitUntil, CaptureCapableDriver } from './page-driver';

export { PlaywrightSession, createPlaywrightDriverFactory, evaluateFnSource } from './playwright-session';
export type { PlaywrightSessionOptions } from './playwright-session';

export { launchServerInSandbox, ServerLaunchError } from './sandbox-server';
export type { LaunchServerInSandboxOptions, LaunchedServer } from './sandbox-server';

export { ObservationRunner, ObservationRunError } from './runner';
export type {
  ObservationStep,
  ObservationScript,
  StepOutcome,
  ObservationResult,
  ObservationRunnerOptions,
} from './runner';
