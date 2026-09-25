/**
 * RecordingSession — the @clapp/evidence implementation of the EvidenceRecorder
 * port (src/capture-contract.ts, canonical copy of the tech-lead declaration).
 *
 * Wiring per capture (the CLAPP-011 acceptance contract):
 *
 *   CaptureRecord ──canonicalJson──▶ bytes ──sha256──▶ EvidenceRef.sha256
 *        │                                          │
 *        └── ArtifactStore.put(kind: evidence-appropriate   │
 *              artifact kind, mediaType: application/json,  │
 *              redacted: capture.redacted)                 ▼
 *                                              RunStore.appendEvent(
 *                                                'evidence.recorded',
 *                                                evidenceRefs: [ref])
 *
 * Semantics (documented honestly):
 *
 * - **Eager write-through**: `record()` persists the artifact and appends the
 *   run event immediately; there is no in-memory-only window in which
 *   evidence exists only inside the recorder. `flush()` therefore has
 *   nothing buffered to force out — it is an idempotent sync point that
 *   returns every ref emitted this session (allowed by the port contract).
 * - **Idempotent record()**: a byte-identical CaptureRecord (same canonical
 *   bytes, hence same ts and content) is a retry, not a new observation:
 *   the session returns the SAME EvidenceRef and appends no second event.
 *   This mirrors the content-addressed dedupe the ArtifactStore already
 *   guarantees at the blob level. Dedupe scope is THIS session only — a
 *   later session recording the same bytes mints a fresh evidenceId and a
 *   fresh event (honest: a new observation happened).
 * - **Single-writer**: the session owns seq assignment for its run and
 *   assumes no concurrent appender (the fs store has no locking — see
 *   @clapp/store README). The store's monotonicity check remains the
 *   backstop: a colliding append throws rather than corrupting the log.
 * - **Redaction is the channel's duty**: the recorder persists exactly what
 *   it receives and copies `capture.redacted` onto the artifact record; it
 *   does NOT scan payloads for secrets (CLAPP channels redact before the
 *   recorder; see the security docs).
 */

import { EVIDENCE_KINDS, newEvidenceId, newRunId, sha256Hex } from '@clapp/core';
import type {
  ArtifactKind,
  EvidenceKind,
  EvidenceRef,
  RunBudget,
  RunEvent,
  RunEventKind,
  RunId,
  RunMeta,
  RunStatus,
} from '@clapp/core';
import type { ArtifactStore, RunStore } from '@clapp/store';
import type { CaptureRecord, EvidenceRecorder } from './capture-contract';
import { canonicalJson } from './canonical-json';
import { errorMessage, preview } from './inspect';

/** Thrown when a CaptureRecord violates the capture contract. */
export class InvalidCaptureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidCaptureError';
  }
}

/** Thrown when a session API is used after the run reached a terminal state. */
export class SessionStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionStateError';
  }
}

/** The two stores a RecordingSession records into (fs or memory pairs). */
export interface RecordingStores {
  runStore: RunStore;
  artifactStore: ArtifactStore;
}

/** Options for {@link RecordingSession.start}. */
export interface StartRecordingOptions {
  targetId: string;
  /** run kind recorded in RunMeta; defaults to 'observation'. */
  kind?: string;
  /** captured execution environment recorded in RunMeta; defaults to {}. */
  environment?: Record<string, unknown>;
  budget?: RunBudget;
}

/** Every evidence capture is persisted as canonical JSON bytes. */
export const EVIDENCE_MEDIA_TYPE = 'application/json';

/**
 * EvidenceKind → ArtifactKind mapping used when persisting captures.
 *
 * 'dom', 'network', 'runtime' and 'screenshot' map onto the closed
 * ArtifactKind vocabulary; 'storage', 'static' and 'user' use the
 * extensible tail of ArtifactKind (documented package-level extensions —
 * the union is `(string & {})` precisely so recording channels can name
 * artifact kinds the core vocabulary does not cover).
 */
