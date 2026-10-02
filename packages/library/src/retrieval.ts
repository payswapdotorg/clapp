/**
 * @clapp/library — the package retrieval (CLAPP-052).
 *
 * The P5 lane-3 module over the frozen PackageManifest v0.1 (CLAPP-050): a
 * DETERMINISTIC, HONEST ranked-candidate retrieval — the
 * docs/LEARNING_AND_LIBRARY.md §6 signal list, v0.1-shaped. Runtime imports
 * are exactly `@clapp/core` (sha256Hex), `@clapp/observe` (canonicalJson)
 * and the local frozen `./package-contract` (same package — retrieval
 * imports no contract owner at all, and needs nothing from `./compat-graph`
 * at runtime: v0.1 retrieval signals are all single-manifest facts).
 *
 * THE CONTRACT (v0.1): `retrievePackages(manifests, query)` validates EVERY
 * manifest with the frozen `validatePackageManifest` and the query against
 * the RetrievalQuery v0.1 vocabulary, then ranks the candidates that pass
 * the CANDIDACY GATE —
 *
 *   targetMatch === true          (query.target ∈ manifest.supportedTargets)
 *   requiredCoverage === 1        (EVERY required capability measured present)
 *
 * — partial coverage is NOT candidacy (honesty: a package missing a required
 * capability is excluded, never ranked). The gate is the single-manifest
 * reduction of the compat-graph target gate (CLAPP-051: a pair sharing no
 * supported target is 'unrelated' — a manifest not supporting the query
 * target is never a candidate), and v0.1's frozen formula carries NO
 * dependency-compatibility term, so nothing here can contradict the graph's
 * runtime-conflict rule. Every signal is MEASURED from the manifest:
 *
 *   targetMatch      manifest.supportedTargets membership (measured)
 *   requiredCoverage matched / required, over SET intersection (measured; 1 when none required)
 *   optionalCoverage matched / optional, over SET intersection (measured; 0 when none requested)
 *   similarity       Jaccard token overlap between purposeHint and manifest.purpose
 *                    (measured lexical placeholder — NOT semantic; embeddings are a later lane)
 *   parityHistory    manifest.evidence.length (measured list length)
 *   repairCost       manifest.failureModes.length (measured list length)
 *   recencyRank      0-based rank over ALL considered manifests by generatedAt
 *                    DESCENDING (RFC3339 lexical compare), tie-break id ASC
 *
 * THE FROZEN COMPOSITE (v0.1 weights — re-weighting requires a contract
 * version bump, never a quiet tune):
 *
 *   score = 40 * requiredCoverage
 *         + 15 * optionalCoverage
 *         + 15 * similarity
 *         + 10 * min(parityHistory, 5) / 5
 *         -  6 * min(repairCost, 5) / 5
 *         +  6 * (1 / (1 + recencyRank))
 *
 * Ranking is score DESCENDING with a deterministic id-ASCENDING tie-break;
 * `maxResults` truncates AFTER ranking (never before). Scores, counts and
 * coverage ratios in reasons are all MEASURED, never asserted.
 *
 * FAIL-CLOSED: results, never exceptions. A non-array manifest list, ANY
 * invalid manifest entry, a duplicate minted id, or an invalid query
 * (missing/empty target, non-array capability lists, non-positive-integer
 * maxResults, an UNKNOWN FIELD — typo safety: a mistyped field name must
 * not silently degrade the query) returns `{ ok: false, errors }` with
 * every error collected and NAMED. An EMPTY corpus with a valid query is a
 * legal, honest retrieval: zero candidates, `considered 0`, still digested.
 *
 * DETERMINISM: same manifests in ANY input order + same query → deep-equal
 * result. No clock, no randomness, no network, no filesystem reads; the
 * module never mutates its inputs. The query identity is content-addressed:
 * `queryDigest = 'rq_' + sha256Hex(canonicalJson(normalizedQuery))` where
 * the normalized query omits absent optional fields (never nulls) and
 * canonicalizes capability arrays (sorted, deduped — array order is caller
 * presentation, not query semantics). The `'rq_'` prefix is THIS packet's
 * frozen proposal — the same id discipline as `pkg_` / `cgraph_`; changing
 * it changes every minted query digest and requires a contract bump.
 *
 * HONEST LIMITATION (v0.1): generatedAt comparison is LEXICAL over the
 * RFC3339 text — correct for same-offset (e.g. all-UTC 'Z') timestamps,
 * which is the shape the extractor emits and the corpus discipline keeps;
 * mixed-offset ordering is a documented future refinement, not a silent
 * reinterpretation.
 */

