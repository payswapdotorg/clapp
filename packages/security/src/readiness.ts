/**
 * @clapp/security — the production readiness gate (CLAPP-074).
 *
 * The P7 CLOSING lane, OWNED AND IMPLEMENTED BY THE TECH LEAD (the
 * integration authority — docs/WORK_ITEMS.md: "CLAPP-074 — Production
 * readiness gate, Owner: tech lead, Depends on: 070,071,072,073", all
 * landed). The gate WEIGHS the four landed security surfaces' measured
 * evidence and issues the honest production verdict — it never inspects
 * implementations, never re-runs the surfaces' own machinery: readiness
 * is a JUDGMENT over measured facts, exactly the promotion-gate pattern
 * (CLAPP-054) applied to production.
 *
 * THE FROZEN v0.1 READINESS CHECKS (each a measured-fact comparison —
 * "requirement" is the threshold, "measured" is the evidence's own number):
 *
 *   authorization.positive  sessionsAdmitted >= 1        (the boundary admits)
 *   authorization.negative  observationRefusals >= 1     (the boundary refuses — the fail-closed path PROVEN exercised)
 *   redaction.positive      fieldsRedacted >= 1          (the engine redacts)
 *   redaction.zero-leak     rawSecretLeaks === 0         (HARD: any measured leak is not-ready, always)
 *   isolation.positive      zoneWrites >= 1              (zones store)
 *   isolation.negative      crossOriginRefusals >= 1     (the publish-leak guard PROVEN exercised)
 *   audit.positive          eventsRecorded >= 1          (the trail records)
 *   audit.lifecycle         cancellationCycles >= 1      (cancel/resume PROVEN exercised)
 *
 * ALL eight met → verdict 'ready'. ANY unmet → 'not-ready' with EVERY
 * unmet check named and its measured value carried. The zero-leak law is
 * absolute: a measured raw-secret leak is not-ready regardless of
 * everything else.
 *
 * Discipline (binding — the 070..073 house rules): fail-closed results
 * (ALL evidence-shape errors collected, each naming its field); the
 * evidence numbers are the CALLER's measured facts (the gate never
 * fabricates, never re-measures — it weighs); determinism (no clock —
 * evaluatedAt is CALLER-injected RFC3339; no randomness/network/
 * filesystem); inputs never mutated; the report content-addressed
 * ('ready_' + sha256Hex over the canonical report minus its id — THIS
 * packet's frozen prefix proposal).
 */

import { sha256Hex } from '@clapp/core';
import { canonicalJson } from '@clapp/observe';

// Local house helpers (the 070..073 precedent).

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

/** RFC3339 date-time: full-date "T" full-time, offset `Z`/`z` or ±HH:MM. */
const RFC3339_RE =
  /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|([+-])(\d{2}):(\d{2}))$/;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** RFC3339 check: lexical shape + REAL calendar validity (the house helper). */
function isRfc3339(value: unknown): value is string {
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
  if (day < 1 || day > (daysInMonth[month - 1] as number)) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;
  if (hasOffset && (offsetHour > 23 || offsetMinute > 59)) return false;
  return true;
}

/** A non-negative integer guard (measured counts are never negative). */
function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

// ---- the readiness contract v0.1 ---------------------------------------------

/** The readiness-gate contract version (bumps only via a tech-lead declaration wave). */
export const READINESS_VERSION = '0.1';

/** The work-item identity stamped on every readiness report. */
export const EVALUATED_BY = 'CLAPP-074';

/** The four landed surfaces' measured evidence (the gate's input). */
export interface ReadinessEvidence {
  authorization: {
    /** MEASURED: sessions admitted through createAuthorizedSession. */
    sessionsAdmitted: number;
    /** MEASURED: boundary refusals through assertObservationAuthorized. */
    observationRefusals: number;
  };
  redaction: {
    /** MEASURED: fields redacted (the sum over RedactionReport entries). */
    fieldsRedacted: number;
    /** MEASURED: raw secrets found in durable evidence post-redaction (MUST be 0). */
    rawSecretLeaks: number;
  };
  isolation: {
    /** MEASURED: successful zone writes. */
    zoneWrites: number;
    /** MEASURED: cross-origin publication refusals (the publish-leak guard). */
    crossOriginRefusals: number;
  };
  audit: {
    /** MEASURED: audit events recorded. */
    eventsRecorded: number;
    /** MEASURED: cancel→resume cycles completed. */
    cancellationCycles: number;
  };
}

/** One weighed check — the requirement, the measured fact, the verdict. */
export interface ReadinessCheck {
  surface: string;          // 'authorization' | 'redaction' | 'isolation' | 'audit'
  requirement: string;      // the frozen v0.1 rule text
  measured: number;         // the evidence's own number, carried verbatim
  met: boolean;             // measured vs requirement — computed, never asserted
}

