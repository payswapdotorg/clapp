/**
 * @clapp/observe — ObservationRunner: drives a scripted observation
 * session end-to-end through the EvidenceRecorder port.
 *
 * Composition: the runner is PLAYWRIGHT-FREE (no runtime import — the
 * PageDriver port abstracts the browser; wire in
 * createPlaywrightDriverFactory for real sessions). That is what makes
 * the recorder-port wiring unit-testable with a fake driver + fake
 * recorder, no browser required.
 *
 * Script semantics (deterministic by construction):
 *  - 'navigate' — goto + wait for the lifecycle point;
 *  - 'settle' — sleep, then drain settled network activity + SW events
 *    into the funnel (responses in request-initiation order);
 *  - 'capture-dom' / 'capture-storage' / 'capture-static' / 'screenshot'
 *    — explicit evidence steps;
 *  - 'action' — a journey-contract JourneyAction (click/fill resolve
 *    targets through dom-semantics against a fresh serialized tree, then
 *    act by element path);
 *  - 'flush' — force a funnel flush.
 *
 * Every capture flows: channel → SessionCore (prune → redact → canonical
 * check → bound) → onFlush → recorder.record(). The runner returns the
 * collected EvidenceRefs; on step failure it throws ObservationRunError
 * with the partial result (session end + recorder flush + driver close
 * always run — no orphaned contexts).
 */

import { Buffer } from 'node:buffer';
import type { EvidenceRef } from '@clapp/core';
import type { CaptureRecord, EvidenceRecorder } from './capture-contract';
import { normalizeDomTree, type DomTreeEnvelope, type RawDomNode } from './dom-serializer';
import { CLICK_BY_PATH_FN, DOM_TREE_FN, SET_VALUE_BY_PATH_FN, STATIC_LINKS_FN } from './dom-kit';
import { resolveTarget } from './dom-semantics';
import type { JourneyAction } from './journey-contract';
import { buildStorageInventory } from './logs/storage';
import type { NetworkCapturePayload } from './logs/network';
import { networkResponsesForInventory, buildStaticInventory, type DomAssetLinks, type NetworkResponseLike } from './static-inventory';
import type { PageDriver, PageDriverFactory } from './page-driver';
import {
  defaultRedactionPolicy,
  type RedactionPolicy,
} from './redaction';
import {
  networkChannelFor,
  SessionCore,
  type CaptureSink,
  type SessionCoreOptions,
  type SessionStats,
} from './session-core';

