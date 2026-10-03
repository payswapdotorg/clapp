/**
 * @clapp/security — multi-tenant isolation (CLAPP-072, the P7 third lane —
 * Worker 3, Synthesis, Verification, and Repair, the lane's owner per
 * docs/WORK_ITEMS.md: "CLAPP-072 — Multi-tenant isolation, Owner W3").
 *
 * docs/SECURITY_AND_AUTHORIZATION.md §6 (Data isolation) reads:
 * "Separate:
 * - user project data
 * - target app evidence
 * - generated code
 * - package library
 * - benchmark corpus
 *
 * Library promotion must never accidentally publish private project data."
 * THIS MODULE IS THAT SEPARATION, made executable: `createTenantZone`
 * mints a fail-closed tenant zone — an in-memory store whose every datum
 * lives under exactly one of the five frozen §6 domains, inside exactly
 * one tenant's zone instance — and the zone's write path enforces the two
 * §6 laws: domain integrity (data is insert-only per (domain, key) pair)
 * and THE PUBLISH-LEAK GUARD (a write that declares an origin domain
 * different from its target domain is refused — the §6 acceptance law,
 * "Library promotion must never accidentally publish private project
 * data", made executable for the one case it names and honestly
 * generalized to every domain pair). §4's sandbox budgets (filesystem
 * boundaries, CPU/memory, process limits, network egress) are a DIFFERENT
 * section's lane — this one separates the DATA domains.
 *
 * THE FIVE §6 DATA DOMAINS (the frozen v0.1 vocabulary — the ONLY domains
 * a datum may live in):
 *   - user project data     → 'user-project'
 *   - target app evidence   → 'target-evidence'
 *   - generated code        → 'generated-code'
 *   - the package library   → 'package-library'
 *   - the benchmark corpus  → 'benchmark-corpus'
 *
 * THE PUBLISH-LEAK GUARD (v0.1's honest approximation, binding): the
 * write input MAY carry an optional `originDomain: DataDomain` — the
 * domain the value came FROM. When it is present and differs from the
 * target `domain`, the write is REFUSED with the named
 * cross-domain-publication error ("cross-domain publication refused:
 * <origin> data cannot enter the <domain> domain"). When it is ABSENT,
 * the write proceeds — the caller asserts same-origin by OMISSION, an
 * honesty this module documents rather than hides (v0.1 cannot read a
 * value's provenance off its bytes; the declaring caller IS the
 * provenance channel). A present-but-malformed originDomain (non-string,
 * off-vocabulary) fails closed with a named error, and a present
 * originDomain EQUAL to the target domain is the explicit same-origin
 * assertion — the write proceeds.
 *
 * THE INTEGRITY UNIT IS THE (domain, key) PAIR (the registry's
 * (id, version) precedent, @clapp/library registry.ts): a datum may be
 * written ONCE per pair. The same key MAY live in several domains as
 * separate, unrelated data — the domain is part of the address and there
 * is NO cross-domain overwrite channel (a write addressed to another
 * domain never touches the first domain's datum). A rewrite of an
 * existing pair is refused: with DIFFERENT content (a different value,
 * or the same value under a different storedAt — the timestamp is
 * content) it is the immutable-datum refusal naming the key and the
 * domain; with IDENTICAL content (same value, same storedAt) it is the
 * duplicate refusal (an idempotent no-op refused as a duplicate — the
 * fail-closed memory precedent, CLAPP-060).
 *
 * Tenant scoping (the honest v0.1 in-memory model): the zone IS the
 * tenant. `createTenantZone` validates the tenantId (a non-empty string
 * — anything else is a named error and NO zone is minted) and the minted
 * instance holds its data in a closure-private store: separate instances
 * share NOTHING (no module-level state, no tenant-keyed registry), so one
 * tenant's data is invisible to another zone — even another zone minted
 * with the SAME tenantId string (the instance, not the string, is the
 * boundary). The tenantId is deliberately NOT retained after validation:
 * there is nothing to look the tenant up BY in a model where the instance
 * is the boundary, and retaining it would be decoration.
 *
 * Query-handle policy (the registry precedent): `put` and `get` return
 * the STORED RECORD itself — an alias by construction; the stored VALUE
 * is verbatim BY VALUE (the authorization.ts statement discipline: a
 * deep copy preserving every key and value exactly, never normalized,
 * never rewritten — so the caller can never mutate a stored datum
 * through the object they passed in). `list` and `counts` are the sealed
 * fresh-copy channels (a fresh sorted array; a fresh measured record),
 * and `snapshot` never exposes values at all: it HASHES them (value
 * digests only) — the snapshot is a leak-free fingerprint.
 *
 * Discipline (binding — the house rules, mirroring authorization.ts and
 * redaction.ts and the docs/WORKER_HANDOFFS.md acceptance rules):
 * - Fail closed: the factory and the write path collect EVERY field
 *   error in a { ok: false, errors } result (the list canonicalized —
 *   sorted, deduped) — results, never exceptions, for ANY input; a
 *   rejected write stores nothing. Queries never error: a wrong-typed or
 *   missing lookup is an honest null / empty listing.
 * - Determinism: no clock (storedAt is CALLER-injected per write and
 *   validated — RFC3339, calendar-valid; the zone never reads a clock),
 *   no randomness, no network, no filesystem, no module-level mutable
 *   state. The same writes in ANY order produce the identical `iso_`
 *   snapshot (the entries are canonically sorted before hashing).
 * - The module never mutates its inputs; stored values are VERBATIM.
 * - The write path validates that every datum value is canonical-JSON
 *   serializable BEFORE storing it — the snapshot channel (whose frozen
 *   signature returns Promise<string>, with no refusal branch) hashes
 *   canonicalJson(value) and can therefore never fail on a well-formed
 *   zone. The one documented way to violate that invariant is to mutate
 *   a stored record through the get() alias (the registry precedent's
 *   same trade-off — outside the contract).
 *
 * Honest v0.1 scope: in-memory only — persistence, cross-zone process
 * isolation, and the §4 sandbox budgets are later, tech-lead-declared
 * scope. Audit (CLAPP-073) and the production readiness gate (CLAPP-074)
 * are later lanes, not this one.
 */

