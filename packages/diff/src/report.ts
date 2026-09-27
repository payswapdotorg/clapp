/**
 * @clapp/diff — DiffReport assembly, canonical serialization, and parsing.
 *
 * - {@link buildDiffReport} assembles a report with COMPUTED severity
 *   counts (never caller-asserted) and the derived verdict:
 *   'equivalent' iff critical === 0, else 'divergent'.
 * - {@link serializeDiffReport} validates the full report against the
 *   contract and emits its CANONICAL JSON form: object keys sorted,
 *   no whitespace (the @clapp/observe canonicalJson discipline), with
 *   undefined-valued properties dropped and undefined array elements
 *   (absent per-step capture ids) rendered as null — the only JSON
 *   representable form of "absent element in a positionally-aligned
 *   array"; parseDiffReport normalizes them back to undefined.
 * - {@link parseDiffReport} validates EVERY field (shape, vocabulary,
 *   id patterns, cross-field consistency: counts must equal the actual
 *   finding tallies and the verdict must agree with them; the diff
 *   version must equal DIFF_VERSION) and throws {@link DiffReportError}
 *   with path-qualified messages on any violation.
 *
 * Determinism: a report is a pure function of its inputs plus the id and
 * time factories that minted it — same inputs + same factories →
 * byte-identical canonical text (see README "Determinism").
 */

import { EVIDENCE_KINDS } from '@clapp/core';
import { canonicalJson, isCanonicalSerializable, pruneUndefined } from '@clapp/observe';
import { PLANNED_APPLICATION_ID_PATTERN } from '@clapp/plan';
import {
  DIFF_VERSION,
  type DiffDimension,
  type DiffFinding,
  type DiffReport,
  type DiffSeverity,
  type PairedRun,
  type SideRunResult,
} from './diff-contract';
import type { DiffIdFactory } from './ids';

/** Raised by serialize/parse on any contract violation. */
export class DiffReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiffReportError';
  }
}

// ---------------------------------------------------------------------------
// Validation vocabulary
// ---------------------------------------------------------------------------

const DIFF_REPORT_ID_RE = /^diffr_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIFF_FINDING_ID_RE = /^diff_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EVIDENCE_ID_RE = /^ev_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;
const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DRIVERS = ['replayer-dom', 'replayer-playwright'] as const;
const DIMENSIONS: readonly DiffDimension[] = ['semantic', 'visual', 'network', 'state'];
const SEVERITIES: readonly DiffSeverity[] = ['critical', 'major', 'minor', 'info'];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function validateEvidenceRef(value: unknown, path: string, errors: string[]): void {
  if (!isObject(value)) {
    errors.push(`${path} must be an EvidenceRef object`);
    return;
  }
  if (!isString(value.evidenceId) || !EVIDENCE_ID_RE.test(value.evidenceId)) {
    errors.push(`${path}.evidenceId must be "ev_" + uuid-shaped hex`);
  }
  if (!isString(value.kind) || !(EVIDENCE_KINDS as readonly string[]).includes(value.kind)) {
    errors.push(`${path}.kind must be one of ${EVIDENCE_KINDS.join('|')}`);
  }
  if (!isString(value.sha256) || !SHA256_HEX_RE.test(value.sha256)) {
    errors.push(`${path}.sha256 must be 64-char lowercase hex`);
  }
}

function validateStepIdArray(value: unknown, path: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  for (const [index, entry] of value.entries()) {
    // undefined = in-memory absence; null = its canonical-JSON rendering.
    if (entry !== null && entry !== undefined && !isString(entry)) {
      errors.push(`${path}[${index}] must be a capture id string, null, or absent`);
    }
  }
}

