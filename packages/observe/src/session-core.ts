/**
 * @clapp/observe — SessionCore: the capture session state machine.
 *
 * One instance per observation session. Owns:
 *  - state machine: idle → running ⇄ paused → ended (invalid transitions
 *    throw; captures while paused or after end are DROPPED and counted —
 *    pause means "not recording", not "record later");
 *  - the funnel every capture channel passes through: channel id →
 *    pruneUndefined → redaction (policy-driven, screenshots excluded) →
 *    canonical-JSON byte check (rejects invalid/oversized, counted) →
 *    buffer;
 *  - event batching: buffer flushes to `onFlush` when it reaches
 *    flushBatchSize (auto-flush errors requeue and are counted, never
 *    thrown from capture()); `flush()`/`end()` propagate errors to the
 *    caller;
 *  - buffer bounds: maxBufferedRecords (drop-oldest on overflow, counted)
 *    and maxRecordBytes (oversized records rejected, counted).
 *
 * CaptureRecord.redacted semantics (documented in README): true iff the
 * record passed through an ACTIVE redaction policy — provenance of the
 * scrubbing pass, not a claim that secret-shaped content was found.
 */

import type { EvidenceKind } from '@clapp/core';
import { canonicalJsonBytes, pruneUndefined } from './canonical-json';
import { defaultRedactionPolicy, policyIsActive, redactValue, type RedactionPolicy } from './redaction';
import type { CaptureRecord } from './capture-contract';

/** Channel registry: every capture lane this package knows, with its evidence kind + redactability. */
export interface ChannelSpec {
  kind: EvidenceKind;
  subkind: string;
  /** false when payload bytes cannot be meaningfully scrubbed (screenshots) */
  redactable: boolean;
  description: string;
}

export const CAPTURE_CHANNELS = {
  'dom.tree': { kind: 'dom', subkind: 'dom-tree', redactable: true, description: 'serialized DOM subtree (tag/role/text/attr subset/child order)' },
  'runtime.console': { kind: 'runtime', subkind: 'console', redactable: true, description: 'page console call (level/text/args/location)' },
  'runtime.pageerror': { kind: 'runtime', subkind: 'pageerror', redactable: true, description: 'uncaught page exception' },
  'runtime.browser-log': { kind: 'runtime', subkind: 'browser-log', redactable: true, description: 'CDP Log.entryAdded browser-level entry (level-filtered)' },
  'network.request': { kind: 'network', subkind: 'request', redactable: true, description: 'network request initiated' },
  'network.response': { kind: 'network', subkind: 'response', redactable: true, description: 'network response drained at settlement (request order)' },
  'network.requestfailed': { kind: 'network', subkind: 'requestfailed', redactable: true, description: 'failed network request drained at settlement' },
  'network.ws-frame': { kind: 'network', subkind: 'ws-frame', redactable: true, description: 'WebSocket frame sent/received (payload preview)' },
  'storage.inventory': { kind: 'storage', subkind: 'storage-inventory', redactable: true, description: 'localStorage/sessionStorage/cookies/SW/caches/IndexedDB inventory' },
  'storage.sw-registered': { kind: 'storage', subkind: 'sw-registered', redactable: true, description: 'service worker registration event' },
  'screenshot.png': { kind: 'screenshot', subkind: 'screenshot-png', redactable: false, description: 'base64 PNG bytes + metadata (pixels are NOT redactable)' },
  'static.inventory': { kind: 'static', subkind: 'static-inventory', redactable: true, description: 'static asset inventory (scripts/styles/images/fonts/manifests)' },
} as const satisfies Record<string, ChannelSpec>;

export type ChannelName = keyof typeof CAPTURE_CHANNELS;

export function isChannelName(name: string): name is ChannelName {
  return Object.prototype.hasOwnProperty.call(CAPTURE_CHANNELS, name);
}

/** Maps a network payload subkind to its channel (null for unknown). */
export function networkChannelFor(subkind: string): ChannelName | null {
  switch (subkind) {
    case 'request':
      return 'network.request';
    case 'response':
      return 'network.response';
    case 'requestfailed':
      return 'network.requestfailed';
    default:
      return null;
  }
}

export type SessionState = 'idle' | 'running' | 'paused' | 'ended';

export class SessionStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionStateError';
  }
}

export interface SessionStats {
  enqueued: number;
  flushed: number;
  flushes: number;
  flushErrors: number;
  lastFlushError?: string;
  droppedWhilePaused: number;
  droppedAfterEnd: number;
  droppedOverflow: number;
  rejectedOversized: number;
  rejectedInvalid: number;
}

export interface SessionCoreOptions {
  /** the sink batches are flushed to (usually: recorder.record per record) */
  onFlush: (records: CaptureRecord[]) => Promise<void>;
  /** flush when the buffer reaches this size (default 32) */
  flushBatchSize?: number;
  /** hard bound on buffered records; overflow drops oldest (default 10_000) */
  maxBufferedRecords?: number;
  /** per-record canonical byte cap (default 2 MiB) */
  maxRecordBytes?: number;
  /** injectable clock for tests (default real UTC ISO-8601) */
  clock?: () => string;
  /** redaction policy applied at the funnel (default: all rules active) */
  redactionPolicy?: RedactionPolicy;
}

const DEFAULT_FLUSH_BATCH_SIZE = 32;
const DEFAULT_MAX_BUFFERED = 10_000;
const DEFAULT_MAX_RECORD_BYTES = 2 * 1024 * 1024;

/** The funnel signature capture subscriptions push through. */
export type CaptureSink = (channel: ChannelName, payload: unknown) => void;

