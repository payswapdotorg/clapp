/**
 * @clapp/learn — the repair-pattern miner (CLAPP-061, the P6 second lane —
 * Worker 2, Behavioral Model and Package Learning, the learning-records
 * owner per docs/WORKER_HANDOFFS.md).
 *
 * docs/LEARNING_AND_LIBRARY.md §7: "A repeated failure should produce a
 * reusable guard, test, or package correction." CLAPP-060 is the RECORD +
 * STORE half of that law; THIS module is the DERIVATION half: it mines the
 * failure memory's stored events for REPEATED failure signatures with
 * POSITIVE repair evidence, and mints repair-pattern CANDIDATES — derived,
 * never guessed (§8's contamination-guard spirit: a pattern is minted only
 * from REAL recorded evidence — every support number is MEASURED from the
 * events given, never asserted).
 *
 * THE CONTRACT (v0.1): `mineRepairPatterns(events)` consumes the failure
 * memory's stored-event shape (FailureRecord literals — typically
 * `memory.list()`) and returns a MiningResult: zero or more RepairPattern
 * candidates, or a fail-closed error list. Groups are keyed by the
 * signature TRIPLE (dimension + severity + summary) — the findingId is
 * the per-event ANCHOR, never a key: recurrences across finding ids share
 * a signature (a re-run mints fresh finding ids for the same divergence —
 * the 060 event-identity rule). Every group yields EXACTLY ONE candidate
 * entry, emitted in canonical signature order (dimension, then severity,
 * then summary).
 *
 * THE STATUS CASCADE (fail-closed, checked in order — the anchor mints
 * the pattern, the honest split rides in the measured support):
 * 1. 'repair-pattern' — total >= 2 AND at least one event resolved AND
 *    the resolved events carry at least one resolvedFindingId (the
 *    reusable anchor exists). Minted WITH the measured support (the
 *    resolved/total split included) and the anchor union.
 * 2. 'insufficient-evidence' — total < 2 (a single event never becomes a
 *    pattern — no generalization from one example), OR total >= 2 with
 *    resolved === 0 (recurrence with no repair success anywhere — the
 *    recurrence itself is knowledge; 064's benchmarks will weigh it), OR
 *    every event resolved but zero resolvedFindingIds recorded anywhere
 *    (resolution with nothing reusable to anchor a guard on — the
 *    exhaustive closure of the three-status contract).
 * 3. 'unresolved-dominant' — total >= 2 AND resolved >= 1 AND resolved <
 *    total AND no resolvedFindingId on any resolved event: the repair
 *    SOMETIMES works, and the unresolved class dominates the verdict;
 *    the reasons name the measured ratio.
 *
 * Discipline (binding — the 060 store + promotion-gate precedents):
 * - Fail closed: a non-array input, or ANY invalid entry, is a collected
 *   error with its index and field named — ALL errors, never just the
 *   first; results, never exceptions; nothing is mined from partial data.
 * - Determinism: no clock, no randomness, no network, no filesystem —
 *   nothing but the events enters. The same events in ANY input order
 *   produce a deep-equal patterns array with identical ids (canonical
 *   signature order; content-addressed identities).
 * - The miner never mutates its inputs: it reads each event's signature
 *   and repair facts, and every pattern field is a FRESH value (the
 *   anchors union is a fresh sorted array; the signature object is a
 *   fresh literal).
 * - Counts are measured, never asserted: total/resolved/generalized and
 *   the anchors union are measured from the events given.
 * - Patterns are CANDIDATES: this module mines and reports; deciding
 *   which patterns become guards, tests, or package corrections is the
 *   tech lead's and later lanes' call (062 archetypes, 063 composition,
 *   064 benchmarks). v0.1 mines patterns ONLY — no policy (§9: repair-
 *   policy learning is future model improvement).
 *
 * Non-degeneracy rule (binding, the 060 discipline): the miner consumes
 * contract-shaped DATA. The runtime dependencies are exactly @clapp/core
 * (sha256Hex) and @clapp/observe (canonicalJson); @clapp/diff is a
 * devDependency imported for TYPES ONLY, and the frozen vocabulary's
 * RUNTIME string values are pinned here as literals. FAILURE_VERSION is
 * imported (in-package, relative) from the frozen failure-memory module —
 * the drift-proof admission pin: the miner accepts exactly the events the
 * frozen contract versions. The admission gate below validates the fields
 * the miner consumes (failureVersion, id shape, signature, repair,
 * observedAt); the fields it does not consume (packageRef, target,
 * context, expected, actual) are the memory's own admission business
 * (060's gate guaranteed them for stored events).
 */

