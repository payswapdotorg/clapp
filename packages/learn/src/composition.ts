/**
 * @clapp/learn — the composition planner (CLAPP-063, the P6 FOURTH lane —
 * Worker 2, Behavioral Model and Package Learning, the composition-planning
 * owner per docs/WORKER_HANDOFFS.md).
 *
 * docs/LEARNING_AND_LIBRARY.md §10 — the target end state's "compose" step:
 * "new app → identify archetype → retrieve 70–95% → compose → fill
 * target-specific gaps → verify" (the percentages are aspirational, never
 * acceptance). The archetype step landed as CLAPP-062; the retrieval landed
 * as CLAPP-052. THIS module is the compose step's executable seed: it turns
 * a digested retrieval query over a manifest corpus into a greedy,
 * rank-ordered composition PLAN — a proposal, not a product (see the
 * boundary below).
 *
 * THE CONTRACT (v0.1): `planComposition(corpus, query, options)` returns a
 * CompositionResult — a CompositionPlan or a fail-closed error list. The
 * plan carries the SELECTED components (the retrieval-ranked candidates
 * that survived the compat gate, in selection order = greedy rank order),
 * the EXCLUDED components (each with its honest reason: the binding
 * conflict, the binding disjointness, or the rank cut), the MEASURED facts
 * (candidates the retrieval ranked, edges of the induced subgraph over the
 * ranked candidates), the query digest carried VERBATIM from the retrieval
 * result, the caller-injected plannedAt, and a content-addressed identity
 * `comp_ + sha256Hex(canonicalJson(plan minus id))`.
 *
 * THE PIPELINE (deterministic; every step delegates to the FROZEN
 * @clapp/library machinery — never a re-implementation):
 *
 *   0. the caller contract — options `{ plannedAt, maxComponents? }` is
 *      validated FIRST (the 060/061/062 house pattern: observedAt /
 *      classifiedAt / plannedAt first): plannedAt RFC3339 calendar-valid
 *      (2026-02-30 refused), maxComponents a positive integer when
 *      present. ALL of the planner's own option errors are collected
 *      (never just the first), each naming its field.
 *   1. corpus admission — `buildCompatGraph(corpus)`; a non-ok result
 *      returns `{ ok: false, errors }` with the graph's own errors carried
 *      VERBATIM (the corpus must be a validated manifest list — the graph
 *      is the authority). An empty corpus is legal and flows through.
 *   2. retrieval — `retrievePackages(corpus, query)`; a non-ok result
 *      returns the retrieval's errors VERBATIM (query validation is the
 *      retrieval's authority). The ranked candidates (score DESC, id ASC —
 *      the frozen order) enter selection; `considered` = the candidates
 *      array length (measured).
 *   3. the compat gate — the induced subgraph is built via
 *      `buildCompatGraph` over the RANKED CANDIDATES' manifests (the
 *      frozen edges are the facts; the verdict vocabulary 'compatible' |
 *      'conflict' | 'unrelated' BINDS every composition decision). The
 *      walk is greedy in frozen retrieval-rank order, keeping a running
 *      SELECTED list; for each candidate:
 *        - RANK CUT first (categorical): a candidate whose measured rank
 *          is beyond `maxComponents` (rank >= maxComponents) is EXCLUDED
 *          with the rank-cut reason naming that measured rank — the cap
 *          disqualifies the position regardless of verdicts;
 *        - otherwise the pairwise verdict against EVERY already-selected
 *          component is read from the induced graph's edge; verdict
 *          'conflict' on any pair → EXCLUDE (reason names both ids and
 *          the conflict rule); else verdict 'unrelated' on any pair →
 *          EXCLUDE (reason names both ids and the target disjointness);
 *          else SELECT (append). The binding pair named is the FIRST in
 *          selection order (deterministic; the conflict check is the
 *          cascade's first test — any-pair semantics, per §3.2's order).
 *        The FIRST candidate is always selected (no pairs yet — and rank 0
 *        is never rank-cut, maxComponents being a positive integer).
 *   4. the plan — selected in selection order, excluded in canonical
 *      order (id, then version), the measured facts, the queryDigest
 *      carried verbatim, plannedAt from options, and the comp_ id minted
 *      over the canonical serialization of the plan MINUS its id.
 *
 * THE BINDING-VERDICTS LAW: the planner re-implements NOTHING. Corpus
 * validation, query validation, the ranking, the score composite, the
 * verdict vocabulary, and every pairwise verdict are the frozen library's;
 * the planner only WALKS the ranked order and READS the frozen edges. The
 * corpus is even validated twice (the admission graph, then the induced
 * graph's own admission of the candidate manifests) — the price of never
 * re-implementing validation, paid gladly.
 *
 * HONEST LIMITATION (disclosed, structural): the frozen retrieval's
 * candidacy gate requires `query.target ∈ manifest.supportedTargets`, so
 * ANY TWO RANKED CANDIDATES share at least the query target — the
 * retrieval's own header documents the gate as "the single-manifest
 * reduction of the compat-graph target gate (a pair sharing no supported
 * target is 'unrelated' — a manifest not supporting the query target is
 * never a candidate)". The walk's 'unrelated' branch is therefore
 * DEFENSIVE COMPLETENESS over the frozen verdict vocabulary: implemented
 * per the work order §3.2, honest in its reason, and unreachable through
 * planComposition in v0.1 (a target-disjoint candidate is excluded by the
 * frozen target gate BEFORE ranking — never a plan-level exclusion). A
 * future retrieval contract that relaxed the gate would find the branch
 * already implemented; nothing here pre-judges that contract.
 *
 * FIRST RUNTIME LIBRARY CONSUMER: this is the first @clapp/learn module
 * that consumes the landed library machinery LIVE — `retrievePackages` +
 * `buildCompatGraph` are RUNTIME imports, so @clapp/library is a
 * (production) dependency of @clapp/learn (the work order's §4 licensing;
 * the import-discipline test's runtime set gains it accordingly). The
 * runtime dependency set is exactly @clapp/core (sha256Hex), @clapp/observe
 * (canonicalJson) and @clapp/library (retrievePackages + buildCompatGraph);
 * @clapp/diff and @clapp/repair remain import-type ONLY contract owners.
 *
 * THE BOUNDARY (proposal, not product): the plan is §10's "compose" step
 * only. Gap-filling ("fill target-specific gaps") and verification
 * ("verify") are LATER, OTHER machinery — the planner neither fills gaps,
 * nor generates code, nor verifies parity, nor benchmarks; it proposes a
 * deterministic, honest selection with every exclusion reason named.
 *
 * DETERMINISM + HONESTY LAWS (binding — the 060/061/062 house rules):
 * - Fail closed: results, never exceptions. Every input error is collected
 *   and NAMED (the option errors by the planner; corpus errors by the
 *   frozen graph, carried verbatim; query errors by the frozen retrieval,
 *   carried verbatim). Unreachable-in-practice derivation failures (a
 *   ranked candidate missing from the admitted corpus, a missing induced
 *   edge, a canonicalization refusal) are NAMED errors too — never a
 *   guessed fact, never an escaped exception.
 * - No clock, no randomness, no network, no filesystem. plannedAt is
 *   CALLER-injected (RFC3339 calendar-valid); every other input enters
 *   through the frozen library calls.
 * - Same corpus + query + options → deep-equal plan, identical comp_ id.
 *   The plan is also CORPUS-INPUT-ORDER independent: the admission graph,
 *   the retrieval ranking, and the induced graph are all order-independent
 *   frozen derivations, and the excluded list is canonically sorted (id,
 *   then version) after the walk.
 * - The planner never mutates its inputs: the corpus, query and options
 *   are read only; every selected/excluded record is a fresh object; the
 *   score is a primitive carried verbatim from the retrieval composite.
 * - Counts are MEASURED, never asserted: `considered` counts the ranked
 *   candidates array; `graphEdgeCount` counts the induced graph's actual
 *   edges; `rank` is the candidate's measured position in the frozen
 *   ranking; `score` is the frozen composite carried verbatim.
 * - The `'comp_'` prefix is THIS packet's frozen proposal, in the repo's
 *   pkg_ / cgraph_ / rq_ / creg_ / fail_ / fmem_ / rpat_ / arch_ prefix
 *   discipline; changing it changes every minted plan id and requires a
 *   contract version bump (only via a tech-lead declaration wave).
 */

