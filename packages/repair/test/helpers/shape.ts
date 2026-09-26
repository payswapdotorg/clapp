/**
 * @clapp/repair tests — contract-shape runtime validators (CLAPP-042).
 *
 * Pure runtime validation of the MIRROR types' shapes: every consumed
 * report (synthesized by the test-side runner stand-in) and every
 * produced directive/attempt/result must conform — exact field sets,
 * correct primitive types, optional fields ABSENT (never null), enum
 * values, and computed invariants (counts honest, converged iff).
 * Returns a list of violations (empty = conformant).
 */

import type { DiffFinding } from '../../src/diff-contract';

const DIFF_DIMENSIONS = new Set(['semantic', 'visual', 'network', 'state']);
const DIFF_SEVERITIES = new Set(['critical', 'major', 'minor', 'info']);
const EVIDENCE_KINDS = new Set(['console', 'network', 'screenshot', 'static', 'user']);
const VERDICTS = new Set(['equivalent', 'divergent', 'worse', 'error']);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fieldNames(value: Record<string, unknown>): string[] {
  return Object.keys(value).sort();
}

/** Asserts a required string field. */
function reqString(container: Record<string, unknown>, name: string, errors: string[], at: string): string {
  const value = container[name];
  if (typeof value !== 'string') {
    errors.push(`${at}.${name} must be a string (got ${typeof value})`);
    return '';
  }
  return value;
}

/** Asserts a required boolean/number field. */
function reqBoolean(container: Record<string, unknown>, name: string, errors: string[], at: string): boolean {
  const value = container[name];
  if (typeof value !== 'boolean') {
    errors.push(`${at}.${name} must be a boolean (got ${typeof value})`);
    return false;
  }
  return value;
}

function reqNumber(container: Record<string, unknown>, name: string, errors: string[], at: string): number {
  const value = container[name];
  if (typeof value !== 'number') {
    errors.push(`${at}.${name} must be a number (got ${typeof value})`);
    return NaN;
  }
  return value;
}

/** Asserts an optional string field: ABSENT or string — NEVER null. */
function optString(container: Record<string, unknown>, name: string, errors: string[], at: string): void {
  const value = container[name];
  if (value === null) {
    errors.push(`${at}.${name} is null — optional fields stay ABSENT, never null`);
  } else if (value !== undefined && typeof value !== 'string') {
    errors.push(`${at}.${name} must be a string when present (got ${typeof value})`);
  }
}

function validateEvidenceRef(value: unknown, errors: string[], at: string): void {
  if (!isObject(value)) {
    errors.push(`${at} must be an object`);
    return;
  }
  reqString(value, 'evidenceId', errors, at);
  reqString(value, 'sha256', errors, at);
  const kind = reqString(value, 'kind', errors, at);
  if (!EVIDENCE_KINDS.has(kind)) {
    errors.push(`${at}.kind must be one of the EvidenceKind values (got ${JSON.stringify(kind)})`);
  }
  const allowed = ['evidenceId', 'kind', 'sha256'];
  for (const extra of fieldNames(value)) {
    if (!allowed.includes(extra)) {
      errors.push(`${at} has unexpected field "${extra}"`);
    }
  }
}

export function validateDiffAnchor(value: unknown, errors: string[], at: string): void {
  if (!isObject(value)) {
    errors.push(`${at} must be an object`);
    return;
  }
  reqNumber(value, 'stepIndex', errors, at);
  if (value['leftEvidence'] !== undefined) {
    validateEvidenceRef(value['leftEvidence'], errors, `${at}.leftEvidence`);
  }
  if (value['leftEvidence'] === null) {
    errors.push(`${at}.leftEvidence is null — optional fields stay ABSENT`);
  }
  if (value['rightEvidence'] !== undefined) {
    validateEvidenceRef(value['rightEvidence'], errors, `${at}.rightEvidence`);
  }
  if (value['rightEvidence'] === null) {
    errors.push(`${at}.rightEvidence is null — optional fields stay ABSENT`);
  }
  const sourceIds = value['sourceIds'];
  if (!Array.isArray(sourceIds) || sourceIds.some((id) => typeof id !== 'string')) {
    errors.push(`${at}.sourceIds must be string[]`);
  }
  const allowed = ['stepIndex', 'leftEvidence', 'rightEvidence', 'sourceIds'];
  for (const extra of fieldNames(value)) {
    if (!allowed.includes(extra)) {
      errors.push(`${at} has unexpected field "${extra}"`);
    }
  }
}

