/**
 * @clapp/security — resource budgets (CLAPP-075, the P7 closing lane —
 * Worker 1, Observation and Platform Adapters, the lane's owner per
 * docs/WORK_ITEMS.md: "CLAPP-075 — Resource budgets, Owner W1, Depends
 * on: 074" — landed).
 *
 * docs/SECURITY_AND_AUTHORIZATION.md §4 is the production-hardening
 * spine this module closes: "Generated applications and untrusted
 * target artifacts must run inside isolation with: filesystem
 * boundaries; CPU/memory budgets; process limits; network
 * allowlists/egress controls; execution timeouts; artifact quotas."
 * `createBudgetAccount` mints that spine's MEASURABLE core: the frozen
 * six-axis budget envelope, the fail-closed usage accounting, and the
 * content-addressed account state — the accounting truth a runtime
 * reports its enforcement against.
 *
 * THE SIX §4 BUDGET AXES (the frozen v0.1 vocabulary — every axis a
 * positive-integer limit in its own unit):
 *   - 'cpu-ms'               CPU budget in milliseconds   (§4 "CPU/memory budgets", the CPU side)
 *   - 'memory-mb'            memory budget in megabytes   (§4 "CPU/memory budgets", the memory side)
 *   - 'process-count'        concurrent process limit      (§4 "process limits")
 *   - 'filesystem-bytes'     artifact/storage quota        (§4 "filesystem boundaries" + "artifact quotas" — the quota is the measurable form of both; the boundary itself is the §6 isolation lane's concern)
 *   - 'network-egress-count' allowed egress events         (§4 "network allowlists/egress controls" — the count is the measurable form; the allowlist content is the runtime's)
 *   - 'timeout-ms'           execution timeout             (§4 "execution timeouts")
 *
 * THE OVER-BUDGET REFUSAL LAW (the §4 boundary law, binding): a usage
 * that would carry an axis's recorded total OVER its limit is REFUSED —
 * a named error, the usage NOT recorded — a refused charge NEVER
 * consumes; the boundary refuses, it never silently overdraws. A usage
 * that lands EXACTLY at the limit is allowed (remaining 0 — the next
 * usage on that axis refuses).
 *
 * THE MULTISET STATE LAW: the account's observable state is the
 * MULTISET of accounted charges. `snapshot()` re-sorts the recorded
 * usages by (axis, usedAt, amount) before hashing, so the same charges
 * accounted in ANY order produce the identical `budget_` snapshot. The
 * REFUSAL sequence depends on order (800 then 200 refuses a third 400;
 * 400, 400, then 200 does not); the recorded state does not.
 *
 * Discipline (binding — the 070..074 house rules, mirroring
 * authorization.ts, redaction.ts, isolation.ts, audit.ts, and
 * readiness.ts, and the docs/WORKER_HANDOFFS.md acceptance rules):
 * - Fail closed: `createBudgetAccount` and `use` collect EVERY field
 *   error in a { ok: false, errors } result (the list canonicalized —
 *   sorted, deduped), each error naming its field and carrying the
 *   observed value — results, never exceptions, for ANY input. A
 *   rejected envelope mints no account; a rejected usage records
 *   nothing.
 * - Determinism: no clock (usedAt is CALLER-injected and validated —
 *   RFC3339, calendar-valid; the account never reads a clock), no
 *   randomness, no network, no filesystem, no module-level mutable
 *   state — the closure is the boundary, separate accounts share
 *   NOTHING.
 * - The module never mutates its inputs; the envelope is stored
 *   VERBATIM (by value: a deep copy preserving every key and value
 *   exactly, never normalized — extra caller keys ride along and
 *   honestly move the snapshot, the 070 statement precedent).
 * - THE ACCOUNT IS SEALED: every value handed out — `envelope()`,
 *   `used()`, `remaining()` — is a FRESH deep copy. There is no alias
 *   channel: no caller can silently rewrite the account's state
 *   through an object they were handed (the 073 sealed-trail law).
 * - `remaining`/`used` are MEASURED from the recorded usages (never
 *   asserted, never estimated), fresh objects per call, projected in
 *   the frozen axis order, and carry ONLY axes that have recorded
 *   charges (the 073 countsByKind precedent).
 *
 * Sketch resolutions, disclosed (the CLAPP-073 OperationResult
 * precedent — the binding prose supersedes an earlier sketch, and the
 * resolution is documented rather than hidden):
 * - `use` is ASYNC (`Promise<BudgetResult>`): the frozen interface
 *   pins the signature. The account's state channel (`snapshot()`)
 *   mints content-addressed digests through WebCrypto `sha256Hex` —
 *   async by design; `use` mints no digest today (v0.1 has no per-
 *   usage id law — the recorded charge is the three validated fields),
 *   but it is the mutating surface a later contract version would
 *   stamp, and the signature a frozen interface cannot quietly narrow.
 * - The envelope is admitted CANONICAL-SERIALIZABLE or refused: the
 *   verbatim envelope rides into every `budget_` snapshot, so a value
 *   the canonicalizer could never hash is refused at ADMISSION with a
 *   named error (the 073 facts precedent — refuse at record time what
 *   the snapshot channel could never hash). The six axis limits are
 *   validated positive integers (always hashable); it is the extra
 *   verbatim keys this check guards.
 *
 * Honest v0.1 scope: this module is the budget CONTRACT + the
 * enforcement ACCOUNTING — the measurable, honest core. OS-level
 * enforcement (cgroups, containers, process walls, kernel egress
 * filters) is the deployment runtime's concern, documented as the
 * boundary: the runtime enforces, the account is the accounting truth
 * the runtime reports against. A usage's `amount` is the CALLER's own
 * measurement — the account weighs it, never fabricates it.
 */

