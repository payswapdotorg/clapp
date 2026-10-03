/**
 * @clapp/security — secret redaction (CLAPP-071, the P7 second lane —
 * Worker 2, Behavioral Model and Package Learning, the owner of the
 * evidence-to-model boundary this redaction guards).
 *
 * docs/SECURITY_AND_AUTHORIZATION.md §3 (Secret handling) reads:
 * "The observation pipeline must classify sensitive fields: cookies,
 * Authorization headers, bearer tokens, API keys, passwords, private user
 * data. Default behavior: redact from durable evidence; keep only
 * short-lived in-memory references where required; make redaction visible
 * in provenance; never train package retrieval directly on raw secrets."
 * THIS MODULE IS THAT DEFAULT BEHAVIOR FOR DURABLE EVIDENCE:
 * `redactSensitiveFields` walks an evidence-shaped object (never mutating
 * it), replaces every field whose NAME classifies into the frozen six-kind
 * §3 vocabulary with a visible NON-REVERSIBLE marker, and returns the
 * RedactionReport that makes the redaction visible in provenance — one
 * entry per redacted field, MEASURED counts per kind, and the
 * before/after content digests.
 *
 * THE SIX §3 SENSITIVE-FIELD CLASSES (the frozen v0.1 vocabulary — the
 * ONLY kinds a field name may classify into):
 *   - cookies                → 'cookie'
 *   - Authorization headers  → 'authorization-header'
 *   - bearer tokens          → 'bearer-token'
 *   - API keys               → 'api-key'
 *   - passwords              → 'password'
 *   - private user data      → 'private-user-data'
 *
 * THE CLASSIFIER NEVER GUESSES (the honest-miss law): classifyFieldName
 * matches a field NAME against the frozen rule table — case-insensitive,
 * first match wins — and returns null for everything else. 'value',
 * 'name', 'route', 'title' are NOT sensitive in v0.1; a miss is a miss,
 * reported as null, never silently widened.
 *
 * WALK SEMANTICS (v0.1, binding — the reading the §5 contract's own
 * `cookies[0].sessionToken` example demands): a classified field whose
 * value is a SCALAR (or an opaque non-plain object) is replaced by its
 * marker; a walkable container (a plain object or an array, classified or
 * not) is always DESCENDED INTO, and its inner fields classify by their
 * own names — that is how `cookies: [{ sessionToken }]` yields the entry
 * `cookies[0].sessionToken` (kind bearer-token) rather than one wholesale
 * `cookies` marker. Honest limits, stated: unnamed primitives under a
 * classified container name (`cookies: ['sid=1']`) ride verbatim, and an
 * off-vocabulary inner name (`cookies[0].value`) rides verbatim — the
 * frozen vocabulary decides everything, field name by field name.
 *
 * Discipline (binding — the house rules, mirroring authorization.ts and
 * the docs/WORKER_HANDOFFS.md acceptance rules):
 * - Fail closed: a non-object/non-array root, a cyclic input, an
 *   unfingerprintable value, or a non-canonicalizable input is a
 *   { ok: false, errors } result with every error NAMED — results, never
 *   exceptions, for ANY input. The error list is canonicalized (sorted,
 *   deduped).
 * - Determinism: no clock, no randomness, no network, no filesystem, no
 *   module-level mutable state. The same input yields the deep-equal
 *   report with the identical `redct_` id and the identical fingerprints
 *   (`canonicalJson` sorts keys, so the caller's key order never leaks
 *   into the identity).
 * - The input is NEVER mutated: the walk only reads it; `report.redacted`
 *   is a fresh deep copy carrying the markers (plain objects and arrays
 *   deep-copied; non-sensitive values ride verbatim).
 * - The marker is a sha256 PREFIX — it keeps the redaction visible and
 *   distinguishable in provenance while NEVER allowing recovery of the
 *   value. The value's own content is dropped: it appears nowhere in the
 *   report.
 *
 * Honest v0.1 scope: cycles are DETECTED (an ancestors WeakSet) and
 * REFUSED, not walked; shared non-cyclic references are copied
 * independently (aliasing is not preserved in the copy); a non-plain
 * object (Date, Map, class instance) is opaque — it rides verbatim under
 * a non-sensitive name and is wholesale-replaced by a marker under a
 * sensitive one. Persistence and multi-tenant isolation are LATER lanes
 * (CLAPP-072/073/074), not this one.
 */

import { sha256Hex } from '@clapp/core';
import { canonicalJson } from '@clapp/observe';

// ---- internal shared helpers (module-level; NOT re-exported by src/index.ts) --------

/** Human preview of an unknown value, for error messages (the house helper). */
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

