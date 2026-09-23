// §5 tests 4–5 and 7 (+ immutability & validation extras), parametrized over
// the memory and filesystem RunStore implementations (§5 test 8).

import { describe, expect, test } from 'bun:test';
import type { RunStatus } from '@clapp/core';
import { makeRunMeta, newRunId, runEvent, storeImplementations, withPair } from './test-utils';

for (const impl of storeImplementations) {
  describe(`RunStore — ${impl.name}`, () => {
    test('createRun → getRun round-trips the meta', async () => {
      await withPair(impl, async ({ runStore }) => {
        const meta = makeRunMeta();
        const created = await runStore.createRun(meta);
        expect(created).toEqual(meta);
        expect(await runStore.getRun(meta.id)).toEqual(meta);
      });
    });

    test('createRun is idempotent for identical meta (any key order) and refuses divergent re-creation', async () => {
      await withPair(impl, async ({ runStore }) => {
        const meta = makeRunMeta();
        await runStore.createRun(meta);
        // same content, differently ordered keys → still the same run
        const reordered = {
          environment: meta.environment,
          startedAt: meta.startedAt,
          status: meta.status,
          kind: meta.kind,
          targetId: meta.targetId,
          id: meta.id,
        };
        const again = await runStore.createRun(reordered);
        expect(again).toEqual(meta);
        // divergent meta under the same id → honest failure, no overwrite
        await expect(runStore.createRun({ ...meta, targetId: 'bench/other' })).rejects.toThrow(/already exists/);
      });
    });

    test('§5.4 appendEvent rejects duplicate seq', async () => {
      await withPair(impl, async ({ runStore }) => {
        const meta = makeRunMeta({ status: 'running' });
        await runStore.createRun(meta);
        await runStore.appendEvent(runEvent(meta.id, 0, 'run.started'));
        await runStore.appendEvent(runEvent(meta.id, 1, 'log'));
        await expect(runStore.appendEvent(runEvent(meta.id, 1, 'log'))).rejects.toThrow(/non-monotonic/);
        await expect(runStore.appendEvent(runEvent(meta.id, 0, 'log'))).rejects.toThrow(/non-monotonic/);
        // rejected writes append nothing
        expect(await runStore.listEvents(meta.id)).toHaveLength(2);
      });
    });

    test('§5.4 appendEvent rejects out-of-order seq', async () => {
      await withPair(impl, async ({ runStore }) => {
        const meta = makeRunMeta();
        await runStore.createRun(meta);
        await runStore.appendEvent(runEvent(meta.id, 0, 'run.started'));
        await runStore.appendEvent(runEvent(meta.id, 1, 'log'));
        await runStore.appendEvent(runEvent(meta.id, 2, 'log'));
        await expect(runStore.appendEvent(runEvent(meta.id, 1, 'log'))).rejects.toThrow(/non-monotonic/);
        const events = await runStore.listEvents(meta.id);
        expect(events.map((e) => e.seq)).toEqual([0, 1, 2]);
      });
    });

    test('first event must be seq 0; gaps are tolerated (strictly increasing)', async () => {
      await withPair(impl, async ({ runStore }) => {
        const meta = makeRunMeta();
        await runStore.createRun(meta);
        await expect(runStore.appendEvent(runEvent(meta.id, 3, 'run.started'))).rejects.toThrow(/seq 0/);
        await runStore.appendEvent(runEvent(meta.id, 0, 'run.started'));
        await runStore.appendEvent(runEvent(meta.id, 2, 'log'));
        const events = await runStore.listEvents(meta.id);
        expect(events.map((e) => e.seq)).toEqual([0, 2]);
      });
    });

    test('appendEvent rejects events for unknown runs', async () => {
      await withPair(impl, async ({ runStore }) => {
        await expect(runStore.appendEvent(runEvent(newRunId(), 0, 'run.started'))).rejects.toThrow(/does not exist/);
      });
    });

    test('appendEvent validates the event shape', async () => {
      await withPair(impl, async ({ runStore }) => {
        const meta = makeRunMeta();
        await runStore.createRun(meta);
        await expect(runStore.appendEvent(runEvent(meta.id, -1, 'log'))).rejects.toThrow(/seq/);
        await expect(runStore.appendEvent(runEvent(meta.id, 1.5, 'log'))).rejects.toThrow(/seq/);
        const badTs = { ...runEvent(meta.id, 0, 'run.started'), ts: 'yesterday' };
        await expect(runStore.appendEvent(badTs)).rejects.toThrow(/ISO-8601/);
      });
    });

    test('§5.5 append-only events: listEvents returns insertion order after many appends', async () => {
      await withPair(impl, async ({ runStore }) => {
        const meta = makeRunMeta();
        await runStore.createRun(meta);
        const kinds = [
          'run.started',
          'log',
          'artifact.written',
          'evidence.recorded',
          'log',
          'artifact.written',
          'log',
          'run.completed',
        ] as const;
        for (let seq = 0; seq < kinds.length; seq += 1) {
          await runStore.appendEvent(runEvent(meta.id, seq, kinds[seq] ?? 'log', { step: seq }));
        }
        const events = await runStore.listEvents(meta.id);
        expect(events.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
        expect(events.map((e) => e.kind)).toEqual([...kinds]);
        expect(events.map((e) => e.payload)).toEqual(kinds.map((_kind, i) => ({ step: i })));
      });
    });

    test('§5.7 updateStatus changes only status and endedAt', async () => {
      await withPair(impl, async ({ runStore }) => {
        const meta = makeRunMeta({
          status: 'running',
          budget: { maxDurationMs: 5000, maxArtifacts: 4 },
        });
        await runStore.createRun(meta);
        await runStore.appendEvent(runEvent(meta.id, 0, 'run.started'));

        const endedAt = '2026-09-23T10:05:00.000Z';
        const updated = await runStore.updateStatus(meta.id, 'failed', endedAt);
        expect(updated).toEqual({ ...meta, status: 'failed', endedAt });
        expect(await runStore.getRun(meta.id)).toEqual({ ...meta, status: 'failed', endedAt });

        // events are untouched by status updates
        expect(await runStore.listEvents(meta.id)).toHaveLength(1);

        // a later update without endedAt preserves the recorded one
        await runStore.updateStatus(meta.id, 'cancelled');
        const after = await runStore.getRun(meta.id);
        expect(after?.status).toBe('cancelled');
        expect(after?.endedAt).toBe(endedAt);

        // unknown run → null; invalid status → honest failure
        expect(await runStore.updateStatus(newRunId(), 'completed')).toBeNull();
        await expect(runStore.updateStatus(meta.id, 'bogus' as RunStatus)).rejects.toThrow(/status/);
      });
    });

    test('listEvents throws for unknown runs (empty ≠ nonexistent)', async () => {
      await withPair(impl, async ({ runStore }) => {
        await expect(runStore.listEvents(newRunId())).rejects.toThrow(/does not exist/);
      });
    });
  });
}
