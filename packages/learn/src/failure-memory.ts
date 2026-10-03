/**
 * @clapp/learn — the failure memory (CLAPP-060, the P6 first lane —
 * Worker 3, Synthesis/Verification/Repair, the failure-classification
 * owner per docs/WORKER_HANDOFFS.md).
 *
 * docs/LEARNING_AND_LIBRARY.md §7: "Failures are first-class knowledge."
 * This module is the RECORD + STORE half of that law: one observed failure
 * event — derived from a frozen diff-contract v0.1 DiffFinding plus the
 * repair loop's outcome facts — admitted fail-closed into an in-memory,
 * insert-only, deterministic store. The DERIVATION half (a repeated failure
 * producing a reusable guard, test, or package correction) is CLAPP-061's
 * lane; this module records and stores honestly, and mines nothing.
 *
 * What one event carries (the §7 field list, verbatim sources):
 * - failing package/version — packageRef { id, version } verbatim, or null
 *   when the failure predates packaging;
 * - target/context — free-form non-empty strings;
 * - error signature — the finding's dimension/severity/findingId/summary,
 *   validated against the FROZEN diff-contract vocabulary (never minted,
 *   never normalized — VERBATIM);
 * - expected behavior / actual behavior — the finding's machine-checkable
 *   pair, carried VERBATIM (absent when structural);
 * - successful repair — attempted/resolved/resolvedFindingIds (sorted,
 *   deduped) from the repair loop's facts;
 * - whether repair generalized — caller-judged; null when unknown (the
 *   honesty law: never fabricated).
 *
 * Discipline (binding — the CLAPP-055 registry precedent plus the worker
 * handoff acceptance rules: no hidden global state, determinism):
 * - No clock: observedAt is CALLER-injected per admission (RFC3339,
 *   calendar-valid — 2026-02-30 is refused); the memory never reads a
 *   clock (there is no clock to read).
 * - No randomness, no network, no filesystem; all state lives in the
 *   createFailureMemory closure.
 * - Fail closed: every rejection is a collected, field-named error in a
 *   { ok: false, errors } result — results, never exceptions; a rejected
 *   admission stores nothing.
 * - Insert-only: an event's identity is content-addressed
 *   ('fail_' + sha256Hex(canonicalJson(record minus id))); a duplicate id
 *   is refused with a named error; a RECURRENCE (the same finding
 *   re-observed at a different observedAt, or the same signature from a
 *   different finding id) is a DISTINCT event with a distinct id —
 *   recurrences are exactly what CLAPP-061 will mine, and the memory
 *   stores them all honestly.
 * - Determinism: the same events in ANY admission order produce the same
 *   snapshot (records canonically sorted by id before hashing); listings
 *   are canonically ordered and DEEP COPIED (the caller can never mutate
 *   memory state through a listing).
 *
 * Non-degeneracy rule (binding): the memory consumes contract-shaped DATA.
 * @clapp/diff and @clapp/repair are devDependencies imported for TYPES
 * ONLY (pinned by test/failure-memory.test.ts); the runtime dependencies
 * are exactly @clapp/core (sha256Hex) and @clapp/observe (canonicalJson).
 * The frozen vocabulary's RUNTIME string values are pinned here as
 * literals — importing them at runtime would import the implementations.
 *
 * Query-handle policy (the registry precedent): record() returns the
 * stored record itself — an alias by construction (the caller already
 * supplied every verbatim-carried object it references); list() /
 * bySignature() / byPackage() return DEEP COPIES, the one channel this
 * contract seals. In-memory v0.1: persistence is a later, tech-lead-
 * declared lane; this module stores nothing outside its closure.
 */

import { sha256Hex } from '@clapp/core';
import { canonicalJson, isCanonicalSerializable } from '@clapp/observe';
import type { DiffDimension, DiffFinding, DiffSeverity } from '@clapp/diff';

// ---- the frozen diff-contract v0.1 vocabulary (TYPE-pinned literals) ------------

/**
 * The frozen DiffDimension vocabulary (diff-contract v0.1, canonical owner
 * @clapp/diff — CLAPP-040). Pinned as literals: the memory validates
 * contract-shaped DATA against these exact strings.
 */
const DIFF_DIMENSIONS: readonly DiffDimension[] = ['semantic', 'visual', 'network', 'state'];