export function validateDiffFinding(value: unknown, errors: string[], at: string): void {
  if (!isObject(value)) {
    errors.push(`${at} must be an object`);
    return;
  }
  reqString(value, 'id', errors, at);
  const dimension = reqString(value, 'dimension', errors, at);
  if (!DIFF_DIMENSIONS.has(dimension)) {
    errors.push(`${at}.dimension must be a DiffDimension (got ${JSON.stringify(dimension)})`);
  }
  const severity = reqString(value, 'severity', errors, at);
  if (!DIFF_SEVERITIES.has(severity)) {
    errors.push(`${at}.severity must be a DiffSeverity (got ${JSON.stringify(severity)})`);
  }
  reqString(value, 'summary', errors, at);
  const anchors = value['anchors'];
  if (!Array.isArray(anchors) || anchors.length === 0) {
    errors.push(`${at}.anchors must be a non-empty array`);
  } else {
    anchors.forEach((anchor, index) => validateDiffAnchor(anchor, errors, `${at}.anchors[${index}]`));
  }
  for (const optional of ['expected', 'actual'] as const) {
    if (value[optional] === null) {
      errors.push(`${at}.${optional} is null — optional fields stay ABSENT, never null`);
    }
  }
  const allowed = ['id', 'dimension', 'severity', 'summary', 'anchors', 'expected', 'actual'];
  for (const extra of fieldNames(value)) {
    if (!allowed.includes(extra)) {
      errors.push(`${at} has unexpected field "${extra}"`);
    }
  }
}

function validatePairedTarget(value: unknown, errors: string[], at: string): void {
  if (!isObject(value)) {
    errors.push(`${at} must be an object`);
    return;
  }
  const side = reqString(value, 'side', errors, at);
  if (side !== 'left' && side !== 'right') {
    errors.push(`${at}.side must be 'left' | 'right' (got ${JSON.stringify(side)})`);
  }
  reqString(value, 'baseUrl', errors, at);
  reqString(value, 'targetId', errors, at);
  const driver = reqString(value, 'driver', errors, at);
  if (driver !== 'replayer-dom' && driver !== 'replayer-playwright') {
    errors.push(`${at}.driver must be a driver value (got ${JSON.stringify(driver)})`);
  }
}

function validateSideRunResult(value: unknown, errors: string[], at: string): void {
  if (!isObject(value)) {
    errors.push(`${at} must be an object`);
    return;
  }
  const side = reqString(value, 'side', errors, at);
  if (side !== 'left' && side !== 'right') {
    errors.push(`${at}.side must be 'left' | 'right'`);
  }
  reqString(value, 'journeyId', errors, at);
  const completed = reqBoolean(value, 'completed', errors, at);
  const steps = reqNumber(value, 'stepsCompleted', errors, at);
  optString(value, 'failure', errors, at);
  if (completed && value['failure'] !== undefined) {
    errors.push(`${at}.failure must be absent when completed`);
  }
  if (!completed && value['failure'] === undefined) {
    errors.push(`${at}.failure must be present when not completed`);
  }
  validateEvidenceRef(value['evidenceRef'], errors, `${at}.evidenceRef`);
  for (const arrayField of ['stepPageIds', 'stepNetworkIds', 'storageIds'] as const) {
    const array = value[arrayField];
    if (!Array.isArray(array)) {
      errors.push(`${at}.${arrayField} must be an array`);
    } else if (array.some((entry) => entry !== undefined && typeof entry !== 'string')) {
      errors.push(`${at}.${arrayField} entries must be string | undefined`);
    } else if (array.some((entry) => entry === null)) {
      errors.push(`${at}.${arrayField} contains null — absent entries are undefined, never null`);
    }
  }
  if (Number.isFinite(steps) && Array.isArray(value['stepPageIds'])) {
    // stepsCompleted may be less than the arrays' length only when the run
    // failed; arrays are always aligned to the journey's full step count.
    if (completed && value['stepPageIds'].length !== steps) {
      errors.push(`${at}: completed run must have stepPageIds aligned to stepsCompleted`);
    }
  }
}

