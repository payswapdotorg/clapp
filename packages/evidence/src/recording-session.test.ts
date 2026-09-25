// RecordingSession — the EvidenceRecorder implementation, parametrized over
// the memory and filesystem store pairs (mirrors @clapp/store's battery).

import { describe, expect, test } from 'bun:test';
import { assertMonotonicSeq, sha256Hex } from '@clapp/core';
import type { ArtifactRecord, EvidenceKind, RunEvent } from '@clapp/core';
import { canonicalJson } from './canonical-json';
import { InvalidCaptureError, RecordingSession, SessionStateError } from './recording-session';
import { EVIDENCE_TO_ARTIFACT_KIND } from './recording-session';
import { captureFixture, fakeSecret, storeImplementations, withPair } from './test-utils';

for (const impl of storeImplementations) {
  describe(`RecordingSession — ${impl.name}`, () => {
    test('start() creates the run, appends run.started at seq 0, and flips status to running', async () => {
      await withPair(impl, async (stores) => {
        const session = await RecordingSession.start(stores, {
          targetId: 'bench/b01-static',
          kind: 'observation',
          environment: { os: 'linux', engine: 'bun' },
        });
        const meta = await stores.runStore.getRun(session.runId);
        expect(meta?.status).toBe('running');
        expect(meta?.kind).toBe('observation');
        expect(meta?.targetId).toBe('bench/b01-static');
        expect(meta?.environment).toEqual({ os: 'linux', engine: 'bun' });

        const events = await stores.runStore.listEvents(session.runId);
        expect(events).toHaveLength(1);
        expect(events[0]?.kind).toBe('run.started');
        expect(events[0]?.seq).toBe(0);
        expect(events[0]?.payload).toEqual({ targetId: 'bench/b01-static', kind: 'observation' });
      });
    });

    test('record() persists canonical evidence bytes and emits evidence.recorded with the ref', async () => {
      await withPair(impl, async (stores) => {
        const session = await RecordingSession.start(stores, { targetId: 'bench/b01-static' });
        const capture = captureFixture();
        const ref = await session.record(capture);

        expect(ref.kind).toBe('dom');
        // independent recomputation of the evidence hash
        const expectedBytes = new TextEncoder().encode(canonicalJson(capture));
        expect(ref.sha256).toBe(await sha256Hex(expectedBytes));

        const artifacts = await stores.artifactStore.list(session.runId);
        expect(artifacts).toHaveLength(1);
        const artifact = artifacts[0] as ArtifactRecord;
        expect(artifact.kind).toBe('dom-snapshot');
        expect(artifact.mediaType).toBe('application/json');
        expect(artifact.sha256).toBe(ref.sha256);
        expect(artifact.sizeBytes).toBe(expectedBytes.byteLength);
        expect(artifact.redacted).toBe(false);

        // stored bytes are exactly the canonical JSON of the capture
        const stored = await stores.artifactStore.readBytes(artifact.id);
        expect(Array.from(stored ?? [])).toEqual(Array.from(expectedBytes));

        const events = await stores.runStore.listEvents(session.runId);
        expect(events.map((event) => event.kind)).toEqual(['run.started', 'evidence.recorded']);
        const evidenceEvent = events[1] as RunEvent;
        expect(evidenceEvent.evidenceRefs).toEqual([ref]);
        expect(evidenceEvent.payload).toEqual({ artifactId: artifact.id, sizeBytes: artifact.sizeBytes });
      });
    });

    test('record() copies the redacted flag onto the artifact record', async () => {
      await withPair(impl, async (stores) => {
        const session = await RecordingSession.start(stores, { targetId: 'bench/b01-static' });
        await session.record(captureFixture({ kind: 'network', redacted: true, payload: { requests: [] } }));
        const artifacts = await stores.artifactStore.list(session.runId);
        expect(artifacts[0]?.redacted).toBe(true);
      });
    });

    test('record() is idempotent for byte-identical captures (same ref, one artifact, one event)', async () => {
      await withPair(impl, async (stores) => {
        const session = await RecordingSession.start(stores, { targetId: 'bench/b01-static' });
        const first = await session.record(captureFixture());
        // same content, different key insertion order → same canonical bytes
        const reordered = {
          payload: { headings: ['CLAPP', 'Evidence'], title: 'Home' },
          redacted: false,
          ts: '2026-09-25T10:00:00.000Z',
          kind: 'dom' as const,
        };
        const second = await session.record(reordered);
        expect(second).toEqual(first);

        expect(await stores.artifactStore.list(session.runId)).toHaveLength(1);
        const events = await stores.runStore.listEvents(session.runId);
        expect(events).toHaveLength(2); // run.started + the single evidence.recorded
      });
    });

    test('record() rejects non-canonical payloads without appending events or artifacts', async () => {
      await withPair(impl, async (stores) => {
        const session = await RecordingSession.start(stores, { targetId: 'bench/b01-static' });
        const before = await stores.runStore.listEvents(session.runId);

        const badPayloads: unknown[] = [
          { fn: () => 1 },
          { hole: undefined },
          { nan: Number.NaN },
          { when: new Date(0) },
        ];
        for (const payload of badPayloads) {
          await expect(
            session.record(captureFixture({ payload: payload as never })),
          ).rejects.toThrow(InvalidCaptureError);
        }

        expect(await stores.runStore.listEvents(session.runId)).toEqual(before);
        expect(await stores.artifactStore.list(session.runId)).toHaveLength(0);
      });
    });

    test('record() validates kind, ts and redacted before anything is persisted', async () => {
      await withPair(impl, async (stores) => {
        const session = await RecordingSession.start(stores, { targetId: 'bench/b01-static' });
        await expect(session.record(captureFixture({ kind: 'telemetry' as EvidenceKind }))).rejects.toThrow(
          /kind must be one of/,
        );
        await expect(session.record(captureFixture({ ts: 'not-a-timestamp' }))).rejects.toThrow(/ts must be/);
        await expect(
          session.record(captureFixture({ redacted: 'yes' as unknown as boolean })),
        ).rejects.toThrow(/redacted must be a boolean/);
        expect(await stores.artifactStore.list(session.runId)).toHaveLength(0);
      });
    });

    test('every evidence kind maps to its artifact kind on persist', async () => {
      await withPair(impl, async (stores) => {
        const session = await RecordingSession.start(stores, { targetId: 'bench/b01-static' });
        const kinds = Object.keys(EVIDENCE_TO_ARTIFACT_KIND) as EvidenceKind[];
        for (const [index, kind] of kinds.entries()) {
          await session.record(captureFixture({ kind, ts: `2026-09-25T10:00:0${index}.000Z`, payload: { i: index } }));
        }
        const artifacts = await stores.artifactStore.list(session.runId);
        expect(artifacts.map((artifact) => artifact.kind)).toEqual(kinds.map((kind) => EVIDENCE_TO_ARTIFACT_KIND[kind]));
      });
    });

    test('flush() returns every emitted ref in record order, idempotently', async () => {
      await withPair(impl, async (stores) => {
        const session = await RecordingSession.start(stores, { targetId: 'bench/b01-static' });
        const first = await session.record(captureFixture());
        const second = await session.record(
          captureFixture({ kind: 'runtime', ts: '2026-09-25T10:00:01.000Z', payload: { console: [] } }),
        );
        const refs = await session.flush();
        expect(refs).toEqual([first, second]);
        expect(await session.flush()).toEqual(refs);
        expect(session.refs).toEqual(refs);
      });
    });

    test('complete() appends run.completed with the evidence count and sets status/endedAt', async () => {
      await withPair(impl, async (stores) => {
        const session = await RecordingSession.start(stores, { targetId: 'bench/b01-static' });
        await session.record(captureFixture());
        await session.record(
          captureFixture({ kind: 'storage', ts: '2026-09-25T10:00:01.000Z', payload: { keys: [] } }),
        );
        const meta = await session.complete();

        expect(meta.status).toBe('completed');
        expect(meta.endedAt).toBeDefined();
        expect(await stores.runStore.getRun(session.runId)).toEqual(meta);

        const events = await stores.runStore.listEvents(session.runId);
        expect(events.map((event) => event.kind)).toEqual([
          'run.started',
          'evidence.recorded',
          'evidence.recorded',
          'run.completed',
        ]);
        expect(events[3]?.payload).toEqual({ evidenceCount: 2 });
        // flush() still answers after the run ended
        expect(await session.flush()).toHaveLength(2);
      });
    });

    test('fail(reason) appends run.failed with the reason and sets status failed', async () => {
      await withPair(impl, async (stores) => {
        const session = await RecordingSession.start(stores, { targetId: 'bench/b01-static' });
        const meta = await session.fail('budget exceeded');
        expect(meta.status).toBe('failed');
        const events = await stores.runStore.listEvents(session.runId);
        expect(events.at(-1)?.kind).toBe('run.failed');
        expect(events.at(-1)?.payload).toEqual({ reason: 'budget exceeded' });
      });
    });

    test('cancel() appends run.cancelled and sets status cancelled', async () => {
      await withPair(impl, async (stores) => {
        const session = await RecordingSession.start(stores, { targetId: 'bench/b01-static' });
        const meta = await session.cancel();
        expect(meta.status).toBe('cancelled');
        const events = await stores.runStore.listEvents(session.runId);
        expect(events.at(-1)?.kind).toBe('run.cancelled');
      });
    });

    test('record()/log() after a terminal state throw SessionStateError', async () => {
      await withPair(impl, async (stores) => {
        const session = await RecordingSession.start(stores, { targetId: 'bench/b01-static' });
        await session.complete();
        await expect(session.record(captureFixture())).rejects.toThrow(SessionStateError);
        await expect(session.log('late')).rejects.toThrow(SessionStateError);
        await expect(session.complete()).rejects.toThrow(SessionStateError);
      });
    });

    test('log() appends a log event with its payload', async () => {
      await withPair(impl, async (stores) => {
        const session = await RecordingSession.start(stores, { targetId: 'bench/b01-static' });
        await session.log({ phase: 'warmup' });
        const events = await stores.runStore.listEvents(session.runId);
        expect(events.map((event) => event.kind)).toEqual(['run.started', 'log']);
        expect(events[1]?.payload).toEqual({ phase: 'warmup' });
      });
    });

    test('the emitted event stream satisfies the core monotonicity contract', async () => {
      await withPair(impl, async (stores) => {
        const session = await RecordingSession.start(stores, { targetId: 'bench/b01-static' });
        await session.log({ i: 1 });
        await session.record(captureFixture());
        await session.log({ i: 2 });
        await session.record(
          captureFixture({ kind: 'user', ts: '2026-09-25T10:00:01.000Z', payload: { consent: true } }),
        );
        await session.complete();
        const events = await stores.runStore.listEvents(session.runId);
        expect(() => assertMonotonicSeq(events)).not.toThrow();
        expect(events.map((event) => event.seq)).toEqual([0, 1, 2, 3, 4, 5]);
      });
    });

    test('evidence containing assembled fake credentials is stored byte-exactly (redaction is the channel duty)', async () => {
      await withPair(impl, async (stores) => {
        const session = await RecordingSession.start(stores, { targetId: 'bench/b01-static' });
        // no secret-shaped literals: assembled from fragments at runtime
        const payload = { sessionToken: fakeSecret('tok', 1), apiKey: fakeSecret('key', 2) };
        const capture = captureFixture({ payload, redacted: true });
        const ref = await session.record(capture);
        const record = await stores.artifactStore.getBySha256(ref.sha256, session.runId);
        expect(record).not.toBeNull();
        const bytes = await stores.artifactStore.readBytes((record as ArtifactRecord).id);
        expect(new TextDecoder().decode(bytes ?? new Uint8Array())).toBe(canonicalJson(capture));
        // the recorder persisted what it received — flag honesty, no scanning
        expect((record as ArtifactRecord).redacted).toBe(true);
      });
    });

    test('record() with a huge nested plain payload round-trips canonically', async () => {
      await withPair(impl, async (stores) => {
        const session = await RecordingSession.start(stores, { targetId: 'bench/b01-static' });
        const payload = { tree: { b: { z: 1, a: 2 }, a: [1, [2, [3, { k: 'v' }]]] } };
        const ref = await session.record(captureFixture({ payload }));
        const record = await stores.artifactStore.getBySha256(ref.sha256, session.runId);
        const bytes = await stores.artifactStore.readBytes((record as ArtifactRecord).id);
        expect(new TextDecoder().decode(bytes ?? new Uint8Array())).toBe(canonicalJson({ ...captureFixture(), payload }));
      });
    });
  });
}
