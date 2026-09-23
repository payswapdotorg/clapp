// §5 tests 6 and 9 (+ fs-only durability & integrity behaviors): loadRun
// replay and the full acceptance scenario walked end-to-end with the core
// hello-run shape (run.started / log / run.completed).

import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { describe, expect, test } from 'bun:test';
import type { RunMeta } from '@clapp/core';
import { FsArtifactStore, FsRunStore, loadRun } from './index';
import { bytesEqual, isRecordLike, sha256Hex } from './shared';
import { fakeBytes, makeRunMeta, newRunId, runEvent, withTempRoot } from './test-utils';

describe('fs durability & integrity (fs only)', () => {
  test('a fresh store instance over the same rootDir serves prior writes', async () => {
    await withTempRoot(async (rootDir) => {
      const runId = newRunId();
      const first = new FsArtifactStore(rootDir);
      const record = await first.put({
        runId,
        kind: 'ir',
        mediaType: 'application/json',
        bytes: fakeBytes(128, 5),
      });
      const reopened = new FsArtifactStore(rootDir);
      expect(await reopened.get(record.id)).toEqual(record);
      expect(await reopened.list(runId)).toEqual([record]);
      expect(await reopened.readBytes(record.id)).not.toBeNull();
    });
  });

  test('readBytes detects on-disk tampering (hash mismatch), and a new record refuses to overwrite the tampered blob', async () => {
    await withTempRoot(async (rootDir) => {
      const runId = newRunId();
      const store = new FsArtifactStore(rootDir);
      const bytes = fakeBytes(256, 9);
      const record = await store.put({ runId, kind: 'screenshot', mediaType: 'image/png', bytes });
      // tamper with the blob directly on disk
      await writeFile(join(rootDir, record.storageKey), fakeBytes(256, 10));
      await expect(store.readBytes(record.id)).rejects.toThrow(/integrity/i);
      // a NEW record (different kind) addressing the same hash must not
      // silently overwrite the divergent blob
      await expect(store.put({ runId, kind: 'trace', mediaType: 'image/png', bytes })).rejects.toThrow(
        /refusing to overwrite/i,
      );
    });
  });

  test('readBytes reports a missing blob as an integrity error', async () => {
    await withTempRoot(async (rootDir) => {
      const runId = newRunId();
      const store = new FsArtifactStore(rootDir);
      const record = await store.put({ runId, kind: 'screenshot', mediaType: 'image/png', bytes: fakeBytes(32, 2) });
      await rm(join(rootDir, record.storageKey));
      await expect(store.readBytes(record.id)).rejects.toThrow(/missing/i);
    });
  });

  test('loadRun returns null for unknown runs', async () => {
    await withTempRoot(async (rootDir) => {
      expect(await loadRun(rootDir, newRunId())).toBeNull();
    });
  });

  test('§5.6 loadRun replay: create run, 3 events, 2 artifacts → meta/events/artifacts all match', async () => {
    await withTempRoot(async (rootDir) => {
      const runs = new FsRunStore(rootDir);
      const artifacts = new FsArtifactStore(rootDir);
      const meta = makeRunMeta({ status: 'running' });
      await runs.createRun(meta);
      await runs.appendEvent(runEvent(meta.id, 0, 'run.started', { target: meta.targetId }));
      await runs.appendEvent(runEvent(meta.id, 1, 'log', { level: 'info' }));
      const a = await artifacts.put({
        runId: meta.id,
        kind: 'dom-snapshot',
        mediaType: 'application/json',
        bytes: fakeBytes(64, 1),
      });
      const b = await artifacts.put({
        runId: meta.id,
        kind: 'screenshot',
        mediaType: 'image/png',
        bytes: fakeBytes(64, 2),
      });
      await runs.appendEvent(runEvent(meta.id, 2, 'run.completed'));

      const loaded = await loadRun(rootDir, meta.id);
      if (loaded === null) throw new Error('loadRun returned null for a persisted run');
      expect(loaded.meta).toEqual(meta);
      expect(loaded.events.map((e) => e.seq)).toEqual([0, 1, 2]);
      expect(loaded.events.map((e) => e.kind)).toEqual(['run.started', 'log', 'run.completed']);
      expect(loaded.events.map((e) => e.payload)).toEqual([{ target: meta.targetId }, { level: 'info' }, undefined]);
      expect(loaded.artifacts).toEqual([a, b]);

      // bytes replay byte-identically through a brand-new store instance
      const replayStore = new FsArtifactStore(rootDir);
      const readA = await replayStore.readBytes(a.id);
      const readB = await replayStore.readBytes(b.id);
      if (readA === null || readB === null) throw new Error('readBytes returned null for persisted artifacts');
      expect(bytesEqual(readA, fakeBytes(64, 1))).toBe(true);
      expect(bytesEqual(readB, fakeBytes(64, 2))).toBe(true);
    });
  });
});

