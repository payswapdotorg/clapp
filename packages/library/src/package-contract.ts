// ============ SHARED CONTRACT: package-contract.ts ============
// CLAPP Package Library contract v0.1 — declared by Worker 2 (the package
// schema owner, docs/WORKER_HANDOFFS.md). Canonical owner: @clapp/library
// (CLAPP-050). The manifest vocabulary is docs/LEARNING_AND_LIBRARY.md §4
// (the AUTHORITATIVE YAML field list), TypeScript-shaped; the promotion
// stages (§5) and the contamination guard (§8) live with the extractor
// (./extract.ts). Bump to v0.2 ONLY via a tech-lead declaration wave.
//
// Purpose: one REUSED BEHAVIORAL UNIT distilled from a verified build —
// code + interface + tests + evidence + compatibility metadata. In v0.1
// the unit is the whole synthesized candidate application (the plan/app/
// parity ports CLAPP-050 consumes); finer-grained packages are later
// lanes. The manifest is DERIVED ART: every field is extracted from the
// frozen P4 ports, never hand-asserted, never fabricated.
//
// Design principles (inherited from the frozen P3/P4 contracts, binding):
//   1. Deterministic packaging: canonical serialization (canonicalJson
//      over the manifest minus its id) + content-addressed identity
//      (mintPackageId) mean identical inputs mint identical packages.
//   2. Honesty law: benchmark is `string | null` — null in v0.1; a
//      benchmark is a REFERENCE, a number is never fabricated.
//   3. Fail-closed validation: validatePackageManifest collects EVERY
//      field error (never stops at the first) and rejects wrong versions,
//      unsorted canonical order, and non-RFC3339 shapes.
//   4. The manifest is self-contained beyond @clapp/core's EvidenceRef:
//      the plan/app/report artifacts it summarizes are referenced by
//      digest/id strings only (same discipline as the synthesis and diff
//      contracts).

import { EVIDENCE_KINDS, sha256Hex } from '@clapp/core';
import type { EvidenceRef } from '@clapp/core';
import { canonicalJson } from '@clapp/observe';

// ---- identity + version ------------------------------------------------------

/** Package contract version (the manifest is versioned like the plan/diff contracts). */
export const PACKAGE_VERSION = '0.1';

/**
 * The minted-id pattern: `pkg_` + 64 lowercase hex chars. The `pkg_` prefix
 * is THIS packet's frozen proposal — the same id discipline as `diffr_` /
 * `diff_` / `ev_` in @clapp/diff's ids.ts; changing it changes every minted
 * id and requires a contract version bump.
 */
export const PACKAGE_ID_PATTERN = /^pkg_[0-9a-f]{64}$/;

/** Lowercase-hex sha256 shape (the repo's content-addressing primitive). */
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

/** RFC3339 date-time: full-date "T" full-time, offset `Z`/`z` or ±HH:MM. */
const RFC3339_RE =
  /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|([+-])(\d{2}):(\d{2}))$/;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

// ---- internal shared helpers (module-level; NOT re-exported by src/index.ts) --

/** Plain-object guard (arrays are NOT objects here). */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Human preview of an unknown value, for error messages. */
export function preview(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'undefined') return 'undefined';
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * RFC3339 check: lexical shape + REAL calendar validity (component ranges,
 * true month lengths, leap years). `Date.parse` is deliberately NOT used —
 * it accepts rollover dates such as 2026-02-30. Honest limitation: the
 * leap-second form (second === 60) is not accepted, matching what a JS
 * Date can represent.
 */
export function isRfc3339(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = RFC3339_RE.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const hasOffset = match[7] !== undefined;
  const offsetHour = match[8] === undefined ? 0 : Number(match[8]);
  const offsetMinute = match[9] === undefined ? 0 : Number(match[9]);
  if (month < 1 || month > 12) return false;
  const daysInMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day < 1 || day > daysInMonth[month - 1]!) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;
  if (hasOffset && (offsetHour > 23 || offsetMinute > 59)) return false;
  return true;
}

/** The frozen @clapp/core v0 EvidenceRef shape (kind vocabulary included). */
export function isEvidenceRefShaped(value: unknown): value is EvidenceRef {
  return (
    isObject(value) &&
    typeof value.evidenceId === 'string' &&
    value.evidenceId.length > 0 &&
    typeof value.kind === 'string' &&
    (EVIDENCE_KINDS as readonly string[]).includes(value.kind) &&
    typeof value.sha256 === 'string' &&
    SHA256_HEX_RE.test(value.sha256)
  );
}

// ---- the manifest (docs/LEARNING_AND_LIBRARY.md §4 — AUTHORITATIVE) -----------

/** The evidence chain: how the packaged build was proven. */
export interface PackageProvenance {
  /** sha256Hex(canonicalJson(plan)) — the synthesized plan the package summarizes. */
  planSha256: string;
  /** sha256Hex(canonicalJson(app.manifest)) — the generated app's manifest digest. */
  appManifestSha256: string;
  /** parity.report.id — the DiffReport that witnesses equivalence. */
  diffReportId: string;
  /** parity.repair.converged — the repair loop's convergence verdict. */
  repairConverged: boolean;
  /** parity.repair.attempts[0]?.baseSha ?? null — the pre-repair candidate commit; null when repair never fired. */
  candidateBaseSha: string | null;
}

