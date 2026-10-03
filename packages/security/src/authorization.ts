/**
 * @clapp/security — the authorized-session boundary (CLAPP-070, the P7
 * first lane — Worker 1, Observation and Platform Adapters, the owner of
 * the observation pipeline this boundary gates).
 *
 * docs/SECURITY_AND_AUTHORIZATION.md §1 (the authorized-use model) reads:
 * "The system must capture an authorization statement or benchmark
 * ownership record before observation begins." THIS MODULE IS THAT
 * CAPTURE AND THAT BOUNDARY: `createAuthorizedSession` admits a captured
 * authorization statement fail-closed into a content-addressed
 * AuthorizationSession, and `assertObservationAuthorized` is the gate an
 * observation must pass through before it begins — per-target,
 * observation-only, and distrustful of everything it was not handed.
 *
 * THE FIVE AUTHORIZED-USE CLASSES (§1 verbatim, the frozen v0.1
 * vocabulary — the ONLY kinds a statement may carry):
 *   - applications owned by the user                     → 'owned'
 *   - applications where the user has explicit permission → 'explicit-permission'
 *   - open-source applications subject to their licenses → 'licensed-open-source'
 *   - interoperability/testing environments              → 'interop-testing'
 *   - controlled research benchmarks                     → 'research-benchmark'
 *
 * THE MODULE DOES NOT SCAN STATEMENT TEXT FOR INTENT (the §2
 * product-language law): the grant reference + the kind CARRY the
 * authorization. A statement is authorized when its grantReference names
 * a real ownership/license/permission/interop/benchmark record of the
 * named kind for the named target — for THAT target and for nothing
 * else. The module never judges prose, never judges intent, and never
 * guesses an authorization the statement does not carry.
 *
 * Discipline (binding — the 060..064 house rules plus the
 * docs/WORKER_HANDOFFS.md acceptance rules: no hidden global state,
 * determinism):
 * - No clock: grantedAt is CALLER-injected and validated (RFC3339,
 *   calendar-valid — 2026-02-30-style rollover dates are refused); the
 *   module never reads a clock (there is no clock to read).
 * - No randomness, no network, no filesystem, no module-level mutable
 *   state; every session mints a FRESH scopes array — no shared array
 *   two sessions could alias and no way to widen one session's scope
 *   through another's.
 * - Fail closed: admission collects EVERY field error in a
 *   { ok: false, errors } result (the error list canonicalized — sorted,
 *   deduped) — results, never exceptions; the boundary returns
 *   { ok: false, reason } naming the first defect it meets. Refusal is
 *   the DEFAULT: every unlisted malformed shape refuses.
 * - Determinism: the same statement admits the deep-equal session with
 *   the identical content-addressed id ('authz_' +
 *   sha256Hex(canonicalJson(session minus sessionId))); canonicalJson
 *   sorts keys, so the caller's key order never leaks into the identity.
 * - VERBATIM statements: the admitted statement is stored by VALUE — a
 *   deep copy preserving every key and value exactly (never normalized,
 *   never rewritten, never trimmed, never re-cased) — so the admitted
 *   session never aliases the caller's input object: the statement is
 *   immutable once admitted, and the caller cannot mutate a live session
 *   through the object they passed in.
 * - The module never mutates its inputs.
 *
 * Honest v0.1 scope: the boundary validates the sessionId's authz_ SHAPE,
 * not its content-addressed consistency with the statement (recomputing
 * the digest would cost an async hash; the boundary is synchronous and
 * pure by contract — the id's integrity is the minting channel's
 * guarantee). In-memory only: persistence, secret redaction (CLAPP-071),
 * multi-tenant isolation (CLAPP-072), audit (CLAPP-073), and the
 * production readiness gate (CLAPP-074) are LATER lanes, not this one.
 */

import { sha256Hex } from '@clapp/core';
import { canonicalJson } from '@clapp/observe';

// ---- the frozen §1 vocabulary (TYPE-pinned literals) --------------------------------

/**
 * The frozen authorized-use vocabulary (security contract v0.1, canonical
 * source docs/SECURITY_AND_AUTHORIZATION.md §1 — the five classes the
 * product is designed for). Pinned as literals: the module validates
 * contract-shaped DATA against these exact strings; importing them from
 * any implementation would import that implementation's behavior.
 */
