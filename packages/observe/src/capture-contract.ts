// ================= SHARED CONTRACT: capture-contract.ts =================
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
