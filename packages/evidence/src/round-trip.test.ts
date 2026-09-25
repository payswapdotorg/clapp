// The golden path end to end: record → bundle → save → load → verify,
// against BOTH the fs and memory store pairs (CLAPP-011 acceptance test),
// plus the on-disk tamper scenario where the saved bundle.json is edited.

import { describe, expect, test } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FsArtifactStore, FsRunStore } from '@clapp/store';
import { buildBundle, loadRunFromStores } from './bundle';
import { loadBundle, saveBundle } from './persist';
import { verify } from './verify';
import { recordedScenario, storeImplementations, withPair, withTempDir } from './test-utils';
import type { StorePair } from './test-utils';

for (const impl of storeImplementations) {
  describe(`round trip — ${impl.name}`, () => {
    test('record → bundle → save → load → verify resolves ok with exact counts', async () => {
      await withPair(impl, async (stores: StorePair) => {
        // 1. record
        const { runId, refs } = await recordedScenario(stores);
        expect(refs).toHaveLength(3);

        // 2. bundle
        const run = await loadRunFromStores(stores, runId);
        if (run === null) throw new Error('run vanished');
        const bundle = await buildBundle(run);

        // 3. save / 4. load
        await withTempDir(async (dir) => {
          await saveBundle(dir, bundle, stores.artifactStore);
          const loaded = await loadBundle(dir);
          expect(loaded).toEqual(bundle);

          // 5. verify (the loaded artifact, against the original stores)
          const result = await verify(loaded, stores);
          expect(result).toEqual({
            ok: true,
            rootHash: bundle.rootHash,
            eventCount: 5,
            evidenceCount: 3,
            artifactCount: 3,
          });
        });
      });
    });
  });
}

describe('round trip — fresh-process stores (fs)', () => {
  test('a bundle saved by one process verifies against brand-new store instances', async () => {
    await withPair(storeImplementations[1]!, async (stores) => {
      const rootDir = stores.rootDir as string;
      const { runId } = await recordedScenario(stores);
      const run = await loadRunFromStores(stores, runId);
      if (run === null) throw new Error('run vanished');
      const bundle = await buildBundle(run);

      await withTempDir(async (dir) => {
        await saveBundle(dir, bundle, stores.artifactStore);
        const loaded = await loadBundle(dir);
        const freshStores = {
          runStore: new FsRunStore(rootDir),
          artifactStore: new FsArtifactStore(rootDir),
        };
        const result = await verify(loaded, freshStores);
        expect(result.ok).toBe(true);
      });
    });
  });

  test('editing the saved bundle.json on disk is caught by verify (ROOT_HASH_MISMATCH)', async () => {
    await withPair(storeImplementations[1]!, async (stores) => {
      const { runId } = await recordedScenario(stores);
      const run = await loadRunFromStores(stores, runId);
      if (run === null) throw new Error('run vanished');
      const bundle = await buildBundle(run);

      await withTempDir(async (dir) => {
        await saveBundle(dir, bundle, stores.artifactStore);

        // tamper the persisted manifest but keep the sealed rootHash
        const bundlePath = join(dir, 'bundle.json');
        const onDisk = JSON.parse(await readFile(bundlePath, 'utf8')) as {
          manifest: { run: { targetId: string } };
          rootHash: string;
        };
        onDisk.manifest.run.targetId = 'bench/tampered-on-disk';
        await writeFile(bundlePath, `${JSON.stringify(onDisk, null, 2)}\n`, 'utf8');

        // still loads (mechanically) — but verify catches the edit
        const loaded = await loadBundle(dir);
        const result = await verify(loaded, stores);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.code).toBe('ROOT_HASH_MISMATCH');
      });
    });
  });
});