/** The PackageManifest v0.1 — exactly the §4 field list, TypeScript-shaped. */
export interface PackageManifest {
  /** MUST equal PACKAGE_VERSION ('0.1') in v0. */
  packageVersion: string;
  /** Content-addressed identity minted by mintPackageId (`pkg_` + sha256Hex). */
  id: string;
  /** Immutable package version — CALLER-supplied (extractPackages options). */
  version: string;
  /** Extraction-derived category (v0.1: 'application' — the whole verified candidate app; see README). */
  category: string;
  /** One-sentence extraction-derived summary assembled from plan.application facts. */
  purpose: string;
  /** Derived: the generated app's route paths + api endpoints (sorted, deduped). */
  interface: string[];
  /** Derived honestly from the plan's actual surfaces — NAMED kinds, never counts. */
  capabilities: string[];
  /** plan.constraints verbatim + derived storage facts (sorted, deduped). */
  constraints: string[];
  /** Runtime facts from app.manifest.startCommand — honest, may be []. */
  dependencies: string[];
  /** ['web'] — the only synthesized target today (frozen v0.1 declaration). */
  supportedTargets: string[];
  /** The evidence chain (see PackageProvenance). */
  provenance: PackageProvenance;
  /** The parity report's evidence entries (deduped by evidenceId, sorted by evidenceId). */
  evidence: EvidenceRef[];
  /** References to the plan's acceptance/test surface — [] when the plan names none (never fabricated). */
  tests: string[];
  /** null in v0.1 — a benchmark is a REFERENCE, never a fabricated number. */
  benchmark: string | null;
  /** Journey ids from the plan's acceptance entries (sorted, deduped). */
  examples: string[];
  /** Finding ids the repair attempts resolved (deduped, sorted) — the failure knowledge the library learns from. */
  failureModes: string[];
  /** RFC3339 — CALLER-injected; the extractor never reads the clock. */
  generatedAt: string;
}

// ---- validation (fail-closed: collect EVERY error) -----------------------------

export type PackageValidationResult = { ok: true } | { ok: false; errors: string[] };

function checkStringArray(errors: string[], field: string, value: unknown, sorted: boolean): void {
  if (!Array.isArray(value)) {
    errors.push(`${field}: expected an array of strings, got ${preview(value)}`);
    return;
  }
  let allStrings = true;
  value.forEach((entry, index) => {
    if (typeof entry !== 'string' || entry.length === 0) {
      errors.push(`${field}[${index}]: expected a non-empty string, got ${preview(entry)}`);
      allStrings = false;
    }
  });
  if (sorted && allStrings) {
    for (let index = 1; index < value.length; index++) {
      const previous = value[index - 1] as string;
      const current = value[index] as string;
      if (previous > current) {
        errors.push(
          `${field}: not sorted in canonical (lexicographic) order — ${preview(previous)} precedes ${preview(current)}`,
        );
        break;
      }
    }
  }
}

function checkHexDigest(errors: string[], field: string, value: unknown): void {
  if (typeof value !== 'string' || !SHA256_HEX_RE.test(value)) {
    errors.push(`${field}: expected 64 lowercase hex chars, got ${preview(value)}`);
  }
}

/**
 * Fail-closed, field-by-field validation of a PackageManifest v0.1.
 * Collects ALL errors (never stops at the first); every error message
 * NAMES the offending field. Checks: every field present with the right
 * shape; `packageVersion === PACKAGE_VERSION`; `id` matches the minted
 * pattern (PACKAGE_ID_PATTERN); interface/capabilities/constraints/
 * supportedTargets sorted in canonical (lexicographic) order; `benchmark`
 * is a string or null (never a number); `generatedAt` parses as RFC3339.
 */