import { sha256Hex } from '@clapp/core';
import { canonicalJson } from '@clapp/observe';
import type { DiffDimension, DiffSeverity } from '@clapp/diff';

import { FAILURE_VERSION } from './failure-memory';
import type { FailureRecord } from './failure-memory';

// ---- the frozen diff-contract v0.1 vocabulary (TYPE-pinned literals) ---------------

/**
 * The frozen DiffDimension vocabulary (diff-contract v0.1, canonical owner
 * @clapp/diff — CLAPP-040). Pinned as literals (the 060 discipline): the
 * miner validates contract-shaped DATA against these exact strings.
 */
const DIFF_DIMENSIONS: readonly DiffDimension[] = ['semantic', 'visual', 'network', 'state'];

/**
 * The frozen DiffSeverity vocabulary (diff-contract v0.1, canonical owner
 * @clapp/diff — CLAPP-040).
 */
const DIFF_SEVERITIES: readonly DiffSeverity[] = ['critical', 'major', 'minor', 'info'];

// ---- internal shared helpers (module-level; NOT re-exported by src/index.ts) ------

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

/**
 * RFC3339 check: lexical shape + REAL calendar validity — the house helper
 * discipline (the 060 failure-memory precedent, itself from
 * @clapp/library package-contract.ts), copied because the runtime
 * dependency set is exactly @clapp/core + @clapp/observe. `Date.parse` is
 * deliberately NOT used — it accepts rollover dates such as 2026-02-30.
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

// ---- the repair-pattern contract v0.1 ----------------------------------------------

/** The repair-pattern contract version (bumps only via a tech-lead declaration wave). */
export const PATTERN_VERSION = '0.1';

/**
 * The mined pattern-id prefix — THIS lane's frozen proposal in the
 * `pkg_` / `cgraph_` / `rq_` / `creg_` / `fail_` / `fmem_` prefix
 * discipline: `rpat_` + 64 lowercase hex chars. Changing it changes every
 * minted id and requires a contract version bump.
 */
const PATTERN_ID_PREFIX = 'rpat_';

/** A mined repair-pattern CANDIDATE — derived, never guessed. */
export interface RepairPattern {
  /** MUST equal PATTERN_VERSION ('0.1') in v0. */
  patternVersion: string;
  /** Content-addressed: 'rpat_' + sha256Hex(canonicalJson(pattern minus id)). */
  id: string;
  /** The signature the pattern covers — VERBATIM from the events (dimension + severity + summary; the findingId is the per-event anchor, not part of the pattern). */
  signature: { dimension: string; severity: string; summary: string };
  /** MEASURED support: the events sharing this signature. */
  support: {
    /** All events with this signature (measured). */
    total: number;
    /** Events with repair.resolved === true (measured). */
    resolved: number;
    /** Events with repair.generalized === true (measured). */
    generalized: number;
  };
  /** The pattern's verdict — derived fail-closed (the cascade above). */
  status: 'repair-pattern' | 'insufficient-evidence' | 'unresolved-dominant';
  /** The reusable anchors, VERBATIM from the resolved events (sorted, deduped). */
  anchors: {
    /** The union of the resolved events' resolvedFindingIds. */
    resolvedFindingIds: string[];
  };
  /** Honest, sorted, deduped; each names a measured fact. */
  reasons: string[];
}

