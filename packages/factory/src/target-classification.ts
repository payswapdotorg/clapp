/**
 * @clapp/factory — the target classifier (CLAPP-085, the P9 opener —
 * Worker 1, Observation and Platform Adapters, per
 * docs/WORKER_HANDOFFS.md; the factory lane's owner).
 *
 * docs/WORK_ITEMS.md P9: "The factory turns a build request into a
 * classified target, explores within adaptive budgets, synthesizes the
 * package graph, repairs multi-pass, and holds the release for the human
 * gate. The five frozen platform contracts (P8) and the learn lane's
 * frozen archetypes are its inputs. Do not fork the core Behavioral IR."
 * THIS module is the factory's FIRST component: the entry classification
 * that binds the five frozen P8 platform literals (android, linux,
 * windows, macos, ios — the completed CLAPP-080..084 sequence) and the
 * learn lane's frozen archetype classification (CLAPP-062, @clapp/learn,
 * v0.1) into the factory's own first frozen output, the
 * TargetClassification.
 *
 * THE BINDING (consumed, never forked): the learn lane's
 * ArchetypeClassification enters as DATA — duck-validated on exactly the
 * fields this lane consumes (archetypeVersion, outcome, matches[].name),
 * with a named error for every malformation. The shape is referenced
 * TYPE-ONLY (@clapp/learn is a devDependency — the import-discipline
 * test in test/target-classification.test.ts pins that src never touches
 * the learn lane's runtime) and is pinned structurally by the
 * compile-time LearnArchetypeBinding assertion below: a REAL learn
 * classification fits the request's classification slot as-is.
 *
 * THE LAWS (the 060–084 house discipline, binding):
 * - Fail closed: admission errors are collected — ALL of them, each
 *   naming its field and the OBSERVED VALUE — into { ok: false, errors };
 *   results, never exceptions; nothing is classified from partial data.
 * - The honest-agreement law: the learn classification's outcome and its
 *   matches MUST AGREE — outcome 'classified' with zero matches, or
 *   'unclassified' with matches present, is a NAMED inconsistency error.
 *   A classified target is derived from measured matches, never guessed.
 * - Derived, never guessed: primaryArchetype is matches[0].name — the
 *   learn table's canonical first, positional — or 'unclassified' when
 *   nothing matched; matchCount is MEASURED (matches.length), never
 *   asserted from the input's shape; the outcome is carried VERBATIM from
 *   the learn classification.
 * - Determinism: no clock (classifiedAt is CALLER-injected), no
 *   randomness, no network, no filesystem. The classification id is
 *   content-addressed — 'tcls_' + sha256Hex(canonicalJson(classification
 *   minus id minus classifiedAt)) — so classifying the same request twice
 *   yields deep-equal results, and a different caller clock never
 *   changes the id.
 * - The vocabularies are frozen: platform must be one of the five P8
 *   literals (a sixth is a named error, never a guess); budgetTier must
 *   be one of the frozen exploration-budget tiers ('minimal',
 *   'standard', 'extended') — in THIS lane the tiers are honest TAGS
 *   (the budget a tier spends is CLAPP-086's later lane).
 */

import { sha256Hex } from '@clapp/core';
import { canonicalJson } from '@clapp/observe';
import type { ArchetypeClassification } from '@clapp/learn';

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

/** Renders a frozen vocabulary for an error message (the preview discipline). */
function vocabulary(words: readonly string[]): string {
  return `[${words.map((word) => `'${word}'`).join(', ')}]`;
}

// ---- the target classifier contract v0.1 -------------------------------------------

/** The target classification's contract version (bumps only via a tech-lead declaration wave). */
export const TARGET_CLASS_VERSION = '0.1';

/** The learn-lane contract version this classifier binds (frozen — a mismatch is a named error). */
export const ARCHETYPE_BINDING_VERSION = '0.1';

/** The five frozen P8 platform literals (the binding — a sixth is a named error, never a guess). */
export const TARGET_PLATFORMS: readonly string[] = ['android', 'linux', 'windows', 'macos', 'ios'];

/** The frozen v0.1 exploration-budget tier vocabulary (the tiers CLAPP-086 will spend). */
export const BUDGET_TIERS: readonly string[] = ['minimal', 'standard', 'extended'];

/**
 * The classification-id prefix — THIS lane's frozen proposal in the
 * `pkg_` / `arch_` / `fail_` / `fmem_` / `andev_` … prefix discipline:
 * `tcls_` + 64 lowercase hex chars. Changing it changes every minted id
 * and requires a contract version bump.
 */
const TARGET_CLASS_ID_PREFIX = 'tcls_';

/** The build request — the factory's entry shape (validated fail-closed as `unknown`). */
export interface TargetRequest {
  /** The target platform — one of TARGET_PLATFORMS. */
  platform: string;
  /**
   * The learn lane's archetype classification consumed as DATA
   * (duck-validated: the fields this lane uses, named errors for every
   * malformation).
   */
  classification: {
    /** Must equal ARCHETYPE_BINDING_VERSION ('0.1'). */
    archetypeVersion: string;
    /** 'classified' | 'unclassified' (the learn lane's frozen outcome vocabulary). */
    outcome: string;
    /** The matched archetypes in the table's canonical order (name non-empty). */
    matches: Array<{ name: string }>;
  };
  /** The exploration budget tier — one of BUDGET_TIERS. */
  budgetTier: string;
}

