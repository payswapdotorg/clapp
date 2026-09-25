// The canonical capture contract must stay byte-identical to the tech-lead
// declaration — this test pins the file against accidental drift by
// comparing it to the frozen text verbatim.

import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import type { CaptureRecord, EvidenceRecorder } from './capture-contract';
import { RecordingSession } from './recording-session';

const FROZEN_CONTRACT = `// ================= SHARED CONTRACT: capture-contract.ts =================
// CLAPP capture contract v0 — declared by the tech lead (P1 wave, 2026-09-25).
// Canonical owner: @clapp/evidence (CLAPP-011). @clapp/observe (CLAPP-010)
// implements capture channels AGAINST this port; @clapp/evidence implements
// the recording side. Every package carries a byte-identical mirror of this
// file (canonical ownership declared in the header); the tech lead freezes
// at integration. Changes require an ADR.

import type { EvidenceKind, EvidenceRef, RunId } from '@clapp/core';

/** One captured observation, pre-persist. */
export interface CaptureRecord {
  kind: EvidenceKind;      // 'dom' | 'runtime' | 'network' | 'storage' | 'screenshot' | 'static' | 'user'
  ts: string;              // ISO-8601 UTC
  /** channel-specific payload; MUST be canonical-JSON serializable */
  payload: unknown;
  /** true if redaction was applied BEFORE the record reached the recorder */
  redacted: boolean;
}

/**
 * The port every capture channel funnels observations through.
 * Implementations hash the canonical bytes, persist artifacts, and emit
 * 'evidence.recorded' run events with the returned refs.
 */
export interface EvidenceRecorder {
  readonly runId: RunId;
  record(capture: CaptureRecord): Promise<EvidenceRef>;
  /** flush buffered records; returns every ref emitted this session */
  flush(): Promise<EvidenceRef[]>;
}
`;

describe('canonical capture contract (src/capture-contract.ts)', () => {
  test('is byte-identical to the frozen tech-lead declaration', async () => {
    const text = await readFile(new URL('./capture-contract.ts', import.meta.url), 'utf8');
    expect(text).toBe(FROZEN_CONTRACT);
  });

  test('header declares @clapp/evidence as the canonical owner', async () => {
    const text = await readFile(new URL('./capture-contract.ts', import.meta.url), 'utf8');
    expect(text).toContain('Canonical owner: @clapp/evidence (CLAPP-011)');
  });

  test('RecordingSession satisfies the EvidenceRecorder port (compile-time)', () => {
    const session: RecordingSession | undefined = undefined;
    const recorder: EvidenceRecorder | undefined = session;
    expect(recorder).toBeUndefined();
  });

  test('CaptureRecord shape matches the contract', () => {
    const capture: CaptureRecord = {
      kind: 'dom',
      ts: '2026-09-25T10:00:00.000Z',
      payload: { note: 'fixture' },
      redacted: false,
    };
    expect(Object.keys(capture).sort()).toEqual(['kind', 'payload', 'redacted', 'ts']);
  });
});