import { sha256Hex } from '@clapp/core';
import { canonicalJson } from '@clapp/observe';

// ---- the frozen §6 vocabulary (TYPE-pinned literals) --------------------------------

/**
 * The frozen §6 data-domain vocabulary (security contract v0.1, canonical
 * source docs/SECURITY_AND_AUTHORIZATION.md §6 — the five data classes the
 * section separates). Pinned as literals: the module validates
 * contract-shaped DATA against these exact strings; importing them from
 * any implementation would import that implementation's behavior.
 */
const DATA_DOMAINS: readonly DataDomain[] = [
  'user-project',
  'target-evidence',
  'generated-code',
  'package-library',
  'benchmark-corpus',
];

/** The frozen §6 domains, rendered for error messages (the observed-value law). */
const DOMAINS_FOR_MESSAGES = DATA_DOMAINS.map((domain) => JSON.stringify(domain)).join(' | ');

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

/** Plain-value deep copy (datum values are JSON-shaped; no class instances). */
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

// ---- the isolation contract v0.1 ------------------------------------------------------

/** The isolation contract version (bumps only via a tech-lead declaration wave). */
export const ISOLATION_VERSION = '0.1';

/**
 * The zone-snapshot prefix — THIS lane's frozen proposal in the `pkg_` /
 * `cgraph_` / `rq_` / `creg_` / `fail_` / `fmem_` / `rpat_` / `arch_` /
 * `comp_` / `bench_` / `authz_` / `redct_` prefix discipline: `iso_` + 64
 * lowercase hex chars. Changing it changes every zone snapshot id and
 * requires a contract version bump.
 */
const ISO_SNAPSHOT_PREFIX = 'iso_';

/**
 * The snapshot-id shape the zone mints: `iso_` + 64 lowercase hex chars
 * (the repo's content-addressing primitive, sha256Hex's output).
 */
export const ISO_SNAPSHOT_PATTERN = /^iso_[0-9a-f]{64}$/;

