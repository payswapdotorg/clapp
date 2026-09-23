// Filesystem-backed store implementations + loadRun.
//
// Layout under rootDir (all stores sharing one rootDir interoperate):
//   objects/<aa>/<bb>/<sha256>        content-addressed blobs (write-once)
//   runs/<runId>.json                 run metadata (only status/endedAt ever mutate)
//   events/<runId>.jsonl              append-only per-run event log (JSONL)
//   artifacts/by-id/<artifactId>.json artifact records (write-once)
//   artifacts/by-run/<runId>.jsonl    append-only per-run artifact manifest (JSONL)
//
// Write ordering on put(): blob → record file → manifest line. The manifest
// append is the commit point: a crash before it leaves an orphan blob/record
// that is invisible to reads; a manifest line always has its record on disk.

import { join, resolve } from 'node:path';
import type { ArtifactId, ArtifactRecord, RunEvent, RunId, RunMeta, RunStatus } from '@clapp/core';
import type { ArtifactStore, LoadedRun, PutArtifactInput, RunStore } from './types';
import type { ManifestEntry } from './shared';
import * as io from './fs-io';
import {
  applyStatusUpdate,
  assertCreateRunAllowed,
  assertSafeId,
  assertSha256Hex,
  buildArtifactRecord,
  checkAppendableSeq,
  InvalidInputError,
  jsonClone,
  parseArtifactRecordFromDisk,
  parseJsonl,
  parseManifestEntry,
  parseRunEventFromDisk,
  parseRunMetaFromDisk,
  sha256Hex,
  StoreIntegrityError,
  UnknownRunError,
  validateNewRunMeta,
  validatePutInput,
  validateRunEvent,
  validateStatusUpdate,
} from './shared';

function blobPath(rootDir: string, sha256: string): string {
  return join(rootDir, 'objects', sha256.slice(0, 2), sha256.slice(2, 4), sha256);
}

function runMetaPath(rootDir: string, runId: string): string {
  return join(rootDir, 'runs', `${runId}.json`);
}

function eventsPath(rootDir: string, runId: string): string {
  return join(rootDir, 'events', `${runId}.jsonl`);
}

function artifactRecordPath(rootDir: string, artifactId: string): string {
  return join(rootDir, 'artifacts', 'by-id', `${artifactId}.json`);
}

function artifactManifestPath(rootDir: string, runId: string): string {
  return join(rootDir, 'artifacts', 'by-run', `${runId}.jsonl`);
}

/**
 * Filesystem artifact store over `rootDir`. Content-addressed and write-once:
 * identical (runId, sha256, kind) puts return the ONE existing record; blobs
 * are never overwritten (divergence under an existing hash is an integrity
 * error); `readBytes` re-verifies the hash on every read so tampering fails
 * loudly instead of replaying corrupted evidence.
 */
export class FsArtifactStore implements ArtifactStore {
  private readonly rootDir: string;

  constructor(rootDir: string) {
    if (typeof rootDir !== 'string' || rootDir.trim().length === 0) {
      throw new InvalidInputError('FsArtifactStore requires a non-empty rootDir');
    }
    this.rootDir = resolve(rootDir);
  }

  async put(input: PutArtifactInput): Promise<ArtifactRecord> {
    validatePutInput(input);
    const sha256 = sha256Hex(input.bytes);
    // Dedupe against the on-disk manifest (fresh read: correct across
    // sequentially reused store instances pointing at the same rootDir).
    for (const entry of await this.readManifest(input.runId)) {
      if (entry.sha256 === sha256 && entry.kind === input.kind) {
        const existing = await this.readRecord(entry.artifactId);
        if (existing === null) {
          throw new StoreIntegrityError(
            `artifact manifest for run ${input.runId} references missing record ${entry.artifactId}`,
          );
        }
        return existing;
      }
    }
    const record = buildArtifactRecord(input, sha256);
    await io.writeBlobOnce(blobPath(this.rootDir, sha256), input.bytes);
    await io.writeJsonFile(artifactRecordPath(this.rootDir, record.id), record);
    await io.appendJsonlLine(artifactManifestPath(this.rootDir, input.runId), {
      artifactId: record.id,
      sha256,
      kind: input.kind,
    });
    return record;
  }

  async get(id: ArtifactId): Promise<ArtifactRecord | null> {
    assertSafeId(id, 'artifactId');
    return this.readRecord(id);
  }

  async getBySha256(sha256: string, runId: RunId): Promise<ArtifactRecord | null> {
    assertSha256Hex(sha256, 'sha256');
    assertSafeId(runId, 'runId');
    for (const entry of await this.readManifest(runId)) {
      if (entry.sha256 === sha256) {
        const record = await this.readRecord(entry.artifactId);
        if (record === null) {
          throw new StoreIntegrityError(`artifact manifest for run ${runId} references missing record ${entry.artifactId}`);
        }
        return record;
      }
    }
    return null;
  }

  async readBytes(id: ArtifactId): Promise<Uint8Array | null> {
    assertSafeId(id, 'artifactId');
    const record = await this.readRecord(id);
    if (record === null) return null;
    return this.readVerifiedBlob(record);
  }