function validatePairedRun(value: unknown, errors: string[], at: string): void {
  if (!isObject(value)) {
    errors.push(`${at} must be an object`);
    return;
  }
  reqString(value, 'journeyId', errors, at);
  const transitionIds = value['transitionIds'];
  if (!Array.isArray(transitionIds) || transitionIds.some((id) => typeof id !== 'string')) {
    errors.push(`${at}.transitionIds must be string[]`);
  }
  validatePairedTarget(value['left'], errors, `${at}.left`);
  validatePairedTarget(value['right'], errors, `${at}.right`);
  const runs = value['runs'];
  if (!isObject(runs)) {
    errors.push(`${at}.runs must be an object`);
    return;
  }
  validateSideRunResult(runs['left'], errors, `${at}.runs.left`);
  validateSideRunResult(runs['right'], errors, `${at}.runs.right`);
}

export function validateDiffReport(value: unknown, errors: string[]): void {
  const at = 'report';
  if (!isObject(value)) {
    errors.push(`${at} must be an object`);
    return;
  }
  reqString(value, 'id', errors, at);
  reqString(value, 'diffVersion', errors, at);
  reqString(value, 'candidateAppId', errors, at);
  reqString(value, 'baselineRootHash', errors, at);
  const runs = value['runs'];
  if (!Array.isArray(runs)) {
    errors.push(`${at}.runs must be an array`);
  } else {
    runs.forEach((run, index) => validatePairedRun(run, errors, `${at}.runs[${index}]`));
  }
  const findings = value['findings'];
  if (!Array.isArray(findings)) {
    errors.push(`${at}.findings must be an array`);
  } else {
    findings.forEach((finding, index) => validateDiffFinding(finding, errors, `${at}.findings[${index}]`));
  }
  const counts = value['counts'];
  if (!isObject(counts)) {
    errors.push(`${at}.counts must be an object`);
  } else {
    for (const severity of ['critical', 'major', 'minor', 'info'] as const) {
      reqNumber(counts, severity, errors, `${at}.counts`);
    }
    if (Array.isArray(findings) && isObject(counts)) {
      const recomputed: Record<string, number> = { critical: 0, major: 0, minor: 0, info: 0 };
      for (const finding of findings as DiffFinding[]) {
        recomputed[finding.severity] = (recomputed[finding.severity] ?? 0) + 1;
      }
      for (const severity of ['critical', 'major', 'minor', 'info'] as const) {
        if (counts[severity] !== recomputed[severity]) {
          errors.push(
            `${at}.counts.${severity} is ${String(counts[severity])} but the findings contain ${recomputed[severity]} (computed, never asserted)`,
          );
        }
      }
    }
  }
  const verdict = reqString(value, 'verdict', errors, at);
  if (verdict !== 'equivalent' && verdict !== 'divergent') {
    errors.push(`${at}.verdict must be 'equivalent' | 'divergent' (got ${JSON.stringify(verdict)})`);
  }
  if (Array.isArray(findings) && verdict === 'equivalent' && findings.length > 0) {
    errors.push(`${at}.verdict is 'equivalent' but findings exist`);
  }
  reqString(value, 'generatedAt', errors, at);
  const allowed = [
    'id',
    'diffVersion',
    'candidateAppId',
    'baselineRootHash',
    'runs',
    'findings',
    'counts',
    'verdict',
    'generatedAt',
  ];
  for (const extra of fieldNames(value)) {
    if (!allowed.includes(extra)) {
      errors.push(`${at} has unexpected field "${extra}"`);
    }
  }
}

