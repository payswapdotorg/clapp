// buildBundle — manifest construction, determinism, and honest preconditions.

import { describe, expect, test } from 'bun:test';
import { sha256Hex } from '@clapp/core';
import type { EvidenceRef, RunEvent, RunMeta } from '@clapp/core';
import type { LoadedRun } from '@clapp/store';
import { MemoryArtifactStore, MemoryRunStore } from '@clapp/store';
import { buildBundle, loadRunFromStores } from './bundle';
import { canonicalJson } from './canonical-json';
import { recordedScenario, storeImplementations, withPair } from './test-utils';

function makeMeta(overrides?: Partial<RunMeta>): RunMeta {
  return {
    id: 'run_00000000-0000-4000-8000-000000000001',
    targetId: 'bench/b01-static',
    kind: 'observation',
    status: 'running',
    startedAt: '2026-09-25T10:00:00.000Z',
    environment: { os: 'linux', engine: 'bun' },
    ...overrides,
  };
}

function makeEvent(runId: string, seq: number, kind: string, evidenceRefs?: EvidenceRef[]): RunEvent {
  return {
    runId,
    seq,
    ts: `2026-09-25T10:00:0${seq}.000Z`,
    kind,
    ...(evidenceRefs !== undefined ? { evidenceRefs } : {}),
  };
}

/** Rebuild any JSON value with object keys inserted in REVERSE sorted order. */
function withReversedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withReversedKeys);
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort().reverse()) {
      out[key] = withReversedKeys(record[key]);
    }
    return out;
  }
  return value;
}