/** Fail-closed mining: a result, never an exception. */
export type MiningResult =
  | { ok: true; patterns: RepairPattern[] }
  | { ok: false; errors: string[] };

// ---- the admission gate (fail-closed: ALL errors collected, index + field named) ----

/**
 * Validates ONE entry as a FailureRecord over the frozen contract — the
 * packet's enumerated gate: failureVersion, the 'fail_' id prefix, a
 * well-formed signature over the frozen diff-contract vocabulary, the
 * repair facts, and a calendar-valid RFC3339 observedAt. Collects every
 * error into `errors` (never just the first) and returns whether the
 * entry is valid; never throws.
 */
function validateFailureEvent(entry: unknown, index: number, errors: string[]): boolean {
  const where = `events[${index}]`;
  if (!isObject(entry)) {
    errors.push(
      `${where}: expected an object (a FailureRecord — the failure memory's stored event shape), got ${preview(entry)}`,
    );
    return false;
  }
  let valid = true;

  if (entry['failureVersion'] !== FAILURE_VERSION) {
    errors.push(
      `${where}.failureVersion: expected "${FAILURE_VERSION}" (FAILURE_VERSION — the frozen failure-memory contract), got ${preview(entry['failureVersion'])}`,
    );
    valid = false;
  }

  // The prefix check ONLY — the memory's own content-addressed ids are its
  // business (the miner never re-derives them).
  const id = entry['id'];
  if (typeof id !== 'string' || !id.startsWith('fail_')) {
    errors.push(
      `${where}.id: expected a 'fail_'-prefixed string (the failure memory's content-addressed event id), got ${preview(id)}`,
    );
    valid = false;
  }

  const signature = entry['signature'];
  if (!isObject(signature)) {
    errors.push(
      `${where}.signature: expected an object { dimension, severity, findingId, summary }, got ${preview(signature)}`,
    );
    valid = false;
  } else {
    const dimension = signature['dimension'];
    if (
      typeof dimension !== 'string' ||
      !(DIFF_DIMENSIONS as readonly string[]).includes(dimension)
    ) {
      errors.push(
        `${where}.signature.dimension: expected one of the frozen diff-contract dimensions ("semantic" | "visual" | "network" | "state"), got ${preview(dimension)}`,
      );
      valid = false;
    }

    const severity = signature['severity'];
    if (
      typeof severity !== 'string' ||
      !(DIFF_SEVERITIES as readonly string[]).includes(severity)
    ) {
      errors.push(
        `${where}.signature.severity: expected one of the frozen diff-contract severities ("critical" | "major" | "minor" | "info"), got ${preview(severity)}`,
      );
      valid = false;
    }

    const findingId = signature['findingId'];
    if (typeof findingId !== 'string' || findingId.length === 0) {
      errors.push(
        `${where}.signature.findingId: expected a non-empty string (the per-event anchor), got ${preview(findingId)}`,
      );
      valid = false;
    }

    const summary = signature['summary'];
    if (typeof summary !== 'string' || summary.length === 0) {
      errors.push(
        `${where}.signature.summary: expected a non-empty string (the finding's one-sentence divergence), got ${preview(summary)}`,
      );
      valid = false;
    }
  }

  const repair = entry['repair'];
  if (!isObject(repair)) {
    errors.push(
      `${where}.repair: expected an object { attempted, resolved, resolvedFindingIds, generalized }, got ${preview(repair)}`,
    );
    valid = false;
  } else {
    if (typeof repair['attempted'] !== 'boolean') {
      errors.push(
        `${where}.repair.attempted: expected a boolean, got ${preview(repair['attempted'])}`,
      );
      valid = false;
    }

    if (typeof repair['resolved'] !== 'boolean') {
      errors.push(
        `${where}.repair.resolved: expected a boolean, got ${preview(repair['resolved'])}`,
      );
      valid = false;
    }

    const resolvedFindingIds = repair['resolvedFindingIds'];
    if (!Array.isArray(resolvedFindingIds)) {
      errors.push(
        `${where}.repair.resolvedFindingIds: expected an array of non-empty strings (the repair attempts' resolved ids), got ${preview(resolvedFindingIds)}`,
      );
      valid = false;
    } else {
      let entriesValid = true;
      resolvedFindingIds.forEach((resolvedId: unknown, resolvedIndex: number) => {
        if (typeof resolvedId !== 'string' || resolvedId.length === 0) {
          errors.push(
            `${where}.repair.resolvedFindingIds[${resolvedIndex}]: expected a non-empty string, got ${preview(resolvedId)}`,
          );
          entriesValid = false;
        }
      });
      if (!entriesValid) {
        valid = false;
      }
    }

    const generalized = repair['generalized'];
    if (typeof generalized !== 'boolean' && generalized !== null) {
      errors.push(
        `${where}.repair.generalized: expected a boolean or null (caller-judged; null when unknown), got ${preview(generalized)}`,
      );
      valid = false;
    }
  }

  const observedAt = entry['observedAt'];
  if (!isRfc3339(observedAt)) {
    errors.push(
      `${where}.observedAt: expected an RFC3339 date-time string (calendar-valid — rollover dates such as 2026-02-30 are refused), got ${preview(observedAt)}`,
    );
    valid = false;
  }

  return valid;
}