export function validateRepairDirective(value: unknown, errors: string[], at: string): void {
  if (!isObject(value)) {
    errors.push(`${at} must be an object`);
    return;
  }
  const id = reqString(value, 'id', errors, at);
  if (!id.startsWith('repd_')) {
    errors.push(`${at}.id must be "repd_"-prefixed (got ${JSON.stringify(id)})`);
  }
  const findingIds = value['findingIds'];
  if (!Array.isArray(findingIds) || findingIds.length === 0 || findingIds.some((fid) => typeof fid !== 'string')) {
    errors.push(`${at}.findingIds must be a non-empty string[]`);
  }
  const scopePaths = value['scopePaths'];
  if (!Array.isArray(scopePaths) || scopePaths.some((p) => typeof p !== 'string')) {
    errors.push(`${at}.scopePaths must be string[]`);
  }
  reqString(value, 'acceptance', errors, at);
  const allowed = ['id', 'findingIds', 'scopePaths', 'acceptance'];
  for (const extra of fieldNames(value)) {
    if (!allowed.includes(extra)) {
      errors.push(`${at} has unexpected field "${extra}"`);
    }
  }
}

export function validateRepairAttempt(value: unknown, errors: string[], at: string): void {
  if (!isObject(value)) {
    errors.push(`${at} must be an object`);
    return;
  }
  reqString(value, 'directiveId', errors, at);
  const iteration = reqNumber(value, 'iteration', errors, at);
  if (!Number.isInteger(iteration) || iteration < 0) {
    errors.push(`${at}.iteration must be a non-negative integer (loop assigns 1..maxIterations)`);
  }
  reqString(value, 'baseSha', errors, at);
  const changedPaths = value['changedPaths'];
  if (!Array.isArray(changedPaths) || changedPaths.some((p) => typeof p !== 'string')) {
    errors.push(`${at}.changedPaths must be string[]`);
  }
  const verdict = reqString(value, 'rerunVerdict', errors, at);
  if (!VERDICTS.has(verdict)) {
    errors.push(`${at}.rerunVerdict must be a verdict value (got ${JSON.stringify(verdict)})`);
  }
  const resolved = value['resolvedFindingIds'];
  if (!Array.isArray(resolved) || resolved.some((fid) => typeof fid !== 'string')) {
    errors.push(`${at}.resolvedFindingIds must be string[]`);
  }
  const allowed = ['directiveId', 'iteration', 'baseSha', 'changedPaths', 'rerunVerdict', 'resolvedFindingIds'];
  for (const extra of fieldNames(value)) {
    if (!allowed.includes(extra)) {
      errors.push(`${at} has unexpected field "${extra}"`);
    }
  }
}

export function validateRepairLoopResult(value: unknown, errors: string[]): void {
  const at = 'result';
  if (!isObject(value)) {
    errors.push(`${at} must be an object`);
    return;
  }
  reqNumber(value, 'maxIterations', errors, at);
  const attempts = value['attempts'];
  if (!Array.isArray(attempts)) {
    errors.push(`${at}.attempts must be an array`);
  } else {
    attempts.forEach((attempt, index) => validateRepairAttempt(attempt, errors, `${at}.attempts[${index}]`));
    const maxIterations = value['maxIterations'];
    if (typeof maxIterations === 'number' && attempts.length > maxIterations) {
      errors.push(`${at}: ${attempts.length} attempts exceed the budget ${maxIterations}`);
    }
  }
  const remaining = value['remainingCriticalFindings'];
  if (!Array.isArray(remaining) || remaining.some((fid) => typeof fid !== 'string')) {
    errors.push(`${at}.remainingCriticalFindings must be string[]`);
  }
  const converged = reqBoolean(value, 'converged', errors, at);
  if (Array.isArray(remaining) && converged !== (remaining.length === 0)) {
    errors.push(`${at}.converged must be true iff remainingCriticalFindings is empty`);
  }
  const allowed = ['maxIterations', 'attempts', 'remainingCriticalFindings', 'converged'];
  for (const extra of fieldNames(value)) {
    if (!allowed.includes(extra)) {
      errors.push(`${at} has unexpected field "${extra}"`);
    }
  }
}