const AUTHORIZATION_KINDS: readonly AuthorizationKind[] = [
  'owned',
  'licensed-open-source',
  'explicit-permission',
  'interop-testing',
  'research-benchmark',
];

/** The frozen §1 kinds, rendered for error messages (the observed-value law). */
const KINDS_FOR_MESSAGES = AUTHORIZATION_KINDS.map((kind) => JSON.stringify(kind)).join(' | ');

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

/** Plain-value deep copy (statements are JSON-shaped; no class instances). */
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

// ---- the security contract v0.1 ------------------------------------------------------

/** The security contract version (bumps only via a tech-lead declaration wave). */
export const AUTHZ_VERSION = '0.1';

/**
 * The minted session-id prefix — THIS lane's frozen proposal in the
 * `pkg_` / `cgraph_` / `rq_` / `creg_` / `fail_` / `fmem_` / `rpat_` /
 * `arch_` / `comp_` / `bench_` prefix discipline: `authz_` + 64 lowercase
 * hex chars. Changing it changes every minted session id and requires a
 * contract version bump.
 */
const AUTHZ_ID_PREFIX = 'authz_';

/**
 * The session-id shape the boundary demands: `authz_` + 64 lowercase hex
 * chars (the repo's content-addressing primitive, sha256Hex's output).
 */
export const AUTHZ_ID_PATTERN = /^authz_[0-9a-f]{64}$/;

/** The §1 authorized-use classes (the frozen v0.1 vocabulary). */
export type AuthorizationKind =
  | 'owned' // applications owned by the user
  | 'licensed-open-source' // open-source applications subject to their licenses
  | 'explicit-permission' // the user has explicit permission
  | 'interop-testing' // interoperability/testing environments
  | 'research-benchmark'; // controlled research benchmarks

/** The captured authorization statement (the §1 capture requirement). */
export interface AuthorizationStatement {
  authorizationKind: AuthorizationKind;
  /** The target application's identifier (a domain, package name, or repo id — non-empty). */
  targetIdentifier: string;
  /** The authorizing owner's identity (non-empty). */
  ownerIdentity: string;
  /**
   * The license/permission/benchmark-ownership record reference (non-empty
   * — the §1 "authorization statement or benchmark ownership record" the
   * statement must carry; the module never scans it for intent, it CARRIES
   * the authorization together with the kind).
   */
  grantReference: string;
  /** RFC3339 — CALLER-injected; the module never reads a clock. */
  grantedAt: string;
}

/** A live authorized session — the boundary object observation must hold. */
export interface AuthorizationSession {
  authzVersion: string; // AUTHZ_VERSION ('0.1')
  sessionId: string; // content-addressed: 'authz_' + sha256Hex(canonicalJson(session minus sessionId))
  /** VERBATIM, immutable once admitted (stored by value — never aliased to the caller's input). */
  statement: AuthorizationStatement;
  /** v0.1 grants exactly ONE scope: observation (the §1 model — observation must not begin without it). */
  scopes: string[]; // ['observe']
}

/** Fail-closed session admission: a result, never an exception. */
export type AuthorizationSessionResult =
  | { ok: true; session: AuthorizationSession }
  | { ok: false; errors: string[] };

/** The boundary check's result. */
export type BoundaryResult =
  | { ok: true; sessionId: string; targetIdentifier: string }
  | { ok: false; reason: string }; // fail-closed — results, never exceptions

// ---- the session admission (the §1 capture requirement) -------------------------------

/** Fail-closed admission refusal — the error list canonicalized (sorted, deduped). */
function admissionFailure(errors: string[]): AuthorizationSessionResult {
  return { ok: false, errors: [...new Set(errors)].sort() };
}

