import type { EvidenceRef, RunEvent } from './contract';

/**
 * Event-stream invariants and validation for the core contract.
 *
 * The closed vocabularies (RunStatus, EvidenceKind, ArtifactKind) are mirrored
 * as runtime constants so validators and sibling packages check membership
 * against one source of truth instead of inventing copies. The extensible
 * unions (RunEventKind, ArtifactKind) are deliberately NOT membership-checked:
 * unknown kinds are valid data, not violations — unknown-over-invented.
 */

export const RUN_STATUSES = [
  'planned',
  'running',
  'completed',
  'failed',
  'cancelled',
] as const;

export const EVIDENCE_KINDS = [
  'dom',
  'runtime',
  'network',
  'storage',
  'screenshot',
  'static',
  'user',
] as const;

export const ARTIFACT_KINDS = [
  'screenshot',
  'dom-snapshot',
  'har',
  'trace',
  'ir',
  'report',
  'bundle',
] as const;

const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * Asserts the per-run ordering invariants of an event stream:
 * every event carries the same `runId`, and `seq` is strictly increasing.
 * Throws with an observed-evidence message on the first violation.
 * An empty list is trivially valid.
 */
export function assertMonotonicSeq(events: RunEvent[]): void {
  if (events.length === 0) return;

  const runId = events[0]!.runId;
  let previous: RunEvent | undefined;

  for (const event of events) {
    if (event.runId !== runId) {
      throw new Error(
        `assertMonotonicSeq: runId mismatch at seq ${String(event.seq)}: expected ${runId}, observed ${event.runId}`,
      );
    }
    if (previous !== undefined && !(event.seq > previous.seq)) {
      throw new Error(
        `assertMonotonicSeq: non-increasing seq for run ${runId}: ${String(previous.seq)} -> ${String(event.seq)}`,
      );
    }
    previous = event;
  }
}

/**
 * Structural validation of a single `RunEvent` against the contract.
 * Returns a list of human-readable violations; an empty list means conformant.
 *
 * Total over untrusted input: never throws, never invents values — every
 * violation message reports exactly what was observed.
 */
export function validateRunEvent(event: RunEvent): string[] {
  // Widen to unknown before inspecting: runtime shapes may violate the
  // declared type, and a validator must not crash on them.
  const candidate: unknown = event;
  if (typeof candidate !== 'object' || candidate === null) {
    return [`RunEvent must be an object, observed ${preview(candidate)}`];
  }

  const violations: string[] = [];

  if (typeof event.runId !== 'string' || event.runId.length === 0) {
    violations.push(`runId must be a non-empty string, observed ${preview(event.runId)}`);
  }

  if (typeof event.ts !== 'string' || Number.isNaN(Date.parse(event.ts))) {
    violations.push(`ts must be a parseable ISO-8601 timestamp, observed ${preview(event.ts)}`);
  }

  if (typeof event.kind !== 'string' || event.kind.length === 0) {
    violations.push(`kind must be a non-empty string, observed ${preview(event.kind)}`);
  }

  if (!Number.isInteger(event.seq) || event.seq < 0) {
    violations.push(`seq must be an integer >= 0, observed ${preview(event.seq)}`);
  }

  if (event.evidenceRefs !== undefined) {
    if (!Array.isArray(event.evidenceRefs)) {
      violations.push(
        `evidenceRefs must be an array when present, observed ${preview(event.evidenceRefs)}`,
      );
    } else {
      event.evidenceRefs.forEach((ref, index) => {
        violations.push(...validateEvidenceRef(ref, index));
      });
    }
  }

  return violations;
}

function validateEvidenceRef(ref: unknown, index: number): string[] {
  if (typeof ref !== 'object' || ref === null) {
    return [`evidenceRefs[${index}] must be an object, observed ${preview(ref)}`];
  }

  const record = ref as Partial<EvidenceRef>;
  const violations: string[] = [];

  if (typeof record.evidenceId !== 'string' || record.evidenceId.length === 0) {
    violations.push(
      `evidenceRefs[${index}].evidenceId must be a non-empty string, observed ${preview(record.evidenceId)}`,
    );
  }

  if (!isEvidenceKind(record.kind)) {
    violations.push(
      `evidenceRefs[${index}].kind must be one of ${EVIDENCE_KINDS.join('|')}, observed ${preview(record.kind)}`,
    );
  }

  if (typeof record.sha256 !== 'string' || !SHA256_HEX.test(record.sha256)) {
    violations.push(
      `evidenceRefs[${index}].sha256 must be 64 lowercase hex chars, observed ${preview(record.sha256)}`,
    );
  }

  return violations;
}

function isEvidenceKind(value: unknown): value is (typeof EVIDENCE_KINDS)[number] {
  return typeof value === 'string' && (EVIDENCE_KINDS as readonly string[]).includes(value);
}

/** Non-throwing preview of an observed value for violation messages. */
function preview(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  try {
    return String(value);
  } catch {
    return '<unprintable>';
  }
}