import { sha256Hex } from '@clapp/core';
import { canonicalJson } from '@clapp/observe';
import { buildCompatGraph, retrievePackages } from '@clapp/library';
import type { CompatEdge, CompatibilityVerdict, PackageManifest } from '@clapp/library';

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
 * RFC3339 check: lexical shape + REAL calendar validity — the house helper
 * discipline (the 060/061/062 precedent, itself from @clapp/library
 * package-contract.ts), copied so the module's runtime dependency set stays
 * exactly @clapp/core + @clapp/observe + @clapp/library. `Date.parse` is
 * deliberately NOT used — it accepts rollover dates such as 2026-02-30.
 * Honest limitation: the leap-second form (second === 60) is not accepted,
 * matching what a JS Date can represent.
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

// ---- the composition contract v0.1 --------------------------------------------------

/** The composition contract version (bumps only via a tech-lead declaration wave). */
export const COMPOSITION_VERSION = '0.1';

/**
 * The plan-id prefix — THIS lane's frozen proposal in the `pkg_` /
 * `cgraph_` / `rq_` / `creg_` / `fail_` / `fmem_` / `rpat_` / `arch_`
 * prefix discipline: `comp_` + 64 lowercase hex chars. Changing it changes
 * every minted id and requires a contract version bump.
 */