/**
 * The frozen DiffSeverity vocabulary (diff-contract v0.1, canonical owner
 * @clapp/diff — CLAPP-040).
 */
const DIFF_SEVERITIES: readonly DiffSeverity[] = ['critical', 'major', 'minor', 'info'];

// ---- internal shared helpers (module-level; NOT re-exported by src/index.ts) ----

/** Plain-object guard (arrays are NOT objects here). */
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

/**
 * RFC3339 check: lexical shape + REAL calendar validity (component ranges,
 * true month lengths, leap years) — the house helper discipline
 * (@clapp/library package-contract.ts), copied because the memory's
 * runtime dependency set is exactly @clapp/core + @clapp/observe.
 * `Date.parse` is deliberately NOT used — it accepts rollover dates such
 * as 2026-02-30. Honest limitation: the leap-second form (second === 60)
 * is not accepted, matching what a JS Date can represent.
 */
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
  if (day < 1 || day > daysInMonth[month - 1]!) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;
  if (hasOffset && (offsetHour > 23 || offsetMinute > 59)) return false;
  return true;
}

/** Plain-value deep copy (records are JSON-shaped; no class instances). */
function deepCopyValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => deepCopyValue(item));
  }
  if (isObject(value)) {
    const copy: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      copy[key] = deepCopyValue(value[key]);
    }
    return copy;
  }
  return value;
}

/** The defensive copy a listing hands out — never aliases stored state. */
function copyRecord(record: FailureRecord): FailureRecord {
  return deepCopyValue(record) as FailureRecord;
}

// ---- the failure memory contract v0.1 ----------------------------------------------

/** The failure memory's contract version (bumps only via a tech-lead declaration wave). */
export const FAILURE_VERSION = '0.1';

/**
 * The minted event-id prefix — THIS lane's frozen proposal in the
 * `pkg_` / `cgraph_` / `rq_` / `creg_` prefix discipline: `fail_` + 64
 * lowercase hex chars. Changing it changes every minted id and requires a
 * contract version bump.
 */
const FAILURE_ID_PREFIX = 'fail_';

/**
 * The snapshot digest prefix — THIS lane's frozen proposal: `fmem_` + 64
 * lowercase hex chars (the memory-level companion of the registry's
 * `creg_`).
 */
const SNAPSHOT_PREFIX = 'fmem_';

/** One observed failure event, derived from a frozen DiffFinding + repair facts. */
export interface FailureRecord {
  /** MUST equal FAILURE_VERSION ('0.1') in v0. */
  failureVersion: string;
  /** Content-addressed: 'fail_' + sha256Hex(canonicalJson(record minus id)). */
  id: string;
  /** The failing package, when known — { id, version } verbatim; null when the failure predates packaging. */
  packageRef: { id: string; version: string } | null;
  /** The deployment-target context (free-form, non-empty). */
  target: string;
  /** The context summary (free-form, non-empty). */
  context: string;
  /** The error signature, derived VERBATIM from the frozen vocabulary. */
  signature: {
    /** The finding's dimension (validated against the frozen vocabulary). */
    dimension: string;
    /** The finding's severity (validated likewise). */
    severity: string;
    /** The finding's id — the per-event anchor. */
    findingId: string;
    /** The finding's one-sentence divergence, verbatim. */
    summary: string;
  };
  /** Machine-checkable expectation vs actual, carried VERBATIM from the finding (absent when structural). */
  expected?: unknown;
  actual?: unknown;
  /** The repair outcome facts (honest: generalized is caller-judged, null when unknown). */
  repair: {
    attempted: boolean;
    resolved: boolean;
    /** The repair attempts' resolved ids (sorted, deduped). */
    resolvedFindingIds: string[];
    generalized: boolean | null;
  };
  /** RFC3339 — CALLER-injected; the memory never reads a clock. */
  observedAt: string;
}

/** A failure memory over FailureRecords: record/query, deterministic, fail-closed. */
export interface FailureMemory {
  record(input: unknown, options: unknown): Promise<FailureResult>;
  /** All events whose signature matches (dimension+severity+summary), canonical order. */
  bySignature(signature: { dimension: string; severity: string; summary: string }): FailureRecord[];
  /** All events for a package id, canonical order. */
  byPackage(packageId: string): FailureRecord[];
  /** Canonical order (id), defensively copied. */
  list(): FailureRecord[];
  /** Measured, honest. */
  size(): number;
  /** 'fmem_' + sha256Hex(canonicalJson({failureVersion, records sorted})) — content-addressed, input-order independent. */
  snapshot(): Promise<string>;
}