import { sha256Hex } from '@clapp/core';
import { canonicalJson } from '@clapp/observe';

// ---- the frozen six-axis vocabulary (TYPE-pinned literals) --------------------------

/**
 * The frozen §4 budget axes (security contract v0.1). Pinned as
 * literals: the module validates contract-shaped DATA against these
 * exact strings; importing them from any implementation would import
 * that implementation's behavior.
 */
const BUDGET_AXES: readonly BudgetAxis[] = [
  'cpu-ms',
  'memory-mb',
  'process-count',
  'filesystem-bytes',
  'network-egress-count',
  'timeout-ms',
];

/** The frozen axes, rendered for error messages (the observed-value law). */
const AXES_FOR_MESSAGES = BUDGET_AXES.map((axis) => JSON.stringify(axis)).join(' | ');

/**
 * The axis → envelope-field mapping (the frozen v0.1 correspondence):
 * each axis's positive-integer limit lives in exactly one named
 * envelope field, and each envelope field backs exactly one axis.
 */
const AXIS_TO_FIELD: Readonly<Record<BudgetAxis, keyof BudgetEnvelope>> = {
  'cpu-ms': 'cpuMs',
  'memory-mb': 'memoryMb',
  'process-count': 'processCount',
  'filesystem-bytes': 'filesystemBytes',
  'network-egress-count': 'networkEgressCount',
  'timeout-ms': 'timeoutMs',
};

// ---- internal shared helpers (module-level; NOT re-exported by src/index.ts) --------

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

/** Error detail for a caught unknown (the house helper). */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
 * (@clapp/library package-contract.ts), copied because this module's
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

/** A positive-integer guard (envelope limits are strictly positive integers). */
function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/** A non-negative-integer guard (MEASURED amounts are never negative or fractional). */
function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/** Plain-value deep copy (envelopes are JSON-shaped; no class instances). */
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

/** Fail-closed error list, canonicalized (sorted, deduped) — the house discipline. */
function canonicalErrors(errors: string[]): string[] {
  return [...new Set(errors)].sort();
}

/**
 * Canonical usage order — (axis, usedAt, amount) — the multiset law's
 * sort: the recorded charges re-sorted into this order before hashing,
 * so usage-order permutations of the same multiset produce the identical
 * snapshot (identical entries are interchangeable, so the three-key
 * comparison is a total order over distinct content).
 */
function byAxisTimeAmount(a: BudgetUsage, b: BudgetUsage): number {
  if (a.axis !== b.axis) return a.axis < b.axis ? -1 : 1;
  if (a.usedAt !== b.usedAt) return a.usedAt < b.usedAt ? -1 : 1;
  return a.amount < b.amount ? -1 : a.amount > b.amount ? 1 : 0;
}