/** The classification of one target — the factory's first frozen output. */
export interface TargetClassification {
  /** TARGET_CLASS_VERSION ('0.1'). */
  targetVersion: string;
  /**
   * Content-addressed: 'tcls_' + sha256Hex(canonicalJson(classification
   * minus id minus classifiedAt)) — deterministic, no uuid, no clock.
   * Excluding classifiedAt means a different caller clock never changes
   * the id.
   */
  id: string;
  /** The validated platform literal (one of the five). */
  platform: string;
  /**
   * The primary archetype: the FIRST match in the learn table's canonical
   * order (derived, never chosen); 'unclassified' when none matched.
   */
  primaryArchetype: string;
  /** MEASURED: how many archetypes matched (never asserted from the input's shape). */
  matchCount: number;
  /** The validated budget tier. */
  budgetTier: string;
  /** 'classified' when the learn classification matched >= 1 rule; 'unclassified' otherwise (honest, never a guess). */
  outcome: 'classified' | 'unclassified';
  /** RFC3339 — CALLER-injected; the classifier never reads a clock. */
  classifiedAt: string;
}

/** Fail-closed classification: a result, never an exception. */
export type TargetClassificationResult =
  | { ok: true; classification: TargetClassification }
  | { ok: false; errors: string[] };

/**
 * The TYPE-ONLY binding pin (compile-time only — no runtime artifact, and
 * never a fork): the learn lane's frozen ArchetypeClassification, picked
 * to EXACTLY the three fields this lane consumes, is structurally
 * assignable to the request's classification slot. A real learn
 * classification therefore fits TargetRequest['classification'] as-is;
 * the runtime validator below duck-validates those same fields as DATA.
 * If the learn lane ever breaks its frozen v0.1 shape, this line stops
 * compiling — the binding is a checked seam, not a convention.
 */
export type LearnArchetypeBinding = StaticAssign<
  Pick<ArchetypeClassification, 'archetypeVersion' | 'outcome' | 'matches'>,
  TargetRequest['classification']
>;

/** Compile-time assignability assertion: TFits must extend TSlot. */
type StaticAssign<TFits extends TSlot, TSlot> = TFits;

// ---- the target classifier ----------------------------------------------------------

/**
 * Classifies ONE build request into the factory's entry classification.
 * Async because the classification id hashes (sha256Hex over the
 * canonical classification body).
 *
 * Fail closed: a non-object request, an unknown platform (a sixth
 * platform is a named error, never a guess), a malformed learn
 * classification (non-object; archetypeVersion mismatch; an unknown
 * outcome; matches not an array of { name } objects with non-empty name
 * strings; the outcome and the matches disagreeing — the
 * honest-agreement law), an unknown budget tier, or an empty
 * classifiedAt is a collected, field-named error — ALL errors, never
 * just the first; results, never exceptions; nothing is classified from
 * partial data. Extra request fields are the caller's business — the
 * classifier validates exactly the fields it reads.
 *
 * On success the classification is DERIVED, never guessed:
 * primaryArchetype is matches[0].name (the learn table's canonical
 * first — positional) or 'unclassified' when the outcome is
 * 'unclassified'; matchCount is MEASURED; the outcome is carried
 * VERBATIM. Deterministic: the same request + caller timestamp produce a
 * deep-equal classification with an identical id, and a different caller
 * clock never moves the id (classifiedAt is excluded from the minting
 * body). The classifier never mutates its inputs and touches nothing
 * but the request and timestamp given.
 */
