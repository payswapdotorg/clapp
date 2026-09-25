// saveBundle / loadBundle — persisted layout, write-once semantics, and
// the refusal to persist internally-inconsistent bundles.

import { describe, expect, test } from 'bun:test';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { sha256Hex } from '@clapp/core';
import type { ArtifactRecord } from '@clapp/core';
import { MemoryArtifactStore, MemoryRunStore } from '@clapp/store';
import { buildBundle, loadRunFromStores } from './bundle';
import type { EvidenceBundle } from './bundle';
import { canonicalJson } from './canonical-json';
import { RecordingSession } from './recording-session';
import { EvidencePersistenceError, loadBundle, saveBundle } from './persist';
import { captureFixture, recordedScenario, storeImplementations, tampered, withPair, withTempDir } from './test-utils';

function blobPath(dir: string, sha256: string): string {
  return join(dir, 'blobs', sha256.slice(0, 2), sha256.slice(2, 4), sha256);
}

describe('saveBundle / loadBundle', () => {
  test('writes bundle.json plus one blob per artifact; load round-trips the bundle', async () => {
    await withPair(storeImplementations[1]!, async (stores) => {
      const { runId } = await recordedScenario(stores);
      const run = await loadRunFromStores(stores, runId);
      if (run === null) throw new Error('scenario run vanished');
      const bundle = await buildBundle(run);

      await withTempDir(async (dir) => {
        await saveBundle(dir, bundle, stores.artifactStore);

        const text = await readFile(join(dir, 'bundle.json'), 'utf8');
        const parsed = JSON.parse(text) as { manifest: unknown; rootHash: string };
        expect(parsed.rootHash).toBe(bundle.rootHash);
        expect(parsed.manifest).toEqual(bundle.manifest);

        for (const record of bundle.manifest.artifacts) {
          const stored = await stores.artifactStore.readBytes(record.id);
          const exported = await readFile(blobPath(dir, record.sha256));
          expect(Array.from(exported)).toEqual(Array.from(stored ?? []));
        }

        const loaded = await loadBundle(dir);
        expect(loaded).toEqual(bundle);
      });
    });
  });

  test('multiple artifacts sharing one sha256 export a single blob', async () => {
    const stores = { runStore: new MemoryRunStore(), artifactStore: new MemoryArtifactStore() };

    const session = await RecordingSession.start(stores, { targetId: 'bench/b01-static' });
    await session.record(captureFixture());
    await session.complete();

    // same bytes persisted directly under a second artifact kind → same sha
    const first = (await stores.artifactStore.list(session.runId))[0] as ArtifactRecord;
    const bytes = await stores.artifactStore.readBytes(first.id);
    if (bytes === null) throw new Error('first artifact lost its bytes');
    await stores.artifactStore.put({
      runId: session.runId,
      kind: 'trace',
      mediaType: 'application/json',
      bytes,
    });

    const run = await loadRunFromStores(stores, session.runId);
    if (run === null) throw new Error('run vanished');
    const bundle = await buildBundle(run);
    expect(bundle.manifest.artifacts).toHaveLength(2);
    expect(bundle.manifest.artifacts.map((record) => record.sha256)).toEqual([first.sha256, first.sha256]);

    await withTempDir(async (dir) => {
      await saveBundle(dir, bundle, stores.artifactStore);
      const blob = await readFile(blobPath(dir, first.sha256));
      expect(Array.from(blob)).toEqual(Array.from(bytes));
      // exactly one blob file exists under blobs/
      const blobsDir = join(dir, 'blobs');
      const subdirs = await readdir(blobsDir);
      expect(subdirs).toHaveLength(1);
      const inner = await readdir(join(blobsDir, subdirs[0]!));
      expect(inner).toHaveLength(1);
    });
  });

  test('saveBundle refuses an internally-inconsistent bundle (stale rootHash)', async () => {
    await withPair(storeImplementations[0]!, async (stores) => {
      const { runId } = await recordedScenario(stores);
      const run = await loadRunFromStores(stores, runId);
      if (run === null) throw new Error('scenario run vanished');
      const bundle = await buildBundle(run);
      const torn = JSON.parse(JSON.stringify(bundle)) as EvidenceBundle;
      torn.manifest.run.targetId = 'bench/torn';
      await withTempDir(async (dir) => {
        await expect(saveBundle(dir, torn, stores.artifactStore)).rejects.toThrow(EvidencePersistenceError);
        await expect(saveBundle(dir, torn, stores.artifactStore)).rejects.toThrow(/rootHash/);
      });
    });
  });

  test('saveBundle refuses when artifact bytes are missing from the store', async () => {
    await withPair(storeImplementations[0]!, async (stores) => {
      const { runId } = await recordedScenario(stores);
      const run = await loadRunFromStores(stores, runId);
      if (run === null) throw new Error('scenario run vanished');
      const bundle = await buildBundle(run);
      const forgedSha = '7'.repeat(64);
      const extended = await tampered(bundle, (m) => {
        m.artifacts.push({
          id: 'art_00000000-0000-4000-8000-0000000000ee',
          runId,
          kind: 'trace',
          mediaType: 'application/json',
          sizeBytes: 5,
          sha256: forgedSha,
          storageKey: `objects/77/77/${forgedSha}`,
          redacted: false,
          createdAt: '2026-09-25T10:00:03.000Z',
        });
      });
      await withTempDir(async (dir) => {
        await expect(saveBundle(dir, extended, stores.artifactStore)).rejects.toThrow(/no bytes/);
      });
    });
  });

  test('write-once: existing differing files are never overwritten', async () => {
    await withPair(storeImplementations[1]!, async (stores) => {
      const { runId } = await recordedScenario(stores);
      const run = await loadRunFromStores(stores, runId);
      if (run === null) throw new Error('scenario run vanished');
      const bundle = await buildBundle(run);
      const record = bundle.manifest.artifacts[0] as ArtifactRecord;

      await withTempDir(async (dir) => {
        // garbage planted at the blob path before saving
        const planted = blobPath(dir, record.sha256);
        await mkdir(dirname(planted), { recursive: true });
        await writeFile(planted, new TextEncoder().encode('{"planted":true}'));
        await expect(saveBundle(dir, bundle, stores.artifactStore)).rejects.toThrow(/refusing to overwrite/);
      });

      await withTempDir(async (dir) => {
        // garbage planted at bundle.json before saving
        const bundlePath = join(dir, 'bundle.json');
        await writeFile(bundlePath, 'not the bundle');
        await expect(saveBundle(dir, bundle, stores.artifactStore)).rejects.toThrow(/refusing to overwrite/);
      });
    });
  });

  test('re-saving identical content is an idempotent no-op', async () => {
    await withPair(storeImplementations[1]!, async (stores) => {
      const { runId } = await recordedScenario(stores);
      const run = await loadRunFromStores(stores, runId);
      if (run === null) throw new Error('scenario run vanished');
      const bundle = await buildBundle(run);
      await withTempDir(async (dir) => {
        await saveBundle(dir, bundle, stores.artifactStore);
        const before = await readFile(join(dir, 'bundle.json'));
        await saveBundle(dir, bundle, stores.artifactStore);
        expect(await readFile(join(dir, 'bundle.json'))).toEqual(before);
      });
    });
  });

  test('loadBundle: missing directory → clear error', async () => {
    await expect(loadBundle('/nonexistent/clapp-evidence-bundle')).rejects.toThrow(/no bundle/);
  });

  test('loadBundle: invalid JSON / bad wrapper shape → BUNDLE_MALFORMED-tagged errors', async () => {
    await withTempDir(async (dir) => {
      const bundlePath = join(dir, 'bundle.json');
      await writeFile(bundlePath, '{not json', 'utf8');
      await expect(loadBundle(dir)).rejects.toThrow(/BUNDLE_MALFORMED[\s\S]*not valid JSON/);

      await writeFile(bundlePath, JSON.stringify({ manifest: 'x' }), 'utf8');
      await expect(loadBundle(dir)).rejects.toThrow(/BUNDLE_MALFORMED/);

      await writeFile(
        bundlePath,
        JSON.stringify({ manifest: { schemaVersion: 1 }, rootHash: 'not-hex' }),
        'utf8',
      );
      await expect(loadBundle(dir)).rejects.toThrow(/BUNDLE_MALFORMED/);
    });
  });

  test('saved bundle.json is the pretty serialization of { manifest, rootHash }', async () => {
    await withPair(storeImplementations[0]!, async (stores) => {
      const { runId } = await recordedScenario(stores);
      const run = await loadRunFromStores(stores, runId);
      if (run === null) throw new Error('scenario run vanished');
      const bundle = await buildBundle(run);
      await withTempDir(async (dir) => {
        await saveBundle(dir, bundle, stores.artifactStore);
        const text = await readFile(join(dir, 'bundle.json'), 'utf8');
        expect(text).toBe(`${JSON.stringify({ manifest: bundle.manifest, rootHash: bundle.rootHash }, null, 2)}\n`);
      });
    });
  });

  test('loadBundle returns a bundle whose manifest still hashes to rootHash', async () => {
    await withPair(storeImplementations[0]!, async (stores) => {
      const { runId } = await recordedScenario(stores);
      const run = await loadRunFromStores(stores, runId);
      if (run === null) throw new Error('scenario run vanished');
      const bundle = await buildBundle(run);
      await withTempDir(async (dir) => {
        await saveBundle(dir, bundle, stores.artifactStore);
        const loaded = await loadBundle(dir);
        expect(await sha256Hex(canonicalJson(loaded.manifest))).toBe(loaded.rootHash);
      });
    });
  });
});