/** The readiness report. */
export interface ReadinessReport {
  readinessVersion: string;   // READINESS_VERSION ('0.1')
  id: string;                 // content-addressed: 'ready_' + sha256Hex(canonicalJson(report minus id))
  evaluatedBy: string;        // 'CLAPP-074'
  checks: ReadinessCheck[];   // ALL EIGHT, in the frozen order
  verdict: 'ready' | 'not-ready';
  reasons: string[];          // honest, sorted, deduped — the unmet checks named with measured values
  /** RFC3339 — CALLER-injected; the gate never reads a clock. */
  evaluatedAt: string;
}

export type ReadinessResult =
  | { ok: true; report: ReadinessReport }
  | { ok: false; errors: string[] };  // fail-closed — results, never exceptions

// ---- the gate -------------------------------------------------------------------

/**
 * Weigh the four surfaces' measured evidence and mint the readiness
 * report. The frozen v0.1 checks (in order): authorization.positive
 * (sessionsAdmitted >= 1), authorization.negative (observationRefusals >=
 * 1), redaction.positive (fieldsRedacted >= 1), redaction.zero-leak
 * (rawSecretLeaks === 0 — absolute), isolation.positive (zoneWrites >= 1),
 * isolation.negative (crossOriginRefusals >= 1), audit.positive
 * (eventsRecorded >= 1), audit.lifecycle (cancellationCycles >= 1).
 */
export async function evaluateReadiness(
  evidence: unknown,
  options: unknown,
): Promise<ReadinessResult> {
  const errors: string[] = [];

  // ---- 1. fail-closed evidence-shape validation (ALL errors collected) ----
  if (!isObject(evidence)) {
    return { ok: false, errors: [`evidence: expected a ReadinessEvidence object, got ${preview(evidence)}`] };
  }
  for (const surface of ['authorization', 'redaction', 'isolation', 'audit'] as const) {
    if (!isObject(evidence[surface])) {
      errors.push(`evidence.${surface}: expected an object with measured counts, got ${preview(evidence[surface])}`);
    }
  }
  if (!isObject(options)) {
    return { ok: false, errors: [`options: expected an object { evaluatedAt }, got ${preview(options)}`] };
  }
  if (!isRfc3339(options.evaluatedAt)) {
    errors.push(
      `options.evaluatedAt: expected an RFC3339 date-time string (caller-injected — the gate never reads a clock), got ${preview(options.evaluatedAt)}`,
    );
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const auth = evidence.authorization as Record<string, unknown>;
  const red = evidence.redaction as Record<string, unknown>;
  const iso = evidence.isolation as Record<string, unknown>;
  const aud = evidence.audit as Record<string, unknown>;
  const measures: Array<[string, string, unknown, (value: number) => boolean]> = [
    ['authorization', 'sessionsAdmitted >= 1', auth.sessionsAdmitted, (v) => v >= 1],
    ['authorization', 'observationRefusals >= 1', auth.observationRefusals, (v) => v >= 1],
    ['redaction', 'fieldsRedacted >= 1', red.fieldsRedacted, (v) => v >= 1],
    ['redaction', 'rawSecretLeaks === 0 (absolute)', red.rawSecretLeaks, (v) => v === 0],
    ['isolation', 'zoneWrites >= 1', iso.zoneWrites, (v) => v >= 1],
    ['isolation', 'crossOriginRefusals >= 1', iso.crossOriginRefusals, (v) => v >= 1],
    ['audit', 'eventsRecorded >= 1', aud.eventsRecorded, (v) => v >= 1],
    ['audit', 'cancellationCycles >= 1', aud.cancellationCycles, (v) => v >= 1],
  ];

  const checks: ReadinessCheck[] = [];
  for (const [surface, requirement, measured, predicate] of measures) {
    if (!isCount(measured)) {
      errors.push(`evidence.${surface}: the measured value for "${requirement}" must be a non-negative integer, got ${preview(measured)}`);
      continue;
    }
    checks.push({ surface, requirement, measured, met: predicate(measured) });
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // ---- 2. the verdict (all eight met, or every unmet check named) ----
  const unmet = checks.filter((check) => !check.met);
  const verdict: ReadinessReport['verdict'] = unmet.length === 0 ? 'ready' : 'not-ready';
  const reasons: string[] = [];
  if (verdict === 'ready') {
    reasons.push('all eight frozen v0.1 readiness checks met (measured)');
  } else {
    for (const check of unmet) {
      reasons.push(`not-ready: ${check.surface} — ${check.requirement} (measured ${check.measured})`);
    }
  }

  // ---- 3. the content-addressed report ----
  const unsigned: Omit<ReadinessReport, 'id'> = {
    readinessVersion: READINESS_VERSION,
    evaluatedBy: EVALUATED_BY,
    checks,
    verdict,
    reasons: [...new Set(reasons)].sort(),
    evaluatedAt: options.evaluatedAt as string,
  };
  const id = `ready_${await sha256Hex(canonicalJson(unsigned))}`;
  return { ok: true, report: { ...unsigned, id } };
}