export async function classifyTarget(
  request: unknown,
  classifiedAt: string,
): Promise<TargetClassificationResult> {
  const errors: string[] = [];

  // ---- caller-injected classification time — the classifier never reads a clock ----
  if (typeof classifiedAt !== 'string' || classifiedAt.length === 0) {
    errors.push(
      `classifiedAt: expected a non-empty string (caller-injected — the classifier never reads a clock), got ${preview(classifiedAt)}`,
    );
  }

  // ---- the request admission shape (a plain object) ----
  if (!isObject(request)) {
    errors.push(
      `request: expected an object (TargetRequest-shaped: platform, classification, budgetTier), got ${preview(request)}`,
    );
    return { ok: false, errors };
  }

  // ---- platform: one of the five frozen P8 literals ----
  const platform = request['platform'];
  if (typeof platform !== 'string' || !TARGET_PLATFORMS.includes(platform)) {
    errors.push(
      `request.platform: expected a string from the five frozen P8 platforms ${vocabulary(TARGET_PLATFORMS)}, got ${preview(platform)}`,
    );
  }

  // ---- the learn classification, consumed as DATA (duck-validated on
  // exactly the fields this lane uses; every malformation named) ----
  const classification = request['classification'];
  let outcome: TargetClassification['outcome'] | null = null;
  let matches: Array<{ name: string }> | null = null;
  if (!isObject(classification)) {
    errors.push(
      `request.classification: expected an object (the learn lane's ArchetypeClassification consumed as DATA: archetypeVersion, outcome, matches), got ${preview(classification)}`,
    );
  } else {
    // The bound contract version — a mismatch is a named error, never a guess.
    const archetypeVersion = classification['archetypeVersion'];
    if (archetypeVersion !== ARCHETYPE_BINDING_VERSION) {
      errors.push(
        `request.classification.archetypeVersion: expected '0.1' (ARCHETYPE_BINDING_VERSION — the frozen learn contract this classifier binds; a mismatch is a named error, never a guess), got ${preview(archetypeVersion)}`,
      );
    }

    // The frozen outcome vocabulary.
    const rawOutcome = classification['outcome'];
    if (rawOutcome === 'classified' || rawOutcome === 'unclassified') {
      outcome = rawOutcome;
    } else {
      errors.push(
        `request.classification.outcome: expected 'classified' or 'unclassified' (the learn lane's frozen outcome vocabulary), got ${preview(rawOutcome)}`,
      );
    }

    // The matches: an array of { name } objects with non-empty name strings.
    const rawMatches = classification['matches'];
    if (!Array.isArray(rawMatches)) {
      errors.push(
        `request.classification.matches: expected an array of { name } match objects (the learn table's canonical order), got ${preview(rawMatches)}`,
      );
    } else {
      const admitted: Array<{ name: string }> = [];
      let malformed = false;
      rawMatches.forEach((entry: unknown, index: number) => {
        if (!isObject(entry)) {
          malformed = true;
          errors.push(
            `request.classification.matches[${index}]: expected an object with a non-empty name string, got ${preview(entry)}`,
          );
          return;
        }
        const name = entry['name'];
        if (typeof name !== 'string' || name.length === 0) {
          malformed = true;
          errors.push(
            `request.classification.matches[${index}].name: expected a non-empty string, got ${preview(name)}`,
          );
          return;
        }
        admitted.push({ name });
      });
      if (!malformed) {
        matches = admitted;
      }
    }

    // ---- the honest-agreement law (checked only over admitted data:
    // the learn classification's outcome and its matches MUST AGREE) ----
    if (outcome !== null && matches !== null) {
      if (outcome === 'classified' && matches.length === 0) {
        errors.push(
          "request.classification: the outcome 'classified' disagrees with 0 matches — the outcome and the matches MUST AGREE (the honest-agreement law; a classified learn classification carries at least one match)",
        );
      } else if (outcome === 'unclassified' && matches.length > 0) {
        errors.push(
          `request.classification: the outcome 'unclassified' disagrees with ${matches.length} matches — the outcome and the matches MUST AGREE (the honest-agreement law; an unclassified learn classification carries zero matches)`,
        );
      }
    }
  }

  // ---- budgetTier: one of the frozen exploration-budget tiers ----
  const budgetTier = request['budgetTier'];
  if (typeof budgetTier !== 'string' || !BUDGET_TIERS.includes(budgetTier)) {
    errors.push(
      `request.budgetTier: expected a string from the frozen exploration-budget tiers ${vocabulary(BUDGET_TIERS)}, got ${preview(budgetTier)}`,
    );
  }

  // ---- fail closed: nothing is classified unless every field admitted ----
  if (
    errors.length > 0 ||
    outcome === null ||
    matches === null ||
    typeof platform !== 'string' ||
    typeof budgetTier !== 'string'
  ) {
    return { ok: false, errors };
  }

  // ---- the DERIVED classification (never guessed) ----
  // primaryArchetype is matches[0].name — the learn table's canonical
  // first, positional (the derived law); 'unclassified' when nothing
  // matched. matchCount is MEASURED. The agreement law above guarantees
  // matches.length >= 1 whenever the outcome is 'classified'.
  const primaryArchetype = outcome === 'unclassified' ? 'unclassified' : matches[0]!.name;
  const matchCount = matches.length; // MEASURED

  // ---- the content-addressed classification identity ----
  // The classification MINUS its id and classifiedAt is the minting input
  // (the arch_ / fail_ discipline with the clock excluded): same id ⇔
  // identical canonical classification bytes — any measured change (the
  // platform, the primary archetype, the match count, the tier, the
  // outcome) moves the id, while a different caller clock never does.
  const classificationBody: Omit<TargetClassification, 'id' | 'classifiedAt'> = {
    targetVersion: TARGET_CLASS_VERSION,
    platform,
    primaryArchetype,
    matchCount,
    budgetTier,
    outcome,
  };

  // The last line of defense (the 060/061/062 precedent): a
  // canonicalization refusal is a NAMED error — never an escaped
  // exception. (The body is built from validated strings, so this cannot
  // fire in practice — the discipline is kept unconditional anyway.)
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
  const id = `${TARGET_CLASS_ID_PREFIX}${await sha256Hex(canonical)}`;

  return { ok: true, classification: { ...classificationBody, id, classifiedAt } };
}