describe('§5.9 full acceptance scenario — hello run end-to-end with replay', () => {
  test('write → hash → retrieve → replay, with immutability enforced throughout', async () => {
    await withTempRoot(async (rootDir) => {
      const runs = new FsRunStore(rootDir);
      const artifacts = new FsArtifactStore(rootDir);

      // plan + start the run
      const meta: RunMeta = {
        id: newRunId(),
        targetId: 'bench/b00-hello',
        kind: 'hello',
        status: 'running',
        startedAt: new Date().toISOString(),
        environment: { engine: 'bun', os: 'linux', clapp: 'phase-0' },
        budget: { maxDurationMs: 60000, maxArtifacts: 16 },
      };
      await runs.createRun(meta);
      await runs.appendEvent({
        runId: meta.id,
        seq: 0,
        ts: new Date().toISOString(),
        kind: 'run.started',
        payload: { targetId: meta.targetId },
      });

      // write evidence artifacts (content-addressed)
      const domBytes = new TextEncoder().encode(JSON.stringify({ hello: 'clapp', capturedAt: meta.startedAt }));
      const dom = await artifacts.put({
        runId: meta.id,
        kind: 'dom-snapshot',
        mediaType: 'application/json',
        bytes: domBytes,
      });
      await runs.appendEvent({
        runId: meta.id,
        seq: 1,
        ts: new Date().toISOString(),
        kind: 'log',
        payload: { level: 'info', msg: 'dom snapshot captured' },
      });
      await runs.appendEvent({
        runId: meta.id,
        seq: 2,
        ts: new Date().toISOString(),
        kind: 'artifact.written',
        payload: { artifactId: dom.id, sha256: dom.sha256, kind: dom.kind },
      });
      await runs.appendEvent({
        runId: meta.id,
        seq: 3,
        ts: new Date().toISOString(),
        kind: 'evidence.recorded',
        evidenceRefs: [{ evidenceId: `ev_${randomUUID()}`, kind: 'dom', sha256: dom.sha256 }],
      });

      const pngBytes = fakeBytes(2048, 42);
      const shot = await artifacts.put({
        runId: meta.id,
        kind: 'screenshot',
        mediaType: 'image/png',
        bytes: pngBytes,
        redacted: true,
      });
      await runs.appendEvent({
        runId: meta.id,
        seq: 4,
        ts: new Date().toISOString(),
        kind: 'artifact.written',
        payload: { artifactId: shot.id, sha256: shot.sha256, kind: shot.kind },
      });

      // immutability: identical bytes+kind resolve to the ONE canonical record
      const dup = await artifacts.put({
        runId: meta.id,
        kind: 'screenshot',
        mediaType: 'image/png',
        bytes: pngBytes,
        redacted: true,
      });
      expect(dup.id).toBe(shot.id);
      expect(dup).toEqual(shot);
      expect(await artifacts.list(meta.id)).toHaveLength(2);

      // retrieval by content hash and by id
      const bySha = await artifacts.getBySha256(shot.sha256, meta.id);
      expect(bySha?.id).toBe(shot.id);
      const byId = await artifacts.get(dom.id);
      expect(byId?.sha256).toBe(dom.sha256);

      // complete the run
      const endedAt = new Date().toISOString();
      await runs.appendEvent({
        runId: meta.id,
        seq: 5,
        ts: endedAt,
        kind: 'run.completed',
        payload: { status: 'completed' },
      });
      const finalMeta = await runs.updateStatus(meta.id, 'completed', endedAt);
      expect(finalMeta?.status).toBe('completed');
      expect(finalMeta?.endedAt).toBe(endedAt);

      // REPLAY: load the full run from fresh store instances (a new "process")
      const loaded = await loadRun(rootDir, meta.id);
      if (loaded === null) throw new Error('loadRun returned null for a persisted run');
      expect(loaded.meta).toEqual({ ...meta, status: 'completed', endedAt });
      expect(loaded.events.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4, 5]);
      expect(loaded.events.map((e) => e.kind)).toEqual([
        'run.started',
        'log',
        'artifact.written',
        'evidence.recorded',
        'artifact.written',
        'run.completed',
      ]);
      expect(loaded.artifacts).toHaveLength(2);

      // replay the event sequence against the store: every artifact.written
      // event resolves to a real record whose bytes hash to the recorded sha256
      const replayStore = new FsArtifactStore(rootDir);
      for (const event of loaded.events) {
        if (event.kind === 'artifact.written' && isRecordLike(event.payload)) {
          const artifactId = event.payload['artifactId'];
          const sha256 = event.payload['sha256'];
          if (typeof artifactId !== 'string' || typeof sha256 !== 'string') {
            throw new Error('malformed artifact.written payload');
          }
          const record = await replayStore.get(artifactId);
          if (record === null) throw new Error(`replay: artifact ${artifactId} is missing`);
          expect(record.sha256).toBe(sha256);
          const bytes = await replayStore.readBytes(artifactId);
          if (bytes === null) throw new Error(`replay: bytes for ${artifactId} are missing`);
          expect(sha256Hex(bytes)).toBe(sha256);
        }
      }

      // evidenceRefs hash-verify against stored artifact content
      for (const event of loaded.events) {
        if (event.kind === 'evidence.recorded' && event.evidenceRefs !== undefined) {
          for (const ref of event.evidenceRefs) {
            const record = await replayStore.getBySha256(ref.sha256, meta.id);
            if (record === null) throw new Error(`replay: evidence ${ref.evidenceId} is unresolved`);
            expect(record.sha256).toBe(ref.sha256);
          }
        }
      }

      // and the original screenshot bytes come back bit-for-bit
      const shotBytes = await replayStore.readBytes(shot.id);
      if (shotBytes === null) throw new Error('screenshot bytes are missing');
      expect(bytesEqual(shotBytes, pngBytes)).toBe(true);
    });
  });
});

describe('package surface', () => {
  test('@clapp/store resolves its own export map (consumer experience)', async () => {
    const mod = await import('@clapp/store');
    expect(typeof mod.loadRun).toBe('function');
    expect(typeof mod.FsArtifactStore).toBe('function');
    expect(typeof mod.FsRunStore).toBe('function');
    expect(typeof mod.MemoryArtifactStore).toBe('function');
    expect(typeof mod.MemoryRunStore).toBe('function');
  });
});