export const EVIDENCE_TO_ARTIFACT_KIND: Readonly<Record<EvidenceKind, ArtifactKind>> = {
  dom: 'dom-snapshot',
  runtime: 'trace',
  network: 'har',
  storage: 'storage',
  screenshot: 'screenshot',
  static: 'static',
  user: 'user',
};

/** The artifact kind a capture of `kind` is persisted under. */
export function artifactKindForEvidence(kind: EvidenceKind): ArtifactKind {
  return EVIDENCE_TO_ARTIFACT_KIND[kind];
}

function nowIso(): string {
  return new Date().toISOString();
}

function captureViolations(capture: unknown): string[] {
  if (typeof capture !== 'object' || capture === null) {
    return [`CaptureRecord must be an object, observed ${preview(capture)}`];
  }
  const record = capture as Partial<CaptureRecord>;
  const out: string[] = [];
  if (typeof record.kind !== 'string' || !(EVIDENCE_KINDS as readonly string[]).includes(record.kind)) {
    out.push(`kind must be one of ${EVIDENCE_KINDS.join('|')}, observed ${preview(record.kind)}`);
  }
  if (typeof record.ts !== 'string' || Number.isNaN(Date.parse(record.ts))) {
    out.push(`ts must be a parseable ISO-8601 timestamp, observed ${preview(record.ts)}`);
  }
  if (typeof record.redacted !== 'boolean') {
    out.push(`redacted must be a boolean, observed ${preview(record.redacted)}`);
  }
  // payload structure is validated by canonicalJson (type-agnostic).
  return out;
}

/**
 * A live recording session over an injected RunStore + ArtifactStore.
 * Implements the EvidenceRecorder port from src/capture-contract.ts.
 */
export class RecordingSession implements EvidenceRecorder {
  private readonly runStore: RunStore;
  private readonly artifactStore: ArtifactStore;
  private meta: RunMeta;
  private nextSeq = 0;
  private readonly refsByContentKey = new Map<string, EvidenceRef>();
  private readonly refsInOrder: EvidenceRef[] = [];
  private ended = false;
  private endedStatus: RunStatus | undefined;

  private constructor(stores: RecordingStores, meta: RunMeta) {
    this.runStore = stores.runStore;
    this.artifactStore = stores.artifactStore;
    this.meta = meta;
  }

  /**
   * Create the run, append `run.started` (seq 0), and flip the run to
   * 'running' — createRun → appendEvent → updateStatus, the full lifecycle
   * wiring over the frozen RunStore surface.
   */
  static async start(stores: RecordingStores, options: StartRecordingOptions): Promise<RecordingSession> {
    if (typeof options?.targetId !== 'string' || options.targetId.length === 0) {
      throw new Error('RecordingSession.start: targetId must be a non-empty string');
    }
    const meta: RunMeta = {
      id: newRunId(),
      targetId: options.targetId,
      kind: options.kind ?? 'observation',
      status: 'planned',
      startedAt: nowIso(),
      environment: options.environment ?? {},
      ...(options.budget !== undefined ? { budget: options.budget } : {}),
    };
    // The store's createRun validates the rest of the meta honestly.
    await stores.runStore.createRun(meta);
    const session = new RecordingSession(stores, meta);
    await session.appendEvent('run.started', { targetId: meta.targetId, kind: meta.kind });
    const running = await stores.runStore.updateStatus(meta.id, 'running');
    if (running === null) {
      throw new Error(`RecordingSession.start: run ${meta.id} disappeared before it could be marked running`);
    }
    session.meta = running;
    return session;
  }

  /** The run this session records into (EvidenceRecorder port). */
  get runId(): RunId {
    return this.meta.id;
  }

  /** Every ref emitted this session, in record order (detached copies). */
  get refs(): readonly EvidenceRef[] {
    return this.refsInOrder.map((ref) => ({ ...ref }));
  }

  private assertOpen(operation: string): void {
    if (this.ended) {
      throw new SessionStateError(
        `${operation} is not allowed: run already ended with status '${this.endedStatus}'`,
      );
    }
  }

