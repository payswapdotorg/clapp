import { describe, expect, it } from 'bun:test';
import type { ArtifactRecord, EvidenceRef, RunBudget, RunEvent, RunMeta } from './index';
import { newArtifactId, newRunId, sha256Hex } from './index';

function evidenceRefFixture(): EvidenceRef {
  return {
    evidenceId: 'ev_00000000-0000-4000-8000-000000000000',
    kind: 'dom',
    sha256: 'a'.repeat(64),
  };
}

describe('packages/core contract v0 shapes', () => {
  it('a fully-populated RunEvent conforms to the declared shape', () => {
    const event: RunEvent = {
      runId: newRunId(),
      seq: 0,
      ts: new Date().toISOString(),
      kind: 'evidence.recorded',
      payload: { note: 'fixture' },
      evidenceRefs: [evidenceRefFixture()],
    };
    expect(event.kind).toBe('evidence.recorded');
    expect(event.seq).toBe(0);
    expect(event.evidenceRefs).toHaveLength(1);
  });

  it('a fully-populated ArtifactRecord conforms and carries a real content hash', async () => {
    const bytes = 'png-ish-bytes';
    const record: ArtifactRecord = {
      id: newArtifactId(),
      runId: newRunId(),
      kind: 'screenshot',
      mediaType: 'image/png',
      sizeBytes: bytes.length,
      sha256: await sha256Hex(bytes),
      storageKey: 'runs/fixture/artifact',
      redacted: false,
      createdAt: new Date().toISOString(),
    };
    expect(record.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(record.redacted).toBe(false);
    expect(record.sizeBytes).toBe(bytes.length);
  });

  it('RunBudget and RunMeta honor the declared optionality', () => {
    const budget: RunBudget = { maxDurationMs: 1_000 };
    const meta: RunMeta = {
      id: newRunId(),
      targetId: 'bench/b01-static',
      kind: 'observation',
      status: 'planned',
      startedAt: new Date().toISOString(),
      environment: {},
      budget,
    };
    expect(meta.endedAt).toBeUndefined();
    expect(meta.budget?.maxMemoryMb).toBeUndefined();
    expect(meta.budget?.maxDurationMs).toBe(1_000);
  });
});