/** The §6 data domains (the frozen v0.1 vocabulary). */
export type DataDomain =
  | 'user-project' // user project data
  | 'target-evidence' // target app evidence
  | 'generated-code' // generated code
  | 'package-library' // the package library
  | 'benchmark-corpus'; // the benchmark corpus

/** One isolated datum, stored VERBATIM under its tenant+domain key. */
export interface IsolatedDatum {
  /** Non-empty — the caller's chosen key (unique within its domain: the (domain, key) pair is the address). */
  key: string;
  /** The §6 domain this datum lives in — part of the address, never rewritten. */
  domain: DataDomain;
  /** VERBATIM, never rewritten (stored by value — a deep copy, never aliased to the caller's input). */
  value: unknown;
  /** RFC3339 — CALLER-injected per write; the zone never reads a clock. */
  storedAt: string;
}

/**
 * Fail-closed zone creation: a result, never an exception. A valid zone is
 * `{ ok: true, zone }` — the work order's binding prose ("a VALID zone is
 * { ok: true, zone: IsolationZone }"), reading like the siblings'
 * AuthorizationSessionResult, which carries its session on the ok branch
 * (the order's earlier bare `{ ok: true }` sketch is superseded by its own
 * prose).
 */
export type ZoneResult =
  | { ok: true; zone: IsolationZone }
  | { ok: false; errors: string[] };

/** Fail-closed datum storage: a result, never an exception. */
export type StoreResult =
  | { ok: true; datum: IsolatedDatum }
  | { ok: false; errors: string[] };

/**
 * A tenant's isolation zone: the in-memory store holding ONE tenant's
 * data, separated by the five §6 domains. Every method is closure-private
 * state over this zone only — separate zone instances share NOTHING.
 */
export interface IsolationZone {
  /**
   * Store a datum. `input` = `{ domain, key, value }` (optionally
   * `originDomain` — see the publish-leak guard); `options` =
   * `{ storedAt }` (RFC3339, caller-injected per write). Fail-closed: ALL
   * field errors are collected and named; the publish-leak guard refuses
   * a declared cross-origin write; the immutability law refuses a rewrite
   * of an existing (domain, key) pair — a CHANGED rewrite (different
   * value, or the same value under a different storedAt) with the
   * immutable-datum error, an IDENTICAL rewrite (same value AND same
   * storedAt) with the duplicate error. There is no cross-domain
   * overwrite: the (domain, key) pair is the address. On success the
   * stored record itself is returned (an alias by construction — the
   * registry precedent).
   */
  put(input: unknown, options: unknown): Promise<StoreResult>;
  /**
   * Read a datum — ONLY within the requested domain and this tenant's
   * zone. A query is never an error: non-string arguments and misses are
   * null; a hit returns the stored datum (the record itself — an alias by
   * construction, the registry precedent).
   */
  get(domain: unknown, key: unknown): IsolatedDatum | null;
  /**
   * List a domain's keys in canonical (UTF-16 code-unit) order — a FRESH
   * array every call (the sealed listing channel). A non-string or
   * unknown domain lists nothing; queries never error.
   */
  list(domain: unknown): string[];
  /**
   * MEASURED counts per domain — a fresh record every call, only
   * non-empty domains listed.
   */
  counts(): Record<string, number>;
  /**
   * Content-addressed zone snapshot: `'iso_' + sha256Hex(canonicalJson(
   * the canonically-sorted [{ domain, key, valueDigest }]))` where each
   * `valueDigest = sha256Hex(canonicalJson(value))`. The values are
   * HASHED — never serialized into the id — so the snapshot is a
   * leak-free fingerprint; the entries are sorted by (domain, key) before
   * hashing, so the same writes in ANY order produce the identical
   * snapshot, and any change moves the id.
   */
  snapshot(): Promise<string>;
}

/** The snapshot's per-datum record: the address plus the value's digest — never the value. */
interface SnapshotEntry {
  domain: string;
  key: string;
  valueDigest: string;
}

// ---- the tenant zone factory (the §6 separation, made executable) ---------------------

