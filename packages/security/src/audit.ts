/**
 * @clapp/security — the audit trail and the cancellation/resume state
 * machine (CLAPP-073, the P7 fourth lane — Worker 3, Synthesis,
 * Verification, and Repair, the lane's owner per docs/WORK_ITEMS.md:
 * "CLAPP-073 — Audit/cancellation/resume").
 *
 * docs/SECURITY_AND_AUTHORIZATION.md is the production-hardening spine,
 * and this module is the spine's RECORDING LAYER: the three security
 * surfaces that landed before it (the §1 authorized-session boundary,
 * CLAPP-070; the §3 secret redaction, CLAPP-071; the §6 tenant
 * isolation, CLAPP-072) all ACT — and their actions need to be
 * RECORDED, and the long operations those surfaces guard need to be
 * CANCELLABLE and RESUMABLE. `createAuditTrail` mints that record: an
 * append-only, content-addressed, fail-closed in-memory audit trail
 * plus the honest cancellation state machine whose every legal
 * transition is itself recorded as an audit event — the trail and the
 * state machine move TOGETHER.
 *
 * THE SEVEN RECORDED ACTION KINDS (the frozen v0.1 vocabulary — the
 * security surfaces that exist):
 *   - an authorization session was admitted  → 'session-admitted'
 *   - the §1 boundary refused                → 'observation-refused'
 *   - sensitive fields were redacted         → 'redaction-applied'
 *   - a datum entered an isolation zone      → 'zone-write'
 *   - a zone write was refused               → 'zone-refused'
 *   - a cancellable operation was cancelled  → 'operation-cancelled'
 *   - a cancelled operation was resumed      → 'operation-resumed'
 *
 * THE APPEND-ONLY LAW (the audit law, binding): once recorded, an event
 * is NEVER rewritten, NEVER removed, and NEVER re-recorded — the trail
 * stores events verbatim, insert-only (the fail-closed memory
 * precedent, CLAPP-060). The identical event content — including
 * recordedAt, because the timestamp is CONTENT — re-recorded into the
 * same trail is the DUPLICATE refusal. Two separate trails may of
 * course hold the same event content (separate instances share
 * NOTHING); the duplicate law is per-trail.
 *
 * THE HONEST STATE MACHINE (cancellation/resume, v0.1):
 *   running → cancelled   cancel; the MEASURED cancellationCount +1;
 *                         an 'operation-cancelled' event is recorded
 *   cancelled → resumed   resume; the count stands; an
 *                         'operation-resumed' event is recorded
 *   resumed → cancelled   the cycle CONTINUES — a resumed operation may
 *                         be cancelled again; each cancellation bumps
 *                         the measured count
 *   cancelled → cancelled REFUSED ("already cancelled")
 *   running → resumed    REFUSED ("not cancelled")
 *   resumed → resumed    REFUSED ("already resumed")
 * The single-slot `cancelledAt`/`resumedAt` fields carry the LATEST
 * transition's caller-injected timestamp; `cancellationCount` is the
 * cumulative MEASURED total — the honest v0.1 record of a cycling
 * operation.
 *
 * Discipline (binding — the house rules, mirroring authorization.ts,
 * redaction.ts, and isolation.ts and the docs/WORKER_HANDOFFS.md
 * acceptance rules):
 * - Fail closed: `record`, `registerOperation`, `cancel`, and `resume`
 *   collect EVERY field error in a { ok: false, errors } result (the
 *   list canonicalized — sorted, deduped) — results, never exceptions,
 *   for ANY input; a rejected write stores nothing. Queries never
 *   error: a non-string or unknown `operation(operationId)` is an
 *   honest null; `list()` and `countsByKind()` are the sealed channels.
 * - Determinism: no clock (recordedAt/registeredAt/cancelledAt/
 *   resumedAt are CALLER-injected and validated — RFC3339,
 *   calendar-valid; the trail never reads a clock), no randomness, no
 *   network, no filesystem, no module-level mutable state. The same
 *   events + operations in ANY order produce the identical `atrail_`
 *   snapshot (the events are canonically sorted by id before hashing —
 *   the input order never leaks).
 * - The module never mutates its inputs; events are stored VERBATIM
 *   (facts carried verbatim — a deep copy preserving every key and
 *   value exactly, never normalized, so the caller can never mutate a
 *   stored event through the object they passed in).
 * - THE TRAIL IS SEALED (a deliberate strengthening over the registry
 *   alias precedent): every event and every operation record handed to
 *   the caller — from `record`, `cancel`, `resume`,
 *   `registerOperation`, `list`, and `operation` — is a FRESH DEEP
 *   COPY. There is no alias channel at all: no caller can silently
 *   rewrite an audit record (the audit law — immutable once recorded).
 * - The state machine and the trail move TOGETHER: a legal cancel or
 *   resume mints its event FIRST (including the duplicate check) and
 *   only then mutates the operation record — a transition whose event
 *   would collide with an already-recorded identical event is refused
 *   WHOLE (neither the state nor the trail moves).
 * - operationId is CALLER-SUPPLIED (a non-empty opaque string — the
 *   module never generates one: determinism; there is no `oper_`
 *   prefix law in v0.1, the caller's naming discipline is the
 *   boundary).
 *
 * Two sketch resolutions, disclosed (the CLAPP-072 ZoneResult
 * precedent — the binding prose supersedes an earlier sketch, and the
 * resolution is documented rather than hidden):
 * - The three operation methods are ASYNC (`Promise<OperationResult>`):
 *   `cancel` and `resume` must mint content-addressed event ids, and
 *   the repo's content-addressing primitive is WebCrypto `sha256Hex` —
 *   async by design; `registerOperation` mints no event today but
 *   shares the mutating surface (a later contract version whose
 *   registration records an event would not change the signature). The
 *   rule this yields: every TRAIL MUTATION is async (it may mint an
 *   id); every query is synchronous except `snapshot` (which hashes).
 * - `OperationResult`'s ok branch carries `event?` — the event is
 *   present exactly when the transition moved the trail (cancel and
 *   resume record; registration does NOT: the seven-kind v0.1
 *   vocabulary has no registration kind, and the trail must hold
 *   exactly the cancelled/resumed events after register→cancel→resume).
 *   The sketch's `AuditResult & { operation?: … }` would have REQUIRED
 *   an `event` on every ok branch — a registration cannot carry one
 *   without fabricating an off-vocabulary event.
 *
 * Honest v0.1 scope: in-memory only — persistence, tamper-evident
 * external storage, and retention policy are later, tech-lead-declared
 * scope; the production readiness gate (CLAPP-074) is the tech lead's
 * lane, not this one. `registerOperation`'s `registeredAt` is validated
 * (the caller-injected-clock law holds at every mutation) and then
 * deliberately NOT retained: the frozen v0.1 CancellableOperation shape
 * carries no registration slot, and retaining an unobservable
 * timestamp would be unverifiable decoration.
 */