  /**
   * Record one capture: canonicalize → hash → persist artifact → append
   * 'evidence.recorded'. Byte-identical repeats return the existing ref
   * (see module doc: idempotent record()).
   */
  async record(capture: CaptureRecord): Promise<EvidenceRef> {
    this.assertOpen('record()');
    const violations = captureViolations(capture);
    if (violations.length > 0) {
      throw new InvalidCaptureError(`invalid CaptureRecord: ${violations.join('; ')}`);
    }

    let canonical: string;
    try {
      canonical = canonicalJson(capture);
    } catch (error) {
      throw new InvalidCaptureError(
        `CaptureRecord is not canonical-JSON serializable: ${errorMessage(error)}`,
      );
    }
    const bytes = new TextEncoder().encode(canonical);
    const sha256 = await sha256Hex(bytes);

    const dedupeKey = `${capture.kind}:${sha256}`;
    const existing = this.refsByContentKey.get(dedupeKey);
    if (existing !== undefined) {
      return { ...existing };
    }

    const artifact = await this.artifactStore.put({
      runId: this.meta.id,
      kind: artifactKindForEvidence(capture.kind),
      mediaType: EVIDENCE_MEDIA_TYPE,
      bytes,
      redacted: capture.redacted,
    });

    const ref: EvidenceRef = { evidenceId: newEvidenceId(), kind: capture.kind, sha256 };
    this.refsByContentKey.set(dedupeKey, { ...ref });
    this.refsInOrder.push({ ...ref });
    await this.appendEvent(
      'evidence.recorded',
      { artifactId: artifact.id, sizeBytes: artifact.sizeBytes },
      [ref],
    );
    return { ...ref };
  }

  /**
   * Sync point required by the EvidenceRecorder port. Because record()
   * writes through eagerly, flush() has nothing buffered to force: it
   * idempotently returns every ref emitted this session.
   */
  async flush(): Promise<EvidenceRef[]> {
    return this.refsInOrder.map((ref) => ({ ...ref }));
  }

  /** Append a plain 'log' event to the run's event stream. */
  async log(payload: unknown): Promise<void> {
    this.assertOpen('log()');
    await this.appendEvent('log', payload);
  }

  /** Append `run.completed` + set status/endedAt. Terminal. */
  async complete(): Promise<RunMeta> {
    return this.end('completed', 'run.completed', { evidenceCount: this.refsInOrder.length });
  }

  /** Append `run.failed` (with reason payload when given) + set status/endedAt. Terminal. */
  async fail(reason?: string): Promise<RunMeta> {
    return this.end('failed', 'run.failed', reason !== undefined ? { reason } : undefined);
  }

  /** Append `run.cancelled` + set status/endedAt. Terminal. */
  async cancel(): Promise<RunMeta> {
    return this.end('cancelled', 'run.cancelled', undefined);
  }

  private async end(
    status: Extract<RunStatus, 'completed' | 'failed' | 'cancelled'>,
    kind: RunEventKind,
    payload: unknown,
  ): Promise<RunMeta> {
    this.assertOpen(`end(${status})`);
    this.ended = true;
    this.endedStatus = status;
    await this.appendEvent(kind, payload);
    const updated = await this.runStore.updateStatus(this.meta.id, status, nowIso());
    if (updated === null) {
      throw new Error(`RecordingSession: run ${this.meta.id} disappeared while ending with status '${status}'`);
    }
    this.meta = updated;
    return { ...updated };
  }

  private async appendEvent(
    kind: RunEventKind,
    payload?: unknown,
    evidenceRefs?: EvidenceRef[],
  ): Promise<void> {
    const event: RunEvent = {
      runId: this.meta.id,
      seq: this.nextSeq,
      ts: nowIso(),
      kind,
      ...(payload !== undefined ? { payload } : {}),
      ...(evidenceRefs !== undefined ? { evidenceRefs: evidenceRefs.map((ref) => ({ ...ref })) } : {}),
    };
    await this.runStore.appendEvent(event);
    this.nextSeq += 1;
  }
}
