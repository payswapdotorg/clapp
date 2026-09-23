// In-memory store implementations (for tests and ephemeral runs).
//
// They share every validation and behavior rule with the filesystem stores
// through ./shared, and boundary values are JSON round-tripped (jsonClone)
// so callers can observe exactly — and only — what the filesystem store
// would have persisted. Records/metablocks/events handed out are detached
// copies: mutating them cannot corrupt the store, and mutating the input
// after put/append cannot rewrite what was stored.

import type { ArtifactId, ArtifactRecord, RunEvent, RunId, RunMeta, RunStatus } from '@clapp/core';
import type { ArtifactStore, PutArtifactInput, RunStore } from './types';
import {
  applyStatusUpdate,
  assertCreateRunAllowed,
  assertSafeId,
  assertSha256Hex,
  buildArtifactRecord,
  bytesEqual,
  checkAppendableSeq,
  jsonClone,
  sha256Hex,
  StoreIntegrityError,
  UnknownRunError,
  validateNewRunMeta,
  validatePutInput,
  validateRunEvent,
  validateStatusUpdate,
} from './shared';

export class MemoryArtifactStore implements ArtifactStore {
  private readonly recordsById = new Map<ArtifactId, ArtifactRecord>();
  private readonly artifactIdsByRun = new Map<RunId, ArtifactId[]>();
  private readonly blobsByStorageKey = new Map<string, Uint8Array>();

  async put(input: PutArtifactInput): Promise<ArtifactRecord> {
    validatePutInput(input);
    const sha256 = sha256Hex(input.bytes);
    const existing = this.findExisting(input.runId, sha256, input.kind);
    if (existing !== null) return { ...existing };
    const record = buildArtifactRecord(input, sha256);
    const storedBlob = this.blobsByStorageKey.get(record.storageKey);
    if (storedBlob === undefined) {
      this.blobsByStorageKey.set(record.storageKey, Uint8Array.from(input.bytes));
    } else if (!bytesEqual(storedBlob, input.bytes)) {
      throw new StoreIntegrityError(
        `refusing to overwrite blob ${record.storageKey}: existing content differs from its sha256-addressed bytes`,
      );
    }
    this.recordsById.set(record.id, { ...record });
    const ids = this.artifactIdsByRun.get(input.runId) ?? [];
    ids.push(record.id);
    this.artifactIdsByRun.set(input.runId, ids);
    return { ...record };
  }

  async get(id: ArtifactId): Promise<ArtifactRecord | null> {
    assertSafeId(id, 'artifactId');
    const record = this.recordsById.get(id);
    return record === undefined ? null : { ...record };
  }

  async getBySha256(sha256: string, runId: RunId): Promise<ArtifactRecord | null> {
    assertSha256Hex(sha256, 'sha256');
    assertSafeId(runId, 'runId');
    const ids = this.artifactIdsByRun.get(runId);
    if (ids === undefined) return null;
    for (const id of ids) {
      const record = this.recordsById.get(id);
      if (record !== undefined && record.sha256 === sha256) return { ...record };
    }
    return null;
  }

  async readBytes(id: ArtifactId): Promise<Uint8Array | null> {
    assertSafeId(id, 'artifactId');
    const record = this.recordsById.get(id);
    if (record === undefined) return null;
    const blob = this.blobsByStorageKey.get(record.storageKey);
    if (blob === undefined) {
      throw new StoreIntegrityError(`blob for artifact ${id} is missing (${record.storageKey})`);
    }
    return Uint8Array.from(blob);
  }

  async list(runId: RunId): Promise<ArtifactRecord[]> {
    assertSafeId(runId, 'runId');
    const ids = this.artifactIdsByRun.get(runId);
    if (ids === undefined) return [];
    const out: ArtifactRecord[] = [];
    for (const id of ids) {
      const record = this.recordsById.get(id);
      if (record === undefined) {
        throw new StoreIntegrityError(`run ${runId} references missing artifact record ${id}`);
      }
      out.push({ ...record });
    }
    return out;
  }

  private findExisting(runId: RunId, sha256: string, kind: PutArtifactInput['kind']): ArtifactRecord | null {
    const ids = this.artifactIdsByRun.get(runId);
    if (ids === undefined) return null;
    for (const id of ids) {
      const record = this.recordsById.get(id);
      if (record !== undefined && record.sha256 === sha256 && record.kind === kind) return record;
    }
    return null;
  }
}

export class MemoryRunStore implements RunStore {
  private readonly metasById = new Map<RunId, RunMeta>();
  private readonly eventsByRun = new Map<RunId, RunEvent[]>();

  async createRun(meta: RunMeta): Promise<RunMeta> {
    validateNewRunMeta(meta);
    const stored = jsonClone(meta);
    const existing = this.metasById.get(meta.id);
    if (existing !== undefined) {
      assertCreateRunAllowed(existing, stored);
      return jsonClone(existing);
    }
    this.metasById.set(meta.id, stored);
    return jsonClone(stored);
  }

  async appendEvent(event: RunEvent): Promise<void> {
    validateRunEvent(event);
    if (!this.metasById.has(event.runId)) {
      throw new UnknownRunError(`cannot append event: run ${event.runId} does not exist`);
    }
    const events = this.eventsByRun.get(event.runId) ?? [];
    checkAppendableSeq(events, event);
    events.push(jsonClone(event));
    this.eventsByRun.set(event.runId, events);
  }

  async getRun(id: RunId): Promise<RunMeta | null> {
    assertSafeId(id, 'runId');
    const meta = this.metasById.get(id);
    return meta === undefined ? null : jsonClone(meta);
  }

  async listEvents(id: RunId): Promise<RunEvent[]> {
    assertSafeId(id, 'runId');
    if (!this.metasById.has(id)) {
      throw new UnknownRunError(`run ${id} does not exist; cannot list events`);
    }
    return (this.eventsByRun.get(id) ?? []).map((event) => jsonClone(event));
  }

  async updateStatus(id: RunId, status: RunStatus, endedAt?: string): Promise<RunMeta | null> {
    assertSafeId(id, 'runId');
    validateStatusUpdate(status, endedAt);
    const meta = this.metasById.get(id);
    if (meta === undefined) return null;
    const updated = applyStatusUpdate(meta, status, endedAt);
    this.metasById.set(id, updated);
    return jsonClone(updated);
  }
}
