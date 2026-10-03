/**
 * @clapp/learn — the archetype classifier (CLAPP-062, the P6 third lane —
 * Worker 1, Observation and Platform Adapters, per
 * docs/WORKER_HANDOFFS.md).
 *
 * docs/LEARNING_AND_LIBRARY.md §10 — the target end state's FIRST step is
 * "identify archetype": a future build should start by recognizing what
 * KIND of application it is, then retrieve 70–95% of its architecture
 * from the library (aspirational targets, §10's own caveat). THIS module
 * is that step's executable seed: it classifies ONE manifest-shaped
 * input against the frozen five-rule archetype table v0.1, and every
 * element of the classification is MEASURED from the manifest's actual
 * facts — the §8 contamination-guard spirit: a classification is minted
 * only from manifest FACTS, never guessed, never hand-asserted.
 *
 * THE CONTRACT (v0.1): `classifyManifest(manifest, { classifiedAt })`
 * consumes manifest-SHAPED data — the @clapp/library PackageManifest's
 * id/version/capabilities/interface (TYPE-ONLY link; the FULL manifest
 * validation is the library's business — validatePackageManifest,
 * CLAPP-050) — and returns a ClassificationResult: one
 * ArchetypeClassification carrying every matched rule's measured
 * evidence, or a fail-closed error list.
 *
 * THE FROZEN FIVE-RULE TABLE (v0.1, binding — canonical evaluation order):
 * 1. 'api-backed-app' — capabilities includes 'api-mock' OR the interface
 *    carries ≥1 '/api/'-prefixed entry (api evidence may come from either
 *    surface: the manifest's interface is the plan's route paths + api
 *    endpoints, and the capability vocabulary is grounded in @clapp/library
 *    extract.ts deriveCapabilities);
 * 2. 'form-driven-app' — capabilities includes 'form';
 * 3. 'persistent-app' — capabilities includes ≥1 'storage:'-prefixed entry;
 * 4. 'navigable-app' — capabilities includes BOTH 'route' AND 'navigation';
 * 5. 'static-content-app' — capabilities is EMPTY (an interface-only
 *    manifest — routes may exist, no behavioral capability: a MEASURED
 *    absence, which is the honest evidence itself).
 *
 * Archetypes are TAGS, not a partition: one manifest may match SEVERAL
 * rules (a manifest with forms AND storage is BOTH 'form-driven-app' and
 * 'persistent-app'), and the matches array carries them ALL in the
 * table's canonical order. A rule matches only with NON-EMPTY measured
 * evidence (rule 5's evidence is the measured emptiness itself). ZERO
 * matches is legal only when capabilities is NON-empty but no rule's
 * evidence exists (e.g. capabilities ['route'] alone) — outcome
 * 'unclassified', the honest verdict, never a guess; rule 5 means empty
 * capabilities ⇒ at least 'static-content-app' matches, so that is the
 * complete, deterministic cascade.
 *
 * PACKET-INTERNAL CONFLICT, RESOLVED AND DISCLOSED (the 061 precedent —
 * the packet's own tests are the tiebreaker): §3.2 and the mandated test 7
 * require the 'unclassified' outcome to carry "the honest reason naming
 * the unclaimed capabilities" while matches is EMPTY in exactly that
 * case — and the frozen §3.1 field list has nowhere to carry it.
 * Resolution: ArchetypeClassification carries `reasons: string[]` —
 * EMPTY when 'classified' (the matches carry their own reasons), and one
 * entry per unclaimed capability when 'unclassified'. The field is
 * ADDITIVE: every §3.1 field keeps its exact name, type, and semantics;
 * the reasons ride inside the content-addressed identity like every
 * other measured fact, so the resolution is deterministic and
 * id-visible.
 *
 * Discipline (binding — the 060/061 house rules):
 * - Fail closed: admission errors are collected — ALL of them, each
 *   naming its field — into { ok: false, errors }; results, never
 *   exceptions; nothing is classified from partial data.
 * - Determinism: no clock (classifiedAt is CALLER-injected, RFC3339
 *   calendar-valid — 2026-02-30 is refused), no randomness, no network,
 *   no filesystem. The same manifest facts + options produce a deep-equal
 *   classification with an identical id: canonicalJson sorts keys at
 *   every level, the measured facts are sorted + deduped in fresh arrays,
 *   and the matches are emitted in the table's canonical order.
 * - The classifier never mutates its inputs: every evidence and reason
 *   array is a FRESH value; the manifest's own arrays are read only.
 * - Evidence is MEASURED, never asserted: each rule's
 *   matchedCapabilities / matchedInterface are the intersection of the
 *   manifest's actual facts with the rule's requirements — the facts the
 *   rule used, nothing else; each reason names a measured fact.
 * - 'unclassified' is honest, never an error: a measured verdict naming
 *   the unclaimed capabilities, so no caller mistakes silence for success.
 *
 * Non-degeneracy rule (binding — the 060/061 discipline): the classifier
 * consumes contract-shaped DATA. The runtime dependencies are exactly
 * @clapp/core (sha256Hex) and @clapp/observe (canonicalJson);
 * @clapp/library is a devDependency imported for TYPES ONLY (the
 * PackageManifest type source — pinned, with diff/repair, by the
 * import-discipline test inside test/failure-memory.test.ts).
 */