function validateSideRunResult(
  value: unknown,
  path: string,
  expectedSide: 'left' | 'right',
  journeyId: string,
  errors: string[],
): void {
  if (!isObject(value)) {
    errors.push(`${path} must be a SideRunResult object`);
    return;
  }
  if (value.side !== expectedSide) {
    errors.push(`${path}.side must be "${expectedSide}"`);
  }
  if (value.journeyId !== journeyId) {
    errors.push(`${path}.journeyId must equal the paired run's journeyId`);
  }
  if (typeof value.completed !== 'boolean') {
    errors.push(`${path}.completed must be a boolean`);
  }
  if (!Number.isInteger(value.stepsCompleted) || (value.stepsCompleted as number) < 0) {
    errors.push(`${path}.stepsCompleted must be a non-negative integer`);
  }
  const completed = value.completed === true;
  if (completed && value.failure !== undefined) {
    errors.push(`${path}.failure must be ABSENT when completed is true`);
  }
  if (!completed && (!isString(value.failure) || value.failure === '')) {
    errors.push(`${path}.failure must be a non-empty string when completed is false`);
  }
  validateEvidenceRef(value.evidenceRef, `${path}.evidenceRef`, errors);
  validateStepIdArray(value.stepPageIds, `${path}.stepPageIds`, errors);
  validateStepIdArray(value.stepNetworkIds, `${path}.stepNetworkIds`, errors);
  const expectedLength = completed
    ? (value.stepsCompleted as number)
    : (value.stepsCompleted as number) + 1;
  if (Array.isArray(value.stepPageIds) && value.stepPageIds.length !== expectedLength) {
    errors.push(`${path}.stepPageIds length must be ${expectedLength} (attempted steps)`);
  }
  if (Array.isArray(value.stepNetworkIds) && value.stepNetworkIds.length !== expectedLength) {
    errors.push(`${path}.stepNetworkIds length must be ${expectedLength} (attempted steps)`);
  }
  if (!Array.isArray(value.storageIds) || value.storageIds.some((entry) => !isString(entry))) {
    errors.push(`${path}.storageIds must be an array of capture id strings`);
  }
}

function validatePairedTarget(value: unknown, path: string, expectedSide: 'left' | 'right', errors: string[]): void {
  if (!isObject(value)) {
    errors.push(`${path} must be a PairedTarget object`);
    return;
  }
  if (value.side !== expectedSide) {
    errors.push(`${path}.side must be "${expectedSide}"`);
  }
  if (!isString(value.baseUrl) || !/^https?:\/\//.test(value.baseUrl)) {
    errors.push(`${path}.baseUrl must be an http(s) URL string`);
  }
  if (!isString(value.targetId) || value.targetId === '') {
    errors.push(`${path}.targetId must be a non-empty string`);
  }
  if (!isString(value.driver) || !(DRIVERS as readonly string[]).includes(value.driver)) {
    errors.push(`${path}.driver must be one of ${DRIVERS.join('|')}`);
  }
}

function validateAnchor(value: unknown, path: string, errors: string[]): void {
  if (!isObject(value)) {
    errors.push(`${path} must be a DiffAnchor object`);
    return;
  }
  if (!Number.isInteger(value.stepIndex) || (value.stepIndex as number) < 0) {
    errors.push(`${path}.stepIndex must be a non-negative integer`);
  }
  if (value.leftEvidence !== undefined) {
    validateEvidenceRef(value.leftEvidence, `${path}.leftEvidence`, errors);
  }
  if (value.rightEvidence !== undefined) {
    validateEvidenceRef(value.rightEvidence, `${path}.rightEvidence`, errors);
  }
  if (!Array.isArray(value.sourceIds) || value.sourceIds.some((entry) => !isString(entry))) {
    errors.push(`${path}.sourceIds must be an array of id strings`);
  }
}