/**
 * Mint a tenant's isolation zone. Fail-closed: the `tenantId` must be a
 * non-empty string — anything else (empty, null, a number, an object, …)
 * is a named error and NO zone is minted; the call NEVER throws.
 *
 * The minted zone IS the tenant (the honest v0.1 in-memory model): its
 * store is closure-private to this instance, separate zones share
 * NOTHING (not even zones minted with the same tenantId string), and no
 * module-level state exists. The tenantId is validated and then
 * deliberately not retained — the instance is the boundary; there is
 * nothing to look a tenant up BY.
 */
export function createTenantZone(tenantId: unknown): ZoneResult {
  // ---- the tenant must be NAMED — no anonymous zones ----
  if (typeof tenantId !== 'string' || tenantId.length === 0) {
    return {
      ok: false,
      errors: canonicalErrors([
        `tenantId: expected a non-empty string (the tenant whose data this zone isolates), got ${preview(tenantId)}`,
      ]),
    };
  }

  // ---- the zone's private store: domain → key → the stored datum ----
  // Closure-private, never module-level: the INSTANCE is the tenant
  // boundary — separate zones share nothing, not even zones minted with
  // the same tenantId string.
  const byDomain = new Map<string, Map<string, IsolatedDatum>>();

  const put = async (input: unknown, options: unknown): Promise<StoreResult> => {
    const errors: string[] = [];

    if (!isObject(input)) {
      return {
        ok: false,
        errors: canonicalErrors([
          `input: expected an object { domain, key, value }, got ${preview(input)}`,
        ]),
      };
    }

    // ---- validations (ALL collected, each naming its field) ----
    const domain = input['domain'];
    if (typeof domain !== 'string' || !(DATA_DOMAINS as readonly string[]).includes(domain)) {
      errors.push(
        `domain: expected one of the frozen §6 data domains (${DOMAINS_FOR_MESSAGES}), got ${preview(domain)}`,
      );
    }

    const key = input['key'];
    if (typeof key !== 'string' || key.length === 0) {
      errors.push(
        `key: expected a non-empty string (the caller\u2019s chosen key for the datum), got ${preview(key)}`,
      );
    }

    const value = input['value'];
    try {
      // the snapshot channel hashes this exact form — refuse at WRITE time
      // what the snapshot could never hash (its frozen signature has no
      // refusal branch; the write path carries the burden)
      canonicalJson(value);
    } catch (error) {
      errors.push(
        `value: not canonical-JSON serializable (${messageOf(error)}) — datum values must be plain JSON data (the snapshot channel hashes canonicalJson(value))`,
      );
    }

    const originDomain = input['originDomain'];
    if (
      originDomain !== undefined &&
      (typeof originDomain !== 'string' || !(DATA_DOMAINS as readonly string[]).includes(originDomain))
    ) {
      errors.push(
        `originDomain: expected one of the frozen §6 data domains (${DOMAINS_FOR_MESSAGES}) when present, got ${preview(originDomain)}`,
      );
    }

    let storedAt: unknown = undefined;
    if (!isObject(options)) {
      errors.push(`options: expected an object { storedAt }, got ${preview(options)}`);
    } else {
      storedAt = options['storedAt'];
      if (!isRfc3339(storedAt)) {
        errors.push(
          `options.storedAt: expected an RFC3339 date-time string (caller-injected per write — the zone never reads a clock), got ${preview(storedAt)}`,
        );
      }
    }

    // ---- fail closed: nothing is stored unless every field admitted ----
    if (errors.length > 0) {
      return { ok: false, errors: canonicalErrors(errors) };
    }

    // Validated above (every invalid shape returned already) — narrowed by
    // the admission, the house cast discipline (authorization.ts).
    const targetDomain = domain as DataDomain;
    const targetKey = key as string;
    const targetStoredAt = storedAt as string;

    // ---- THE PUBLISH-LEAK GUARD (the §6 acceptance law) — checked BEFORE
    // the immutability law: a cross-origin publication is refused for the
    // more fundamental reason, before any question of what the target
    // domain already holds ----
    if (originDomain !== undefined && originDomain !== targetDomain) {
      return {
        ok: false,
        errors: canonicalErrors([
          `cross-domain publication refused: ${preview(originDomain)} data cannot enter the ${preview(targetDomain)} domain`,
        ]),
      };
    }

    // ---- the immutability law: the (domain, key) pair is insert-only ----
    const existing = byDomain.get(targetDomain)?.get(targetKey);
    if (existing !== undefined) {
      let sameValue = false;
      try {
        sameValue = canonicalJson(value) === canonicalJson(existing.value);
      } catch (error) {
        // the last line of defense — fires only through the documented
        // get()-alias corruption channel; a named error, never an escape
        return {
          ok: false,
          errors: canonicalErrors([
            `value: the write could not be compared with the stored datum (${messageOf(error)}) — zone state must remain plain JSON data`,
          ]),
        };
      }
      if (sameValue && targetStoredAt === existing.storedAt) {
        return {
          ok: false,
          errors: canonicalErrors([
            `duplicate datum: key ${preview(targetKey)} in domain ${preview(targetDomain)} is already stored identically (same value and storedAt) — the idempotent no-op write is refused as a duplicate`,
          ]),
        };
      }
      return {
        ok: false,
        errors: canonicalErrors([
          `immutable datum: key ${preview(targetKey)} in domain ${preview(targetDomain)} already holds different content (storedAt is content — a different timestamp is a different write) — zone data is insert-only, the changed rewrite is refused`,
        ]),
      };
    }

    // ---- store: VERBATIM by value (never aliased to the caller's input) ----
    const datum: IsolatedDatum = {
      key: targetKey,
      domain: targetDomain,
      value: deepCopyValue(value),
      storedAt: targetStoredAt,
    };
    const byKey = byDomain.get(targetDomain);
    if (byKey === undefined) {
      byDomain.set(targetDomain, new Map([[targetKey, datum]]));
    } else {
      byKey.set(targetKey, datum);
    }
    return { ok: true, datum }; // the stored record itself — an alias by construction
  };

  const get = (domain: unknown, key: unknown): IsolatedDatum | null => {
    // A query is never an error; non-string arguments and misses are null
    // (the honest-miss law — the registry's get precedent).
    if (typeof domain !== 'string' || typeof key !== 'string') {
      return null;
    }
    const datum = byDomain.get(domain)?.get(key);
    return datum === undefined ? null : datum;
  };

  const list = (domain: unknown): string[] => {
    // A query is never an error: a non-string or unknown domain lists
    // nothing. Canonical (UTF-16 code-unit) order — the order
    // canonicalJson sorts keys in — and a FRESH array every call (the
    // sealed listing channel: the caller can never mutate zone state
    // through a listing).
    if (typeof domain !== 'string') {
      return [];
    }
    return [...(byDomain.get(domain)?.keys() ?? [])].sort();
  };

  const counts = (): Record<string, number> => {
    // MEASURED per domain, only non-empty domains listed, a fresh record
    // every call.
    const measured: Record<string, number> = {};
    for (const [domain, byKey] of byDomain) {
      if (byKey.size > 0) {
        measured[domain] = byKey.size;
      }
    }
    return measured;
  };

  const snapshot = async (): Promise<string> => {
    // Content-addressed, leak-free, input-order independent: every stored
    // value was validated canonical-serializable at WRITE time, so this
    // channel cannot fail on a well-formed zone; the values are hashed
    // (never serialized into the id), and the entries are canonically
    // sorted by (domain, key) before hashing so the writes' input order
    // never leaks.
    const entries: SnapshotEntry[] = [];
    for (const [domain, byKey] of byDomain) {
      for (const [key, datum] of byKey) {
        entries.push({
          domain,
          key,
          valueDigest: await sha256Hex(canonicalJson(datum.value)),
        });
      }
    }
    entries.sort((a, b) =>
      a.domain < b.domain
        ? -1
        : a.domain > b.domain
          ? 1
          : a.key < b.key
            ? -1
            : a.key > b.key
              ? 1
              : 0,
    );
    return `${ISO_SNAPSHOT_PREFIX}${await sha256Hex(canonicalJson(entries))}`;
  };

  return { ok: true, zone: { put, get, list, counts, snapshot } };
}