describe('buildBundle', () => {
  test('collects the run meta, full event stream, artifacts and deduped evidence refs', async () => {
    await withPair(storeImplementations[0]!, async (stores) => {
      const { runId } = await recordedScenario(stores);
      const run = await loadRunFromStores(stores, runId);
      expect(run).not.toBeNull();
      const bundle = await buildBundle(run as LoadedRun);

      expect(bundle.manifest.schemaVersion).toBe(1);
      expect(bundle.manifest.run.id).toBe(runId);
      expect(bundle.manifest.run.status).toBe('completed');
      expect(bundle.manifest.events.map((event) => event.kind)).toEqual([
        'run.started',
        'evidence.recorded',
        'evidence.recorded',
        'evidence.recorded',
        'run.completed',
      ]);
      expect(bundle.manifest.evidence).toHaveLength(3);
      expect(bundle.manifest.artifacts).toHaveLength(3);
      expect(bundle.manifest.evidence.map((ref) => ref.kind)).toEqual(['dom', 'network', 'runtime']);
    });
  });

  test('rootHash is sha256 over canonicalJson(manifest), independently recomputed', async () => {
    await withPair(storeImplementations[0]!, async (stores) => {
      const { runId } = await recordedScenario(stores);
      const bundle = await buildBundle((await loadRunFromStores(stores, runId)) as LoadedRun);
      expect(bundle.rootHash).toBe(await sha256Hex(canonicalJson(bundle.manifest)));
      // and the materialized manifest re-canonicalizes to the same bytes
      expect(canonicalJson(bundle.manifest)).toBe(canonicalJson(bundle.manifest));
    });
  });

  test('deterministic: identical LoadedRun data → identical rootHash', async () => {
    await withPair(storeImplementations[0]!, async (stores) => {
      const { runId } = await recordedScenario(stores);
      const run = (await loadRunFromStores(stores, runId)) as LoadedRun;
      const first = await buildBundle(run);
      const second = await buildBundle(run);
      expect(second.rootHash).toBe(first.rootHash);
    });
  });

  test('key insertion order does not affect the rootHash (canonicalization)', async () => {
    const ref: EvidenceRef = {
      evidenceId: 'ev_00000000-0000-4000-8000-000000000001',
      kind: 'dom',
      sha256: 'a'.repeat(64),
    };
    const run: LoadedRun = {
      meta: makeMeta(),
      events: [makeEvent(makeMeta().id, 0, 'run.started'), makeEvent(makeMeta().id, 1, 'evidence.recorded', [ref])],
      artifacts: [],
    };
    const shuffled: LoadedRun = withReversedKeys(run) as LoadedRun;
    const first = await buildBundle(run);
    const second = await buildBundle(shuffled);
    expect(second.rootHash).toBe(first.rootHash);
  });

  test('the manifest is detached from the caller’s LoadedRun objects', async () => {
    const run: LoadedRun = {
      meta: makeMeta(),
      events: [makeEvent(makeMeta().id, 0, 'run.started')],
      artifacts: [],
    };
    const bundle = await buildBundle(run);
    const rootBefore = bundle.rootHash;
    run.meta.targetId = 'bench/tampered';
    (run.events[0] as RunEvent).kind = 'log';
    expect(bundle.rootHash).toBe(rootBefore);
    expect(bundle.manifest.run.targetId).toBe('bench/b01-static');
  });

  test('evidence refs dedupe by evidenceId across events (first occurrence kept)', async () => {
    const ref: EvidenceRef = {
      evidenceId: 'ev_00000000-0000-4000-8000-000000000001',
      kind: 'dom',
      sha256: 'b'.repeat(64),
    };
    const run: LoadedRun = {
      meta: makeMeta(),
      events: [
        makeEvent(makeMeta().id, 0, 'run.started'),
        makeEvent(makeMeta().id, 1, 'evidence.recorded', [ref]),
        makeEvent(makeMeta().id, 2, 'evidence.recorded', [ref]),
      ],
      artifacts: [],
    };
    const bundle = await buildBundle(run);
    expect(bundle.manifest.evidence).toEqual([ref]);
  });

  test('the same evidenceId with DIFFERENT content throws', async () => {
    const a: EvidenceRef = { evidenceId: 'ev_1', kind: 'dom', sha256: 'c'.repeat(64) };
    const b: EvidenceRef = { evidenceId: 'ev_1', kind: 'dom', sha256: 'd'.repeat(64) };
    const run: LoadedRun = {
      meta: makeMeta(),
      events: [
        makeEvent(makeMeta().id, 0, 'run.started'),
        makeEvent(makeMeta().id, 1, 'evidence.recorded', [a]),
        makeEvent(makeMeta().id, 2, 'evidence.recorded', [b]),
      ],
      artifacts: [],
    };
    await expect(buildBundle(run)).rejects.toThrow(/different content/);
  });

  test('rejects non-monotonic event streams (duplicate seq)', async () => {
    const run: LoadedRun = {
      meta: makeMeta(),
      events: [makeEvent(makeMeta().id, 0, 'run.started'), makeEvent(makeMeta().id, 0, 'log')],
      artifacts: [],
    };
    await expect(buildBundle(run)).rejects.toThrow(/non-increasing seq/);
  });

  test('rejects a stream that does not start at seq 0', async () => {
    const run: LoadedRun = {
      meta: makeMeta(),
      events: [makeEvent(makeMeta().id, 1, 'log')],
      artifacts: [],
    };
    await expect(buildBundle(run)).rejects.toThrow(/seq/);
  });

  test('rejects events from another run', async () => {
    const run: LoadedRun = {
      meta: makeMeta(),
      events: [makeEvent(makeMeta().id, 0, 'run.started'), makeEvent('run_other', 1, 'log')],
      artifacts: [],
    };
    await expect(buildBundle(run)).rejects.toThrow(/does not belong to run/);
  });

  test('rejects artifacts from another run', async () => {
    const run: LoadedRun = {
      meta: makeMeta(),
      events: [],
      artifacts: [
        {
          id: 'art_1',
          runId: 'run_other',
          kind: 'trace',
          mediaType: 'application/json',
          sizeBytes: 1,
          sha256: 'e'.repeat(64),
          storageKey: `objects/e${'e'.repeat(1)}/e${'e'.repeat(1)}/${'e'.repeat(64)}`,
          redacted: false,
          createdAt: '2026-09-25T10:00:00.000Z',
        },
      ],
    };
    await expect(buildBundle(run)).rejects.toThrow(/does not belong to run/);
  });

  test('rejects malformed run meta with the observed violations', async () => {
    const run: LoadedRun = {
      meta: makeMeta({ startedAt: 'not-a-date' }),
      events: [],
      artifacts: [],
    };
    await expect(buildBundle(run)).rejects.toThrow(/run meta violates the contract.*startedAt/s);
  });

  test('an empty run seals to a bundle with zero counts and a real root hash', async () => {
    const run: LoadedRun = { meta: makeMeta({ status: 'planned' }), events: [], artifacts: [] };
    const bundle = await buildBundle(run);
    expect(bundle.rootHash).toMatch(/^[0-9a-f]{64}$/);
    expect(bundle.manifest.events).toEqual([]);
    expect(bundle.manifest.evidence).toEqual([]);
    expect(bundle.manifest.artifacts).toEqual([]);
  });
});

describe('loadRunFromStores', () => {
  test('returns null for an unknown run', async () => {
    const stores = { runStore: new MemoryRunStore(), artifactStore: new MemoryArtifactStore() };
    expect(await loadRunFromStores(stores, 'run_unknown')).toBeNull();
  });

  test('round-trips meta, events and artifacts from memory stores', async () => {
    await withPair(storeImplementations[0]!, async (stores) => {
      const { runId, refs } = await recordedScenario(stores);
      const run = (await loadRunFromStores(stores, runId)) as LoadedRun;
      expect(run.meta.id).toBe(runId);
      expect(run.events).toHaveLength(5);
      expect(run.artifacts).toHaveLength(3);
      const recordedRefs = run.events.flatMap((event) => event.evidenceRefs ?? []);
      expect(recordedRefs).toEqual(refs);
    });
  });
});