const COMPOSITION_ID_PREFIX = 'comp_';

/** One selected component (a retrieval-ranked candidate that survived the compat gate). */
export interface SelectedComponent {
  /** The manifest's minted id. */
  id: string;
  /** manifest.version — the immutable package version. */
  version: string;
  /** The retrieval composite (measured, carried verbatim). */
  score: number;
  /** 0-based retrieval rank (measured). */
  rank: number;
}

/** One exclusion with its honest reason. */
export interface ExcludedComponent {
  /** The manifest's minted id. */
  id: string;
  /** manifest.version. */
  version: string;
  /** Names the binding fact (conflict / unrelated / rank cut). */
  reason: string;
}

/** The composition plan — derived, deterministic, honest. */
export interface CompositionPlan {
  /** COMPOSITION_VERSION ('0.1'). */
  compositionVersion: string;
  /** Content-addressed: 'comp_' + sha256Hex(canonicalJson(plan minus id)). */
  id: string;
  /** The retrieval query digest (rq_…) — carried verbatim from the retrieval result. */
  queryDigest: string;
  /** In selection order (greedy rank order). */
  selected: SelectedComponent[];
  /** Canonical order (id, then version). */
  excluded: ExcludedComponent[];
  /** MEASURED: candidates the retrieval ranked. */
  considered: number;
  /** MEASURED: edges of the induced subgraph over the ranked candidates. */
  graphEdgeCount: number;
  /** RFC3339 — CALLER-injected; the planner never reads a clock. */
  plannedAt: string;
}

/** Fail-closed result: a plan, or every collected input error. */
export type CompositionResult =
  | { ok: true; plan: CompositionPlan }
  | { ok: false; errors: string[] };

// ---- the caller contract (options) ---------------------------------------------------

