/**
 * @clapp/library — the promotion gate (CLAPP-054).
 *
 * The P5 closing lane, OWNED AND IMPLEMENTED BY THE TECH LEAD (the
 * integration authority — docs/WORK_ITEMS.md: "CLAPP-054 — Promotion gate,
 * Owner: tech lead, Depends on 053"). Promotion is never a worker's call:
 * the tech lead rejects unverified package promotions
 * (docs/WORKER_HANDOFFS.md), and this module IS that rejection machinery,
 * executable.
 *
 * THE CONTRACT (v0.1): `promoteCandidate(candidate, evidence, options)`
 * mints a PackagePromotionRecord — a NEW stage document ('replayed') —
 * ONLY when EVERY landed evidence class is green:
 *
 *   1. the CANDIDATE is a valid candidate-stage record (the frozen
 *      manifest validator + stage 'candidate');
 *   2. the REPLAY record is green: outcome 'replayed', replayVersion
 *      matching REPLAY_VERSION, packageId matching the manifest's minted
 *      id, and manifestSha256 matching the digest RECOMPUTED HERE (the
 *      promotion gate re-derives sha256Hex(canonicalJson(manifest)) —
 *      recorded digests are compared, never trusted) AND matching the
 *      candidate's recorded extractionContext.manifestSha256 when present
 *      (no drift anywhere);
 *   3. the EVIDENCE CHAIN is intact: provenanceCheck.matches === true —
 *      the replay module DISCLOSES a moved chain without flipping its
 *      outcome; the promotion gate WEIGHS that disclosure and REFUSES
 *      (a candidate whose parity evidence moved is not promoted on the
 *      strength of a stale chain);
 *   4. the replay minted a benchmark reference (a green replay's measured
 *      artifact) — carried into the promotion record verbatim.
 *
 * §5 promotion stages (docs/LEARNING_AND_LIBRARY.md): Candidate → Verified
 * → Replayed → Stable → Preferred. v0.1's evidence classes (extraction
 * minted the candidate with the unverified-candidate gate already green;
 * replay re-proved it) justify exactly ONE promotion: 'candidate' →
 * 'replayed'. 'stable'/'preferred' arrive with later evidence classes
 * (regression history, cross-target replay) via contract version bumps —
 * never by quietly widening this gate.
 *
 * THE MANIFEST IS IMMUTABLE (WORKER_HANDOFFS acceptance): promotion
 * produces a NEW record carrying the manifest VERBATIM; no field of the
 * manifest is rewritten (the package's `benchmark` field stays exactly as
 * extracted — lifting a replay reference INTO a manifest is a separate,
 * future, tech-lead-gated operation with its own contract). The module
 * never mutates any input.
 *
 * FAIL-CLOSED: every unmet condition is a collected, named error with its
 * observed value — results, never exceptions. DETERMINISM: same candidate
 * + evidence + options → deep-equal promotion records; `promotedAt` is
 * CALLER-injected (RFC3339 — validated, never clock-read); the evidence
 * digest is content-addressed. No clock, no randomness, no network, no
 * filesystem.
 */

import { sha256Hex } from '@clapp/core';
import { canonicalJson } from '@clapp/observe';

import { isObject, isRfc3339, preview, validatePackageManifest } from './package-contract';
import type { PackageManifest } from './package-contract';
import type { PackageStage } from './record';
import { REPLAY_VERSION } from './replay-benchmark';
import type { ReplayBenchmarkRecord } from './replay-benchmark';

// ---- the promotion contract v0.1 -------------------------------------------------

/** The promotion-gate contract version (bumps only via a tech-lead declaration wave). */
export const PROMOTION_VERSION = '0.1';

/**
 * v0.1's ONLY promotion: candidate → 'replayed' (extraction evidence +
 * replay evidence both green). 'stable'/'preferred' are later evidence
 * classes, never a widening of this constant.
 */