import { sha256Hex } from '@clapp/core';
import { canonicalJson } from '@clapp/observe';
import type { PackageManifest } from '@clapp/library';

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
 * discipline (the 060/061 precedent, itself from @clapp/library
 * package-contract.ts), copied because the runtime dependency set is
 * exactly @clapp/core + @clapp/observe. `Date.parse` is deliberately NOT
 * used — it accepts rollover dates such as 2026-02-30. Honest limitation:
 * the leap-second form (second === 60) is not accepted, matching what a JS
 * Date can represent.
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

/** The manifest fields the classifier consumes — the frozen manifest's own shapes. */
type AdmittedManifest = Pick<PackageManifest, 'id' | 'version' | 'capabilities' | 'interface'>;

// ---- the archetype classifier contract v0.1 ----------------------------------------

/** The archetype classifier's contract version (bumps only via a tech-lead declaration wave). */
export const ARCHETYPE_VERSION = '0.1';

/** The frozen v0.1 archetype table version (bumps add/reweight rules — never a quiet edit). */
export const ARCHETYPE_TABLE_VERSION = '0.1';

/**
 * The classification-id prefix — THIS lane's frozen proposal in the
 * `pkg_` / `cgraph_` / `rq_` / `creg_` / `fail_` / `fmem_` / `rpat_`
 * prefix discipline: `arch_` + 64 lowercase hex chars. Changing it
 * changes every minted id and requires a contract version bump.
 */
const ARCHETYPE_ID_PREFIX = 'arch_';

/** One matched archetype with its MEASURED evidence. */
export interface ArchetypeMatch {
  /** The archetype's frozen name (the v0.1 vocabulary below). */
  name: string;
  /** MEASURED: the manifest capabilities that satisfied the rule (sorted). */
  matchedCapabilities: string[];
  /** MEASURED: the interface facts that satisfied the rule (sorted). */
  matchedInterface: string[];
  /** Honest, sorted, deduped; each names a measured fact. */
  reasons: string[];
}

/** The classification of ONE validated manifest. */
export interface ArchetypeClassification {
  archetypeVersion: string; // ARCHETYPE_VERSION ('0.1')
  tableVersion: string; // ARCHETYPE_TABLE_VERSION ('0.1')
  id: string; // content-addressed: 'arch_' + sha256Hex(canonicalJson(classification minus id))
  manifestId: string; // the manifest's minted id
  manifestVersion: string; // the manifest's version
  /** Every rule that matched, in the table's canonical order; may be EMPTY — 'unclassified' is honest. */
  matches: ArchetypeMatch[];
  /** 'classified' when matches.length > 0; 'unclassified' when zero rules matched (honest, never a guess). */
  outcome: 'classified' | 'unclassified';
  /** RFC3339 — CALLER-injected; the classifier never reads a clock. */
  classifiedAt: string;
  /**
   * Honest, sorted, deduped; each names a measured fact. EMPTY when
   * 'classified' (each match carries its own reasons); when 'unclassified'
   * — where matches is empty — ONE entry per unclaimed capability: the
   * honest reason §3.2 mandates, carried additively (the disclosed
   * packet-conflict resolution — see the module header).
   */
  reasons: string[];
}

/** Fail-closed classification: a result, never an exception. */
export type ClassificationResult =
  | { ok: true; classification: ArchetypeClassification }
  | { ok: false; errors: string[] };