/** The planner's own options (validated fail-closed, all errors collected). */
interface PlannerOptions {
  /** RFC3339 calendar-valid — CALLER-injected; the planner never reads a clock. */
  plannedAt: string;
  /** When present: a positive integer; candidates ranked beyond it are rank-cut. */
  maxComponents?: number;
}

/**
 * Fail-closed options validation. Collects EVERY error (each names its
 * field); treats an explicitly-undefined `maxComponents` as ABSENT (the
 * observe prune-undefined discipline) but rejects non-objects, a missing or
 * non-RFC3339 `plannedAt` (calendar-valid — 2026-02-30 refused), and a
 * `maxComponents` that is not a positive integer.
 */
function validateOptions(options: unknown, errors: string[]): PlannerOptions | undefined {
  if (!isObject(options)) {
    errors.push(`options: expected an object { plannedAt, maxComponents? }, got ${preview(options)}`);
    return undefined;
  }

  let valid = true;

  let plannedAt: string | undefined;
  const rawPlannedAt = options['plannedAt'];
  if (!isRfc3339(rawPlannedAt)) {
    errors.push(
      `options.plannedAt: expected an RFC3339 date-time string (caller-injected — the planner never reads a clock), got ${preview(rawPlannedAt)}`,
    );
    valid = false;
  } else {
    plannedAt = rawPlannedAt;
  }

  let maxComponents: number | undefined;
  const rawMax = options['maxComponents'];
  if (rawMax !== undefined) {
    if (typeof rawMax !== 'number' || !Number.isInteger(rawMax) || rawMax <= 0) {
      errors.push(
        `options.maxComponents: expected a positive integer when present, got ${preview(rawMax)}`,
      );
      valid = false;
    } else {
      maxComponents = rawMax;
    }
  }

  if (!valid || plannedAt === undefined) {
    return undefined;
  }
  const normalized: PlannerOptions = { plannedAt };
  if (maxComponents !== undefined) {
    normalized.maxComponents = maxComponents;
  }
  return normalized;
}

// ---- the greedy walk's frozen-edge lookup --------------------------------------------

/**
 * The pairwise verdict between two ranked candidates, read from the induced
 * graph's edge (the edge's own frozen derivation — never re-computed here).
 * The graph emits exactly one edge per unordered pair with `left` ALWAYS
 * the lexicographically smaller id, so the lookup key is order-independent.
 * `undefined` only if the edge is missing — unreachable by construction,
 * and always a named error at the call site (a missing fact is never a
 * guessed verdict).
 */
function verdictBetween(
  edges: ReadonlyMap<string, CompatEdge>,
  firstId: string,
  secondId: string,
): CompatibilityVerdict | undefined {
  const key = firstId < secondId ? `${firstId}|${secondId}` : `${secondId}|${firstId}`;
  return edges.get(key)?.verdict;
}

// ---- the composition planner -----------------------------------------------------------

/**
 * Plan a composition: a greedy, rank-ordered selection over the frozen
 * retrieval's ranked candidates, bound by the frozen compat-graph verdicts.
 * Async because the retrieval, the graphs and the plan identity all hash
 * (sha256Hex over canonical serializations).
 *
 * Fail closed: results, never exceptions. The planner's own option errors
 * are collected with their fields named; the corpus's admission errors are
 * the frozen graph's own, carried VERBATIM; the query's errors are the
 * frozen retrieval's own, carried VERBATIM. An EMPTY corpus with a valid
 * query and options plans legally: zero selected, zero excluded, measured
 * zeros, the rq_ digest carried, a valid comp_ id.
 *
 * Deterministic: the same corpus (in ANY input order) + query + options
 * produce a deep-equal plan with an identical comp_ id. No clock, no
 * randomness, no network, no filesystem; the inputs are never mutated.
 */