function validateFinding(value: unknown, path: string, seenIds: Set<string>, errors: string[]): void {
  if (!isObject(value)) {
    errors.push(`${path} must be a DiffFinding object`);
    return;
  }
  if (!isString(value.id) || !DIFF_FINDING_ID_RE.test(value.id)) {
    errors.push(`${path}.id must be "diff_" + uuid-shaped hex`);
  } else if (seenIds.has(value.id)) {
    errors.push(`${path}.id ${value.id} is duplicated`);
  } else {
    seenIds.add(value.id);
  }
  if (!isString(value.dimension) || !(DIMENSIONS as readonly string[]).includes(value.dimension)) {
    errors.push(`${path}.dimension must be one of ${DIMENSIONS.join('|')}`);
  }
  if (!isString(value.severity) || !(SEVERITIES as readonly string[]).includes(value.severity)) {
    errors.push(`${path}.severity must be one of ${SEVERITIES.join('|')}`);
  }
  if (!isString(value.summary) || value.summary === '') {
    errors.push(`${path}.summary must be a non-empty string`);
  }
  if (!Array.isArray(value.anchors) || value.anchors.length === 0) {
    errors.push(`${path}.anchors must be a non-empty array`);
  } else {
    for (const [index, anchor] of value.anchors.entries()) {
      validateAnchor(anchor, `${path}.anchors[${index}]`, errors);
    }
  }
  for (const field of ['expected', 'actual'] as const) {
    if (value[field] !== undefined && !isCanonicalSerializable(pruneUndefined(value[field]))) {
      errors.push(`${path}.${field} must be canonical-JSON data (no undefined inside arrays, no class instances)`);
    }
  }
}