/**
 * A walkable container: an array, or a plain object (Object.prototype- or
 * null-prototype-rooted — the canonical-data shapes, mirroring
 * @clapp/observe's isPlainObject). Everything else (primitives, Dates,
 * Maps, class instances) is an OPAQUE value: it rides verbatim under a
 * non-sensitive name and is wholesale-replaced by a marker under a
 * sensitive one.
 */
function isWalkableContainer(value: unknown): value is object {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return true;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

/** The field's path in the input: dot-joined, array indexes bracketed. */
function fieldPath(parent: string, field: string): string {
  return parent === '' ? field : `${parent}.${field}`;
}

/** An array element's path: the parent path plus a bracketed index. */
function elementPath(parent: string, index: number): string {
  return `${parent}[${index}]`;
}

// ---- the redaction contract v0.1 ------------------------------------------------------

/** The redaction contract version (bumps only via a tech-lead declaration wave). */
export const REDACTION_VERSION = '0.1';

/**
 * The report-id prefix — THIS lane's frozen proposal in the `pkg_` /
 * `cgraph_` / `rq_` / `creg_` / `fail_` / `fmem_` / `rpat_` / `arch_` /
 * `comp_` / `bench_` / `authz_` prefix discipline: `redct_` + 64
 * lowercase hex chars. Changing it changes every minted report id and
 * requires a contract version bump.
 */
const REDACT_ID_PREFIX = 'redct_';

/** The §3 sensitive-field classes (the frozen v0.1 vocabulary). */
export type SensitiveKind =
  | 'cookie' // cookies
  | 'authorization-header' // Authorization headers
  | 'bearer-token' // bearer tokens
  | 'api-key' // API keys
  | 'password' // passwords
  | 'private-user-data'; // private user data

/** One redaction event — what was redacted, where, and its visible marker. */
export interface RedactionEntry {
  /** The field's path in the input (dot-joined object path or array-indexed). */
  path: string;
  kind: SensitiveKind;
  /** The visible marker that replaced the value: 'REDACTED:<kind>:<fingerprint8>'. */
  marker: string;
}

/** The redaction report (the provenance §3 demands). */
export interface RedactionReport {
  redactionVersion: string; // REDACTION_VERSION ('0.1')
  /** Content-addressed: 'redct_' + sha256Hex(canonicalJson(report minus id)). */
  id: string;
  /** The redacted VALUE (a deep copy of the input with markers in place) — for durable evidence. */
  redacted: unknown;
  /** One entry per redacted field, in canonical order (sorted by path). */
  entries: RedactionEntry[];
  /** MEASURED counts per kind (only kinds that fired). */
  countsByKind: Record<string, number>;
  /** sha256Hex(canonicalJson(original)) — the pre-redaction digest, for provenance comparison. */
  originalDigest: string;
  /** sha256Hex(canonicalJson(redacted)) — measured. */
  redactedDigest: string;
}

/** Fail-closed redaction: a result, never an exception. */
export type RedactionResult =
  | { ok: true; report: RedactionReport }
  | { ok: false; errors: string[] };

// ---- the classification rules (the frozen v0.1 rule table) ---------------------------

/**
 * Classify a field NAME against the frozen v0.1 rule table — the §3
 * classes, matched case-insensitively, FIRST MATCH WINS, in this order:
 *
 * 1. 'cookie'            — the name IS 'cookie'/'cookies', or ends with either
 * 2. 'authorization-header' — the name IS 'authorization' or 'authorization-header'
 * 3. 'bearer-token'      — the name IS 'token'/'bearer'/'bearer-token'/'access-token',
 *                          or ends with 'token' (e.g. 'sessionToken', 'apiToken')
 * 4. 'api-key'           — the name IS 'key'/'apikey'/'api-key', or ends with
 *                          'key'/'apikey' (e.g. 'apiKey', 'secretKey' — ORDER:
 *                          'secretKey' ends with 'key' → 'api-key'; it never
 *                          reaches the 'password' rule)
 * 5. 'password'          — the name IS 'password'/'pass', or ends with 'password'
 *                          (e.g. 'userPassword')
 * 6. 'private-user-data' — the name IS 'email'/'phone'/'ssn'/'address'/'birthdate',
 *                          or ends with 'email'/'phone' (e.g. 'userEmail')
 *
 * Everything else → null (NOT sensitive — the classifier never guesses; a
 * miss is a miss, honestly). Suffix matches are literal: a name such as
 * 'monkey' ends with 'key' and classifies 'api-key' — the frozen table's
 * behavior, not a judgment.
 */
export function classifyFieldName(name: string): SensitiveKind | null {
  const n = name.toLowerCase();
  // 1. cookies
  if (n === 'cookie' || n === 'cookies' || n.endsWith('cookie') || n.endsWith('cookies')) {
    return 'cookie';
  }
  // 2. authorization headers
  if (n === 'authorization' || n === 'authorization-header') {
    return 'authorization-header';
  }
  // 3. bearer tokens
  if (
    n === 'token' ||
    n === 'bearer' ||
    n === 'bearer-token' ||
    n === 'access-token' ||
    n.endsWith('token')
  ) {
    return 'bearer-token';
  }
  // 4. api keys
  if (n === 'key' || n === 'apikey' || n === 'api-key' || n.endsWith('key') || n.endsWith('apikey')) {
    return 'api-key';
  }
  // 5. passwords
  if (n === 'password' || n === 'pass' || n.endsWith('password')) {
    return 'password';
  }
  // 6. private user data
  if (
    n === 'email' ||
    n === 'phone' ||
    n === 'ssn' ||
    n === 'address' ||
    n === 'birthdate' ||
    n.endsWith('email') ||
    n.endsWith('phone')
  ) {
    return 'private-user-data';
  }
  // the honest miss — never a guess
  return null;
}

// ---- the redaction engine -------------------------------------------------------------

/**
 * The visible, NON-REVERSIBLE marker that replaces a redacted value:
 * `REDACTED:<kind>:<fingerprint8>` where `fingerprint8` is the first 8
 * lowercase hex chars of `sha256Hex(String(value))`. The fingerprint is a
 * sha256 prefix: it NEVER allows recovery of the value, and it exists so
 * the redaction is VISIBLE and DISTINGUISHABLE in provenance — two
 * different secrets produce different fingerprints with overwhelming
 * probability. The value's own content is dropped.
 */
async function markerFor(value: unknown, kind: SensitiveKind): Promise<string> {
  const fingerprint8 = (await sha256Hex(String(value))).slice(0, 8);
  return `REDACTED:${kind}:${fingerprint8}`;
}

/**
 * Interim placeholder written at a replacement site while the site's
 * marker hashes. It is ALWAYS overwritten by the marker before any report
 * is returned, and any refusal discards the copy under construction — the
 * placeholder never escapes this module.
 */
const PENDING_MARKER = '\u0000clapp-redaction-pending\u0000';

/** A scheduled marker replacement: where it lands, its kind, and its (dropped) value. */
interface ReplacementSite {
  path: string;
  kind: SensitiveKind;
  value: unknown;
  /** Writes the computed marker into the redacted copy at this site's field. */
  apply: (marker: string) => void;
}

/** The walk's accumulating state (one walk, one state — no shared state). */
interface WalkState {
  sites: ReplacementSite[];
  /** The current walk ANCESTRY: a back-edge to any ancestor is a cycle (detected, refused). */
  ancestors: WeakSet<object>;
  errors: string[];
}

/**
 * The synchronous walk: builds the redacted deep copy while scheduling
 * marker replacements as sites. A classified field with a scalar (or
 * opaque-object) value schedules its site; every walkable container is
 * descended into, its inner fields classifying by their own names. The
 * input is only ever READ. Cycles are detected against the ancestry and
 * refused with a named error (fail-fast: the walk unwinds, the copy under
 * construction is discarded).
 */
function walkSync(value: unknown, path: string, state: WalkState): unknown {
  if (!isWalkableContainer(value)) {
    return value; // a primitive or an opaque object rides verbatim
  }
  const node: object = value;
  if (state.ancestors.has(node)) {
    state.errors.push(`input: cyclic reference detected at ${path === '' ? '<root>' : path}`);
    return node; // unwinding — the copy under construction is discarded
  }
  state.ancestors.add(node);
  try {
    if (Array.isArray(node)) {
      const source = node as unknown[];
      const copy: unknown[] = [];
      for (let index = 0; index < source.length; index++) {
        if (state.errors.length > 0) return copy; // fail fast — the walk is refused
        copy[index] = walkSync(source[index], elementPath(path, index), state);
      }
      return copy;
    }
    const record = node as Record<string, unknown>;
    const copy: Record<string, unknown> = {};
    for (const field of Object.keys(record)) {
      if (state.errors.length > 0) return copy; // fail fast — the walk is refused
      const kind = classifyFieldName(field);
      const raw = record[field];
      if (kind !== null && !isWalkableContainer(raw)) {
        // the sensitive VALUE is dropped — only its visible marker is kept
        const holder = copy;
        const name = field;
        state.sites.push({
          path: fieldPath(path, name),
          kind,
          value: raw,
          apply: (marker: string): void => {
            holder[name] = marker;
          },
        });
        copy[field] = PENDING_MARKER; // always overwritten by apply() on success
      } else {
        copy[field] = walkSync(raw, fieldPath(path, field), state);
      }
    }
    return copy;
  } finally {
    state.ancestors.delete(node);
  }
}

/** Fail-closed refusal — the error list canonicalized (sorted, deduped). */
function refusal(errors: string[]): RedactionResult {
  return { ok: false, errors: [...new Set(errors)].sort() };
}

/**
 * Redact the §3 sensitive fields from `input` (never mutated) and return
 * the provenance report — the §3 default behavior for durable evidence,
 * made executable. Fail-closed: a root that is null, undefined, or a
 * primitive (a scalar holds no fields to redact, and the report contract
 * demands a walkable root), a CYCLIC input (detected via an ancestry
 * WeakSet — no infinite loop, no crash), an unfingerprintable value, or a
 * non-canonical-JSON-serializable input each refuse with the defect
 * NAMED — NEVER an exception for any input.
 *
 * The report is deterministic: same input → deep-equal report, identical
 * `redct_` id, identical fingerprints. `entries` carries one entry per
 * redacted field in canonical order (sorted by path); `countsByKind` is
 * MEASURED from the entries (only kinds that fired);
 * `originalDigest`/`redactedDigest` are MEASURED content digests (they
 * differ whenever anything was redacted; a nothing-sensitive input yields
 * the honest no-op report — empty entries, `{}` counts, EQUAL digests);
 * the id is content-addressed over the report minus its id, so ANY input
 * change moves it.
 */
export async function redactSensitiveFields(input: unknown): Promise<RedactionResult> {
  // ---- the root must be walkable: an object or an array, never a scalar ----
  if (input === null || typeof input !== 'object') {
    return refusal([
      `input: expected an object or array to walk, got ${preview(input)}`,
    ]);
  }

  // ---- the walk (synchronous, read-only over the input) ----
  const state: WalkState = { sites: [], ancestors: new WeakSet<object>(), errors: [] };
  let redacted: unknown;
  try {
    redacted = walkSync(input, '', state);
  } catch (error) {
    // the last line of defense (a throwing getter, a Proxy, stack overflow):
    // the failure is a NAMED error, never an escaped exception
    return refusal([
      `input: the redaction walk failed (${messageOf(error)}) — the input must be walkable plain data`,
    ]);
  }
  if (state.errors.length > 0) {
    return refusal(state.errors); // the cycle refusal (v0.1: cycles are refused, not walked)
  }

  // ---- the visible markers (every fingerprint hashes; all in parallel) ----
  let decorated: Array<{ site: ReplacementSite; marker: string }>;
  try {
    decorated = await Promise.all(
      state.sites.map(async (site) => ({
        site,
        marker: await markerFor(site.value, site.kind),
      })),
    );
  } catch (error) {
    // String(value) itself can throw (a Symbol value): named, never escaped
    return refusal([
      `input: a sensitive value could not be fingerprinted (${messageOf(error)}) — sensitive values must have a String() form`,
    ]);
  }
  for (const { site, marker } of decorated) {
    site.apply(marker);
  }

  // ---- canonical order: one entry per redacted field, sorted by path ----
  const entries: RedactionEntry[] = decorated
    .map(({ site, marker }) => ({ path: site.path, kind: site.kind, marker }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  // ---- MEASURED counts per kind — recomputed from the entries ----
  const countsByKind: Record<string, number> = {};
  for (const entry of entries) {
    countsByKind[entry.kind] = (countsByKind[entry.kind] ?? 0) + 1;
  }

  // ---- the provenance digests + the content-addressed report id ----
  // The last line of defense, mirroring createAuthorizedSession: if the
  // input or the derived report refuses canonicalization (an undefined
  // field, a non-finite number, an opaque object, nesting past
  // canonicalJson's depth cap), the refusal is a NAMED error — never an
  // escaped exception.
  try {
    const originalDigest = await sha256Hex(canonicalJson(input));
    const redactedDigest = await sha256Hex(canonicalJson(redacted));
    const unsigned: Omit<RedactionReport, 'id'> = {
      redactionVersion: REDACTION_VERSION,
      redacted,
      entries,
      countsByKind,
      originalDigest,
      redactedDigest,
    };
    const id = `${REDACT_ID_PREFIX}${await sha256Hex(canonicalJson(unsigned))}`;
    return { ok: true, report: { id, ...unsigned } };
  } catch (error) {
    return refusal([
      `input: the redaction report could not be content-addressed (${messageOf(error)}) — input values must be plain JSON data`,
    ]);
  }
}
