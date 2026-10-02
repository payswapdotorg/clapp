/**
 * @clapp/library — the package replay benchmark (CLAPP-053).
 *
 * The P5 lane-4 module: RE-VERIFYING a packaged candidate and producing the
 * honest, MEASURED benchmark evidence the promotion gate (CLAPP-054, the
 * tech lead's lane) will consume. Replay NEVER promotes: the record
 * documents what was replayed, the candidate's manifest is read and never
 * rewritten, and the stage vocabulary stays with the record contract
 * (./record.ts) — promotion is a later, test-gated lane.
 *
 * Runtime imports are exactly `@clapp/core` (sha256Hex) and `@clapp/observe`
 * (canonicalJson) plus the local frozen `./package-contract` (the manifest
 * validator) and `./record` types — the established discipline:
 * `@clapp/diff` and `@clapp/repair` are devDependencies imported for TYPES
 * ONLY (pinned by test/imports.test.ts); replayCandidate consumes
 * contract-shaped DATA through the ports, never the implementations'
 * behavior.
 *
 * THE CONTRACT (v0.1): `replayCandidate(candidate, ports)` fail-closed
 * validates the candidate FIRST — an object whose `manifest` passes the
 * frozen `validatePackageManifest`; `stage`, when present, must be
 * 'candidate' (replay accepts candidate-stage records ONLY — anything else
 * is an error naming the observed value); `extractionContext.manifestSha256`,
 * when present, must be 64 lowercase hex chars — and the PORTS (an object
 * with callable `recomputeParity` and `now`; a non-function is an error
 * naming the field). ALL errors are collected; NEVER an exception for bad
 * input (results, never throws).
 *
 * THE REPLAY: `t0 = ports.now()` → `await ports.recomputeParity(manifest)`
 * → `t1 = ports.now()`; `durationMs = t1 − t0` is MEASURED from the
 * injected clock — never a wall-clock read, never asserted. The record's
 * `manifestSha256` is likewise RECOMPUTED at replay time
 * (sha256Hex(canonicalJson(manifest)) — WITH the id, the record-digest
 * discipline of ./record.ts): the candidate AS REPLAYED, never the recorded
 * digest on trust.
 *
 * THE REPLAY GATE (fail-closed, extraction-consistent — binding): the SAME
 * three conditions as the extractor's unverified-candidate gate
 * (./extract.ts, the §8 contamination guard), in the same order, over the
 * RECOMPUTED parity:
 *
 *   recomputed.report.verdict === 'equivalent'
 *   recomputed.report.counts.critical === 0
 *   recomputed.repair.converged === true
 *
 * ALL three hold → outcome 'replayed'. ANY fails → outcome 'diverged' with
 * reasons naming the failed condition AND its observed value (the
 * extractor's refusal discipline — each condition is checked
 * INDEPENDENTLY, so a lying verdict cannot sneak a critical-laden replay
 * past the count check). A malformed `recomputeParity` return (not an
 * object, missing report/repair, non-finite critical count) is outcome
 * 'malformed' with field-naming reasons — the replay NEVER guesses and
 * never throws for these. An exception THROWN by a port propagates loudly:
 * a broken harness is the caller's failure, never swallowed, never
 * converted into a synthetic 'malformed' record (documented in README.md).
 *
 * PROVENANCE, COMPARED NOT TRUSTED: `provenanceCheck` compares
 * `manifest.provenance.diffReportId` with the RECOMPUTED `report.id`.
 * `matches: false` is DISCLOSED in reasons ("…the evidence chain moved")
 * but does NOT flip the outcome — the gate is over the recomputed
 * conditions (what replay re-proved); the provenance comparison is an
 * honest disclosure the promotion gate (CLAPP-054) will weigh. Drift
 * between the recomputed `manifestSha256` and the candidate's recorded
 * `extractionContext.manifestSha256` (when present) is disclosed the same
 * way: recorded values are compared, never trusted.
 *
 * THE BENCHMARK REFERENCE (never a bare number): on outcome 'replayed'
 * ONLY,
 *
 *   replay:0.1:<manifest.id>:<manifest.version>:ok:<durationMs>ms:attempts:1
 *
 * — the duration inside the reference is the MEASURED value; `attempts` is
 * v0.1's honest count of recomputes (exactly 1 — the single
 * `recomputeParity` invocation in the code path below). On
 * 'diverged'/'malformed' the reference is null — no reference is minted
 * from a failed replay. The manifest's `benchmark` field is `string | null`
 * by contract: the promotion gate (054) decides later whether to lift a
 * reference into a manifest; nothing here fabricates a score.
 *
 * DETERMINISM: same candidate + same ports → deep-equal record. No clock,
 * no randomness, no network, no filesystem reads — every measured number
 * enters through the ports; reasons are sorted and deduped; the module
 * never mutates its inputs.
 */

