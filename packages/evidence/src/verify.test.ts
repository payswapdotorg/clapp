// verify() — happy paths plus one producing test for EVERY tamper code in
// the frozen set. Manifest-side tampers are re-sealed (rootHash recomputed)
// where the test's point is that re-sealing does NOT defeat store
// cross-checks; unsealed edits demonstrate ROOT_HASH_MISMATCH itself.

import { describe, expect, test } from 'bun:test';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ArtifactRecord, EvidenceRef, RunEvent, RunId } from '@clapp/core';
import { FsArtifactStore, FsRunStore, MemoryArtifactStore, MemoryRunStore } from '@clapp/store';
import type { ArtifactStore } from '@clapp/store';
import type { EvidenceBundle } from './bundle';
import { buildBundle, loadRunFromStores } from './bundle';
import type { TamperCode, VerifyResult, VerificationStores } from './verify';
import { verify } from './verify';
import { recordedScenario, storeImplementations, tampered, withPair } from './test-utils';
import type { StorePair } from './test-utils';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function expectCode(result: VerifyResult, code: TamperCode): void {
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.code).toBe(code);
    expect(typeof result.detail).toBe('string');
    expect(result.detail.length).toBeGreaterThan(0);
  }
}

async function scenarioBundle(stores: StorePair): Promise<{ bundle: EvidenceBundle; runId: RunId }> {
  const { runId } = await recordedScenario(stores);
  const run = await loadRunFromStores(stores, runId);
  if (run === null) throw new Error('scenario run vanished before bundling');
  return { bundle: await buildBundle(run), runId };
}

function eventsPath(rootDir: string, runId: RunId): string {
  return join(rootDir, 'events', `${runId}.jsonl`);
}

function runMetaPath(rootDir: string, runId: RunId): string {
  return join(rootDir, 'runs', `${runId}.json`);
}

function artifactRecordPath(rootDir: string, artifactId: string): string {
  return join(rootDir, 'artifacts', 'by-id', `${artifactId}.json`);
}