export type ObservationStep =
  | { type: 'navigate'; url: string; waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' }
  | { type: 'settle'; ms?: number }
  | { type: 'capture-dom'; rootSelector?: string }
  | { type: 'capture-storage' }
  | { type: 'capture-static' }
  | { type: 'screenshot'; fullPage?: boolean }
  | { type: 'action'; action: JourneyAction }
  | { type: 'flush' };

export interface ObservationScript {
  /** observed target identifier, e.g. "bench/b01-static" (carried to the result) */
  targetId: string;
  steps: ObservationStep[];
}

export interface StepOutcome {
  step: number;
  type: ObservationStep['type'];
  ok: boolean;
  recordsBefore: number;
  recordsAfter: number;
  error?: string;
}

export interface ObservationResult {
  targetId: string;
  steps: StepOutcome[];
  refs: EvidenceRef[];
  stats: SessionStats;
  /** records that reached the recorder (== stats.flushed after a clean end) */
  recordCount: number;
  durationMs: number;
  /** cleanup-phase errors (end/flush/close) that did not fail the run */
  cleanupNotes: string[];
}

export interface ObservationRunnerOptions {
  recorder: EvidenceRecorder;
  sessionFactory: PageDriverFactory;
  script: ObservationScript;
  /** redaction policy overrides (default: every rule active) */
  redaction?: Partial<RedactionPolicy>;
  /** SessionCore tuning (bounds, batching, clock) */
  session?: Partial<Omit<SessionCoreOptions, 'onFlush'>>;
}

export class ObservationRunError extends Error {
  constructor(
    readonly stepIndex: number,
    readonly cause: unknown,
    readonly partial: ObservationResult,
  ) {
    super(
      stepIndex < 0
        ? `observation cleanup failed: ${cause instanceof Error ? cause.message : String(cause)}`
        : `observation step ${stepIndex} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = 'ObservationRunError';
  }
}

const DEFAULT_SETTLE_MS = 250;

export class ObservationRunner {
  private readonly options: ObservationRunnerOptions;
  private readonly networkSeen: NetworkResponseLike[] = [];

  constructor(options: ObservationRunnerOptions) {
    this.options = options;
  }

  async run(): Promise<ObservationResult> {
    const startedAt = Date.now();
    const driver = await this.options.sessionFactory({ targetId: this.options.script.targetId });
    const policy: RedactionPolicy = { ...defaultRedactionPolicy(), ...this.options.redaction };
    const recorder = this.options.recorder;
    const refs: EvidenceRef[] = [];

    const core = new SessionCore({
      ...this.options.session,
      redactionPolicy: policy,
      onFlush: async (records: CaptureRecord[]) => {
        for (const record of records) {
          refs.push(await recorder.record(record));
        }
      },
    });

    const sink: CaptureSink = (channel, payload) => core.capture(channel, payload);
    const captureCapable = driver as Partial<PageDriver & { wireCapture?: (sink: CaptureSink) => void }>;
    if (typeof captureCapable.wireCapture === 'function') {
      captureCapable.wireCapture(sink);
    }

    const steps: StepOutcome[] = [];
    const cleanupNotes: string[] = [];
    let failure: { index: number; error: unknown } | null = null;
    let criticalCleanupFailure: unknown = null;

    core.start();
    try {
      const scriptSteps = this.options.script.steps;
      for (let i = 0; i < scriptSteps.length; i++) {
        const step = scriptSteps[i]!;
        const outcome: StepOutcome = {
          step: i,
          type: step.type,
          ok: true,
          recordsBefore: core.stats.enqueued,
          recordsAfter: core.stats.enqueued,
        };
        try {
          await this.runStep(step, core, driver, policy);
          outcome.recordsAfter = core.stats.enqueued;
          steps.push(outcome);
        } catch (error) {
          outcome.ok = false;
          outcome.error = error instanceof Error ? error.message : String(error);
          outcome.recordsAfter = core.stats.enqueued;
          steps.push(outcome);
          failure = { index: i, error };
          break;
        }
      }
    } finally {
      try {
        this.drainSettled(core, driver);
      } catch (error) {
        cleanupNotes.push(`drain: ${error instanceof Error ? error.message : String(error)}`);
      }
      try {
        await core.end();
      } catch (error) {
        // the session could not deliver its evidence — that is critical
        cleanupNotes.push(`session end: ${error instanceof Error ? error.message : String(error)}`);
        criticalCleanupFailure ??= error;
      }
      try {
        const flushed = await recorder.flush();
        for (const ref of flushed) {
          if (!refs.some((existing) => existing.evidenceId === ref.evidenceId)) {
            refs.push(ref);
          }
        }
      } catch (error) {
        cleanupNotes.push(`recorder flush: ${error instanceof Error ? error.message : String(error)}`);
        criticalCleanupFailure ??= error;
      }
      try {
        await driver.close();
      } catch (error) {
        cleanupNotes.push(`driver close: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const result: ObservationResult = {
      targetId: this.options.script.targetId,
      steps,
      refs,
      stats: core.stats,
      recordCount: core.stats.flushed,
      durationMs: Date.now() - startedAt,
      cleanupNotes,
    };
    if (failure !== null) {
      throw new ObservationRunError(failure.index, failure.error, result);
    }
    if (criticalCleanupFailure !== null) {
      throw new ObservationRunError(-1, criticalCleanupFailure, result);
    }
    return result;
  }

  private async runStep(step: ObservationStep, core: SessionCore, driver: PageDriver, policy: RedactionPolicy): Promise<void> {
    switch (step.type) {
      case 'navigate':
        await driver.navigate(step.url, step.waitUntil ?? 'load');
        return;
      case 'settle':
        await sleep(step.ms ?? DEFAULT_SETTLE_MS);
        this.drainSettled(core, driver);
        return;
      case 'capture-dom': {
        const envelope = await driver.evaluate<DomTreeEnvelope | null>(DOM_TREE_FN, {
          maxNodes: 25000,
          rootSelector: step.rootSelector,
        });
        const normalized = normalizeDomTree(envelope?.root as RawDomNode | undefined);
        core.capture('dom.tree', {
          subkind: 'dom-tree',
          root: normalized.root,
          nodeCount: normalized.nodeCount,
          truncated: (envelope?.truncated ?? false) || normalized.truncated,
        });
        return;
      }
      case 'capture-storage': {
        const raw = await driver.storageSnapshot();
        const cookies = await driver.cookies();
        core.capture('storage.inventory', buildStorageInventory(raw, cookies, policy));
        return;
      }
      case 'capture-static': {
        const links = await driver.evaluate<DomAssetLinks | null>(STATIC_LINKS_FN);
        core.capture('static.inventory', buildStaticInventory(links, this.networkSeen));
        return;
      }
      case 'screenshot': {
        const bytes = await driver.screenshotPng(step.fullPage ?? false);
        core.capture('screenshot.png', {
          subkind: 'screenshot-png',
          format: 'png',
          encoding: 'base64',
          data: Buffer.from(bytes).toString('base64'),
          byteLength: bytes.byteLength,
        });
        return;
      }
      case 'action':
        await this.applyAction(step.action, driver);
        return;
      case 'flush':
        await core.flush();
        return;
    }
  }

  private async applyAction(action: JourneyAction, driver: PageDriver): Promise<void> {
    switch (action.type) {
      case 'navigate':
        await driver.navigate(action.url);
        return;
      case 'press':
        await driver.pressKey(action.key);
        return;
      case 'wait':
        await sleep(action.ms);
        return;
      case 'click': {
        const target = await this.resolveTarget(driver, action.target, true);
        const clickResult = await driver.evaluate<{ ok: boolean; tag?: string; error?: string }>(CLICK_BY_PATH_FN, {
          path: target.path,
        });
        if (clickResult?.ok !== true) {
          throw new Error(`click by path [${target.path.join(', ')}] failed: ${clickResult?.error ?? 'unknown'}`);
        }
        return;
      }
      case 'fill': {
        const target = await this.resolveTarget(driver, action.target, true);
        const fillResult = await driver.evaluate<{ ok: boolean; tag?: string; error?: string }>(SET_VALUE_BY_PATH_FN, {
          path: target.path,
          value: action.value,
        });
        if (fillResult?.ok !== true) {
          throw new Error(`fill by path [${target.path.join(', ')}] failed: ${fillResult?.error ?? 'unknown'}`);
        }
        return;
      }
      case 'assert-visible': {
        await this.resolveTarget(driver, action.target, false);
        return;
      }
    }
  }

  /**
   * Resolves a selector against a FRESH full-document tree (action paths
   * are always element-child paths from documentElement — rootSelector
   * scoping is a capture-dom-only concern).
   */
  private async resolveTarget(driver: PageDriver, target: { role?: string; name?: string; testId?: string; nth?: number }, requireActionable: boolean): Promise<{ path: number[] }> {
    const envelope = await driver.evaluate<DomTreeEnvelope | null>(DOM_TREE_FN, {});
    const normalized = normalizeDomTree(envelope?.root as RawDomNode | undefined);
    const resolution = resolveTarget(normalized.root, target, { requireActionable });
    if (!resolution.ok) {
      throw new Error(`target resolution failed (${resolution.reason}): ${resolution.message}`);
    }
    return { path: resolution.target.path };
  }

  /** Drains settled network + service-worker events into the funnel (settlement points). */
  private drainSettled(core: SessionCore, driver: PageDriver): void {
    const drained = driver.drainPendingNetwork();
    for (const payload of drained) {
      const channel = networkChannelFor(payload.subkind);
      if (channel === null) continue;
      core.capture(channel, payload);
      if (payload.subkind === 'response') {
        this.networkSeen.push(...networkResponsesForInventory([payload as NetworkCapturePayload]));
      }
    }
    for (const registration of driver.drainPendingServiceWorkers()) {
      core.capture('storage.sw-registered', registration);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