  async list(runId: RunId): Promise<ArtifactRecord[]> {
    assertSafeId(runId, 'runId');
    const out: ArtifactRecord[] = [];
    for (const entry of await this.readManifest(runId)) {
      const record = await this.readRecord(entry.artifactId);
      if (record === null) {
        throw new StoreIntegrityError(`artifact manifest for run ${runId} references missing record ${entry.artifactId}`);
      }
      out.push(record);
    }
    return out;
  }

  private async readManifest(runId: RunId): Promise<ManifestEntry[]> {
    const text = await io.readTextFile(artifactManifestPath(this.rootDir, runId));
    if (text === null) return [];
    const ctx = `artifact manifest for run ${runId}`;
    return parseJsonl(text, ctx).map((value, index) => parseManifestEntry(value, `${ctx} entry ${index + 1}`));
  }

  private async readRecord(id: ArtifactId): Promise<ArtifactRecord | null> {
    const value = await io.readJsonFile(artifactRecordPath(this.rootDir, id));
    if (value === null) return null;
    return parseArtifactRecordFromDisk(value, `artifact record ${id}`);
  }

  private async readVerifiedBlob(record: ArtifactRecord): Promise<Uint8Array> {
    const path = join(this.rootDir, record.storageKey);
    const bytes = await io.readBinaryFile(path);
    if (bytes === null) {
      throw new StoreIntegrityError(`blob for artifact ${record.id} is missing at ${path}`);
    }
    const actual = sha256Hex(bytes);
    if (actual !== record.sha256) {
      throw new StoreIntegrityError(
        `blob for artifact ${record.id} failed integrity check: recorded sha256 ${record.sha256}, content hashes to ${actual}`,
      );
    }
    return bytes;
  }
}

/**
 * Filesystem run store over `rootDir`: `runs/<runId>.json` metadata plus an
 * append-only `events/<runId>.jsonl` log. appendEvent re-reads the log fresh
 * and rejects non-monotonic seq; updateStatus rewrites ONLY status/endedAt.
 */
export class FsRunStore implements RunStore {
  private readonly rootDir: string;

  constructor(rootDir: string) {
    if (typeof rootDir !== 'string' || rootDir.trim().length === 0) {
      throw new InvalidInputError('FsRunStore requires a non-empty rootDir');
    }
    this.rootDir = resolve(rootDir);
  }

  async createRun(meta: RunMeta): Promise<RunMeta> {
    validateNewRunMeta(meta);
    const existing = await this.readMeta(meta.id);
    if (existing !== null) {
      // Identical meta → idempotent no-op returning the stored record;
      // divergent meta → throw. Runs are never silently overwritten.
      assertCreateRunAllowed(existing, meta);
      return existing;
    }
    await io.writeJsonFile(runMetaPath(this.rootDir, meta.id), meta);
    return jsonClone(meta);
  }

  async appendEvent(event: RunEvent): Promise<void> {
    validateRunEvent(event);
    const meta = await this.readMeta(event.runId);
    if (meta === null) {
      throw new UnknownRunError(`cannot append event: run ${event.runId} does not exist`);
    }
    const events = await this.readEvents(event.runId);
    checkAppendableSeq(events, event);
    await io.appendJsonlLine(eventsPath(this.rootDir, event.runId), event);
  }

  async getRun(id: RunId): Promise<RunMeta | null> {
    assertSafeId(id, 'runId');
    return this.readMeta(id);
  }

  async listEvents(id: RunId): Promise<RunEvent[]> {
    assertSafeId(id, 'runId');
    const meta = await this.readMeta(id);
    if (meta === null) {
      throw new UnknownRunError(`run ${id} does not exist; cannot list events`);
    }
    return this.readEvents(id);
  }

  async updateStatus(id: RunId, status: RunStatus, endedAt?: string): Promise<RunMeta | null> {
    assertSafeId(id, 'runId');
    validateStatusUpdate(status, endedAt);
    const meta = await this.readMeta(id);
    if (meta === null) return null;
    const updated = applyStatusUpdate(meta, status, endedAt);
    await io.writeJsonFile(runMetaPath(this.rootDir, id), updated);
    return updated;
  }

  private async readMeta(id: RunId): Promise<RunMeta | null> {
    const value = await io.readJsonFile(runMetaPath(this.rootDir, id));
    if (value === null) return null;
    return parseRunMetaFromDisk(value, `run meta ${id}`);
  }

  private async readEvents(id: RunId): Promise<RunEvent[]> {
    const text = await io.readTextFile(eventsPath(this.rootDir, id));
    if (text === null) return [];
    const ctx = `event log for run ${id}`;
    return parseJsonl(text, ctx).map((value, index) => parseRunEventFromDisk(value, `${ctx} entry ${index + 1}`));
  }
}

/**
 * Load a full run (meta + events + artifacts) back from a filesystem root
 * using fresh store instances — the replay entry point. Returns null when
 * the run does not exist. Events come back in seq order (append order);
 * artifacts in insertion order.
 */
export async function loadRun(rootDir: string, runId: RunId): Promise<LoadedRun | null> {
  const runStore = new FsRunStore(rootDir);
  const artifactStore = new FsArtifactStore(rootDir);
  const meta = await runStore.getRun(runId);
  if (meta === null) return null;
  const events = await runStore.listEvents(runId);
  const artifacts = await artifactStore.list(runId);
  return { meta, events, artifacts };
}