export type PromotedStage = 'replayed';

/** The work-item identity stamped on every promotion this gate mints. */
export const PROMOTED_BY = 'CLAPP-054';

/** Lowercase-hex sha256 shape (the repo's content-addressing primitive). */
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

/** The only stage promotion accepts as input (the record contract mints exactly this). */
const REQUIRED_INPUT_STAGE: PackageStage = 'candidate';

/** The landed evidence classes v0.1 weighs (later classes arrive via contract bump). */
export interface PromotionEvidence {
  /** The replay benchmark record (CLAPP-053) — re-proven parity evidence. */
  replay: ReplayBenchmarkRecord;
}

export interface PromotionOptions {
  /** RFC3339 — CALLER-injected; the gate never reads a clock. */
  promotedAt: string;
}

/** The promotion record: a NEW stage document; the manifest rides verbatim. */
export interface PackagePromotionRecord {
  promotionVersion: string;        // PROMOTION_VERSION ('0.1')
  manifest: PackageManifest;       // VERBATIM — immutable, never rewritten
  stage: PromotedStage;            // 'replayed' — v0.1's only promotion
  promotionContext: {
    promotedBy: string;            // 'CLAPP-054' — the work item identity
    promotedAt: string;            // the caller-injected RFC3339 timestamp
    /** sha256Hex(canonicalJson(replay)) — content-addressed evidence reference. */
    evidenceDigest: string;
    /** The replay's measured benchmark REFERENCE, carried verbatim. */
    benchmarkRef: string;
  };
}

/** Fail-closed: a promotion, or every collected named refusal. */
export type PromotionResult =
  | { ok: true; promotion: PackagePromotionRecord }
  | { ok: false; errors: string[] };

// ---- the promotion gate ------------------------------------------------------------

/**
 * Promote a candidate-stage package to 'replayed' on green landed evidence.
 * Async because the evidence digest hashes. Fail-closed (ALL errors
 * collected, never a throw); deterministic; the manifest is carried
 * verbatim — promotion mints a stage document, never a manifest edit.
 */