import { sha256Hex } from '@clapp/core';
import { canonicalJson } from '@clapp/observe';

import {
  PACKAGE_ID_PATTERN,
  PACKAGE_VERSION,
  isObject,
  preview,
  validatePackageManifest,
} from './package-contract';
import type { PackageManifest } from './package-contract';

// ---- the retrieval contract v0.1 ---------------------------------------------------

/** The retrieval contract version (bumps only via a tech-lead declaration wave). */
export const RETRIEVAL_VERSION = '0.1';

/** The minted query-digest prefix — THIS packet's frozen proposal (same discipline as `pkg_`). */
const RETRIEVAL_QUERY_PREFIX = 'rq_';

/**
 * The retrieval query (v0.1). `target` and `requiredCapabilities` are
 * required (an empty required list is legal — every target-matching
 * manifest is then a candidate with coverage 1); the remaining fields are
 * optional and OMITTED from the digest when absent. Unknown fields are a
 * fail-closed error — a mistyped field name must never silently degrade
 * the query.
 */
export interface RetrievalQuery {
  /** The deployment target the caller is composing for (e.g. 'web'). */
  target: string;
  /** Capabilities the caller REQUIRES; partial coverage is not candidacy. */
  requiredCapabilities: string[];
  /** Capabilities the caller would LIKE — measured, weighted, never gating. */
  optionalCapabilities?: string[];
  /** Free text compared to manifest.purpose by the lexical placeholder. */
  purposeHint?: string;
  /** Positive integer; truncates the ranking AFTER sorting. */
  maxResults?: number;
}

/** The measured signals behind one candidate's score (every value derived, never asserted). */
export interface RetrievalScoreComponents {
  /** query.target ∈ manifest.supportedTargets (measured membership). */
  targetMatch: boolean;
  /** Matched required capabilities / required count (measured; 1 when none required). */
  requiredCoverage: number;
  /** Matched optional capabilities / optional count (measured; 0 when none requested). */
  optionalCoverage: number;
  /** Lexical token-overlap similarity, 0..1 (measured placeholder, not semantic). */
  similarity: number;
  /** manifest.evidence.length (measured; the formula caps its effect at 5). */
  parityHistory: number;
  /** manifest.failureModes.length (measured; the formula caps its effect at 5). */
  repairCost: number;
  /** 0-based generatedAt-DESCENDING rank over all considered manifests (id ASC tie-break). */
  recencyRank: number;
}

/** One gate-passing manifest, scored and honestly reasoned. */
export interface ScoredCandidate {
  /** The manifest's minted id. */
  id: string;
  /** manifest.version. */
  version: string;
  /** The frozen composite (see the module header for the formula). */
  score: number;
  /** The seven measured signals the composite consumed. */
  components: RetrievalScoreComponents;
  /** Honest, deterministic, sorted, deduped — every number measured. */
  reasons: string[];
}

/** The whole retrieval outcome for one digested query. */
export interface RetrievalResult {
  /** RETRIEVAL_VERSION ('0.1'). */
  retrievalVersion: string;
  /** Content-addressed query identity: 'rq_' + sha256Hex(canonicalJson(normalized query)). */
  queryDigest: string;
  /** Gate-passing manifests, score DESC, id ASC, truncated by maxResults AFTER ranking. */
  candidates: ScoredCandidate[];
  /** Valid input manifests (measured — invalid inputs failed closed before counting). */
  considered: number;
  /** Considered manifests the candidacy gate excluded (measured). */
  excluded: number;
  /** Honest, deterministic, sorted, deduped result-level facts. */
  reasons: string[];
}