export class SessionCore {
  private stateValue: SessionState = 'idle';
  private buffer: CaptureRecord[] = [];
  private readonly onFlush: SessionCoreOptions['onFlush'];
  private readonly flushBatchSize: number;
  private readonly maxBufferedRecords: number;
  private readonly maxRecordBytes: number;
  private readonly clock: () => string;
  private readonly policy: RedactionPolicy;
  private readonly statsValue: SessionStats = {
    enqueued: 0,
    flushed: 0,
    flushes: 0,
    flushErrors: 0,
    droppedWhilePaused: 0,
    droppedAfterEnd: 0,
    droppedOverflow: 0,
    rejectedOversized: 0,
    rejectedInvalid: 0,
  };
  /** serializes every flush (manual + auto) so batches never interleave */
  private flushChain: Promise<void> = Promise.resolve();

  constructor(options: SessionCoreOptions) {
    this.onFlush = options.onFlush;
    this.flushBatchSize = options.flushBatchSize ?? DEFAULT_FLUSH_BATCH_SIZE;
    this.maxBufferedRecords = options.maxBufferedRecords ?? DEFAULT_MAX_BUFFERED;
    this.maxRecordBytes = options.maxRecordBytes ?? DEFAULT_MAX_RECORD_BYTES;
    this.clock = options.clock ?? (() => new Date().toISOString());
    this.policy = options.redactionPolicy ?? defaultRedactionPolicy();
    if (this.flushBatchSize < 1 || this.maxBufferedRecords < 1 || this.maxRecordBytes < 1) {
      throw new SessionStateError('SessionCore bounds must be >= 1');
    }
  }

  get state(): SessionState {
    return this.stateValue;
  }

  get stats(): SessionStats {
    return { ...this.statsValue };
  }

  get buffered(): number {
    return this.buffer.length;
  }

  /** idle → running. */
  start(): void {
    if (this.stateValue !== 'idle') {
      throw new SessionStateError(`start() requires state 'idle', observed '${this.stateValue}'`);
    }
    this.stateValue = 'running';
  }

  /** running → paused: captures while paused are dropped (counted). */
  pause(): void {
    if (this.stateValue !== 'running') {
      throw new SessionStateError(`pause() requires state 'running', observed '${this.stateValue}'`);
    }
    this.stateValue = 'paused';
  }

  /** paused → running. */
  resume(): void {
    if (this.stateValue !== 'paused') {
      throw new SessionStateError(`resume() requires state 'paused', observed '${this.stateValue}'`);
    }
    this.stateValue = 'running';
  }

  /**
   * → ended: drains the buffer through onFlush (errors propagate to the
   * caller after being counted), then ends the session. Idempotent.
   */
  async end(): Promise<void> {
    if (this.stateValue === 'ended') return;
    if (this.stateValue === 'idle') {
      throw new SessionStateError("end() from 'idle' — nothing started; sessions must start before they end");
    }
    try {
      await this.flush();
    } finally {
      this.stateValue = 'ended';
    }
  }

  /**
   * The funnel: prunes undefined, applies redaction (redactable channels,
   * active policy), builds the CaptureRecord, enforces byte bounds, and
   * buffers. Never throws for payload-shape problems (counted instead);
   * invalid channel names throw (programmer error).
   */
  capture(channel: ChannelName, payload: unknown): void {
    const spec = CAPTURE_CHANNELS[channel];
    if (spec === undefined) {
      throw new SessionStateError(`unknown capture channel: ${String(channel)}`);
    }
    if (this.stateValue !== 'running') {
      if (this.stateValue === 'paused') this.statsValue.droppedWhilePaused++;
      else this.statsValue.droppedAfterEnd++;
      return;
    }

    let finalPayload = pruneUndefined(payload);
    let redacted = false;
    if (spec.redactable && policyIsActive(this.policy)) {
      finalPayload = redactValue(finalPayload, this.policy).value;
      redacted = true;
    }

    let byteLength: number;
    try {
      byteLength = canonicalJsonBytes(finalPayload).byteLength;
    } catch {
      this.statsValue.rejectedInvalid++;
      return;
    }
    if (byteLength > this.maxRecordBytes) {
      this.statsValue.rejectedOversized++;
      return;
    }

    const record: CaptureRecord = { kind: spec.kind, ts: this.clock(), payload: finalPayload, redacted };
    this.buffer.push(record);
    this.statsValue.enqueued++;

    if (this.buffer.length > this.maxBufferedRecords) {
      this.buffer.shift();
      this.statsValue.droppedOverflow++;
    }
    if (this.buffer.length >= this.flushBatchSize) {
      this.scheduleAutoFlush();
    }
  }

  /** Manual flush: drains the buffer; flush errors requeue and RETHROW. */
  async flush(): Promise<void> {
    const job = this.flushChain.then(() => this.performFlush());
    // keep the chain usable even when this flush rejects
    this.flushChain = job.catch(() => undefined);
    await job;
  }

  private scheduleAutoFlush(): void {
    // errors are counted + requeued inside performFlush; swallow here —
    // capture() callers (event handlers) cannot await
    this.flushChain = this.flushChain.then(() => this.performFlush()).catch(() => undefined);
  }

  private async performFlush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const batch = this.buffer;
    this.buffer = [];
    this.statsValue.flushes++;
    try {
      await this.onFlush(batch);
    } catch (error) {
      // requeue at the FRONT so ordering is preserved for the retry
      this.buffer = batch.concat(this.buffer);
      this.statsValue.flushErrors++;
      this.statsValue.lastFlushError = error instanceof Error ? error.message : String(error);
      throw error;
    }
    this.statsValue.flushed += batch.length;
  }
}