// ---- the budget contract v0.1 -------------------------------------------------------

/** The budget contract version (bumps only via a tech-lead declaration wave). */
export const BUDGETS_VERSION = '0.1';

/**
 * The account-snapshot prefix — THIS lane's frozen proposal in the
 * `pkg_` / `cgraph_` / `rq_` / `creg_` / `fail_` / `fmem_` / `rpat_` /
 * `arch_` / `comp_` / `bench_` / `authz_` / `redct_` / `iso_` /
 * `audit_` / `atrail_` / `ready_` prefix discipline: `budget_` + 64
 * lowercase hex chars. Changing it changes every account snapshot and
 * requires a contract version bump.
 */
const BUDGET_SNAPSHOT_PREFIX = 'budget_';

/** The snapshot shape the account mints: `budget_` + 64 lowercase hex chars. */
export const BUDGET_SNAPSHOT_PATTERN = /^budget_[0-9a-f]{64}$/;

/** The §4 budget axes (the frozen v0.1 vocabulary). */
export type BudgetAxis =
  | 'cpu-ms' // CPU budget in milliseconds
  | 'memory-mb' // memory budget in megabytes
  | 'process-count' // concurrent process limit
  | 'filesystem-bytes' // artifact/storage quota
  | 'network-egress-count' // allowed egress events
  | 'timeout-ms'; // execution timeout

/** A budget envelope: per-axis limits (all positive integers). */
export interface BudgetEnvelope {
  cpuMs: number;
  memoryMb: number;
  processCount: number;
  filesystemBytes: number;
  networkEgressCount: number;
  timeoutMs: number;
}

/** One enforcement event — a measured usage against its axis. */
export interface BudgetUsage {
  axis: BudgetAxis;
  /** MEASURED: the consumed quantity (non-negative integer — the caller's own measurement). */
  amount: number;
  /** RFC3339 — CALLER-injected; the module never reads a clock. */
  usedAt: string;
}

/** The account result. */
export type BudgetResult =
  | { ok: true; remaining: number } // the measured remaining budget
  | { ok: false; errors: string[] }; // fail-closed — results, never exceptions

/** Fail-closed account admission: a result, never an exception. */
export type BudgetAccountResult =
  | { ok: true; account: BudgetAccount }
  | { ok: false; errors: string[] };

/**
 * A budget account: the fail-closed, measured accounting surface over
 * one frozen envelope. One in-memory object per `createBudgetAccount()`
 * — separate instances share NOTHING (no module-level state, the
 * closure is the boundary).
 */
export interface BudgetAccount {
  /**
   * The frozen envelope (VERBATIM — a fresh deep copy per call: a deep
   * copy of every key and value exactly as admitted, extra caller keys
   * included; the caller can never mutate the account's envelope
   * through the object they are handed, nor through the object they
   * passed in — it was stored by value).
   */
  envelope(): BudgetEnvelope;
  /**
   * Account a MEASURED usage against its axis. Over-budget REFUSES.
   * Fail-closed: axis IN the frozen six-axis vocabulary (an unknown
   * axis is a named error carrying the observed value), amount a
   * non-negative integer, usedAt a calendar-valid RFC3339 date-time —
   * ALL errors collected, never an exception, and a rejected usage
   * records nothing. Then the accounting, against the axis's limit:
   * within budget → `{ ok: true, remaining }` with the MEASURED
   * remaining and the usage RECORDED; over budget → REFUSED with the
   * named exceedance and the usage NOT recorded (a refused charge
   * never consumes); exactly at the limit → allowed, remaining 0.
   */
  use(usage: unknown): Promise<BudgetResult>;
  /**
   * MEASURED remaining per axis (only axes with recorded charges;
   * fresh values) — each axis's envelope limit minus its recorded
   * total, recomputed from the recorded usages on every call, never
   * cached, never asserted.
   */
  remaining(): Record<string, number>;
  /** MEASURED total used per axis (only axes with recorded charges; fresh values). */
  used(): Record<string, number>;
  /**
   * Content-addressed account snapshot: `'budget_' + sha256Hex(
   * canonicalJson({ budgetsVersion, envelope, usages: the canonically
   * sorted charges }))` — the charges re-sorted by (axis, usedAt,
   * amount) before hashing, so the same multiset accounted in ANY
   * order produces the identical snapshot and any new charge moves it.
   * The empty account (no charges) hashes the empty charge list — a
   * valid digest. The envelope was validated canonical-serializable at
   * admission and the account is sealed (no alias channel), so this
   * channel cannot fail on a well-formed account.
   */
  snapshot(): Promise<string>;
}