// ---- the frozen five-rule table (canonical evaluation order) -----------------------

/**
 * Evaluates the frozen table over the MEASURED facts. Each rule's evidence
 * is the measured intersection of the facts with the rule's requirements;
 * a rule matches only when its evidence is non-empty (rule 5's evidence is
 * the measured emptiness itself). Matches are pushed in the table's
 * canonical order — archetypes are TAGS, not a partition: every matched
 * rule lands. The inputs are the already sorted + deduped fact arrays;
 * every evidence array handed out is a FRESH value.
 */
function evaluateArchetypeTable(
  capabilities: readonly string[],
  interfaceEntries: readonly string[],
): ArchetypeMatch[] {
  const matches: ArchetypeMatch[] = [];

  // Rule 1 — 'api-backed-app': capabilities includes 'api-mock' OR the
  // interface carries ≥1 '/api/'-prefixed entry (either surface satisfies —
  // the facts the rule used are the evidence, from both surfaces).
  const apiCapability = capabilities.includes('api-mock') ? ['api-mock'] : [];
  const apiInterface = interfaceEntries.filter((entry) => entry.startsWith('/api/'));
  if (apiCapability.length > 0 || apiInterface.length > 0) {
    const reasons: string[] = [];
    if (apiCapability.length > 0) {
      reasons.push(`capabilities includes 'api-mock'`);
    }
    for (const entry of apiInterface) {
      reasons.push(`interface entry '${entry}' starts with '/api/'`);
    }
    matches.push({
      name: 'api-backed-app',
      matchedCapabilities: apiCapability,
      matchedInterface: [...apiInterface],
      reasons: [...new Set(reasons)].sort(),
    });
  }

  // Rule 2 — 'form-driven-app': capabilities includes 'form'.
  if (capabilities.includes('form')) {
    matches.push({
      name: 'form-driven-app',
      matchedCapabilities: ['form'],
      matchedInterface: [],
      reasons: [`capabilities includes 'form'`],
    });
  }

  // Rule 3 — 'persistent-app': ≥1 capability starting with 'storage:'.
  const storageCapabilities = capabilities.filter((capability) =>
    capability.startsWith('storage:'),
  );
  if (storageCapabilities.length > 0) {
    matches.push({
      name: 'persistent-app',
      matchedCapabilities: [...storageCapabilities],
      matchedInterface: [],
      reasons: storageCapabilities.map(
        (capability) => `capabilities entry '${capability}' starts with 'storage:'`,
      ),
    });
  }

  // Rule 4 — 'navigable-app': capabilities includes BOTH 'route' AND 'navigation'.
  if (capabilities.includes('route') && capabilities.includes('navigation')) {
    matches.push({
      name: 'navigable-app',
      // sorted: 'navigation' precedes 'route'
      matchedCapabilities: ['navigation', 'route'],
      matchedInterface: [],
      reasons: [`capabilities includes both 'route' and 'navigation'`],
    });
  }

  // Rule 5 — 'static-content-app': capabilities is EMPTY — an interface-only
  // manifest (routes may exist, no behavioral capability): a MEASURED
  // absence, which is the honest evidence itself.
  if (capabilities.length === 0) {
    matches.push({
      name: 'static-content-app',
      matchedCapabilities: [],
      matchedInterface: [],
      reasons: [
        'capabilities is empty — the measured absence of behavioral capability (an interface-only manifest)',
      ],
    });
  }

  return matches;
}

// ---- the archetype classifier --------------------------------------------------------

/**
 * Classifies ONE manifest-shaped input against the frozen five-rule
 * table. Async because the classification id hashes (sha256Hex over the
 * canonical classification body).
 *
 * Fail closed: a non-object manifest, a malformed admission field
 * (capabilities/interface arrays of non-empty strings; id/version
 * non-empty strings), or a non-RFC3339 classifiedAt is a collected,
 * field-named error — ALL errors, never just the first; results, never
 * exceptions; nothing is classified from partial data. Extra manifest
 * fields (packageVersion, category, provenance, …) are the library's own
 * validation business — the classifier consumes manifest-SHAPED data and
 * validates exactly the fields it reads.
 *
 * Deterministic: the same manifest facts + options produce a deep-equal
 * classification with an identical id (the measured facts are sorted +
 * deduped in fresh arrays — the input order never leaks; canonicalJson
 * sorts keys at every level; the matches are in the table's canonical
 * order). The classifier never mutates its inputs and touches nothing
 * but the manifest and options given.
 */
