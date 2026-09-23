// §5 tests 1–3 (+ immutability & validation extras), parametrized over the
// memory and filesystem ArtifactStore implementations (§5 test 8).

import { createHash } from 'node:crypto';
import { describe, expect, test } from 'bun:test';
import { bytesEqual } from './shared';
import { fakeBytes, newRunId, storeImplementations, withPair } from './test-utils';

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ARTIFACT_ID_RE = /^art_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

for (const impl of storeImplementations) {
  describe(`ArtifactStore — ${impl.name}`, () => {
    test('§5.1 round-trip: put → get → readBytes → bytes equal, with correct provenance', async () => {
      await withPair(impl, async ({ artifactStore }) => {
        const runId = newRunId();
        const bytes = fakeBytes(1024, 7);
        const record = await artifactStore.put({
          runId,
          kind: 'screenshot',
          mediaType: 'image/png',
          bytes,
        });

        // the record carries exactly what it was given (never invents provenance)
        expect(record.runId).toBe(runId);
        expect(record.kind).toBe('screenshot');
        expect(record.mediaType).toBe('image/png');
        expect(record.sizeBytes).toBe(1024);
        expect(record.redacted).toBe(false);
        expect(record.id).toMatch(ARTIFACT_ID_RE);
        expect(record.createdAt).toMatch(ISO_RE);
        // sha256 verified against an independent oracle (node:crypto in the test)
        expect(record.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
        // storageKey is deterministic and derived from the content hash
        expect(record.storageKey).toBe(
          `objects/${record.sha256.slice(0, 2)}/${record.sha256.slice(2, 4)}/${record.sha256}`,
        );

        const got = await artifactStore.get(record.id);
        expect(got).toEqual(record);

        const read = await artifactStore.readBytes(record.id);
        expect(read).not.toBeNull();
        if (read !== null) {
          expect(bytesEqual(read, bytes)).toBe(true);
        }
      });
    });

    test('redacted flag is carried through unchanged', async () => {
      await withPair(impl, async ({ artifactStore }) => {
        const record = await artifactStore.put({
          runId: newRunId(),
          kind: 'screenshot',
          mediaType: 'image/png',
          bytes: fakeBytes(64, 11),
          redacted: true,
        });
        expect(record.redacted).toBe(true);
        expect((await artifactStore.get(record.id))?.redacted).toBe(true);
      });
    });

    test('§5.2 content addressing: identical bytes twice → ONE canonical record; different bytes → different sha256', async () => {
      await withPair(impl, async ({ artifactStore }) => {
        const runId = newRunId();
        const first = await artifactStore.put({
          runId,
          kind: 'screenshot',
          mediaType: 'image/png',
          bytes: fakeBytes(512, 3),
        });
        const second = await artifactStore.put({
          runId,
          kind: 'screenshot',
          mediaType: 'image/png',
          bytes: fakeBytes(512, 3),
        });
        // same bytes+kind → the SAME record, never a second copy
        expect(second.id).toBe(first.id);
        expect(second).toEqual(first);
        expect(await artifactStore.list(runId)).toHaveLength(1);

        const other = await artifactStore.put({
          runId,
          kind: 'screenshot',
          mediaType: 'image/png',
          bytes: fakeBytes(512, 4),
        });
        expect(other.sha256).not.toBe(first.sha256);
        expect((await artifactStore.list(runId)).map((r) => r.id)).toEqual([first.id, other.id]);
      });
    });

    test('same bytes under a different kind produce a second record sharing one blob', async () => {
      await withPair(impl, async ({ artifactStore }) => {
        const runId = newRunId();
        const bytes = fakeBytes(256, 21);
        const a = await artifactStore.put({ runId, kind: 'screenshot', mediaType: 'image/png', bytes });
        const b = await artifactStore.put({ runId, kind: 'trace', mediaType: 'image/png', bytes });
        expect(b.id).not.toBe(a.id);
        expect(b.sha256).toBe(a.sha256);
        expect(b.storageKey).toBe(a.storageKey);
        expect(await artifactStore.list(runId)).toHaveLength(2);
        for (const record of [a, b]) {
          const read = await artifactStore.readBytes(record.id);
          expect(read).not.toBeNull();
          if (read !== null) expect(bytesEqual(read, bytes)).toBe(true);
        }
      });
    });

    test('§5.3 getBySha256 finds the artifact by content hash (and only within its run)', async () => {
      await withPair(impl, async ({ artifactStore }) => {
        const runId = newRunId();
        const record = await artifactStore.put({
          runId,
          kind: 'dom-snapshot',
          mediaType: 'application/json',
          bytes: fakeBytes(128, 5),
        });
        const found = await artifactStore.getBySha256(record.sha256, runId);
        expect(found?.id).toBe(record.id);
        expect(found).toEqual(record);
        // wrong run → null; unknown hash → null
        expect(await artifactStore.getBySha256(record.sha256, newRunId())).toBeNull();
        expect(await artifactStore.getBySha256('0'.repeat(64), runId)).toBeNull();
        // malformed hash → honest failure, not a silent miss
        await expect(artifactStore.getBySha256('not-a-hash', runId)).rejects.toThrow(/sha256/);
      });
    });

    test('unknown ids: get → null, readBytes → null, list of unknown run → []', async () => {
      await withPair(impl, async ({ artifactStore }) => {
        expect(await artifactStore.get('art_missing')).toBeNull();
        expect(await artifactStore.readBytes('art_missing')).toBeNull();
        expect(await artifactStore.list('run_never_used')).toEqual([]);
      });
    });

    test('stored bytes are isolated from later caller mutation', async () => {
      await withPair(impl, async ({ artifactStore }) => {
        const bytes = fakeBytes(64, 3);
        const record = await artifactStore.put({
          runId: newRunId(),
          kind: 'screenshot',
          mediaType: 'image/png',
          bytes,
        });
        const originalFirst = bytes[0] ?? 0;
        bytes[0] = (originalFirst + 1) % 256;
        const read = await artifactStore.readBytes(record.id);
        expect(read).not.toBeNull();
        if (read !== null) expect(read[0]).toBe(originalFirst);
      });
    });

    test('input validation rejects malformed put inputs', async () => {
      await withPair(impl, async ({ artifactStore }) => {
        const runId = newRunId();
        const bytes = fakeBytes(16, 1);
        await expect(
          artifactStore.put({ runId: '../escape', kind: 'screenshot', mediaType: 'image/png', bytes }),
        ).rejects.toThrow(/runId/);
        await expect(
          artifactStore.put({ runId, kind: '', mediaType: 'image/png', bytes }),
        ).rejects.toThrow(/kind/);
        await expect(
          artifactStore.put({ runId, kind: 'screenshot', mediaType: 'noslashtype', bytes }),
        ).rejects.toThrow(/mediaType/);
        await expect(
          artifactStore.put({ runId, kind: 'screenshot', mediaType: 'image/png', bytes: 'nope' as unknown as Uint8Array }),
        ).rejects.toThrow(/Uint8Array/);
      });
    });
  });
}
