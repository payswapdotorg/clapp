/**
 * @clapp/ios — the evidence emitter (CLAPP-084, the P8 fifth and final
 * platform — the third of the five platform components).
 *
 * docs/WORK_ITEMS.md P8: each platform implements an evidence emitter.
 * THIS MODULE IS THE iOS ONE: `emitObservationEvidence` turns one
 * measured observation into one EvidenceRef-shaped record — the FROZEN
 * core shape (@clapp/core contract.ts), never a forked lookalike.
 *
 * THE NO-FORK LAW (the P8 cardinal law, binding here at its sharpest):
 * the emitter RETURNS the core's EvidenceRef type — imported TYPE-ONLY
 * from '@clapp/core' — and validates its kind against the frozen
 * EVIDENCE_KINDS runtime vocabulary (the core's own closed-vocabulary
 * mirror, exported precisely so sibling packages "check membership
 * against one source of truth instead of inventing copies" —
 * @clapp/core events.ts). It never redefines, rewrites, or forks the
 * shape; never invents a kind; never re-hashes (sha256 carries the
 * observation's screenDigest VERBATIM — the capture's own measured
 * digest, measured upstream by the observation seam, never re-asserted
 * here). An unknown kind is a NAMED error result.
 *
 * THE PREFIX DISCIPLINE: iOS observation evidence ids are minted
 * 'idev_' + the screenDigest's first 32 hex chars + '-' + the kind —
 * CONTENT-DERIVED and deterministic (the same capture mints the same
 * evidence id forever; no uuid, no clock, no randomness — the
 * content-addressed-identity house law, 'idev_' being this lane's
 * prefix the way authz_/redct_/iso_/audit_/atrail_/ready_/budget_ are
 * the security lanes', 'andev_' the Android lane's, 'lidev_' the Linux
 * lane's, 'wdev_' the Windows lane's, and 'mdev_' the macOS lane's).
 *
 * EvidenceId stays CALLER-shaped in the core ('ev_' + uuid v4 is the
 * core's minting form); this emitter's mint is the adapter's
 * content-derived form — a string satisfying the core's EvidenceId
 * (a plain string type), documented as this lane's prefix discipline.
 *
 * Discipline (binding — the 070..083 house rules): no clock, no
 * randomness, no network, no filesystem, no global state; the module
 * never mutates its inputs; results, never exceptions.
 *
 * Honest v0.1 scope: the emitter validates the observation's DIGEST
 * (what it consumes — a non-empty string) and the kind; the
 * observation's other measured fields (environmentVersion, nodeCount,
 * observedDepth) are the observation seam's guarantee, not re-validated
 * here. Persisting the evidence (the @clapp/evidence bundle machinery)
 * is the persistence lane's concern, never this one.
 */

import type { EvidenceKind, EvidenceRef } from '@clapp/core';
import { EVIDENCE_KINDS } from '@clapp/core';

import type { IOSObservation } from './observation';

// ---- the frozen vocabulary (consumed, never redefined) ------------------------------

/** The frozen core kinds rendered for error messages (the observed-value law). */
const KINDS_FOR_MESSAGES = EVIDENCE_KINDS.map((kind) => JSON.stringify(kind)).join(' | ');

// ---- the emitter ---------------------------------------------------------------------

/** The emitter's fail-closed result: the core's EvidenceRef, or named errors. */
export type ObservationEvidenceResult =
  | { ok: true; evidence: EvidenceRef }
  | { ok: false; errors: string[] };

/** Evidence id prefix discipline: every iOS observation evidence id starts 'idev_'. */
const EVIDENCE_ID_PREFIX = 'idev_';

// ---- internal helpers (module-level; NOT re-exported by src/index.ts) --------------

/** Plain-object guard (arrays are NOT objects here — the house helper). */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Human preview of an unknown value, for error messages. */
function preview(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'undefined') return 'undefined';
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

// ---- the evidence emitter ------------------------------------------------------------

/**
 * Emit one EvidenceRef-shaped record for the observation — the frozen
 * core shape, never forked.
 *
 * evidenceId is minted CONTENT-DERIVED: 'idev_' + the observation's
 * screenDigest (first 32 hex chars) + '-' + the kind — deterministic,
 * no uuid, no clock. The kind must be one of the frozen EVIDENCE_KINDS
 * (consumed from the core's runtime mirror — one source of truth; an
 * unknown kind is a NAMED error, never an invented one). sha256 carries
 * the observation's screenDigest verbatim — the capture's own measured
 * digest. Emitting twice for the same observation and kind mints
 * deep-equal EvidenceRefs (the determinism law).
 */
export function emitObservationEvidence(
  observation: IOSObservation,
  kind: EvidenceKind,
): ObservationEvidenceResult {
  const errors: string[] = [];

  if (!isObject(observation)) {
    return {
      ok: false,
      errors: [`observation must be an IOSObservation object (observed: ${preview(observation)})`],
    };
  }

  const screenDigest = observation.screenDigest;
  if (typeof screenDigest !== 'string' || screenDigest.length === 0) {
    errors.push(
      `observation.screenDigest must be a non-empty string — the measured capture digest (observed: ${preview(screenDigest)})`,
    );
  }

  if (typeof kind !== 'string' || !EVIDENCE_KINDS.includes(kind)) {
    errors.push(
      `kind must be one of the frozen EVIDENCE_KINDS: ${KINDS_FOR_MESSAGES} (observed: ${preview(kind)})`,
    );
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const evidence: EvidenceRef = {
    evidenceId: `${EVIDENCE_ID_PREFIX}${screenDigest.slice(0, 32)}-${kind}`,
    kind,
    sha256: screenDigest,
  };
  return { ok: true, evidence };
}