/** Fail-closed admission: a result, never an exception. */
export type FailureResult =
  | { ok: true; record: FailureRecord }
  | { ok: false; errors: string[] };

// ---- the failure memory --------------------------------------------------------------

/**
 * Builds an EMPTY memory. All state is private to the closure; the only
 * mutation is the admission of a not-yet-present event id (insert-only).
 * An empty memory has size 0 and a valid snapshot — an honest empty memory.
 */
export function createFailureMemory(): FailureMemory {
  /** Event id → the stored record (immutable slots — insert-only). */
  const byId = new Map<string, FailureRecord>();
  let count = 0; // measured — +1 per admitted event, never decremented

  /** All stored events in canonical (id) order. */
  const canonicalRecords = (): FailureRecord[] => {
    const records: FailureRecord[] = [...byId.values()];
    records.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
    return records;
  };

  const record = async (input: unknown, options: unknown): Promise<FailureResult> => {
    const errors: string[] = [];

    // Caller-injected observation time — the memory never reads a clock.
    let observedAt: string | null = null;
    if (!isObject(options)) {
      errors.push(`options: expected an object { observedAt }, got ${preview(options)}`);
    } else {
      const candidate = options['observedAt'];
      if (!isRfc3339(candidate)) {
        errors.push(
          `options.observedAt: expected an RFC3339 date-time string (caller-injected — the memory never reads a clock), got ${preview(candidate)}`,
        );
      } else {
        observedAt = candidate;
      }
    }

    if (!isObject(input)) {
      errors.push(
        `input: expected an object { finding, repair, packageRef?, target, context }, got ${preview(input)}`,
      );
      return { ok: false, errors };
    }

    // ---- the finding (DiffFinding-shaped over the frozen vocabulary) ----
    const findingInput = input['finding'];
    let finding: DiffFinding | null = null;
    if (!isObject(findingInput)) {
      errors.push(
        `finding: expected an object (DiffFinding-shaped over the frozen diff-contract v0.1 vocabulary), got ${preview(findingInput)}`,
      );
    } else {
      let findingValid = true;

      const findingId = findingInput['id'];
      if (typeof findingId !== 'string' || findingId.length === 0) {
        errors.push(`finding.id: expected a non-empty string, got ${preview(findingId)}`);
        findingValid = false;
      }

      const dimension = findingInput['dimension'];
      if (
        typeof dimension !== 'string' ||
        !(DIFF_DIMENSIONS as readonly string[]).includes(dimension)
      ) {
        errors.push(
          `finding.dimension: expected one of the frozen diff-contract dimensions ("semantic" | "visual" | "network" | "state"), got ${preview(dimension)}`,
        );
        findingValid = false;
      }

      const severity = findingInput['severity'];
      if (
        typeof severity !== 'string' ||
        !(DIFF_SEVERITIES as readonly string[]).includes(severity)
      ) {
        errors.push(
          `finding.severity: expected one of the frozen diff-contract severities ("critical" | "major" | "minor" | "info"), got ${preview(severity)}`,
        );
        findingValid = false;
      }

      const summary = findingInput['summary'];
      if (typeof summary !== 'string' || summary.length === 0) {
        errors.push(
          `finding.summary: expected a non-empty string (the finding's one-sentence divergence), got ${preview(summary)}`,
        );
        findingValid = false;
      }

      if (!Array.isArray(findingInput['anchors'])) {
        errors.push(
          `finding.anchors: expected an array (the anchors' internals are the diff contract's business, not the memory's), got ${preview(findingInput['anchors'])}`,
        );
        findingValid = false;
      }

      // expected/actual: carried VERBATIM — any JSON value, absent keys stay
      // absent. An explicitly-undefined value is not a JSON value (the
      // canonicalizer would refuse it): a named error, never a rewrite.
      for (const field of ['expected', 'actual'] as const) {
        if (!(field in findingInput)) {
          continue;
        }
        const value = findingInput[field];
        if (value === undefined) {
          errors.push(
            `finding.${field}: expected a JSON value when present (undefined is not — absent keys stay absent), got undefined`,
          );
          findingValid = false;
        } else if (!isCanonicalSerializable(value)) {
          errors.push(
            `finding.${field}: expected a canonical-JSON-serializable value (carried verbatim into the event identity), got ${preview(value)}`,
          );
          findingValid = false;
        }
      }

      if (findingValid) {
        finding = findingInput as unknown as DiffFinding;
      }
    }

    // ---- the repair outcome facts ----
    const repairInput = input['repair'];
    let repair: FailureRecord['repair'] | null = null;
    if (!isObject(repairInput)) {
      errors.push(
        `repair: expected an object { attempted, resolved, resolvedFindingIds, generalized }, got ${preview(repairInput)}`,
      );
    } else {
      let repairValid = true;

      if (typeof repairInput['attempted'] !== 'boolean') {
        errors.push(
          `repair.attempted: expected a boolean, got ${preview(repairInput['attempted'])}`,
        );
        repairValid = false;
      }

      if (typeof repairInput['resolved'] !== 'boolean') {
        errors.push(`repair.resolved: expected a boolean, got ${preview(repairInput['resolved'])}`);
        repairValid = false;
      }

      const resolvedFindingIds = repairInput['resolvedFindingIds'];
      if (!Array.isArray(resolvedFindingIds)) {
        errors.push(
          `repair.resolvedFindingIds: expected an array of non-empty strings (the repair attempts' resolved ids), got ${preview(resolvedFindingIds)}`,
        );
        repairValid = false;
      } else {
        let entriesValid = true;
        resolvedFindingIds.forEach((entry: unknown, index: number) => {
          if (typeof entry !== 'string' || entry.length === 0) {
            errors.push(
              `repair.resolvedFindingIds[${index}]: expected a non-empty string, got ${preview(entry)}`,
            );
            entriesValid = false;
          }
        });
        if (!entriesValid) {
          repairValid = false;
        }
      }

      const generalized = repairInput['generalized'];
      if (typeof generalized !== 'boolean' && generalized !== null) {
        errors.push(
          `repair.generalized: expected a boolean or null (caller-judged; null when unknown), got ${preview(generalized)}`,
        );
        repairValid = false;
      }

      if (repairValid) {
        // Sorted + deduped, in a FRESH array — the memory never mutates its inputs.
        repair = {
          attempted: repairInput['attempted'] as boolean,
          resolved: repairInput['resolved'] as boolean,
          resolvedFindingIds: [...new Set(resolvedFindingIds as string[])].sort(),
          generalized: repairInput['generalized'] as boolean | null,
        };
      }
    }

    // ---- the failing package, when known ----
    const packageRefInput = input['packageRef'];
    let packageRef: FailureRecord['packageRef'] = null;
    if (packageRefInput === undefined || packageRefInput === null) {
      // null is legal — the failure predates packaging (or is unattributed).
      packageRef = null;
    } else if (!isObject(packageRefInput)) {
      errors.push(
        `packageRef: expected { id, version } (both non-empty strings) or null (the failure predates packaging), got ${preview(packageRefInput)}`,
      );
    } else {
      let packageRefValid = true;

      const packageId = packageRefInput['id'];
      if (typeof packageId !== 'string' || packageId.length === 0) {
        errors.push(`packageRef.id: expected a non-empty string, got ${preview(packageId)}`);
        packageRefValid = false;
      }

      const packageVersion = packageRefInput['version'];
      if (typeof packageVersion !== 'string' || packageVersion.length === 0) {
        errors.push(
          `packageRef.version: expected a non-empty string, got ${preview(packageVersion)}`,
        );
        packageRefValid = false;
      }

      // { id, version } verbatim: exactly the two contract keys — extra keys
      // would leak into the event identity (and off the record's type).
      const unexpectedKeys = Object.keys(packageRefInput).filter(
        (key) => key !== 'id' && key !== 'version',
      );
      if (unexpectedKeys.length > 0) {
        errors.push(
          `packageRef: expected exactly { id, version } — unexpected keys: ${unexpectedKeys.sort().join(', ')}`,
        );
        packageRefValid = false;
      }

      if (packageRefValid) {
        // VERBATIM: the caller's own { id, version } object is the stored one
        // (an alias by construction — the registry precedent).
        packageRef = packageRefInput as unknown as FailureRecord['packageRef'];
      }
    }

    // ---- the deployment-target context + the context summary ----
    const target = input['target'];
    if (typeof target !== 'string' || target.length === 0) {
      errors.push(
        `target: expected a non-empty string (the deployment-target context), got ${preview(target)}`,
      );
    }

    const context = input['context'];
    if (typeof context !== 'string' || context.length === 0) {
      errors.push(
        `context: expected a non-empty string (the context summary), got ${preview(context)}`,
      );
    }

    // ---- fail closed: nothing is stored unless every field admitted ----
    if (errors.length > 0 || observedAt === null || finding === null || repair === null) {
      return { ok: false, errors };
    }

    // ---- the content-addressed event identity ----
    // The record MINUS its id is the minting input (the same discipline as
    // canonicalPackageJson): same id ⇔ identical canonical event bytes.
    const recordBody: Omit<FailureRecord, 'id'> = {
      failureVersion: FAILURE_VERSION,
      packageRef,
      target: target as string,
      context: context as string,
      signature: {
        dimension: finding.dimension,
        severity: finding.severity,
        findingId: finding.id,
        summary: finding.summary,
      },
      repair,
      observedAt,
    };
    if ('expected' in finding) {
      recordBody.expected = finding.expected;
    }
    if ('actual' in finding) {
      recordBody.actual = finding.actual;
    }

    // The last line of defense: if the derived record somehow refuses
    // canonicalization (e.g. nesting depth past the canonicalizer's limit),
    // the refusal is a NAMED error — never an escaped exception.
    let canonical: string;
    try {
      canonical = canonicalJson(recordBody);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        errors: [
          `finding: the derived failure event is not canonical-JSON serializable (${detail}) — expected/actual must be plain JSON values`,
        ],
      };
    }
    const id = `${FAILURE_ID_PREFIX}${await sha256Hex(canonical)}`;

    // ---- insert-only: the exact event twice is a duplicate ----
    if (byId.has(id)) {
      return {
        ok: false,
        errors: [
          `duplicate failure event ${id} — the exact event (finding ${finding.id} at ${observedAt}) is already recorded`,
        ],
      };
    }

    const stored: FailureRecord = { ...recordBody, id };
    byId.set(id, stored);
    count += 1;
    // The stored record itself — an alias by construction (documented above).
    return { ok: true, record: stored };
  };

  const bySignature = (signature: unknown): FailureRecord[] => {
    // A query is never an error; a non-object or non-string signature
    // matches nothing (fail closed — honest misses return []).
    if (!isObject(signature)) {
      return [];
    }
    const dimension = signature['dimension'];
    const severity = signature['severity'];
    const summary = signature['summary'];
    if (
      typeof dimension !== 'string' ||
      typeof severity !== 'string' ||
      typeof summary !== 'string'
    ) {
      return [];
    }
    return canonicalRecords()
      .filter(
        (record) =>
          record.signature.dimension === dimension &&
          record.signature.severity === severity &&
          record.signature.summary === summary,
      )
      .map(copyRecord);
  };

  const byPackage = (packageId: unknown): FailureRecord[] => {
    // A query is never an error; a non-string package id matches nothing
    // (and a packageless event never matches any package id).
    if (typeof packageId !== 'string') {
      return [];
    }
    return canonicalRecords()
      .filter((record) => record.packageRef !== null && record.packageRef.id === packageId)
      .map(copyRecord);
  };

  const list = (): FailureRecord[] => canonicalRecords().map(copyRecord);

  const size = (): number => count; // measured — never asserted

  const snapshot = async (): Promise<string> => {
    // Content-addressed: canonical (id) order + canonicalJson + sha256 —
    // identical contents produce identical digests, any admitted event
    // moves the digest, and the admission order never leaks. The empty
    // memory has a valid snapshot (an honest empty memory).
    const records = canonicalRecords();
    const payload = canonicalJson({ failureVersion: FAILURE_VERSION, records });
    return SNAPSHOT_PREFIX + (await sha256Hex(payload));
  };

  return { record, bySignature, byPackage, list, size, snapshot };
}
