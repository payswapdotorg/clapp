// CLAPP run/event/artifact contract v0 — declared by the tech lead.
// Changes require a tech-lead interface-freeze decision (see docs/WORKLOG.md).

export type RunId = string;        // "run_" + uuid v4
export type ArtifactId = string;   // "art_" + uuid v4
export type EvidenceId = string;   // "ev_"  + uuid v4

export type RunStatus = 'planned' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface RunBudget {
  maxDurationMs: number;
  maxMemoryMb?: number;
  maxArtifacts?: number;
  maxBytes?: number;
}

export interface RunMeta {
  id: RunId;
  targetId: string;                     // e.g. "bench/b01-static"
  kind: string;                         // 'observation' | 'synthesis' | 'verification' | 'hello'
  status: RunStatus;
  startedAt: string;                    // ISO-8601 UTC
  endedAt?: string;
  environment: Record<string, unknown>; // captured execution environment
  budget?: RunBudget;
}

export type EvidenceKind =
  | 'dom' | 'runtime' | 'network' | 'storage'
  | 'screenshot' | 'static' | 'user';

export interface EvidenceRef {
  evidenceId: EvidenceId;
  kind: EvidenceKind;
  sha256: string;                       // hex; hash of canonical evidence bytes
}

export type RunEventKind =
  | 'run.started' | 'run.completed' | 'run.failed' | 'run.cancelled'
  | 'log' | 'artifact.written' | 'evidence.recorded'
  | (string & {});                       // extensible

export interface RunEvent {
  runId: RunId;
  seq: number;                          // 0-based, strictly increasing per run
  ts: string;                           // ISO-8601 UTC
  kind: RunEventKind;
  payload?: unknown;
  evidenceRefs?: EvidenceRef[];
}

export type ArtifactKind =
  | 'screenshot' | 'dom-snapshot' | 'har' | 'trace' | 'ir' | 'report' | 'bundle'
  | (string & {});                       // extensible

export interface ArtifactRecord {
  id: ArtifactId;
  runId: RunId;
  kind: ArtifactKind;
  mediaType: string;                    // e.g. "image/png", "application/json"
  sizeBytes: number;
  sha256: string;                       // content hash of stored bytes
  storageKey: string;                   // opaque object-store key (store-owned)
  redacted: boolean;                    // true if secrets removed before persist
  createdAt: string;                    // ISO-8601 UTC
}