import { sha256Hex } from '@clapp/core';
import { canonicalJson } from '@clapp/observe';

// ---- the frozen seven-kind vocabulary (TYPE-pinned literals) -----------------------

/**
 * The frozen audit action kinds (security contract v0.1 — the security
 * surfaces that exist when this lane lands: the §1 boundary's two
 * outcomes, the §3 redaction report, the §6 zone's two outcomes, and
 * this lane's own two state-machine transitions). Pinned as literals:
 * the module validates contract-shaped DATA against these exact
 * strings; importing them from any implementation would import that
 * implementation's behavior.
 */
const AUDIT_ACTION_KINDS: readonly AuditActionKind[] = [
  'session-admitted',
  'observation-refused',
  'redaction-applied',
  'zone-write',
  'zone-refused',
  'operation-cancelled',
  'operation-resumed',
];

/** The frozen action kinds, rendered for error messages (the observed-value law). */
const KINDS_FOR_MESSAGES = AUDIT_ACTION_KINDS.map((kind) => JSON.stringify(kind)).join(' | ');

/**
 * The actor the state machine records its own transitions under — the
 * packet's frozen prose ("actor: 'system'"): the trail and the state
 * machine move together, and the mover is the system surface itself.
 */
const SYSTEM_ACTOR = 'system';

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