function blobPath(rootDir: string, sha256: string): string {
  return join(rootDir, 'objects', sha256.slice(0, 2), sha256.slice(2, 4), sha256);
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function readJsonl(path: string): Promise<Record<string, unknown>[]> {
  const text = await readFile(path, 'utf8');
  return text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function writeJsonl(path: string, values: unknown[]): Promise<void> {
  await writeFile(path, `${values.map((value) => JSON.stringify(value)).join('\n')}\n`, 'utf8');
}

// ---------------------------------------------------------------------------
// happy path
// ---------------------------------------------------------------------------

for (const impl of storeImplementations) {
  describe(`verify — happy path (${impl.name})`, () => {
    test('a freshly recorded, bundled run verifies ok with exact counts', async () => {
      await withPair(impl, async (stores) => {
        const { bundle } = await scenarioBundle(stores);
        const result = await verify(bundle, stores);
        expect(result).toEqual({
          ok: true,
          rootHash: bundle.rootHash,
          eventCount: 5,
          evidenceCount: 3,
          artifactCount: 3,
        });
      });
    });

    test('verify is idempotent', async () => {
      await withPair(impl, async (stores) => {
        const { bundle } = await scenarioBundle(stores);
        const first = await verify(bundle, stores);
        const second = await verify(bundle, stores);
        expect(second).toEqual(first);
      });
    });
  });
}

// ---------------------------------------------------------------------------
// tamper codes — manifest side (impl-agnostic, exercised on memory stores)
// ---------------------------------------------------------------------------

describe('verify — tamper codes (manifest side)', () => {
  test('BUNDLE_MALFORMED: not an object / missing manifest / bad rootHash shape', async () => {
    await withPair(storeImplementations[0]!, async (stores) => {
      const { bundle } = await scenarioBundle(stores);

      expectCode(await verify(null as unknown as EvidenceBundle, stores), 'BUNDLE_MALFORMED');
      expectCode(await verify({ manifest: 'x' } as unknown as EvidenceBundle, stores), 'BUNDLE_MALFORMED');
      expectCode(
        await verify({ manifest: bundle.manifest, rootHash: 'nothex' } as unknown as EvidenceBundle, stores),
        'BUNDLE_MALFORMED',
      );
      expectCode(await verify({} as unknown as EvidenceBundle, stores), 'BUNDLE_MALFORMED');
    });
  });

  test('BUNDLE_MALFORMED: pathological bundle access (verify stays total)', async () => {
    await withPair(storeImplementations[0]!, async (stores) => {
      const hostile = new Proxy(
        {},
        {
          get() {
            throw new Error('boom');
          },
        },
      ) as unknown as EvidenceBundle;
      const result = await verify(hostile, stores);
      expectCode(result, 'BUNDLE_MALFORMED');
      if (!result.ok) expect(result.detail).toContain('verify could not process');
    });
  });

  test('MANIFEST_MALFORMED: structurally invalid fields (even when re-sealed)', async () => {
    await withPair(storeImplementations[0]!, async (stores) => {
      const { bundle } = await scenarioBundle(stores);

      const seqAsString = await tampered(bundle, (m) => {
        (m.events[1] as RunEvent).seq = 'one' as unknown as number;
      });
      expectCode(await verify(seqAsString, stores), 'MANIFEST_MALFORMED');

      const wrongVersion = await tampered(bundle, (m) => {
        m.schemaVersion = 2;
      });
      expectCode(await verify(wrongVersion, stores), 'MANIFEST_MALFORMED');

      const badRef = await tampered(bundle, (m) => {
        (m.evidence[0] as EvidenceRef).sha256 = 'zz';
      });
      expectCode(await verify(badRef, stores), 'MANIFEST_MALFORMED');

      const badStorageKey = await tampered(bundle, (m) => {
        (m.artifacts[0] as ArtifactRecord).storageKey = 'elsewhere/x';
      });
      expectCode(await verify(badStorageKey, stores), 'MANIFEST_MALFORMED');

      const badStartedAt = await tampered(bundle, (m) => {
        m.run.startedAt = 'yesterday';
      });
      expectCode(await verify(badStartedAt, stores), 'MANIFEST_MALFORMED');
    });
  });

  test('ROOT_HASH_MISMATCH: manifest edited without re-sealing', async () => {
    await withPair(storeImplementations[0]!, async (stores) => {
      const { bundle } = await scenarioBundle(stores);
      const edited = JSON.parse(JSON.stringify(bundle)) as EvidenceBundle;
      (edited.manifest.events[4] as RunEvent).payload = { evidenceCount: 99 };
      const result = await verify(edited, stores);
      expectCode(result, 'ROOT_HASH_MISMATCH');
      if (!result.ok) expect(result.detail).toContain(edited.rootHash);
    });
  });

  test('RUN_META_MISMATCH: manifest run identity edited (re-sealed)', async () => {
    await withPair(storeImplementations[0]!, async (stores) => {
      const { bundle } = await scenarioBundle(stores);
      const lied = await tampered(bundle, (m) => {
        m.run.targetId = 'bench/somewhere-else';
      });
      expectCode(await verify(lied, stores), 'RUN_META_MISMATCH');
    });
  });

  test('RUN_META_MISMATCH: the run is unknown to the run store', async () => {
    await withPair(storeImplementations[0]!, async (stores) => {
      const { bundle } = await scenarioBundle(stores);
      const emptyStores: VerificationStores = {
        runStore: new MemoryRunStore(),
        artifactStore: new MemoryArtifactStore(),
      };
      expectCode(await verify(bundle, emptyStores), 'RUN_META_MISMATCH');
    });
  });

  test('RUN_META_MISMATCH: store-side meta tampered (fs)', async () => {
    await withPair(storeImplementations[1]!, async (stores) => {
      const rootDir = stores.rootDir as string;
      const { bundle, runId } = await scenarioBundle(stores);

      const metaPath = runMetaPath(rootDir, runId);
      const meta = await readJson(metaPath);
      meta['targetId'] = 'bench/tampered';
      await writeJson(metaPath, meta);

      expectCode(await verify(bundle, stores), 'RUN_META_MISMATCH');
    });
  });

  test('status/endedAt changes are NOT mismatches (mutable by design, fs)', async () => {
    await withPair(storeImplementations[1]!, async (stores) => {
      const rootDir = stores.rootDir as string;
      const { bundle, runId } = await scenarioBundle(stores);

      const metaPath = runMetaPath(rootDir, runId);
      const meta = await readJson(metaPath);
      meta['status'] = 'cancelled';
      meta['endedAt'] = '2026-09-25T12:00:00.000Z';
      await writeJson(metaPath, meta);

      const result = await verify(bundle, stores);
      expect(result.ok).toBe(true);
    });
  });

  test('EVENT_SEQ_INVALID: manifest stream reordered (re-sealed)', async () => {
    await withPair(storeImplementations[0]!, async (stores) => {
      const { bundle } = await scenarioBundle(stores);
      const swapped = await tampered(bundle, (m) => {
        const first = m.events[1] as RunEvent;
        const second = m.events[2] as RunEvent;
        const seq = first.seq;
        first.seq = second.seq;
        second.seq = seq;
      });
      expectCode(await verify(swapped, stores), 'EVENT_SEQ_INVALID');
    });
  });

  test('EVENT_SEQ_INVALID: manifest stream truncated at the head (first seq != 0, re-sealed)', async () => {
    await withPair(storeImplementations[0]!, async (stores) => {
      const { bundle } = await scenarioBundle(stores);
      const headless = await tampered(bundle, (m) => {
        m.events = m.events.slice(1);
      });
      expectCode(await verify(headless, stores), 'EVENT_SEQ_INVALID');
    });
  });

  test('EVENT_SEQ_INVALID: manifest event from a foreign run (re-sealed)', async () => {
    await withPair(storeImplementations[0]!, async (stores) => {
      const { bundle } = await scenarioBundle(stores);
      const foreign = await tampered(bundle, (m) => {
        (m.events[1] as RunEvent).runId = 'run_ffffffff-0000-4000-8000-000000000000';
      });
      expectCode(await verify(foreign, stores), 'EVENT_SEQ_INVALID');
    });
  });

  test('EVENT_MISSING: manifest event absent from the store log (truncated fs log)', async () => {
    await withPair(storeImplementations[1]!, async (stores) => {
      const rootDir = stores.rootDir as string;
      const { bundle, runId } = await scenarioBundle(stores);

      const path = eventsPath(rootDir, runId);
      const lines = await readJsonl(path);
      await writeJsonl(path, lines.slice(0, lines.length - 1)); // drop run.completed

      expectCode(await verify(bundle, stores), 'EVENT_MISSING');
    });
  });

  test('EVENT_MISSING: store event content altered at the same seq (fs)', async () => {
    await withPair(storeImplementations[1]!, async (stores) => {
      const rootDir = stores.rootDir as string;
      const { bundle, runId } = await scenarioBundle(stores);

      const path = eventsPath(rootDir, runId);
      const lines = await readJsonl(path);
      lines[2]!['payload'] = { replaced: true };
      await writeJsonl(path, lines);

      expectCode(await verify(bundle, stores), 'EVENT_MISSING');
    });
  });

  test('EVENT_MISSING: manifest gains a fabricated event the store never saw (re-sealed)', async () => {
    await withPair(storeImplementations[0]!, async (stores) => {
      const { bundle, runId } = await scenarioBundle(stores);
      const extended = await tampered(bundle, (m) => {
        m.events.push({
          runId,
          seq: 99,
          ts: '2026-09-25T11:00:00.000Z',
          kind: 'log',
          payload: { forged: true },
        });
      });
      expectCode(await verify(extended, stores), 'EVENT_MISSING');
    });
  });

  test('extra store events beyond the manifest are ALLOWED (fs)', async () => {
    await withPair(storeImplementations[1]!, async (stores) => {
      const rootDir = stores.rootDir as string;
      const { bundle, runId } = await scenarioBundle(stores);

      const path = eventsPath(rootDir, runId);
      const lines = await readJsonl(path);
      lines.push({ runId, seq: 99, ts: '2026-09-25T12:00:00.000Z', kind: 'log', payload: { later: true } });
      await writeJsonl(path, lines);

      const result = await verify(bundle, stores);
      expect(result.ok).toBe(true);
    });
  });

  test('ARTIFACT_MISSING: manifest lists an artifact the store never recorded (re-sealed)', async () => {
    await withPair(storeImplementations[0]!, async (stores) => {
      const { bundle, runId } = await scenarioBundle(stores);
      const forgedSha = 'f'.repeat(64);
      const extended = await tampered(bundle, (m) => {
        m.artifacts.push({
          id: 'art_00000000-0000-4000-8000-0000000000ff',
          runId,
          kind: 'trace',
          mediaType: 'application/json',
          sizeBytes: 5,
          sha256: forgedSha,
          storageKey: `objects/ff/ff/${forgedSha}`,
          redacted: false,
          createdAt: '2026-09-25T10:00:03.000Z',
        });
      });
      expectCode(await verify(extended, stores), 'ARTIFACT_MISSING');
    });
  });

  test('ARTIFACT_HASH_MISMATCH: a store whose bytes lie (verify re-hashes independently)', async () => {
    await withPair(storeImplementations[0]!, async (stores) => {
      const { bundle } = await scenarioBundle(stores);

      const lying: ArtifactStore = {
        put: (input) => stores.artifactStore.put(input),
        get: (id) => stores.artifactStore.get(id),
        getBySha256: (sha256, run) => stores.artifactStore.getBySha256(sha256, run),
        list: (run) => stores.artifactStore.list(run),
        readBytes: async () => new TextEncoder().encode('{"tampered":true}'),
      };
      expectCode(
        await verify(bundle, { runStore: stores.runStore, artifactStore: lying }),
        'ARTIFACT_HASH_MISMATCH',
      );
    });
  });

  test('MANIFEST_HASH_MISMATCH: manifest artifact record edited (re-sealed)', async () => {
    await withPair(storeImplementations[0]!, async (stores) => {
      const { bundle } = await scenarioBundle(stores);
      const lied = await tampered(bundle, (m) => {
        const record = m.artifacts[0] as ArtifactRecord;
        record.sizeBytes = record.sizeBytes + 1;
      });
      expectCode(await verify(lied, stores), 'MANIFEST_HASH_MISMATCH');
    });
  });

  test('REF_UNKNOWN: manifest evidence gains an unbacked ref (re-sealed)', async () => {
    await withPair(storeImplementations[0]!, async (stores) => {
      const { bundle } = await scenarioBundle(stores);
      const forgedSha = 'a'.repeat(64);
      const extended = await tampered(bundle, (m) => {
        m.evidence.push({ evidenceId: 'ev_00000000-0000-4000-8000-0000000000aa', kind: 'dom', sha256: forgedSha });
      });
      expectCode(await verify(extended, stores), 'REF_UNKNOWN');
    });
  });

  test('phase order: ROOT_HASH_MISMATCH wins over deeper failures', async () => {
    await withPair(storeImplementations[0]!, async (stores) => {
      const { bundle, runId } = await scenarioBundle(stores);
      // unsealed edit (stale root hash) AND a fabricated artifact: the root
      // hash is checked before any artifact phase
      const edited = JSON.parse(JSON.stringify(bundle)) as EvidenceBundle;
      const forgedSha = 'b'.repeat(64);
      edited.manifest.artifacts.push({
        id: 'art_00000000-0000-4000-8000-0000000000bb',
        runId,
        kind: 'trace',
        mediaType: 'application/json',
        sizeBytes: 5,
        sha256: forgedSha,
        storageKey: `objects/bb/bb/${forgedSha}`,
        redacted: false,
        createdAt: '2026-09-25T10:00:03.000Z',
      });
      expectCode(await verify(edited, stores), 'ROOT_HASH_MISMATCH');
    });
  });
});

// ---------------------------------------------------------------------------
// tamper codes — fs-store side (real corruption of on-disk state)
// ---------------------------------------------------------------------------

describe('verify — tamper codes (fs store side)', () => {
  test('EVENT_SEQ_INVALID: duplicated seq line in the fs event log', async () => {
    await withPair(storeImplementations[1]!, async (stores) => {
      const rootDir = stores.rootDir as string;
      const { bundle, runId } = await scenarioBundle(stores);

      const path = eventsPath(rootDir, runId);
      const lines = await readJsonl(path);
      lines.push(JSON.parse(JSON.stringify(lines[lines.length - 1])) as Record<string, unknown>);
      await writeJsonl(path, lines);

      expectCode(await verify(bundle, stores), 'EVENT_SEQ_INVALID');
    });
  });

  test('ARTIFACT_MISSING: artifact record file deleted', async () => {
    await withPair(storeImplementations[1]!, async (stores) => {
      const rootDir = stores.rootDir as string;
      const { bundle } = await scenarioBundle(stores);

      const record = bundle.manifest.artifacts[0] as ArtifactRecord;
      await rm(artifactRecordPath(rootDir, record.id));

      expectCode(await verify(bundle, stores), 'ARTIFACT_MISSING');
    });
  });

  test('ARTIFACT_MISSING: blob file deleted (store surfaces absence by throwing)', async () => {
    await withPair(storeImplementations[1]!, async (stores) => {
      const rootDir = stores.rootDir as string;
      const { bundle } = await scenarioBundle(stores);

      const record = bundle.manifest.artifacts[0] as ArtifactRecord;
      await rm(blobPath(rootDir, record.sha256));

      expectCode(await verify(bundle, stores), 'ARTIFACT_MISSING');
    });
  });

  test('ARTIFACT_HASH_MISMATCH: blob file replaced with different bytes', async () => {
    await withPair(storeImplementations[1]!, async (stores) => {
      const rootDir = stores.rootDir as string;
      const { bundle } = await scenarioBundle(stores);

      const record = bundle.manifest.artifacts[0] as ArtifactRecord;
      await writeFile(blobPath(rootDir, record.sha256), new TextEncoder().encode('{"replaced":"tampered"}'));

      expectCode(await verify(bundle, stores), 'ARTIFACT_HASH_MISMATCH');
    });
  });

  test('MANIFEST_HASH_MISMATCH: store-side artifact record tampered', async () => {
    await withPair(storeImplementations[1]!, async (stores) => {
      const rootDir = stores.rootDir as string;
      const { bundle } = await scenarioBundle(stores);

      const record = bundle.manifest.artifacts[0] as ArtifactRecord;
      const path = artifactRecordPath(rootDir, record.id);
      const onDisk = await readJson(path);
      onDisk['sizeBytes'] = (onDisk['sizeBytes'] as number) + 1;
      await writeJson(path, onDisk);

      expectCode(await verify(bundle, stores), 'MANIFEST_HASH_MISMATCH');
    });
  });

  test('REF_KIND_MISMATCH: evidence kind relabeled in manifest AND store event (re-sealed)', async () => {
    await withPair(storeImplementations[1]!, async (stores) => {
      const rootDir = stores.rootDir as string;
      const { bundle, runId } = await scenarioBundle(stores);

      // relabel the first evidence ref dom → runtime in the manifest…
      const relabeled = await tampered(bundle, (m) => {
        (m.evidence[0] as EvidenceRef).kind = 'runtime';
        for (const event of m.events) {
          for (const ref of event.evidenceRefs ?? []) {
            if (ref.evidenceId === (m.evidence[0] as EvidenceRef).evidenceId) ref.kind = 'runtime';
          }
        }
      });
      // …and in the store's event log, so the verbatim event check passes
      const path = eventsPath(rootDir, runId);
      const lines = await readJsonl(path);
      const evidenceId = (relabeled.manifest.evidence[0] as EvidenceRef).evidenceId;
      for (const line of lines) {
        const refs = line['evidenceRefs'] as EvidenceRef[] | undefined;
        for (const ref of refs ?? []) {
          if (ref.evidenceId === evidenceId) ref.kind = 'runtime';
        }
      }
      await writeJsonl(path, lines);

      // the artifact carrying that sha256 is a dom-snapshot, but evidence
      // kind 'runtime' expects 'trace' → the disagreement survives
      expectCode(await verify(relabeled, stores), 'REF_KIND_MISMATCH');
    });
  });

  test('REF_UNKNOWN: ref sha256 rewritten in manifest AND store event (re-sealed)', async () => {
    await withPair(storeImplementations[1]!, async (stores) => {
      const rootDir = stores.rootDir as string;
      const { bundle, runId } = await scenarioBundle(stores);

      const forgedSha = '9'.repeat(64);
      const rewritten = await tampered(bundle, (m) => {
        (m.evidence[0] as EvidenceRef).sha256 = forgedSha;
        for (const event of m.events) {
          for (const ref of event.evidenceRefs ?? []) {
            if (ref.evidenceId === (m.evidence[0] as EvidenceRef).evidenceId) ref.sha256 = forgedSha;
          }
        }
      });
      const path = eventsPath(rootDir, runId);
      const lines = await readJsonl(path);
      const evidenceId = (rewritten.manifest.evidence[0] as EvidenceRef).evidenceId;
      for (const line of lines) {
        const refs = line['evidenceRefs'] as EvidenceRef[] | undefined;
        for (const ref of refs ?? []) {
          if (ref.evidenceId === evidenceId) ref.sha256 = forgedSha;
        }
      }
      await writeJsonl(path, lines);

      // the ref is event-backed, but no artifact carries the forged sha256
      expectCode(await verify(rewritten, stores), 'REF_UNKNOWN');
    });
  });

  test('verify against a FRESH store pair over the same fs root still passes', async () => {
    await withPair(storeImplementations[1]!, async (stores) => {
      const rootDir = stores.rootDir as string;
      const { bundle } = await scenarioBundle(stores);

      const freshStores: VerificationStores = {
        runStore: new FsRunStore(rootDir),
        artifactStore: new FsArtifactStore(rootDir),
      };
      const result = await verify(bundle, freshStores);
      expect(result.ok).toBe(true);
    });
  });
});