/**
 * Admits a captured authorization statement as a live AuthorizationSession
 * — the §1 capture requirement, made executable. Fail-closed: the
 * statement must be an object carrying a `authorizationKind` IN the frozen
 * five-kind §1 vocabulary (an unknown kind is a named error listing the
 * observed value), non-empty string `targetIdentifier`/`ownerIdentity`/
 * `grantReference`, and a calendar-valid RFC3339 `grantedAt`. ALL errors
 * are collected (each naming its field, the list sorted and deduped) and
 * the admission NEVER throws — a malformed statement is a
 * { ok: false, errors } result, and nothing is minted.
 *
 * The admitted statement is stored VERBATIM (by value: a deep copy
 * preserving every key and value — never normalized, never rewritten);
 * `scopes` is exactly `['observe']` (v0.1 grants observation only — later
 * scopes arrive via a contract bump, never a quiet widening); the session
 * id is content-addressed over the session minus its id, so the same
 * statement admits the identical session every time.
 */
export async function createAuthorizedSession(
  statement: unknown,
): Promise<AuthorizationSessionResult> {
  const errors: string[] = [];

  if (!isObject(statement)) {
    return admissionFailure([
      `statement: expected an object { authorizationKind, targetIdentifier, ownerIdentity, grantReference, grantedAt }, got ${preview(statement)}`,
    ]);
  }

  // ---- the authorization kind (the frozen §1 vocabulary) ----
  const kind = statement['authorizationKind'];
  if (typeof kind !== 'string' || !(AUTHORIZATION_KINDS as readonly string[]).includes(kind)) {
    errors.push(
      `authorizationKind: expected one of the frozen §1 authorized-use kinds (${KINDS_FOR_MESSAGES}), got ${preview(kind)}`,
    );
  }

  // ---- the target / owner / grant strings ----
  const stringFields: ReadonlyArray<[string, string]> = [
    ['targetIdentifier', 'the target application\u2019s identifier (a domain, package name, or repo id)'],
    ['ownerIdentity', 'the authorizing owner\u2019s identity'],
    ['grantReference', 'the license/permission/benchmark-ownership record reference'],
  ];
  for (const [field, role] of stringFields) {
    const value = statement[field];
    if (typeof value !== 'string' || value.length === 0) {
      errors.push(`${field}: expected a non-empty string (${role}), got ${preview(value)}`);
    }
  }

  // ---- the caller-injected grant time — the module never reads a clock ----
  if (!isRfc3339(statement['grantedAt'])) {
    errors.push(
      `grantedAt: expected an RFC3339 date-time string (caller-injected — the module never reads a clock), got ${preview(statement['grantedAt'])}`,
    );
  }

  // ---- fail closed: nothing is minted unless every field admitted ----
  if (errors.length > 0) {
    return admissionFailure(errors);
  }

  // ---- the verbatim statement (by VALUE — immutable once admitted) ----
  // Every key and value preserved exactly; the deep copy means the session
  // never aliases the caller's input object. Extra caller keys ride along
  // verbatim (the module never rewrites a statement) and move the
  // content-addressed id — any statement change moves the id.
  const statementCopy = deepCopyValue(statement) as AuthorizationStatement;

  // ---- the session body (minus the id it is about to mint) ----
  // A FRESH scopes array per session — no hidden shared state, and no way
  // to widen one session's scope through another's.
  const unsigned: Omit<AuthorizationSession, 'sessionId'> = {
    authzVersion: AUTHZ_VERSION,
    statement: statementCopy,
    scopes: ['observe'],
  };

  // The last line of defense: if the derived session somehow refuses
  // canonicalization (e.g. an extra statement key holding a non-JSON
  // value), the refusal is a NAMED error — never an escaped exception.
  let canonical: string;
  try {
    canonical = canonicalJson(unsigned);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return admissionFailure([
      `statement: the derived session is not canonical-JSON serializable (${detail}) — statement values must be plain JSON data`,
    ]);
  }
  const sessionId = `${AUTHZ_ID_PREFIX}${await sha256Hex(canonical)}`;

  return { ok: true, session: { ...unsigned, sessionId } };
}

// ---- the boundary (the gate observation must pass through) ---------------------------