/** Fail-closed result: a retrieval, or every collected input error. */
export type RetrieveResult =
  | { ok: true; result: RetrievalResult }
  | { ok: false; errors: string[] };

// ---- the query contract (fail-closed validation + canonical normalization) ----------

/** The RetrievalQuery v0.1 vocabulary — anything else is a fail-closed typo guard. */
const QUERY_FIELDS = [
  'target',
  'requiredCapabilities',
  'optionalCapabilities',
  'purposeHint',
  'maxResults',
] as const;

/** The canonicalized query — the digest minting input (absent optionals OMITTED, arrays canonical). */
interface NormalizedQuery {
  target: string;
  requiredCapabilities: string[];
  optionalCapabilities?: string[];
  purposeHint?: string;
  maxResults?: number;
}

/** Sorted, deduped copy — canonical order for both measurement and digests. */
function canonicalList(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function checkStringList(errors: string[], field: string, value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    errors.push(`${field}: expected an array of non-empty strings, got ${preview(value)}`);
    return undefined;
  }
  let valid = true;
  value.forEach((entry, index) => {
    if (typeof entry !== 'string' || entry.length === 0) {
      errors.push(`${field}[${index}]: expected a non-empty string, got ${preview(entry)}`);
      valid = false;
    }
  });
  return valid ? (value as string[]) : undefined;
}

/**
 * Fail-closed query validation + normalization. Collects EVERY error (each
 * names its field); treats an explicitly-undefined optional field as ABSENT
 * (the observe prune-undefined discipline) but rejects nulls, wrong types,
 * empty `target`, non-positive-integer `maxResults`, and UNKNOWN fields.
 */
function normalizeQuery(query: unknown, errors: string[]): NormalizedQuery | undefined {
  if (!isObject(query)) {
    errors.push(`query: expected an object (a RetrievalQuery v${RETRIEVAL_VERSION}), got ${preview(query)}`);
    return undefined;
  }

  for (const key of Object.keys(query)) {
    if (!QUERY_FIELDS.includes(key as (typeof QUERY_FIELDS)[number])) {
      errors.push(
        `query: unknown field ${JSON.stringify(key)} — the RetrievalQuery v${RETRIEVAL_VERSION} vocabulary is exactly ${QUERY_FIELDS.map((field) => JSON.stringify(field)).join(', ')}`,
      );
    }
  }

  let valid = true;

  if (typeof query.target !== 'string' || query.target.length === 0) {
    errors.push(`query.target: expected a non-empty string, got ${preview(query.target)}`);
    valid = false;
  }

  const requiredRaw = query.requiredCapabilities;
  if (requiredRaw === undefined) {
    errors.push(`query.requiredCapabilities: expected an array of non-empty strings, got undefined`);
    valid = false;
  }
  const required = requiredRaw === undefined ? undefined : checkStringList(errors, 'query.requiredCapabilities', requiredRaw);
  if (required === undefined && requiredRaw !== undefined) {
    valid = false;
  }

  let optional: string[] | undefined;
  if (query.optionalCapabilities !== undefined) {
    const checked = checkStringList(errors, 'query.optionalCapabilities', query.optionalCapabilities);
    if (checked === undefined) {
      valid = false;
    } else {
      optional = checked;
    }
  }

  if (query.purposeHint !== undefined && (typeof query.purposeHint !== 'string' || query.purposeHint.length === 0)) {
    errors.push(
      `query.purposeHint: expected a non-empty string when present, got ${preview(query.purposeHint)}`,
    );
    valid = false;
  }

  if (query.maxResults !== undefined) {
    const value = query.maxResults;
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
      errors.push(
        `query.maxResults: expected a positive integer when present, got ${preview(value)}`,
      );
      valid = false;
    }
  }

  if (!valid || typeof query.target !== 'string' || required === undefined) {
    return undefined;
  }

  const normalized: NormalizedQuery = {
    target: query.target,
    requiredCapabilities: canonicalList(required),
  };
  if (optional !== undefined) {
    normalized.optionalCapabilities = canonicalList(optional);
  }
  if (typeof query.purposeHint === 'string') {
    // reached only when the check above passed (valid === true here) — the
    // typeof guard exists purely to narrow `unknown` for the assignment
    normalized.purposeHint = query.purposeHint;
  }
  if (typeof query.maxResults === 'number') {
    normalized.maxResults = query.maxResults;
  }
  return normalized;
}