/** Plain-value deep copy (events and facts are JSON-shaped; no class instances). */
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

/** Canonical (UTF-16 code-unit) id comparator — the order canonicalJson sorts keys in. */
function byIdAscending(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// ---- the audit contract v0.1 -------------------------------------------------------

/** The audit contract version (bumps only via a tech-lead declaration wave). */
export const AUDIT_VERSION = '0.1';

/**
 * The event-id prefix — THIS lane's frozen proposal in the `pkg_` /
 * `cgraph_` / `rq_` / `creg_` / `fail_` / `fmem_` / `rpat_` / `arch_` /
 * `comp_` / `bench_` / `authz_` / `redct_` / `iso_` prefix discipline:
 * `audit_` + 64 lowercase hex chars. Changing it changes every recorded
 * event id and requires a contract version bump.
 */
const AUDIT_EVENT_PREFIX = 'audit_';

/**
 * The event-id shape the trail mints: `audit_` + 64 lowercase hex chars
 * (the repo's content-addressing primitive, sha256Hex's output).
 */
export const AUDIT_EVENT_ID_PATTERN = /^audit_[0-9a-f]{64}$/;

/**
 * The trail-snapshot prefix — this lane's second frozen proposal:
 * `atrail_` + 64 lowercase hex chars over the canonically-sorted
 * events. Changing it changes every trail snapshot and requires a
 * contract version bump.
 */
const ATRAIL_SNAPSHOT_PREFIX = 'atrail_';

/** The snapshot-id shape the trail mints: `atrail_` + 64 lowercase hex chars. */
export const ATRAIL_SNAPSHOT_PATTERN = /^atrail_[0-9a-f]{64}$/;

/** The recorded action kinds (the frozen v0.1 vocabulary — the security surfaces that exist). */
export type AuditActionKind =
  | 'session-admitted' // an authorization session was admitted
  | 'observation-refused' // the §1 boundary refused
  | 'redaction-applied' // sensitive fields were redacted (the count is a fact)
  | 'zone-write' // a datum entered an isolation zone
  | 'zone-refused' // a zone write was refused
  | 'operation-cancelled' // a cancellable operation was cancelled
  | 'operation-resumed'; // a cancelled operation was resumed

/** One audit event — append-only, immutable once recorded. */
export interface AuditEvent {
  auditVersion: string; // AUDIT_VERSION ('0.1')
  /** Content-addressed: 'audit_' + sha256Hex(canonicalJson(event minus id)). */
  id: string;
  kind: AuditActionKind;
  /** The actor identity (non-empty — who/what acted). */
  actor: string;
  /** The subject the action concerned (non-empty — a session id, zone, operation id, …). */
  subject: string;
  /** MEASURED facts, carried verbatim (e.g. { fieldsRedacted: 3 } — never asserted). */
  facts: Record<string, unknown>;
  /** RFC3339 — CALLER-injected; the trail never reads a clock. */
  recordedAt: string;
}

/** The cancellable-operation side of the lane (the honest state machine's record). */
export interface CancellableOperation {
  /** Non-empty — the CALLER supplies the id; the module never generates one (determinism). */
  operationId: string;
  state: 'running' | 'cancelled' | 'resumed';
  /** The LATEST cancellation's caller-injected timestamp, or null before the first. */
  cancelledAt: string | null;
  /** The LATEST resume's caller-injected timestamp, or null before the first. */
  resumedAt: string | null;
  /** MEASURED: how many cancellations this operation has had (the cumulative total). */
  cancellationCount: number;
}

/** Fail-closed event recording: a result, never an exception. */
export type AuditResult =
  | { ok: true; event: AuditEvent }
  | { ok: false; errors: string[] };

/**
 * Fail-closed cancellation/resume bookkeeping: the audit result shape
 * widened for the operation surface. The ok branch CARRIES the
 * operation record; `event` is present exactly when the transition
 * moved the trail (cancel and resume record an event; registration
 * does not — see the module header's disclosed sketch resolution).
 * The refused branches carry the operation too when there is one to
 * carry (the state-carried law: every refusal names the state it
 * refused).
 */
export type OperationResult =
  | { ok: true; event?: AuditEvent; operation: CancellableOperation }
  | { ok: false; errors: string[]; operation?: CancellableOperation };

/**
 * An audit trail: the append-only, content-addressed, fail-closed
 * event record PLUS the cancellation/resume state machine whose legal
 * transitions are recorded as events. One tenant-agnostic in-memory
 * object per `createAuditTrail()` — separate instances share NOTHING.
 */
export interface AuditTrail {
  /**
   * Record an event. `input` = `{ kind, actor, subject, facts? }`;
   * `options` = `{ recordedAt }` (RFC3339 calendar-valid,
   * caller-injected). Fail-closed: kind IN the frozen seven-kind
   * vocabulary (an unknown kind is a named error listing the observed
   * value), actor/subject non-empty strings, facts — when present — a
   * plain object of canonical-JSON-serializable measured values
   * (arrays are not facts objects; an ABSENT facts rides as {} — the
   * event's non-optional slot, freshly minted per event). ALL errors
   * are collected and the call NEVER throws. The identical event
   * content (including recordedAt — the timestamp is content)
   * re-recorded into THIS trail is the DUPLICATE refusal (insert-only,
   * the memory precedent); the same content under a different
   * recordedAt is a DISTINCT event, and both are stored. Extra input
   * keys are ignored (the isolation put() precedent — the event is
   * constructed from the named fields).
   */
  record(input: unknown, options: unknown): Promise<AuditResult>;
  /** All events, canonical (id) order — DEFENSIVELY COPIED (a fresh deep copy per event, per call). */
  list(): AuditEvent[];
  /** MEASURED counts per kind (only kinds that fired) — a fresh record every call. */
  countsByKind(): Record<string, number>;
  /**
   * Content-addressed trail snapshot: `'atrail_' +
   * sha256Hex(canonicalJson(the canonically-sorted events))` — the
   * events sorted by id before hashing, so the same events recorded in
   * ANY order produce the identical snapshot, and any change (any new
   * event) moves it. The empty trail hashes the empty array — a valid
   * digest. Every stored event was validated canonical-serializable at
   * record time and the trail is sealed (no alias channel), so this
   * channel cannot fail on a well-formed trail.
   */
  snapshot(): Promise<string>;
  /**
   * Register a cancellable operation. `input` = `{ operationId }` (a
   * non-empty string — the CALLER supplies the id; the module never
   * generates one); `options` = `{ registeredAt }` (RFC3339,
   * caller-injected — validated, then deliberately not retained: the
   * frozen v0.1 record shape carries no registration slot). A
   * DUPLICATE operationId is refused (named, the existing record
   * carried). The operation starts 'running', cancellationCount 0. No
   * event is recorded (the seven-kind v0.1 vocabulary has no
   * registration kind).
   */
  registerOperation(input: unknown, options: unknown): Promise<OperationResult>;
  /**
   * Cancel an operation. `options` = `{ cancelledAt }` (RFC3339,
   * caller-injected). A 'running' OR 'resumed' operation → 'cancelled':
   * cancelledAt set, cancellationCount +1 (MEASURED), and an
   * 'operation-cancelled' event recorded (actor 'system', subject the
   * operationId, facts { cancellationCount } measured, recordedAt the
   * cancelledAt) — the trail and the state machine move TOGETHER.
   * Cancelling an ALREADY-cancelled operation is refused ("already
   * cancelled", the state carried); an unknown or non-string
   * operationId is a named error.
   */
  cancel(operationId: unknown, options: unknown): Promise<OperationResult>;
  /**
   * Resume an operation. `options` = `{ resumedAt }` (RFC3339,
   * caller-injected). Only a 'cancelled' operation can resume: state
   * 'resumed', resumedAt set, an 'operation-resumed' event recorded
   * (actor 'system', facts { cancellationCount } measured — the count
   * STANDS on resume). A 'running' operation is refused ("not
   * cancelled"); a 'resumed' one is refused ("already resumed"); an
   * unknown operationId is a named error.
   */
  resume(operationId: unknown, options: unknown): Promise<OperationResult>;
  /** The operation record — a fresh copy — or null. Queries never error. */
  operation(operationId: unknown): CancellableOperation | null;
}

// ---- the sealed-copy helpers (the audit law: immutable once recorded) ---------------

/** A fresh deep copy of a stored event (the sealed trail hands out copies only). */
function copyEvent(event: AuditEvent): AuditEvent {
  return {
    auditVersion: event.auditVersion,
    id: event.id,
    kind: event.kind,
    actor: event.actor,
    subject: event.subject,
    facts: deepCopyValue(event.facts) as Record<string, unknown>,
    recordedAt: event.recordedAt,
  };
}

/** A fresh copy of a stored operation record (all-scalar in v0.1; the copy severs every alias). */
function copyOperation(operation: CancellableOperation): CancellableOperation {
  return {
    operationId: operation.operationId,
    state: operation.state,
    cancelledAt: operation.cancelledAt,
    resumedAt: operation.resumedAt,
    cancellationCount: operation.cancellationCount,
  };
}

// ---- the audit trail factory (the spine's recording layer) --------------------------

/**
 * Mint an audit trail: the append-only event record plus the
 * cancellation/resume state machine. No arguments, no tenant model —
 * one tenant-agnostic in-memory object per call; separate instances
 * share NOTHING (no module-level state, the closure is the boundary).
 *
 * The store is a closure-private insertion-ordered id→event map (the
 * append-only law enforced structurally: a new event needs a NEW id —
 * duplicates are refused — and nothing is ever removed) plus a
 * closure-private operation map. The trail never reads a clock; every
 * timestamp is caller-injected and validated.
 */
export function createAuditTrail(): AuditTrail {
  // ---- the trail's private store: content-addressed id → the stored event ----
  const eventsById = new Map<string, AuditEvent>();
  // ---- the state machine's private store: operationId → the record ----
  const operations = new Map<string, CancellableOperation>();

  /**
   * The single append channel (record, cancel, and resume all funnel
   * here — one law, one implementation): mint the content-addressed id,
   * refuse the duplicate, store verbatim, return a sealed copy. The
   * last line of defense: a derived event that somehow refuses
   * canonicalization is a NAMED error — never an escaped exception.
   */
  const appendEvent = async (
    unsigned: Omit<AuditEvent, 'id'>,
  ): Promise<{ ok: true; event: AuditEvent } | { ok: false; errors: string[] }> => {
    let canonical: string;
    try {
      canonical = canonicalJson(unsigned);
    } catch (error) {
      return {
        ok: false,
        errors: canonicalErrors([
          `event: the derived event is not canonical-JSON serializable (${messageOf(error)}) — event values must be plain JSON data`,
        ]),
      };
    }
    const id = `${AUDIT_EVENT_PREFIX}${await sha256Hex(canonical)}`;
    if (eventsById.has(id)) {
      return {
        ok: false,
        errors: canonicalErrors([
          `duplicate event: this exact event content (including recordedAt — the timestamp is content) is already recorded under id ${preview(id)} — the trail is insert-only, nothing is ever re-recorded (the memory precedent)`,
        ]),
      };
    }
    const event: AuditEvent = {
      auditVersion: unsigned.auditVersion,
      id,
      kind: unsigned.kind,
      actor: unsigned.actor,
      subject: unsigned.subject,
      facts: unsigned.facts,
      recordedAt: unsigned.recordedAt,
    };
    eventsById.set(id, event);
    return { ok: true, event: copyEvent(event) }; // sealed — a fresh copy, never the stored record
  };

  const record = async (input: unknown, options: unknown): Promise<AuditResult> => {
    const errors: string[] = [];

    if (!isObject(input)) {
      return {
        ok: false,
        errors: canonicalErrors([
          `input: expected an object { kind, actor, subject, facts? }, got ${preview(input)}`,
        ]),
      };
    }

    // ---- validations (ALL collected, each naming its field) ----
    const kind = input['kind'];
    if (typeof kind !== 'string' || !(AUDIT_ACTION_KINDS as readonly string[]).includes(kind)) {
      errors.push(
        `kind: expected one of the frozen v0.1 audit action kinds (${KINDS_FOR_MESSAGES}), got ${preview(kind)}`,
      );
    }

    const actor = input['actor'];
    if (typeof actor !== 'string' || actor.length === 0) {
      errors.push(
        `actor: expected a non-empty string (who or what acted — a session, a worker, a caller), got ${preview(actor)}`,
      );
    }

    const subject = input['subject'];
    if (typeof subject !== 'string' || subject.length === 0) {
      errors.push(
        `subject: expected a non-empty string (the session id, zone, operation id, or other subject the action concerned), got ${preview(subject)}`,
      );
    }

    // ---- facts: ABSENT rides as {} (a fresh empty record per event — no
    // shared alias); PRESENT must be a plain object of serializable
    // measured values (arrays are not facts objects) ----
    const rawFacts = input['facts'];
    if (rawFacts !== undefined && !isObject(rawFacts)) {
      errors.push(
        `facts: expected a plain object of MEASURED facts (arrays are not facts objects), got ${preview(rawFacts)}`,
      );
    } else if (rawFacts !== undefined) {
      try {
        // the id channel hashes this exact form — refuse at RECORD time
        // what the snapshot channel could never hash
        canonicalJson(rawFacts);
      } catch (error) {
        errors.push(
          `facts: not canonical-JSON serializable (${messageOf(error)}) — facts values must be plain JSON data (the event id channel hashes them)`,
        );
      }
    }

    let recordedAt: unknown = undefined;
    if (!isObject(options)) {
      errors.push(`options: expected an object { recordedAt }, got ${preview(options)}`);
    } else {
      recordedAt = options['recordedAt'];
      if (!isRfc3339(recordedAt)) {
        errors.push(
          `options.recordedAt: expected an RFC3339 date-time string (caller-injected — the trail never reads a clock), got ${preview(recordedAt)}`,
        );
      }
    }

    // ---- fail closed: nothing is recorded unless every field admitted ----
    if (errors.length > 0) {
      return { ok: false, errors: canonicalErrors(errors) };
    }

    // Validated above (every invalid shape returned already) — narrowed by
    // the admission, the house cast discipline (authorization.ts).
    const unsigned: Omit<AuditEvent, 'id'> = {
      auditVersion: AUDIT_VERSION,
      kind: kind as AuditActionKind,
      actor: actor as string,
      subject: subject as string,
      // VERBATIM by value: a fresh deep copy preserving every key and
      // value exactly, never normalized — the stored event never aliases
      // the caller's facts object.
      facts:
        rawFacts === undefined
          ? {}
          : (deepCopyValue(rawFacts) as Record<string, unknown>),
      recordedAt: recordedAt as string,
    };

    return appendEvent(unsigned);
  };

  const registerOperation = async (input: unknown, options: unknown): Promise<OperationResult> => {
    const errors: string[] = [];

    if (!isObject(input)) {
      return {
        ok: false,
        errors: canonicalErrors([
          `input: expected an object { operationId }, got ${preview(input)}`,
        ]),
      };
    }

    const operationId = input['operationId'];
    if (typeof operationId !== 'string' || operationId.length === 0) {
      errors.push(
        `operationId: expected a non-empty string (the CALLER supplies the operation id — the module never generates one, determinism), got ${preview(operationId)}`,
      );
    }

    // registeredAt: validated (the caller-injected-clock law holds at every
    // mutation), then deliberately NOT retained — the frozen v0.1 record
    // shape carries no registration slot (the module header's honesty note).
    let registeredAt: unknown = undefined;
    if (!isObject(options)) {
      errors.push(`options: expected an object { registeredAt }, got ${preview(options)}`);
    } else {
      registeredAt = options['registeredAt'];
      if (!isRfc3339(registeredAt)) {
        errors.push(
          `options.registeredAt: expected an RFC3339 date-time string (caller-injected — the trail never reads a clock), got ${preview(registeredAt)}`,
        );
      }
    }

    if (errors.length > 0) {
      return { ok: false, errors: canonicalErrors(errors) };
    }

    const id = operationId as string;
    const existing = operations.get(id);
    if (existing !== undefined) {
      return {
        ok: false,
        operation: copyOperation(existing), // the state carried
        errors: canonicalErrors([
          `duplicate operation: operationId ${preview(id)} is already registered in state ${preview(existing.state)} — operation ids are insert-only, register a distinct id`,
        ]),
      };
    }

    // The operation starts 'running', cancellationCount 0 — and records
    // NO event (the seven-kind v0.1 vocabulary has no registration kind;
    // the trail holds exactly the cancelled/resumed events).
    const operation: CancellableOperation = {
      operationId: id,
      state: 'running',
      cancelledAt: null,
      resumedAt: null,
      cancellationCount: 0,
    };
    operations.set(id, operation);
    return { ok: true, operation: copyOperation(operation) };
  };

  const cancel = async (operationId: unknown, options: unknown): Promise<OperationResult> => {
    const errors: string[] = [];

    if (typeof operationId !== 'string' || operationId.length === 0) {
      errors.push(
        `operationId: expected a non-empty string (the operation to cancel), got ${preview(operationId)}`,
      );
    }

    let cancelledAt: unknown = undefined;
    if (!isObject(options)) {
      errors.push(`options: expected an object { cancelledAt }, got ${preview(options)}`);
    } else {
      cancelledAt = options['cancelledAt'];
      if (!isRfc3339(cancelledAt)) {
        errors.push(
          `options.cancelledAt: expected an RFC3339 date-time string (caller-injected — the trail never reads a clock), got ${preview(cancelledAt)}`,
        );
      }
    }

    if (errors.length > 0) {
      return { ok: false, errors: canonicalErrors(errors) };
    }

    const id = operationId as string;
    const existing = operations.get(id);
    if (existing === undefined) {
      return {
        ok: false,
        errors: canonicalErrors([
          `unknown operation: operationId ${preview(id)} is not registered — nothing to cancel (register it first)`,
        ]),
      };
    }
    if (existing.state === 'cancelled') {
      return {
        ok: false,
        operation: copyOperation(existing), // the state carried
        errors: canonicalErrors([
          `already cancelled: operationId ${preview(id)} is in state "cancelled" — only a running or resumed operation can be cancelled (a resumed one may cycle again; an already-cancelled one cannot)`,
        ]),
      };
    }

    // Legal (running or resumed → cancelled): the count is MEASURED (+1),
    // and the trail and the state machine move TOGETHER — the event is
    // minted (duplicate check included) BEFORE the record mutates, so a
    // refused append refuses the whole transition.
    const updated: CancellableOperation = {
      operationId: id,
      state: 'cancelled',
      cancelledAt: cancelledAt as string,
      resumedAt: existing.resumedAt,
      cancellationCount: existing.cancellationCount + 1,
    };
    const appended = await appendEvent({
      auditVersion: AUDIT_VERSION,
      kind: 'operation-cancelled',
      actor: SYSTEM_ACTOR,
      subject: id,
      facts: { cancellationCount: updated.cancellationCount }, // MEASURED, the post-bump count
      recordedAt: cancelledAt as string, // the transition's caller-injected timestamp IS the event's
    });
    if (!appended.ok) {
      return { ok: false, operation: copyOperation(existing), errors: appended.errors };
    }
    operations.set(id, updated);
    return { ok: true, event: appended.event, operation: copyOperation(updated) };
  };

  const resume = async (operationId: unknown, options: unknown): Promise<OperationResult> => {
    const errors: string[] = [];

    if (typeof operationId !== 'string' || operationId.length === 0) {
      errors.push(
        `operationId: expected a non-empty string (the operation to resume), got ${preview(operationId)}`,
      );
    }

    let resumedAt: unknown = undefined;
    if (!isObject(options)) {
      errors.push(`options: expected an object { resumedAt }, got ${preview(options)}`);
    } else {
      resumedAt = options['resumedAt'];
      if (!isRfc3339(resumedAt)) {
        errors.push(
          `options.resumedAt: expected an RFC3339 date-time string (caller-injected — the trail never reads a clock), got ${preview(resumedAt)}`,
        );
      }
    }

    if (errors.length > 0) {
      return { ok: false, errors: canonicalErrors(errors) };
    }

    const id = operationId as string;
    const existing = operations.get(id);
    if (existing === undefined) {
      return {
        ok: false,
        errors: canonicalErrors([
          `unknown operation: operationId ${preview(id)} is not registered — nothing to resume (cancel it first)`,
        ]),
      };
    }
    if (existing.state === 'running') {
      return {
        ok: false,
        operation: copyOperation(existing), // the state carried
        errors: canonicalErrors([
          `not cancelled: operationId ${preview(id)} is in state "running" — only a cancelled operation can resume`,
        ]),
      };
    }
    if (existing.state === 'resumed') {
      return {
        ok: false,
        operation: copyOperation(existing), // the state carried
        errors: canonicalErrors([
          `already resumed: operationId ${preview(id)} is in state "resumed" — only a cancelled operation can resume (cancel it again first)`,
        ]),
      };
    }

    // Legal (cancelled → resumed): the count STANDS (resume measures
    // nothing new — the honest state machine), and the trail and the
    // state machine move TOGETHER.
    const updated: CancellableOperation = {
      operationId: id,
      state: 'resumed',
      cancelledAt: existing.cancelledAt,
      resumedAt: resumedAt as string,
      cancellationCount: existing.cancellationCount,
    };
    const appended = await appendEvent({
      auditVersion: AUDIT_VERSION,
      kind: 'operation-resumed',
      actor: SYSTEM_ACTOR,
      subject: id,
      facts: { cancellationCount: updated.cancellationCount }, // MEASURED — the count as it stands
      recordedAt: resumedAt as string,
    });
    if (!appended.ok) {
      return { ok: false, operation: copyOperation(existing), errors: appended.errors };
    }
    operations.set(id, updated);
    return { ok: true, event: appended.event, operation: copyOperation(updated) };
  };

  const operation = (operationId: unknown): CancellableOperation | null => {
    // A query is never an error: non-string, empty, or unknown → an
    // honest null (the registry's get precedent). A hit is a FRESH COPY —
    // the sealed-trail law (mutating a returned record changes nothing).
    if (typeof operationId !== 'string' || operationId.length === 0) {
      return null;
    }
    const found = operations.get(operationId);
    return found === undefined ? null : copyOperation(found);
  };

  const list = (): AuditEvent[] => {
    // Canonical (id) order, DEFENSIVELY COPIED: a fresh array of fresh
    // deep copies — the caller can never mutate the trail through a
    // listing (not the array, not any event, not any facts within).
    return [...eventsById.values()].sort(byIdAscending).map((event) => copyEvent(event));
  };

  const countsByKind = (): Record<string, number> => {
    // MEASURED per kind, only kinds that fired, a fresh record every
    // call — iterated in canonical (id) order so the record is stable
    // across trails holding the same events in different input orders.
    const measured: Record<string, number> = {};
    for (const event of [...eventsById.values()].sort(byIdAscending)) {
      measured[event.kind] = (measured[event.kind] ?? 0) + 1;
    }
    return measured;
  };

  const snapshot = async (): Promise<string> => {
    // Content-addressed, input-order independent: the events canonically
    // sorted by id, then canonicalJson, then sha256Hex. Every event was
    // validated canonical-serializable at RECORD time and the trail is
    // sealed (no alias channel exists — stronger than the isolation
    // precedent's documented get() trade-off), so this channel cannot
    // fail on a well-formed trail. The empty trail hashes the empty
    // array — a valid digest.
    const sorted = [...eventsById.values()].sort(byIdAscending);
    return `${ATRAIL_SNAPSHOT_PREFIX}${await sha256Hex(canonicalJson(sorted))}`;
  };

  return { record, list, countsByKind, snapshot, registerOperation, cancel, resume, operation };
}