// ---- the budget account factory (the §4 accounting truth) ---------------------------

/**
 * Mint a budget account over a frozen envelope. Fail-closed: the
 * envelope must be a plain object carrying EVERY axis's limit as a
 * positive integer — a zero, negative, fractional, or missing limit is
 * a named error carrying the observed value, and ALL errors are
 * collected (the list sorted and deduped); the envelope must moreover
 * be canonical-JSON serializable whole (it rides verbatim into every
 * snapshot — the disclosed admission check). The admission NEVER
 * throws: a malformed envelope is a { ok: false, errors } result, and
 * no account is minted.
 *
 * The admitted envelope is stored VERBATIM (by value — a deep copy
 * preserving every key and value exactly, never normalized; extra
 * caller keys ride along and honestly move the snapshot); the account
 * starts with zero recorded charges and never reads a clock.
 */
export function createBudgetAccount(envelope: unknown): BudgetAccountResult {
  const errors: string[] = [];

  if (!isObject(envelope)) {
    return {
      ok: false,
      errors: canonicalErrors([
        `envelope: expected an object { cpuMs, memoryMb, processCount, filesystemBytes, networkEgressCount, timeoutMs }, got ${preview(envelope)}`,
      ]),
    };
  }

  // ---- every axis a positive integer — ALL errors collected, each
  // naming its field and carrying the observed value ----
  const validated: Partial<Record<BudgetAxis, number>> = {};
  for (const axis of BUDGET_AXES) {
    const field = AXIS_TO_FIELD[axis];
    const limit = envelope[field];
    if (isPositiveInteger(limit)) {
      validated[axis] = limit;
    } else {
      errors.push(
        `envelope.${field}: expected a positive integer (the ${JSON.stringify(axis)} axis limit), got ${preview(limit)}`,
      );
    }
  }

  // ---- the snapshot channel's law, enforced at admission (the 073
  // facts precedent): the envelope rides VERBATIM into every budget_
  // snapshot, so a value the canonicalizer could never hash is refused
  // HERE, by name — never as an escaped exception in snapshot() ----
  try {
    canonicalJson(envelope);
  } catch (error) {
    errors.push(
      `envelope: not canonical-JSON serializable (${messageOf(error)}) — the envelope rides verbatim into every snapshot, so every value must be plain JSON data`,
    );
  }

  // ---- fail closed: no account is minted unless every axis admitted ----
  if (errors.length > 0) {
    return { ok: false, errors: canonicalErrors(errors) };
  }

  // Validated above (every invalid shape returned already) — narrowed
  // by the admission, the house cast discipline (authorization.ts).
  const limits = validated as Record<BudgetAxis, number>;

  // ---- the account's private store ----
  // The frozen envelope, VERBATIM by value (the deep copy severs every
  // alias to the caller's input; extra keys ride along).
  const storedEnvelope = deepCopyValue(envelope) as BudgetEnvelope;
  // The recorded charges, in accounting (append) order — the sequence
  // the REFUSALS depend on; the snapshot re-sorts canonically (the
  // multiset law), so only the multiset is observable state.
  const recorded: BudgetUsage[] = [];

  /** MEASURED per-axis totals over the recorded charges (the one aggregation channel). */
  const measuredTotals = (): Map<BudgetAxis, number> => {
    const totals = new Map<BudgetAxis, number>();
    for (const charge of recorded) {
      totals.set(charge.axis, (totals.get(charge.axis) ?? 0) + charge.amount);
    }
    return totals;
  };

  const use = async (usage: unknown): Promise<BudgetResult> => {
    const useErrors: string[] = [];

    if (!isObject(usage)) {
      return {
        ok: false,
        errors: canonicalErrors([
          `usage: expected an object { axis, amount, usedAt }, got ${preview(usage)}`,
        ]),
      };
    }

    // ---- validations (ALL collected, each naming its field) ----
    const axisValue = usage['axis'];
    if (typeof axisValue !== 'string' || !(BUDGET_AXES as readonly string[]).includes(axisValue)) {
      useErrors.push(
        `axis: expected one of the frozen v0.1 budget axes (${AXES_FOR_MESSAGES}), got ${preview(axisValue)}`,
      );
    }

    const amountValue = usage['amount'];
    if (!isNonNegativeInteger(amountValue)) {
      useErrors.push(
        `amount: expected a non-negative integer (the MEASURED consumed quantity — the caller's own measurement), got ${preview(amountValue)}`,
      );
    }

    const usedAtValue = usage['usedAt'];
    if (!isRfc3339(usedAtValue)) {
      useErrors.push(
        `usedAt: expected an RFC3339 date-time string (caller-injected — the account never reads a clock), got ${preview(usedAtValue)}`,
      );
    }

    // ---- fail closed: nothing is recorded unless every field admitted ----
    if (useErrors.length > 0) {
      return { ok: false, errors: canonicalErrors(useErrors) };
    }

    // Validated above — the house cast discipline.
    const axis = axisValue as BudgetAxis;
    const amount = amountValue as number;
    const limit = limits[axis];
    const total = measuredTotals().get(axis) ?? 0;

    // ---- the over-budget refusal law ----
    if (total + amount > limit) {
      // REFUSED — the named exceedance, and the charge is NOT recorded:
      // a refused charge never consumes (the boundary refuses, it
      // never silently overdraws).
      return {
        ok: false,
        errors: canonicalErrors([
          `budget exceeded: ${axis} usage ${amount} would total ${total + amount} over the ${limit} limit`,
        ]),
      };
    }

    // Within budget, or EXACTLY at the limit (remaining 0 — the next
    // usage on this axis refuses): the charge is RECORDED and the
    // MEASURED remaining returned — computed, never asserted.
    // (usedAtValue validated above — the house cast discipline, audit.ts.)
    recorded.push({ axis, amount, usedAt: usedAtValue as string });
    return { ok: true, remaining: limit - (total + amount) };
  };

  const used = (): Record<string, number> => {
    // MEASURED per axis, only axes with recorded charges, a fresh
    // record every call — projected in the frozen axis order so the
    // record is stable across accounts holding the same charges in
    // different accounting orders (the 073 countsByKind precedent).
    const totals = measuredTotals();
    const measured: Record<string, number> = {};
    for (const axis of BUDGET_AXES) {
      const total = totals.get(axis);
      if (total !== undefined) {
        measured[axis] = total;
      }
    }
    return measured;
  };

  const remaining = (): Record<string, number> => {
    // MEASURED remaining per axis, only axes with recorded charges,
    // fresh values — each axis's own envelope limit minus its recorded
    // total, recomputed from the charges on every call.
    const totals = measuredTotals();
    const measured: Record<string, number> = {};
    for (const axis of BUDGET_AXES) {
      const total = totals.get(axis);
      if (total !== undefined) {
        measured[axis] = limits[axis] - total;
      }
    }
    return measured;
  };

  const snapshot = async (): Promise<string> => {
    // Content-addressed, accounting-order independent: the charges
    // re-sorted by (axis, usedAt, amount) — the multiset law — then
    // canonicalJson, then sha256Hex. The envelope was validated
    // canonical-serializable at admission and the account is sealed
    // (no alias channel), so this channel cannot fail on a well-formed
    // account. The empty account hashes the empty charge list — a
    // valid digest.
    const state = {
      budgetsVersion: BUDGETS_VERSION,
      envelope: storedEnvelope,
      usages: [...recorded].sort(byAxisTimeAmount),
    };
    return `${BUDGET_SNAPSHOT_PREFIX}${await sha256Hex(canonicalJson(state))}`;
  };

  const account: BudgetAccount = {
    // VERBATIM, sealed: a fresh deep copy per call — the caller can
    // never mutate the account's envelope through the handed-out object.
    envelope: () => deepCopyValue(storedEnvelope) as BudgetEnvelope,
    use,
    remaining,
    used,
    snapshot,
  };
  return { ok: true, account };
}