// ---- the measured signals (pure, deterministic, honest) ------------------------------

/** Lowercase whitespace-token set of a text — the lexical placeholder's vocabulary. */
function tokenSet(text: string): Set<string> {
  return new Set(text.trim().toLowerCase().split(/\s+/).filter((token) => token.length > 0));
}

/**
 * The similarity signal: Jaccard token overlap |A ∩ B| / |A ∪ B| between the
 * purpose hint and the manifest purpose. MEASURED lexical placeholder —
 * token-set overlap says nothing about meaning ('form route' vs 'route
 * form' is similarity 1); semantic/embedding similarity is a later lane
 * and is never simulated here. Either side tokenless → 0 (measured
 * nothing-to-compare, never a fabricated midpoint).
 */
function lexicalSimilarity(hintTokens: Set<string>, purposeTokens: Set<string>): number {
  if (hintTokens.size === 0 || purposeTokens.size === 0) return 0;
  let intersectionSize = 0;
  for (const token of hintTokens) {
    if (purposeTokens.has(token)) intersectionSize += 1;
  }
  const unionSize = hintTokens.size + purposeTokens.size - intersectionSize;
  return intersectionSize / unionSize;
}

/** The matched subset, canonically ordered (for honest reasons). */
function matchedList(queryCapabilities: readonly string[], manifestCapabilities: readonly string[]): string[] {
  const owned = new Set(manifestCapabilities);
  return queryCapabilities.filter((capability) => owned.has(capability));
}

/**
 * The frozen composite (module header). The exact expression shape is part
 * of the freeze: `(10 * min(parityHistory, 5)) / 5` — integer numerator
 * over 5 — and `6 * (1 / (1 + recencyRank))` — reciprocal FIRST, then scale.
 */
function compositeScore(components: RetrievalScoreComponents): number {
  return (
    40 * components.requiredCoverage +
    15 * components.optionalCoverage +
    15 * components.similarity +
    (10 * Math.min(components.parityHistory, 5)) / 5 -
    (6 * Math.min(components.repairCost, 5)) / 5 +
    6 * (1 / (1 + components.recencyRank))
  );
}

/** Honest list rendering for reasons: the JSON array text of the actual values. */
function renderList(values: readonly string[]): string {
  return JSON.stringify([...values]);
}

// ---- the retrieval -------------------------------------------------------------------

/**
 * Retrieve ranked package candidates over PackageManifest v0.1 entries.
 * Async because the query identity hashes (sha256Hex over the canonical
 * normalized query). Fail-closed: a non-array manifest list, ANY invalid
 * manifest entry, a duplicate minted id, or an invalid query returns
 * `{ ok: false, errors }` — never an exception. An empty corpus with a
 * valid query is a legal, honest retrieval (zero candidates, still digested).
 */