/**
 * THE BOUNDARY: may observation of `targetIdentifier` begin under
 * `session`? Synchronous and pure — it reads nothing but its two
 * arguments (no clock, no state, no I/O), so the same session and target
 * always yield the identical verdict.
 *
 * The boundary distrusts everything it was not handed: a non-object
 * session, a session whose `authzVersion` is not AUTHZ_VERSION, a
 * missing/malformed ('authz_'-shaped) `sessionId`, a malformed statement
 * (non-object, unknown kind, empty fields, non-RFC3339 grantedAt), or
 * scopes that are not EXACTLY `['observe']` each refuse with the defect
 * named — a session may be structurally present but WRONG. A non-string
 * or empty `targetIdentifier` refuses, named. And the authorization is
 * PER-TARGET: a statement for app A never authorizes observing app B —
 * a mismatch refuses with BOTH identifiers named.
 *
 * Refusal is the DEFAULT (fail-closed — the boundary never guesses an
 * authorization): every unlisted malformed shape refuses. Only a
 * well-formed observation-only session whose statement names the exact
 * target passes: `{ ok: true, sessionId, targetIdentifier }` — the
 * observation may begin.
 */
export function assertObservationAuthorized(
  session: unknown,
  targetIdentifier: unknown,
): BoundaryResult {
  if (!isObject(session)) {
    return {
      ok: false,
      reason: `session: expected an AuthorizationSession object, got ${preview(session)}`,
    };
  }

  if (session['authzVersion'] !== AUTHZ_VERSION) {
    return {
      ok: false,
      reason: `session.authzVersion: expected ${preview(AUTHZ_VERSION)} (AUTHZ_VERSION), got ${preview(session['authzVersion'])}`,
    };
  }

  const sessionId = session['sessionId'];
  if (typeof sessionId !== 'string' || !AUTHZ_ID_PATTERN.test(sessionId)) {
    return {
      ok: false,
      reason: `session.sessionId: expected an authz_-shaped session id ("authz_" + 64 lowercase hex chars), got ${preview(sessionId)}`,
    };
  }

  const statement = session['statement'];
  if (!isObject(statement)) {
    return {
      ok: false,
      reason: `session.statement: expected an AuthorizationStatement object, got ${preview(statement)}`,
    };
  }

  const kind = statement['authorizationKind'];
  if (typeof kind !== 'string' || !(AUTHORIZATION_KINDS as readonly string[]).includes(kind)) {
    return {
      ok: false,
      reason: `session.statement.authorizationKind: expected one of the frozen §1 authorized-use kinds (${KINDS_FOR_MESSAGES}), got ${preview(kind)}`,
    };
  }

  const statementStrings: ReadonlyArray<[string, string]> = [
    ['targetIdentifier', 'the target application\u2019s identifier'],
    ['ownerIdentity', 'the authorizing owner\u2019s identity'],
    ['grantReference', 'the license/permission/benchmark-ownership record reference'],
  ];
  for (const [field, role] of statementStrings) {
    const value = statement[field];
    if (typeof value !== 'string' || value.length === 0) {
      return {
        ok: false,
        reason: `session.statement.${field}: expected a non-empty string (${role}), got ${preview(value)}`,
      };
    }
  }

  if (!isRfc3339(statement['grantedAt'])) {
    return {
      ok: false,
      reason: `session.statement.grantedAt: expected an RFC3339 date-time string (caller-injected — the module never reads a clock), got ${preview(statement['grantedAt'])}`,
    };
  }

  const scopes = session['scopes'];
  if (!Array.isArray(scopes) || scopes.length !== 1 || scopes[0] !== 'observe') {
    return {
      ok: false,
      reason: `session.scopes: expected exactly ["observe"] (v0.1 grants observation only — later scopes arrive via a contract bump, never a quiet widening), got ${preview(scopes)}`,
    };
  }

  if (typeof targetIdentifier !== 'string' || targetIdentifier.length === 0) {
    return {
      ok: false,
      reason: `targetIdentifier: expected a non-empty string (the target the observation is about to observe), got ${preview(targetIdentifier)}`,
    };
  }

  // ---- the per-target law: the authorization names ONE target ----
  const authorizedTarget = statement['targetIdentifier'];
  if (authorizedTarget !== targetIdentifier) {
    return {
      ok: false,
      reason: `the authorization is per-target: the session\u2019s statement authorizes ${preview(authorizedTarget)} — it does not authorize ${preview(targetIdentifier)} (a statement for one app never authorizes observing another)`,
    };
  }

  return { ok: true, sessionId, targetIdentifier };
}
