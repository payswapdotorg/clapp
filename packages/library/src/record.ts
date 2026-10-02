/**
 * @clapp/library — the PackageCandidate document (CLAPP-050).
 *
 * The §5 promotion-stage record (docs/LEARNING_AND_LIBRARY.md): extraction
 * mints CANDIDATES and only candidates — promotion to 'verified' /
 * 'replayed' / 'stable' / 'preferred' is a later, test-gated lane
 * (CLAPP-054), never performed here. Package versions are IMMUTABLE
 * (docs/WORKER_HANDOFFS.md acceptance): the manifest carries the
 * caller-supplied version and a content-addressed id; nothing in this
 * package ever overwrites a minted record.
 */

import type { PackageManifest } from './package-contract';

/**
 * The promotion stage this package can mint. v0.1 extraction produces
 * 'candidate' records ONLY.
 */
export type PackageStage = 'candidate';

/** The work-item identity stamped on every candidate this extractor mints. */
export const EXTRACTED_BY = 'CLAPP-050';

export interface PackageCandidate {
  manifest: PackageManifest;
  /** §5 promotion stage — extraction mints candidates, ONLY candidates. */
  stage: PackageStage;
  extractionContext: {
    /** 'CLAPP-050' — the work item identity. */
    extractedBy: string;
    /** sha256Hex(canonicalJson(manifest)) — WITH the id (the record digest). */
    manifestSha256: string;
  };
}