/** Canonical emission order: dimension, then severity, then summary (house comparison). */
function compareSignatureGroups(left: FailureRecord, right: FailureRecord): number {
  const a = left.signature;
  const b = right.signature;
  if (a.dimension !== b.dimension) return a.dimension < b.dimension ? -1 : 1;
  if (a.severity !== b.severity) return a.severity < b.severity ? -1 : 1;
  if (a.summary !== b.summary) return a.summary < b.summary ? -1 : 1;
  return 0;
}

// ---- the repair-pattern miner --------------------------------------------------------

/**
 * Mines repair-pattern CANDIDATES from failure events (FailureRecord
 * literals — typically `createFailureMemory().list()`). Async because the
 * pattern ids hash (sha256Hex over the canonical pattern body).
 *
 * Fail closed: a non-array input or ANY invalid entry returns
 * `{ ok: false, errors }` with every error collected (index + field
 * named) — never an exception, and nothing mined from partial data.
 * Deterministic: the same events in ANY input order produce a deep-equal
 * patterns array (canonical signature order) with identical ids; the
 * module never reads a clock, never mutates its inputs, and touches
 * nothing but the events given.
 */
export async function mineRepairPatterns(events: unknown): Promise<MiningResult> {
  if (!Array.isArray(events)) {
    return {
      ok: false,
      errors: [
        `events: expected an array of failure events (FailureRecord-shaped — the failure memory's stored events), got ${preview(events)}`,
      ],
    };
  }

  // ---- the admission gate: EVERY entry validated, ALL errors collected ----
  const errors: string[] = [];
  const records: FailureRecord[] = [];
  events.forEach((entry: unknown, index: number) => {
    if (validateFailureEvent(entry, index, errors)) {
      records.push(entry as FailureRecord);
    }
  });
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // ---- group by signature: dimension + severity + summary ----
  // The findingId is the per-event ANCHOR, never a key: recurrences across
  // finding ids share a signature. The map key is the canonical JSON of the
  // triple (injective over string triples — no collision is possible).
  const groups = new Map<string, FailureRecord[]>();
  for (const record of records) {
    const key = canonicalJson([
      record.signature.dimension,
      record.signature.severity,
      record.signature.summary,
    ]);
    const bucket = groups.get(key);
    if (bucket === undefined) {
      groups.set(key, [record]);
    } else {
      bucket.push(record);
    }
  }

  // ---- emit in canonical signature order (dimension, then severity, then summary) ----
  const orderedGroups = [...groups.values()].sort((left, right) =>
    compareSignatureGroups(left[0]!, right[0]!),
  );

  const patterns: RepairPattern[] = [];
  for (const group of orderedGroups) {
    // ---- MEASURE (never assert) ----
    const total = group.length;
    const resolvedEvents = group.filter((record) => record.repair.resolved === true);
    const resolved = resolvedEvents.length;
    const generalized = group.filter((record) => record.repair.generalized === true).length;
    // The union of the RESOLVED events' resolvedFindingIds (verbatim values,
    // sorted + deduped in a fresh array — an unresolved event's partial
    // fixes never enter the anchor union).
    const anchors = [...new Set(resolvedEvents.flatMap((record) => record.repair.resolvedFindingIds))].sort();

    // ---- the status cascade (fail-closed, in order — the anchor mints the
    // pattern; the honest split rides in the measured support) ----
    let status: RepairPattern['status'];
    if (total < 2) {
      status = 'insufficient-evidence';
    } else if (resolved === 0) {
      status = 'insufficient-evidence';
    } else if (anchors.length >= 1) {
      status = 'repair-pattern';
    } else if (resolved < total) {
      status = 'unresolved-dominant';
    } else {
      // Every event resolved but zero resolvedFindingIds recorded anywhere —
      // resolution with nothing reusable to anchor a guard on: the honest
      // closure of the three-status contract (never a guessed pattern).
      status = 'insufficient-evidence';
    }

    // ---- the reasons: honest, each naming a measured fact ----
    const reasons: string[] = [
      `measured support: ${total} ${total === 1 ? 'event' : 'events'} with this signature, ${resolved} resolved, ${generalized} generalized`,
    ];
    if (status === 'insufficient-evidence') {
      if (total < 2) {
        reasons.push(
          'insufficient recurrence: 1 event with this signature — a single event never becomes a pattern (no generalization from one example)',
        );
      } else if (resolved === 0) {
        reasons.push(
          `no event ever resolved: 0 of ${total} events resolved — no resolved repair to anchor a guard on`,
        );
      } else {
        reasons.push(
          `all ${total} events resolved but none carries a resolvedFindingId — no reusable anchor to mint a guard on`,
        );
      }
    } else if (status === 'repair-pattern') {
      reasons.push(`recurrence with positive repair evidence: ${resolved} of ${total} events resolved`);
      reasons.push(
        `reusable anchors: ${anchors.length} resolvedFindingId${anchors.length === 1 ? '' : 's'} in the resolved events' union`,
      );
    } else {
      reasons.push(
        `partial resolution: ${resolved} of ${total} events resolved — the repair sometimes works`,
      );
      reasons.push(
        'no resolvedFindingId recorded on the resolved events — no reusable anchor to mint a guard on',
      );
    }

    // ---- the content-addressed pattern identity ----
    // The pattern MINUS its id is the minting input (the fail_/fmem_
    // discipline): same id ⇔ identical canonical pattern bytes — any
    // measured change (support, status, anchors, reasons) moves the id.
    const patternBody: Omit<RepairPattern, 'id'> = {
      patternVersion: PATTERN_VERSION,
      signature: {
        dimension: group[0]!.signature.dimension,
        severity: group[0]!.signature.severity,
        summary: group[0]!.signature.summary,
      },
      support: { total, resolved, generalized },
      status,
      anchors: { resolvedFindingIds: anchors },
      reasons: [...new Set(reasons)].sort(),
    };

    // The last line of defense (the 060 precedent): a canonicalization
    // refusal is a NAMED error — never an escaped exception. (The body is
    // built from validated strings and numbers, so this cannot fire in
    // practice — the discipline is kept unconditional anyway.)
    let canonical: string;
    try {
      canonical = canonicalJson(patternBody);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        errors: [
          `pattern minting: the derived pattern is not canonical-JSON serializable (${detail})`,
        ],
      };
    }
    const id = `${PATTERN_ID_PREFIX}${await sha256Hex(canonical)}`;

    patterns.push({ ...patternBody, id });
  }

  // Zero groups (an empty event list) is legal: zero patterns, counted
  // honestly — an honest empty mining.
  return { ok: true, patterns };
}