export async function classifyManifest(
  manifest: unknown,
  options: unknown,
): Promise<ClassificationResult> {
  const errors: string[] = [];

  // ---- caller-injected classification time — the classifier never reads a clock ----
  let classifiedAt: string | null = null;
  if (!isObject(options)) {
    errors.push(`options: expected an object { classifiedAt }, got ${preview(options)}`);
  } else {
    const candidate = options['classifiedAt'];
    if (!isRfc3339(candidate)) {
      errors.push(
        `options.classifiedAt: expected an RFC3339 date-time string (caller-injected — the classifier never reads a clock), got ${preview(candidate)}`,
      );
    } else {
      classifiedAt = candidate;
    }
  }

  // ---- the local admission shape (§3.3 — manifest-SHAPED data) ----
  if (!isObject(manifest)) {
    errors.push(
      `manifest: expected an object (manifest-shaped — the @clapp/library PackageManifest's id/version/capabilities/interface), got ${preview(manifest)}`,
    );
    return { ok: false, errors };
  }

  for (const field of ['capabilities', 'interface'] as const) {
    const value = manifest[field];
    if (!Array.isArray(value)) {
      errors.push(`manifest.${field}: expected an array of non-empty strings, got ${preview(value)}`);
    } else {
      value.forEach((entry: unknown, index: number) => {
        if (typeof entry !== 'string' || entry.length === 0) {
          errors.push(
            `manifest.${field}[${index}]: expected a non-empty string, got ${preview(entry)}`,
          );
        }
      });
    }
  }

  for (const field of ['id', 'version'] as const) {
    const value = manifest[field];
    if (typeof value !== 'string' || value.length === 0) {
      errors.push(`manifest.${field}: expected a non-empty string, got ${preview(value)}`);
    }
  }

  // ---- fail closed: nothing is classified unless every field admitted ----
  if (errors.length > 0 || classifiedAt === null) {
    return { ok: false, errors };
  }

  // ---- the MEASURED facts (sorted + deduped in FRESH arrays — the input
  // arrays are read only, never mutated; the input order never leaks) ----
  const manifestData = manifest as unknown as AdmittedManifest;
  const capabilities = [...new Set(manifestData.capabilities)].sort();
  const interfaceEntries = [...new Set(manifestData.interface)].sort();

  // ---- the frozen table, in canonical order ----
  const matches = evaluateArchetypeTable(capabilities, interfaceEntries);
  const outcome: ArchetypeClassification['outcome'] =
    matches.length > 0 ? 'classified' : 'unclassified';

  // The unclassified reasons: one per unclaimed capability — the honest
  // verdict naming what no rule's evidence includes (measured, never a guess).
  const reasons =
    outcome === 'unclassified'
      ? capabilities.map(
          (capability) =>
            `capabilities entry '${capability}' is unclaimed — no v0.1 archetype rule's evidence includes it`,
        )
      : [];

  // ---- the content-addressed classification identity ----
  // The classification MINUS its id is the minting input (the fail_ /
  // rpat_ discipline): same id ⇔ identical canonical classification bytes —
  // any measured change (a fact, a match, the outcome, the reasons, the
  // caller-injected clock) moves the id.
  const classificationBody: Omit<ArchetypeClassification, 'id'> = {
    archetypeVersion: ARCHETYPE_VERSION,
    tableVersion: ARCHETYPE_TABLE_VERSION,
    manifestId: manifestData.id,
    manifestVersion: manifestData.version,
    matches,
    outcome,
    classifiedAt,
    reasons,
  };

  // The last line of defense (the 060/061 precedent): a canonicalization
  // refusal is a NAMED error — never an escaped exception. (The body is
  // built from validated strings, so this cannot fire in practice — the
  // discipline is kept unconditional anyway.)
  let canonical: string;
  try {
    canonical = canonicalJson(classificationBody);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      errors: [
        `classification minting: the derived classification is not canonical-JSON serializable (${detail})`,
      ],
    };
  }
  const id = `${ARCHETYPE_ID_PREFIX}${await sha256Hex(canonical)}`;

  return { ok: true, classification: { ...classificationBody, id } };
}