export async function retrievePackages(manifests: unknown, query: unknown): Promise<RetrieveResult> {
  // ---- 1. fail-closed input validation FIRST (results, never exceptions) ----
  if (!Array.isArray(manifests)) {
    return {
      ok: false,
      errors: [
        `manifests: expected an array of PackageManifest v${PACKAGE_VERSION} entries, got ${preview(manifests)}`,
      ],
    };
  }

  const errors: string[] = [];
  const valid: PackageManifest[] = [];

  // ---- 1a. every entry must pass the frozen validator; ALL errors collected ----
  for (let index = 0; index < manifests.length; index++) {
    const entry: unknown = manifests[index];
    const check = validatePackageManifest(entry);
    if (check.ok) {
      valid.push(entry as PackageManifest); // validation passed — the cast is earned
      continue;
    }
    for (const error of check.errors) {
      errors.push(`manifests[${index}]: ${error}`); // names the index AND (inside) the field
    }
  }

  // ---- 1b. duplicate minted ids (the same discipline as the compat graph:
  //         ranking one package twice would be dishonest counting) ----
  const firstSeen = new Map<string, number>();
  for (let index = 0; index < manifests.length; index++) {
    const entry: unknown = manifests[index];
    if (!isObject(entry)) continue; // its shape error is already reported above
    const id = entry.id;
    if (typeof id !== 'string' || !PACKAGE_ID_PATTERN.test(id)) {
      continue; // not a minted id — no duplicate claim is fabricated
    }
    const firstIndex = firstSeen.get(id);
    if (firstIndex === undefined) {
      firstSeen.set(id, index);
    } else {
      errors.push(`duplicate package id ${id} at indexes ${firstIndex} and ${index}`);
    }
  }

  // ---- 1c. the query contract (typo-safe vocabulary, all errors named) ----
  const normalized = normalizeQuery(query, errors);

  if (errors.length > 0 || normalized === undefined) {
    return { ok: false, errors };
  }

  // ---- 2. content-addressed query identity (the digest is minted FROM the normalized query) ----
  let queryDigest: string;
  try {
    queryDigest = `${RETRIEVAL_QUERY_PREFIX}${await sha256Hex(canonicalJson(normalized))}`;
  } catch {
    // Unreachable for a validated query (strings, string arrays, one integer)
    // — but fail-closed beats a thrown CanonicalJsonError: the identity is
    // never guessed.
    return {
      ok: false,
      errors: [
        'the normalized query is not canonical-JSON serializable — the query identity cannot be computed honestly',
      ],
    };
  }

  // ---- 3. recency ranks over ALL considered manifests (generatedAt DESC, id ASC) ----
  const recencyOrder = [...valid].sort((left, right) => {
    if (left.generatedAt !== right.generatedAt) {
      return left.generatedAt > right.generatedAt ? -1 : 1; // DESC — newest ranks first
    }
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0; // id ASC tie-break
  });
  const recencyRankById = new Map<string, number>();
  recencyOrder.forEach((manifest, index) => {
    recencyRankById.set(manifest.id, index);
  });

  // ---- 4. measure every signal, apply the candidacy gate, reason honestly ----
  const required = normalized.requiredCapabilities;
  const optional = normalized.optionalCapabilities ?? [];
  const hintTokens = normalized.purposeHint === undefined ? undefined : tokenSet(normalized.purposeHint);

  const candidates: ScoredCandidate[] = [];
  const exclusionReasons: string[] = [];

  for (const manifest of valid) {
    const targetMatch = manifest.supportedTargets.includes(normalized.target);
    const requiredMatched = matchedList(required, manifest.capabilities);
    const requiredCoverage =
      required.length === 0 ? 1 : requiredMatched.length / required.length;
    const optionalMatched = matchedList(optional, manifest.capabilities);
    const optionalCoverage =
      optional.length === 0 ? 0 : optionalMatched.length / optional.length;
    const similarity =
      hintTokens === undefined ? 0 : lexicalSimilarity(hintTokens, tokenSet(manifest.purpose));
    const parityHistory = manifest.evidence.length;
    const repairCost = manifest.failureModes.length;
    const recencyRank = recencyRankById.get(manifest.id) ?? 0; // every valid manifest is ranked

    const components: RetrievalScoreComponents = {
      targetMatch,
      requiredCoverage,
      optionalCoverage,
      similarity,
      parityHistory,
      repairCost,
      recencyRank,
    };

    if (!targetMatch || requiredCoverage !== 1) {
      // the candidacy gate — honest, per-exclusion reasons (measured facts)
      if (!targetMatch) {
        exclusionReasons.push(
          `${manifest.id} excluded — query target ${JSON.stringify(normalized.target)} is not among the measured supportedTargets ${renderList(manifest.supportedTargets)}`,
        );
      }
      if (requiredCoverage !== 1) {
        const missing = required.filter((capability) => !requiredMatched.includes(capability));
        exclusionReasons.push(
          `${manifest.id} excluded — required capability coverage ${requiredMatched.length} of ${required.length} measured: missing ${renderList(missing)}`,
        );
      }
      continue; // partial coverage is NOT candidacy — excluded, never ranked
    }

    const reasons: string[] = [
      `target match measured — query target ${JSON.stringify(normalized.target)} is among supportedTargets ${renderList(manifest.supportedTargets)}`,
      required.length === 0
        ? 'no required capabilities requested — coverage is vacuously complete (0 of 0 matched)'
        : `required capabilities covered — ${requiredMatched.length} of ${required.length} measured: matched ${renderList(requiredMatched)}`,
      optional.length === 0
        ? 'no optional capabilities requested — optional coverage 0 (measured)'
        : `optional capabilities — ${optionalMatched.length} of ${optional.length} measured: matched ${renderList(optionalMatched)}`,
      hintTokens === undefined
        ? 'similarity 0 measured — no purpose hint in the query (the lexical placeholder compares nothing)'
        : `similarity ${String(similarity)} measured — lexical token overlap over purpose text, not semantic`,
      `parity history — ${parityHistory} evidence entries measured (the score caps at 5)`,
      `repair cost — ${repairCost} failure modes measured (the score caps at 5)`,
      `recency rank ${recencyRank} of ${valid.length} considered manifests measured (generatedAt descending, id ascending tie-break)`,
    ];

    candidates.push({
      id: manifest.id,
      version: manifest.version,
      score: compositeScore(components),
      components,
      reasons: [...new Set(reasons)].sort(), // canonical order, deterministic
    });
  }

  // ---- 5. rank: score DESC, id ASC; maxResults truncates AFTER ranking ----
  candidates.sort((left, right) => {
    if (left.score !== right.score) {
      return left.score > right.score ? -1 : 1; // score DESC
    }
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0; // id ASC tie-break
  });

  const considered = valid.length; // measured
  const excluded = considered - candidates.length; // measured — gate failures only
  const ranked = candidates.length; // measured BEFORE truncation

  const truncated =
    normalized.maxResults !== undefined && normalized.maxResults < candidates.length
      ? normalized.maxResults
      : candidates.length;
  const kept = candidates.slice(0, truncated);

  // ---- 6. honest result-level reasons (measured counts, sorted + deduped) ----
  const resultReasons: string[] = [
    `considered ${considered} valid manifests (measured)`,
    `excluded ${excluded} manifests by the candidacy gate (measured)`,
    `ranked ${ranked} candidates (measured)`,
    ...exclusionReasons,
  ];
  if (truncated < ranked) {
    resultReasons.push(
      `truncated to ${truncated} of ${ranked} ranked candidates by maxResults ${normalized.maxResults} (measured, truncation applied after ranking)`,
    );
  }
  if (kept.length === 0) {
    resultReasons.push(
      considered === 0
        ? 'no candidate satisfies the query — the manifest corpus is empty (0 considered, measured)'
        : `no candidate satisfies the query — 0 of ${considered} considered manifests passed the candidacy gate (measured)`,
    );
  }

  return {
    ok: true,
    result: {
      retrievalVersion: RETRIEVAL_VERSION,
      queryDigest,
      candidates: kept,
      considered,
      excluded,
      reasons: [...new Set(resultReasons)].sort(), // canonical order, deterministic
    },
  };
}
