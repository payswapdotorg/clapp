/**
 * @clapp/diff — id minting for the Differential Verification artifacts.
 *
 * The diff contract declares three prefixed-uuid identities ("diffr_",
 * "diff_", "ev_" — the last shared with @clapp/core's EvidenceId) plus the
 * runner-internal capture id space ("cap_"). Ids are minted exclusively
 * through a {@link DiffIdFactory} so reports are REPRODUCIBLE: tests (and
 * any deterministic consumer) inject the counter-based factory, and the
 * default factory uses `crypto.randomUUID()`.
 *
 * Honest scope note (same discipline as @clapp/plan's ids.ts): the uuid
 * version/variant bits are NOT pinned by validation (any uuid-shaped hex
 * is accepted downstream in report parsing) — the patterns here document
 * the minting convention; the deterministic factory keeps v4-shaped bits
 * so minted ids look like runtime ones.
 */

/** A minted id: `"diffr_" | "diff_" | "ev_" | "cap_"` + uuid-shaped hex. */
export type DiffMintedIdKind = 'diffr_' | 'diff_' | 'ev_' | 'cap_';

/** Injects every identity a paired run + report needs. */
export interface DiffIdFactory {
  /** Report identity: "diffr_" + uuid v4. */
  newDiffReportId(): string;
  /** Finding identity: "diff_" + uuid v4. */
  newFindingId(): string;
  /** Evidence entry identity: "ev_" + uuid v4 (core EvidenceId space). */
  newEvidenceId(): string;
  /** Capture entry identity: "cap_" + uuid v4 (runner-internal page/network/storage captures). */
  newCaptureId(): string;
}

function uuidV4(): string {
  const uuid = crypto.randomUUID();
  return uuid;
}

function prefixed(prefix: DiffMintedIdKind, uuid: string): string {
  return `${prefix}${uuid}`;
}

/** The default factory: real uuid v4 via crypto.randomUUID(). */
export function createDiffIdFactory(): DiffIdFactory {
  return {
    newDiffReportId: () => prefixed('diffr_', uuidV4()),
    newFindingId: () => prefixed('diff_', uuidV4()),
    newEvidenceId: () => prefixed('ev_', uuidV4()),
    newCaptureId: () => prefixed('cap_', uuidV4()),
  };
}

/** uuid v4 shape with the version/variant bits intact (fixture-friendly). */
const V4_TAIL = '00000000-0000-4000-8000-';

function pad12(value: number): string {
  return String(value).padStart(12, '0');
}

/**
 * The deterministic factory: a single monotonic counter shared across all
 * four kinds (ids stay unique within a run/report pipeline), rendered as
 * uuid-v4-SHAPED placeholders — same convention as the sibling packages'
 * golden fixtures. Intended for tests and reproducible consumers; NOT for
 * production runs (ids would collide across pipelines).
 */
export function createDeterministicDiffIdFactory(): DiffIdFactory {
  let counter = 0;
  const next = (): string => {
    counter += 1;
    return `${V4_TAIL}${pad12(counter)}`;
  };
  return {
    newDiffReportId: () => prefixed('diffr_', next()),
    newFindingId: () => prefixed('diff_', next()),
    newEvidenceId: () => prefixed('ev_', next()),
    newCaptureId: () => prefixed('cap_', next()),
  };
}