import { sha256Hex } from '@clapp/core';
import { canonicalJson } from '@clapp/observe';
import type { DiffReport } from '@clapp/diff';
import type { RepairLoopResult } from '@clapp/repair';

import { isObject, preview, validatePackageManifest } from './package-contract';
import type { PackageManifest } from './package-contract';
import type { PackageStage } from './record';

// ---- the replay contract v0.1 ---------------------------------------------------

/** The replay contract version (bumps only via a tech-lead declaration wave). */
export const REPLAY_VERSION = '0.1';

/**
 * Lowercase-hex sha256 shape (the repo's content-addressing primitive).
 * Pinned locally exactly like the extractor pins its frozen contract facts —
 * the shape is a v0.1 constant, never an importable runtime value.
 */
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

/**
 * Replay accepts candidate-stage records ONLY — the record contract's stage
 * vocabulary (./record.ts mints 'candidate' and nothing else; promotion to
 * later stages is CLAPP-054's lane, never this module's).
 */
const REQUIRED_STAGE: PackageStage = 'candidate';

/**
 * v0.1 performs exactly ONE recompute per replay — the honest attempt count,
 * mirroring the single `recomputeParity` invocation in the code path below.
 * A future retrying replay bumps this with its contract version, never by
 * editing the constant quietly.
 */
const MEASURED_ATTEMPTS = 1;

/**
 * The replay ports: everything measured enters here. `recomputeParity`
 * re-runs the parity verification for the manifest (its DiffReport /
 * RepairLoopResult shapes are TYPE-ONLY imports from the frozen @clapp/diff
 * and @clapp/repair contracts — data, never behavior); `now` is the
 * injectable clock every measured duration comes from.
 */
export interface ReplayPorts {
  /** Re-run the parity verification for the manifest. TYPE-ONLY shapes. */
  recomputeParity: (manifest: PackageManifest) => Promise<{
    report: DiffReport;
    repair: RepairLoopResult;
  }>;
  /** Injectable clock — MEASURED durations come from here, never Date.now(). */
  now: () => number;
}

/** What a replay re-proved: the honest, measured benchmark evidence for the promotion gate (CLAPP-054). */
export interface ReplayBenchmarkRecord {
  /** REPLAY_VERSION ('0.1'). */
  replayVersion: string;
  /** The manifest's minted id. */
  packageId: string;
  /** sha256Hex(canonicalJson(manifest)) recomputed at replay time — the candidate as replayed. */
  manifestSha256: string;
  outcome: 'replayed' | 'diverged' | 'malformed';
  /** The recomputed parity, verbatim facts. */
  gate: {
    /** Recomputed report.verdict (verbatim when a string; the observed spelling otherwise). */
    verdict: string;
    /** Recomputed report.counts.critical — MEASURED (NaN when the parity was unreadable). */
    criticalCount: number;
    /** Recomputed repair.converged — the gate's own reading (=== true). */
    repairConverged: boolean;
  };
  /** Recorded vs recomputed — compared, not trusted. */
  provenanceCheck: {
    /** manifest.provenance.diffReportId (as recorded). */
    recordedDiffReportId: string;
    /** Recomputed report.id (null when a malformed parity prevented reading it). */
    recomputedDiffReportId: string | null;
    /** Measured equality — disclosure, never a gate. */
    matches: boolean;
  };
  measured: {
    /** ports.now() delta around the recompute — MEASURED from the injected clock. */
    durationMs: number;
    /** v0.1: exactly 1 — the honest count of recomputes. */
    attempts: number;
  };
  /**
   * The REFERENCE the promotion gate may later mint into manifest.benchmark —
   * built from measured facts (format in the module header); null on
   * non-'replayed' outcomes (no reference from a failed replay).
   */
  benchmarkRef: string | null;
  /** Honest, sorted, deduped. */
  reasons: string[];
}

/** Fail-closed input validation: results, never exceptions. */
export type ReplayResult =
  | { ok: true; record: ReplayBenchmarkRecord }
  | { ok: false; errors: string[] };

// ---- the replay benchmark -------------------------------------------------------

/**
 * Re-verify a packaged candidate and mint the honest replay-benchmark
 * record. Fail-closed on bad input (ALL errors collected, never a throw);
 * loud on a broken harness (a port exception propagates — the caller's
 * failure, never swallowed); deterministic under identical injected ports.
 */