/** Full contract validation; returns every violation, path-qualified. */
export function validateDiffReport(report: unknown): string[] {
  const errors: string[] = [];
  if (!isObject(report)) {
    return ['report must be a DiffReport object'];
  }
  if (!isString(report.id) || !DIFF_REPORT_ID_RE.test(report.id)) {
    errors.push('report.id must be "diffr_" + uuid-shaped hex');
  }
  if (report.diffVersion !== DIFF_VERSION) {
    errors.push(`report.diffVersion must equal DIFF_VERSION "${DIFF_VERSION}"`);
  }
  if (!isString(report.candidateAppId) || !PLANNED_APPLICATION_ID_PATTERN.test(report.candidateAppId)) {
    errors.push('report.candidateAppId must match the planned application id pattern ("appsyn_" + uuid)');
  }
  if (!isString(report.baselineRootHash) || !SHA256_HEX_RE.test(report.baselineRootHash)) {
    errors.push('report.baselineRootHash must be 64-char lowercase hex');
  }
  if (!Array.isArray(report.runs)) {
    errors.push('report.runs must be an array');
  } else {
    for (const [index, run] of report.runs.entries()) {
      const path = `report.runs[${index}]`;
      if (!isObject(run)) {
        errors.push(`${path} must be a PairedRun object`);
        continue;
      }
      if (!isString(run.journeyId) || run.journeyId === '') {
        errors.push(`${path}.journeyId must be a non-empty string`);
        continue;
      }
      if (!Array.isArray(run.transitionIds) || run.transitionIds.some((entry) => !isString(entry))) {
        errors.push(`${path}.transitionIds must be an array of id strings`);
      }
      validatePairedTarget(run.left, `${path}.left`, 'left', errors);
      validatePairedTarget(run.right, `${path}.right`, 'right', errors);
      if (!isObject(run.runs)) {
        errors.push(`${path}.runs must carry the left/right SideRunResults`);
      } else {
        validateSideRunResult(run.runs.left, `${path}.runs.left`, 'left', run.journeyId, errors);
        validateSideRunResult(run.runs.right, `${path}.runs.right`, 'right', run.journeyId, errors);
      }
    }
  }
  const seenFindingIds = new Set<string>();
  if (!Array.isArray(report.findings)) {
    errors.push('report.findings must be an array');
  } else {
    for (const [index, finding] of report.findings.entries()) {
      validateFinding(finding, `report.findings[${index}]`, seenFindingIds, errors);
    }
  }
  const counts = report.counts;
  if (
    !isObject(counts) ||
    !['critical', 'major', 'minor', 'info'].every((key) => Number.isInteger(counts[key]))
  ) {
    errors.push('report.counts must carry integer counts for critical/major/minor/info');
  } else {
    const tally = countSeverities(Array.isArray(report.findings) ? (report.findings as DiffFinding[]) : []);
    for (const key of ['critical', 'major', 'minor', 'info'] as const) {
      if (counts[key] !== tally[key]) {
        errors.push(
          `report.counts.${key} (${String(counts[key])}) must equal the computed finding tally (${tally[key]}) — counts are computed, never asserted`,
        );
      }
    }
    const critical = tally.critical;
    const expectedVerdict = critical === 0 ? 'equivalent' : 'divergent';
    if (report.verdict !== expectedVerdict) {
      errors.push(`report.verdict must be "${expectedVerdict}" (critical count is ${critical})`);
    }
  }
  if (!isString(report.generatedAt) || !ISO_UTC_RE.test(report.generatedAt)) {
    errors.push('report.generatedAt must be an ISO-8601 UTC timestamp (…T…Z, millisecond precision)');
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/** Computes the honest severity tally of a finding list. */
export function countSeverities(findings: DiffFinding[]): { critical: number; major: number; minor: number; info: number } {
  const counts = { critical: 0, major: 0, minor: 0, info: 0 };
  for (const finding of findings) {
    counts[finding.severity] += 1;
  }
  return counts;
}

export interface BuildDiffReportInput {
  candidateAppId: string;
  baselineRootHash: string;
  runs: PairedRun[];
  findings: DiffFinding[];
  ids: DiffIdFactory;
  now: () => Date;
}

/** Assembles a report: counts computed, verdict derived, identity minted. */
export function buildDiffReport(input: BuildDiffReportInput): DiffReport {
  const counts = countSeverities(input.findings);
  return {
    id: input.ids.newDiffReportId(),
    diffVersion: DIFF_VERSION,
    candidateAppId: input.candidateAppId,
    baselineRootHash: input.baselineRootHash,
    runs: input.runs,
    findings: input.findings,
    counts,
    verdict: counts.critical === 0 ? 'equivalent' : 'divergent',
    generatedAt: input.now().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Canonical serialization + parsing
// ---------------------------------------------------------------------------

/** Validates and canonically serializes a report (sorted keys, no whitespace). */
export function serializeDiffReport(report: DiffReport): string {
  const errors = validateDiffReport(report);
  if (errors.length > 0) {
    throw new DiffReportError(`serializeDiffReport: report violates the diff contract: ${errors.join('; ')}`);
  }
  return canonicalJson(pruneUndefined(report));
}

/**
 * Parses + validates canonical report text. Null array elements (the JSON
 * form of absent per-step capture ids) are normalized back to undefined.
 * Throws {@link DiffReportError} on malformed input, a wrong diffVersion,
 * or any contract violation (including counts/verdict inconsistency).
 */
export function parseDiffReport(text: string): DiffReport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new DiffReportError(`parseDiffReport: input is not valid JSON: ${String(error)}`);
  }
  const errors = validateDiffReport(parsed);
  if (errors.length > 0) {
    throw new DiffReportError(`parseDiffReport: report violates the diff contract: ${errors.join('; ')}`);
  }
  normalizeAbsentEntries(parsed as DiffReport);
  return parsed as DiffReport;
}

/** null → undefined inside the per-step id arrays (in place). */
function normalizeAbsentEntries(report: DiffReport): void {
  for (const run of report.runs) {
    normalizeRunArray(run.runs.left);
    normalizeRunArray(run.runs.right);
  }
}

function normalizeRunArray(result: SideRunResult): void {
  result.stepPageIds = result.stepPageIds.map((entry) => (entry === null ? undefined : entry));
  result.stepNetworkIds = result.stepNetworkIds.map((entry) => (entry === null ? undefined : entry));
}