export function validatePackageManifest(manifest: unknown): PackageValidationResult {
  const errors: string[] = [];

  if (!isObject(manifest)) {
    return { ok: false, errors: [`manifest: expected an object, got ${preview(manifest)}`] };
  }

  // ---- scalar fields ----
  if (typeof manifest.packageVersion !== 'string') {
    errors.push(`packageVersion: expected a string, got ${preview(manifest.packageVersion)}`);
  } else if (manifest.packageVersion !== PACKAGE_VERSION) {
    errors.push(
      `packageVersion: expected "${PACKAGE_VERSION}" (PACKAGE_VERSION), got ${preview(manifest.packageVersion)}`,
    );
  }

  if (typeof manifest.id !== 'string') {
    errors.push(`id: expected a string, got ${preview(manifest.id)}`);
  } else if (!PACKAGE_ID_PATTERN.test(manifest.id)) {
    errors.push(
      `id: expected the minted pattern pkg_ + 64 lowercase hex chars (PACKAGE_ID_PATTERN), got ${preview(manifest.id)}`,
    );
  }

  for (const field of ['version', 'category', 'purpose'] as const) {
    const value = manifest[field];
    if (typeof value !== 'string' || value.length === 0) {
      errors.push(`${field}: expected a non-empty string, got ${preview(value)}`);
    }
  }

  // ---- array fields (canonical order where the contract demands it) ----
  checkStringArray(errors, 'interface', manifest.interface, true);
  checkStringArray(errors, 'capabilities', manifest.capabilities, true);
  checkStringArray(errors, 'constraints', manifest.constraints, true);
  checkStringArray(errors, 'dependencies', manifest.dependencies, false);
  checkStringArray(errors, 'supportedTargets', manifest.supportedTargets, true);
  checkStringArray(errors, 'tests', manifest.tests, false);
  checkStringArray(errors, 'examples', manifest.examples, false);
  checkStringArray(errors, 'failureModes', manifest.failureModes, false);

  // ---- provenance (the evidence chain) ----
  if (!isObject(manifest.provenance)) {
    errors.push(`provenance: expected an object (the evidence chain), got ${preview(manifest.provenance)}`);
  } else {
    checkHexDigest(errors, 'provenance.planSha256', manifest.provenance.planSha256);
    checkHexDigest(errors, 'provenance.appManifestSha256', manifest.provenance.appManifestSha256);
    if (
      typeof manifest.provenance.diffReportId !== 'string' ||
      manifest.provenance.diffReportId.length === 0
    ) {
      errors.push(
        `provenance.diffReportId: expected a non-empty string (the parity report id), got ${preview(manifest.provenance.diffReportId)}`,
      );
    }
    if (typeof manifest.provenance.repairConverged !== 'boolean') {
      errors.push(
        `provenance.repairConverged: expected a boolean, got ${preview(manifest.provenance.repairConverged)}`,
      );
    }
    const candidateBaseSha: unknown = manifest.provenance.candidateBaseSha;
    if (
      candidateBaseSha !== null &&
      (typeof candidateBaseSha !== 'string' || candidateBaseSha.length === 0)
    ) {
      errors.push(
        `provenance.candidateBaseSha: expected a non-empty string or null (null when repair never fired), got ${preview(candidateBaseSha)}`,
      );
    }
  }

  // ---- evidence entries (the frozen @clapp/core v0 shape) ----
  if (!Array.isArray(manifest.evidence)) {
    errors.push(`evidence: expected an array of EvidenceRef entries, got ${preview(manifest.evidence)}`);
  } else {
    manifest.evidence.forEach((entry: unknown, index: number) => {
      if (!isEvidenceRefShaped(entry)) {
        errors.push(
          `evidence[${index}]: expected an EvidenceRef ({evidenceId, kind, sha256}), got ${preview(entry)}`,
        );
      }
    });
  }

  // ---- benchmark (honesty law: a reference or null — NEVER a fabricated number) ----
  if (typeof manifest.benchmark !== 'string' && manifest.benchmark !== null) {
    errors.push(
      `benchmark: expected a string or null (null in v0.1 — a benchmark is a reference, never a fabricated number), got ${preview(manifest.benchmark)}`,
    );
  }

  // ---- generatedAt (RFC3339) ----
  if (!isRfc3339(manifest.generatedAt)) {
    errors.push(`generatedAt: expected an RFC3339 date-time string, got ${preview(manifest.generatedAt)}`);
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

// ---- canonical serialization + content-addressed identity ----------------------

/**
 * Canonical JSON of the manifest with the `id` field EXCLUDED: ids are
 * minted FROM this serialization (mintPackageId), so the minting input
 * must not contain the id. Byte-deterministic (canonicalJson sorts object
 * keys at every level; array order is preserved — canonical order is the
 * manifest's own contract).
 *
 * Throws `CanonicalJsonError` (from @clapp/observe) on non-canonicalizable
 * manifests — the same loud last-line-of-defense discipline the capture
 * channels apply; the extractor catches it and reports `malformed`.
 */
export function canonicalPackageJson(manifest: PackageManifest): string {
  const record: Record<string, unknown> = { ...manifest };
  delete record.id;
  return canonicalJson(record);
}

/** Injectable hash function (deterministic tests / consumers); default sha256Hex. */
export type PackageIdHashFn = (data: Uint8Array | string) => Promise<string>;

/**
 * Content-addressed package identity:
 * `'pkg_' + sha256Hex(canonicalPackageJson(manifest))`.
 * Same id ⇔ identical canonical manifest bytes (the id field is excluded —
 * the digest is the minting input). The `'pkg_'` prefix is this packet's
 * frozen proposal (see PACKAGE_ID_PATTERN).
 */
export async function mintPackageId(
  manifest: PackageManifest,
  sha256hex: PackageIdHashFn = sha256Hex,
): Promise<string> {
  return `pkg_${await sha256hex(canonicalPackageJson(manifest))}`;
}