export async function replayCandidate(candidate: unknown, ports: unknown): Promise<ReplayResult> {
  // ---- 1. fail-closed input validation (ALL errors collected; never a throw) ----
  const errors: string[] = [];

  if (!isObject(candidate)) {
    errors.push(
      `candidate: expected an object (a PackageCandidate-shaped record), got ${preview(candidate)}`,
    );
  }
  if (!isObject(ports)) {
    errors.push(`ports: expected an object (the replay ports), got ${preview(ports)}`);
  }

  let manifest: PackageManifest | undefined;
  if (isObject(candidate)) {
    if (!isObject(candidate.manifest)) {
      errors.push(`manifest: expected an object, got ${preview(candidate.manifest)}`);
    } else {
      const check = validatePackageManifest(candidate.manifest);
      if (check.ok) {
        // the frozen validator passed — the honest bridge from its
        // Record<string, unknown> view to the contract type it just proved
        manifest = candidate.manifest as unknown as PackageManifest;
      } else {
        for (const error of check.errors) {
          errors.push(`manifest: ${error}`);
        }
      }
    }
    if (candidate.stage !== undefined && candidate.stage !== REQUIRED_STAGE) {
      errors.push(
        `stage: expected "candidate" (replay accepts candidate-stage records ONLY — promotion is CLAPP-054's lane), got ${preview(candidate.stage)}`,
      );
    }
    if (candidate.extractionContext !== undefined) {
      if (!isObject(candidate.extractionContext)) {
        errors.push(
          `extractionContext: expected an object (the extraction record context), got ${preview(candidate.extractionContext)}`,
        );
      } else {
        const recordedSha = candidate.extractionContext.manifestSha256;
        if (
          recordedSha !== undefined &&
          (typeof recordedSha !== 'string' || !SHA256_HEX_RE.test(recordedSha))
        ) {
          errors.push(
            `extractionContext.manifestSha256: expected 64 lowercase hex chars, got ${preview(recordedSha)}`,
          );
        }
      }
    }
  }

  let recomputeParity: ReplayPorts['recomputeParity'] | undefined;
  let now: ReplayPorts['now'] | undefined;
  if (isObject(ports)) {
    if (typeof ports.recomputeParity === 'function') {
      recomputeParity = ports.recomputeParity as ReplayPorts['recomputeParity'];
    } else {
      errors.push(
        `ports.recomputeParity: expected a callable (a function), got ${preview(ports.recomputeParity)}`,
      );
    }
    if (typeof ports.now === 'function') {
      now = ports.now as ReplayPorts['now'];
    } else {
      errors.push(`ports.now: expected a callable (a function), got ${preview(ports.now)}`);
    }
  }

  if (errors.length > 0 || manifest === undefined || recomputeParity === undefined || now === undefined) {
    return { ok: false, errors };
  }

  // ---- 2. the record digest, recomputed at replay time (the candidate AS REPLAYED) ----
  // sha256Hex(canonicalJson(manifest)) WITH the id — the record-digest
  // discipline (./record.ts). A non-canonicalizable manifest (the observe
  // discipline throws CanonicalJsonError) is a fail-closed result: a digest
  // that cannot be computed honestly is never fabricated.
  let manifestSha256: string;
  try {
    manifestSha256 = await sha256Hex(canonicalJson(manifest));
  } catch {
    return {
      ok: false,
      errors: [
        'manifest: not canonical-JSON serializable — the replay record digest (manifestSha256) cannot be computed honestly',
      ],
    };
  }

  // ---- 3. the replay — the measured window wraps ONLY the recompute ----
  const t0 = now();
  const recomputed = await recomputeParity(manifest);
  const t1 = now();
  const durationMs = t1 - t0; // MEASURED from the injected clock — never a wall-clock read

  // ---- 4. malformed-shape guards over the recomputed parity (results, never throws) ----
  const reasons: string[] = [];
  const malformedReasons: string[] = [];

  if (!isObject(recomputed)) {
    malformedReasons.push(
      `recomputeParity: expected an object ({ report, repair }), got ${preview(recomputed)}`,
    );
  }

  const report = isObject(recomputed) && isObject(recomputed.report) ? recomputed.report : null;
  const repair = isObject(recomputed) && isObject(recomputed.repair) ? recomputed.repair : null;

  if (isObject(recomputed)) {
    if (report === null) {
      malformedReasons.push(
        `recomputeParity.report: expected a DiffReport-shaped object, got ${preview(recomputed.report)}`,
      );
    }
    if (repair === null) {
      malformedReasons.push(
        `recomputeParity.repair: expected a RepairLoopResult-shaped object, got ${preview(recomputed.repair)}`,
      );
    }
  }

  const counts = report !== null && isObject(report.counts) ? report.counts : null;
  if (report !== null && counts === null) {
    malformedReasons.push(
      `recomputeParity.report.counts: expected an object (missing counts), got ${preview(report.counts)}`,
    );
  }

  const criticalRaw = counts !== null ? counts.critical : undefined;
  if (counts !== null && (typeof criticalRaw !== 'number' || !Number.isFinite(criticalRaw))) {
    malformedReasons.push(
      `recomputeParity.report.counts.critical: expected a finite number, got ${preview(criticalRaw)}`,
    );
  }

  // the verbatim gate facts — read defensively (a 'malformed' verdict may
  // already be decided; the record still reports what was observable)
  const verdictRaw = report !== null ? report.verdict : undefined;
  const gateVerdict = typeof verdictRaw === 'string' ? verdictRaw : preview(verdictRaw);
  const gateCriticalCount = typeof criticalRaw === 'number' ? criticalRaw : Number.NaN;
  const gateRepairConverged = repair !== null && repair.converged === true;
  const recomputedDiffReportId = report !== null && typeof report.id === 'string' ? report.id : null;

  // ---- 5. THE REPLAY GATE — the extraction conditions, over the RECOMPUTED parity ----
  let outcome: ReplayBenchmarkRecord['outcome'];
  if (malformedReasons.length > 0) {
    outcome = 'malformed';
    reasons.push(...malformedReasons);
  } else if (report === null || counts === null || repair === null) {
    // unreachable by construction (every unreadable view pushed a malformed
    // reason above) — kept as an explicit fail-closed guard, never a crash
    outcome = 'malformed';
    reasons.push('recomputeParity: the recomputed parity was unreadable');
  } else {
    const gateReasons: string[] = [];
    if (report.verdict !== 'equivalent') {
      gateReasons.push(
        `replay gate: recomputed report.verdict is ${preview(report.verdict)} (expected 'equivalent') — the extraction-consistent verdict condition failed on replay`,
      );
    }
    if (counts.critical !== 0) {
      gateReasons.push(
        `replay gate: recomputed report.counts.critical is ${preview(counts.critical)} (expected 0) — the extraction-consistent zero-critical condition failed on replay`,
      );
    }
    if (repair.converged !== true) {
      gateReasons.push(
        `replay gate: recomputed repair.converged is ${preview(repair.converged)} (expected true) — the extraction-consistent converged-repair condition failed on replay`,
      );
    }
    if (gateReasons.length > 0) {
      outcome = 'diverged';
      reasons.push(...gateReasons);
    } else {
      outcome = 'replayed';
    }
  }

  // ---- 6. provenance + record-digest drift — compared, not trusted (disclosure, never a gate) ----
  const recordedDiffReportId: string = manifest.provenance.diffReportId;
  const provenanceMatches: boolean = recordedDiffReportId === recomputedDiffReportId;
  if (!provenanceMatches) {
    reasons.push(
      `replay recomputed parity report ${recomputedDiffReportId} differs from recorded provenance ${recordedDiffReportId} — the evidence chain moved`,
    );
  }

  const recordedContext =
    isObject(candidate) && isObject(candidate.extractionContext) ? candidate.extractionContext : null;
  const recordedManifestSha256 =
    recordedContext !== null && typeof recordedContext.manifestSha256 === 'string'
      ? recordedContext.manifestSha256
      : null;
  if (recordedManifestSha256 !== null && recordedManifestSha256 !== manifestSha256) {
    reasons.push(
      `replay recomputed manifestSha256 ${manifestSha256} differs from recorded extractionContext.manifestSha256 ${recordedManifestSha256} — the candidate as replayed moved from its extraction record`,
    );
  }

  // ---- 7. the benchmark REFERENCE (never a bare number) — 'replayed' ONLY ----
  const benchmarkRef =
    outcome === 'replayed'
      ? `replay:${REPLAY_VERSION}:${manifest.id}:${manifest.version}:ok:${durationMs}ms:attempts:${MEASURED_ATTEMPTS}`
      : null;

  // ---- 8. the record (deterministic: sorted, deduped reasons) ----
  const record: ReplayBenchmarkRecord = {
    replayVersion: REPLAY_VERSION,
    packageId: manifest.id,
    manifestSha256,
    outcome,
    gate: {
      verdict: gateVerdict,
      criticalCount: gateCriticalCount,
      repairConverged: gateRepairConverged,
    },
    provenanceCheck: {
      recordedDiffReportId,
      recomputedDiffReportId,
      matches: provenanceMatches,
    },
    measured: {
      durationMs,
      attempts: MEASURED_ATTEMPTS,
    },
    benchmarkRef,
    reasons: [...new Set(reasons)].sort(),
  };
  return { ok: true, record };
}