export async function promoteCandidate(
  candidate: unknown,
  evidence: unknown,
  options: unknown,
): Promise<PromotionResult> {
  const errors: string[] = [];

  // ---- 1. the candidate: valid manifest, candidate stage, well-formed context ----
  if (!isObject(candidate)) {
    return { ok: false, errors: [`candidate: expected an object (a PackageCandidate), got ${preview(candidate)}`] };
  }
  const manifestCheck = validatePackageManifest(candidate.manifest);
  if (!manifestCheck.ok) {
    for (const error of manifestCheck.errors) {
      errors.push(`candidate.manifest: ${error}`);
    }
  }
  const manifest = candidate.manifest as PackageManifest | undefined;

  const stage: unknown = candidate.stage;
  if (stage !== undefined && stage !== REQUIRED_INPUT_STAGE) {
    errors.push(
      `candidate.stage: expected "${REQUIRED_INPUT_STAGE}" (promotion accepts candidate-stage records ONLY), got ${preview(stage)}`,
    );
  }

  const recordedSha: unknown = isObject(candidate.extractionContext)
    ? candidate.extractionContext.manifestSha256
    : undefined;
  if (
    recordedSha !== undefined &&
    (typeof recordedSha !== 'string' || !SHA256_HEX_RE.test(recordedSha))
  ) {
    errors.push(
      `candidate.extractionContext.manifestSha256: expected 64 lowercase hex chars, got ${preview(recordedSha)}`,
    );
  }

  // ---- 2. the options: caller-injected timestamp ----
  if (!isObject(options)) {
    return { ok: false, errors: [`options: expected an object { promotedAt }, got ${preview(options)}`] };
  }
  if (!isRfc3339(options.promotedAt)) {
    errors.push(
      `options.promotedAt: expected an RFC3339 date-time string (caller-injected — the gate never reads a clock), got ${preview(options.promotedAt)}`,
    );
  }

  // ---- 3. the evidence: a green, matching, chain-intact replay record ----
  if (!isObject(evidence) || !isObject(evidence.replay)) {
    return {
      ok: false,
      errors: [
        `evidence: expected an object { replay: ReplayBenchmarkRecord }, got ${preview(evidence)}`,
      ],
    };
  }
  const replay: Record<string, unknown> = evidence.replay as Record<string, unknown>;

  if (replay.replayVersion !== REPLAY_VERSION) {
    errors.push(
      `evidence.replay.replayVersion: expected "${REPLAY_VERSION}" (REPLAY_VERSION), got ${preview(replay.replayVersion)}`,
    );
  }
  if (replay.outcome !== 'replayed') {
    errors.push(
      `evidence.replay.outcome: expected 'replayed' (a failed replay never promotes), got ${preview(replay.outcome)}`,
    );
  }
  if (manifest !== undefined && replay.packageId !== manifest.id) {
    errors.push(
      `evidence.replay.packageId: expected the candidate's minted id ${preview(manifest.id)}, got ${preview(replay.packageId)}`,
    );
  }

  const provenanceCheck = isObject(replay.provenanceCheck) ? replay.provenanceCheck : undefined;
  if (provenanceCheck === undefined) {
    errors.push('evidence.replay.provenanceCheck: expected an object (recorded vs recomputed)');
  } else if (provenanceCheck.matches !== true) {
    errors.push(
      `evidence.replay.provenanceCheck.matches: expected true (the promotion gate WEIGHS the replay's chain disclosure — a moved evidence chain is a refusal here, not a disclosure), got ${preview(provenanceCheck.matches)}`,
    );
  }

  const benchmarkRef = replay.benchmarkRef;
  if (typeof benchmarkRef !== 'string' || benchmarkRef.length === 0) {
    errors.push(
      `evidence.replay.benchmarkRef: expected a non-empty string (a green replay's measured reference), got ${preview(benchmarkRef)}`,
    );
  }

  // ---- 4. the digests: recomputed here, compared everywhere (never trusted) ----
  if (manifest !== undefined) {
    let recomputed: string | null = null;
    try {
      recomputed = await sha256Hex(canonicalJson(manifest));
    } catch {
      recomputed = null;
    }
    if (recomputed === null) {
      errors.push(
        'manifest: not canonical-JSON serializable — the promotion digest cannot be computed honestly',
      );
    } else {
      if (replay.manifestSha256 !== recomputed) {
        errors.push(
          `evidence.replay.manifestSha256: expected the digest recomputed at promotion time (${recomputed.slice(0, 12)}…), got ${preview(replay.manifestSha256)} — the replayed candidate drifted`,
        );
      }
      if (
        typeof recordedSha === 'string' &&
        SHA256_HEX_RE.test(recordedSha) &&
        recordedSha !== recomputed
      ) {
        errors.push(
          `candidate.extractionContext.manifestSha256: expected the recomputed digest (${recomputed.slice(0, 12)}…), got ${preview(recordedSha)} — the recorded candidate drifted`,
        );
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // ---- 5. mint the promotion record (a NEW stage document; manifest verbatim) ----
  let evidenceDigest: string;
  try {
    evidenceDigest = await sha256Hex(canonicalJson(evidence.replay));
  } catch {
    return {
      ok: false,
      errors: ['evidence.replay: not canonical-JSON serializable — the evidence digest cannot be computed honestly'],
    };
  }

  const promotion: PackagePromotionRecord = {
    promotionVersion: PROMOTION_VERSION,
    manifest: manifest as PackageManifest,
    stage: 'replayed',
    promotionContext: {
      promotedBy: PROMOTED_BY,
      promotedAt: options.promotedAt as string,
      evidenceDigest,
      benchmarkRef: benchmarkRef as string,
    },
  };
  return { ok: true, promotion };
}