export async function planComposition(
  corpus: unknown,
  query: unknown,
  options: unknown,
): Promise<CompositionResult> {
  // ---- 0. the caller contract (options) — validated FIRST, all errors collected ----
  const optionErrors: string[] = [];
  const plannerOptions = validateOptions(options, optionErrors);
  if (plannerOptions === undefined) {
    return { ok: false, errors: optionErrors };
  }
  const { plannedAt, maxComponents } = plannerOptions;

  // ---- 1. corpus admission (fail-closed; the frozen graph is the authority) ----
  // The corpus must be a validated manifest list — buildCompatGraph's
  // fail-closed result is the single admission gate; its errors are the
  // graph's own, carried verbatim. An empty corpus admits legally.
  const admission = await buildCompatGraph(corpus);
  if (!admission.ok) {
    return { ok: false, errors: admission.errors };
  }
  // Validation passed — the unknown corpus is an array of validated
  // manifests (the cast is earned; the same discipline the frozen modules
  // apply after their own validators). Read only — never mutated.
  const corpusManifests = corpus as PackageManifest[];
  const manifestById = new Map<string, PackageManifest>();
  for (const manifest of corpusManifests) {
    manifestById.set(manifest.id, manifest); // ids are unique — duplicates were refused above
  }

  // ---- 2. retrieval (the frozen ranking; query validation is its authority) ----
  const retrieval = await retrievePackages(corpus, query);
  if (!retrieval.ok) {
    return { ok: false, errors: retrieval.errors };
  }
  const candidates = retrieval.result.candidates;
  const considered = candidates.length; // MEASURED — the ranked candidates

  // ---- 3a. the induced subgraph over the RANKED CANDIDATES' manifests ----
  // The frozen edges are the facts (built by the frozen builder, never
  // re-implemented): every unordered pair of ranked candidates carries
  // exactly one derived verdict, and those verdicts BIND the walk below.
  const candidateManifests: PackageManifest[] = [];
  for (const candidate of candidates) {
    const manifest = manifestById.get(candidate.id);
    if (manifest === undefined) {
      // Unreachable: every ranked candidate came from the corpus the
      // admission graph just validated — but fail-closed beats a guessed
      // manifest. The disagreement is NAMED, never papered over.
      return {
        ok: false,
        errors: [
          `composition: ranked candidate ${candidate.id} has no manifest in the admitted corpus — the retrieval and the graph disagree (measured admitted manifests: ${manifestById.size})`,
        ],
      };
    }
    candidateManifests.push(manifest);
  }
  const induced = await buildCompatGraph(candidateManifests);
  if (!induced.ok) {
    // Unreachable in practice (validated manifests, unique ids — the
    // admission already proved both) — the errors are carried verbatim
    // regardless; the discipline is unconditional.
    return { ok: false, errors: induced.errors };
  }
  const graphEdgeCount = induced.graph.edges.length; // MEASURED

  const edgeByPair = new Map<string, CompatEdge>();
  for (const edge of induced.graph.edges) {
    edgeByPair.set(`${edge.left}|${edge.right}`, edge);
  }

  // ---- 3b. the greedy compat walk (rank-ordered; the frozen verdicts bind) ----
  const selected: SelectedComponent[] = [];
  const excluded: ExcludedComponent[] = [];

  for (let rank = 0; rank < candidates.length; rank++) {
    const candidate = candidates[rank]!;

    // The RANK CUT (categorical, evaluated before the verdicts): a
    // candidate whose measured rank is beyond maxComponents is excluded
    // with the rank named — the cap disqualifies the position regardless
    // of verdicts. Rank 0 is never cut (maxComponents is a positive
    // integer), so the FIRST candidate always reaches the walk.
    if (maxComponents !== undefined && rank >= maxComponents) {
      excluded.push({
        id: candidate.id,
        version: candidate.version,
        reason: `rank cut — measured rank ${rank} is beyond maxComponents ${maxComponents} (the greedy walk admits at most the first ${maxComponents} ranked candidates)`,
      });
      continue;
    }

    // The compat gate: the pairwise verdict against EVERY already-selected
    // component, read from the induced graph's frozen edges. The cascade is
    // §3.2's order — conflict (any pair) first, then unrelated (any pair),
    // then selection — and the binding pair named is the FIRST in
    // selection order (deterministic).
    let conflictWith: SelectedComponent | undefined;
    let disjointWith: SelectedComponent | undefined;
    for (const alreadySelected of selected) {
      const verdict = verdictBetween(edgeByPair, candidate.id, alreadySelected.id);
      if (verdict === undefined) {
        // Unreachable: the induced graph emits exactly one edge per
        // unordered pair of ranked candidates — but a MISSING fact is
        // never re-derived into a verdict here. Named, fail-closed.
        return {
          ok: false,
          errors: [
            `composition: no compat edge between ranked candidates ${candidate.id} and ${alreadySelected.id} — the induced subgraph is incomplete (measured edges: ${graphEdgeCount})`,
          ],
        };
      }
      if (verdict === 'conflict' && conflictWith === undefined) {
        conflictWith = alreadySelected;
      }
      if (verdict === 'unrelated' && disjointWith === undefined) {
        disjointWith = alreadySelected;
      }
    }

    if (conflictWith !== undefined) {
      // The frozen verdict binds: alternative runtimes never compose.
      excluded.push({
        id: candidate.id,
        version: candidate.version,
        reason: `runtime conflict with selected ${conflictWith.id} — ${candidate.id} and ${conflictWith.id} name alternative runtimes (the frozen compat-graph verdict is 'conflict': alternative runtimes never compose in v0.1)`,
      });
      continue;
    }
    if (disjointWith !== undefined) {
      // The frozen verdict binds: target-disjoint packages never compose.
      // (Defensive completeness — unreachable through the frozen
      // retrieval's target gate in v0.1; see the module header.)
      excluded.push({
        id: candidate.id,
        version: candidate.version,
        reason: `shares no target with selected ${disjointWith.id} — cannot compose — ${candidate.id} and ${disjointWith.id} share no supported target (the frozen compat-graph verdict is 'unrelated': target-disjoint packages never compose)`,
      });
      continue;
    }

    // Compatible with EVERY selected component — selected (the first
    // candidate lands here immediately: no pairs yet).
    selected.push({
      id: candidate.id,
      version: candidate.version,
      score: candidate.score, // the frozen composite, carried verbatim
      rank, // the measured 0-based retrieval rank
    });
  }

  // ---- 4. the plan (canonical excluded order: id, then version) ----
  excluded.sort((left, right) => {
    if (left.id !== right.id) {
      return left.id < right.id ? -1 : 1;
    }
    return left.version < right.version ? -1 : left.version > right.version ? 1 : 0;
  });

  // The content-addressed identity: the plan MINUS its id is the minting
  // input (the fail_ / rpat_ / arch_ discipline) — same id ⇔ identical
  // canonical plan bytes. Any measured change (a selection, an exclusion
  // reason, a count, the digest, the caller-injected clock) moves the id.
  const planBody: Omit<CompositionPlan, 'id'> = {
    compositionVersion: COMPOSITION_VERSION,
    queryDigest: retrieval.result.queryDigest, // carried VERBATIM from the retrieval
    selected,
    excluded,
    considered,
    graphEdgeCount,
    plannedAt,
  };

  // The last line of defense (the 060/061/062 precedent): a
  // canonicalization refusal is a NAMED error — never an escaped
  // exception. (The body is built from validated strings, measured
  // integers and fresh arrays, so this cannot fire in practice — the
  // discipline is kept unconditional anyway.)
  let canonical: string;
  try {
    canonical = canonicalJson(planBody);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      errors: [
        `composition minting: the derived plan is not canonical-JSON serializable (${detail})`,
      ],
    };
  }
  const id = `${COMPOSITION_ID_PREFIX}${await sha256Hex(canonical)}`;

  return { ok: true, plan: { ...planBody, id } };
}
