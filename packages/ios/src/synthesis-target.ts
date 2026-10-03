/**
 * @clapp/ios — the iOS synthesis target (CLAPP-084, the P8 fifth and
 * final platform — the fourth of the five platform components).
 *
 * docs/WORK_ITEMS.md P8: each platform implements a synthesis target.
 * THIS MODULE IS THE iOS ONE: the descriptor the codegen lane aims
 * at — the built product's name, the bundle identifiers to target, the
 * packaging formats to emit artifacts for, and the minimum OS major
 * the artifact supports.
 *
 * THE FROZEN v0.1 VOCABULARY (binding — the only shapes this target
 * admits):
 *   - targetVersion: '0.1' (IOS_TARGET_VERSION)
 *   - platform: 'ios' (the platform literal — frozen)
 *   - the five packaging formats (IOS_PACKAGING_FORMATS): ipa,
 *     app, xcarchive, dSYM, zip
 *
 * "Sorted" means lexicographic ascending (code-unit order — the default
 * `Array.prototype.sort()` on strings), the same law for every sorted
 * vocabulary in this package (bundleIdentifiers AND packagingFormats;
 * note 'dSYM' sorts AFTER 'app' and BEFORE 'ipa' in code-unit order —
 * uppercase inside 'dSYM' is literal, never case-folded).
 *
 * THE CROSS-CHECK BOUNDARY (honest scope): minOsMajor <= the
 * environment's osMajor WHEN BOTH ARE KNOWN is a caller-owned
 * cross-check — this validator checks the target's OWN shape only (it
 * never sees the environment; the two-sided check needs both sides and
 * belongs to the caller holding both).
 *
 * Discipline (binding — the 070..083 house rules): fail closed (EVERY
 * field error collected and named with the observed value — results,
 * never exceptions; refusal is the DEFAULT); no clock, no randomness,
 * no network, no filesystem, no global state; the module never mutates
 * its inputs. THE NO-FORK LAW: the target is a local descriptor the
 * codegen lane consumes — it never redefines any IR/plan contract type.
 */

// ---- the frozen v0.1 vocabulary ------------------------------------------------------

/** The iOS synthesis target's version (frozen at v0.1). */
export const IOS_TARGET_VERSION = '0.1';

/** The iOS synthesis target — what the codegen lane aims at (v0.1: the descriptor). */
export interface IOSSynthesisTarget {
  /** The target's version (always IOS_TARGET_VERSION ('0.1')). */
  targetVersion: string;
  /** The platform literal — frozen at 'ios'. */
  platform: 'ios';
  /** The built product name (non-empty, e.g. 'ClappExample'). */
  productName: string;
  /** The bundle identifiers to target (sorted, deduped, non-empty strings, e.g. 'org.clapp.example'). */
  bundleIdentifiers: string[];
  /**
   * The packaging formats to emit artifacts for (frozen v0.1
   * vocabulary: 'ipa' | 'app' | 'xcarchive' | 'dSYM' | 'zip' — sorted,
   * deduped).
   */
  packagingFormats: string[];
  /** The minimum OS major the artifact supports (a positive integer). */
  minOsMajor: number;
}

/**
 * The frozen v0.1 packaging-format vocabulary (the artifact formats the
 * codegen lane emits for — the only strings packagingFormats may
 * carry).
 */
export const IOS_PACKAGING_FORMATS: readonly string[] = [
  'ipa',
  'app',
  'xcarchive',
  'dSYM',
  'zip',
];

/** The frozen vocabulary rendered for error messages (the observed-value law). */
const PACKAGING_FORMATS_FOR_MESSAGES = IOS_PACKAGING_FORMATS.map((format) => JSON.stringify(format)).join(' | ');

/** The validator's fail-closed result (the house shape). */
export type IOSSynthesisTargetValidation =
  | { ok: true }
  | { ok: false; errors: string[] };

// ---- internal helpers (module-level; NOT re-exported by src/index.ts) --------------

/**
 * Positive-integer check (the v0.1 numeric law: integers only, no zero,
 * no negatives, no fractions). Copied per the fixed six-file src list
 * (src/index.ts is a pure re-export surface — no shared-helpers module
 * exists by law).
 */
function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

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

/**
 * Fail-closed string-list validation: every entry a non-empty string,
 * membership in the frozen vocabulary (when given), no duplicates,
 * sorted ascending. EVERY violation is collected and named with the
 * observed value. (Copied per the fixed six-file src list.)
 */
function validateStringList(
  value: unknown,
  field: string,
  errors: string[],
  vocabulary?: readonly string[],
  vocabularyForMessages?: string,
): void {
  if (!Array.isArray(value)) {
    errors.push(`${field} must be an array of strings (observed: ${preview(value)})`);
    return;
  }
  const entries: string[] = [];
  for (const [index, entry] of value.entries()) {
    if (typeof entry !== 'string' || entry.length === 0) {
      errors.push(`${field}[${index}] must be a non-empty string (observed: ${preview(entry)})`);
      continue;
    }
    entries.push(entry);
  }
  if (vocabulary !== undefined) {
    for (const [index, entry] of entries.entries()) {
      if (!vocabulary.includes(entry)) {
        errors.push(
          `${field}[${index}] is not in ${vocabularyForMessages ?? 'the frozen vocabulary'} (observed: ${preview(entry)})`,
        );
      }
    }
  }
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry)) {
      errors.push(`${field} contains a duplicate entry (observed: ${preview(entry)})`);
    } else {
      seen.add(entry);
    }
  }
  const sorted = [...entries].sort();
  if (entries.some((entry, index) => entry !== sorted[index])) {
    errors.push(`${field} must be sorted ascending (observed: ${preview(entries)})`);
  }
}

// ---- the synthesis target validator --------------------------------------------------

/**
 * Fail-closed validation of an IOSSynthesisTarget: platform exactly
 * 'ios'; targetVersion exactly IOS_TARGET_VERSION; productName a
 * non-empty string; bundleIdentifiers a sorted, deduped array of
 * non-empty strings (free-form reverse-DNS identifiers — no frozen
 * vocabulary, but the sorted/deduped law holds); packagingFormats a
 * sorted, deduped array from the frozen v0.1 five-format vocabulary
 * (an unknown format is named with its observed value); minOsMajor a
 * positive integer. EVERY malformation is collected and named (with the
 * observed value) — results, never exceptions; refusal is the DEFAULT.
 */
export function validateIOSSynthesisTarget(target: unknown): IOSSynthesisTargetValidation {
  const errors: string[] = [];

  if (!isObject(target)) {
    return { ok: false, errors: [`synthesis target must be an object (observed: ${preview(target)})`] };
  }

  if (target.platform !== 'ios') {
    errors.push(`platform must be exactly 'ios' (observed: ${preview(target.platform)})`);
  }

  if (target.targetVersion !== IOS_TARGET_VERSION) {
    errors.push(
      `targetVersion must be ${JSON.stringify(IOS_TARGET_VERSION)} (observed: ${preview(target.targetVersion)})`,
    );
  }

  if (typeof target.productName !== 'string' || target.productName.length === 0) {
    errors.push(
      `productName must be a non-empty string (observed: ${preview(target.productName)})`,
    );
  }

  validateStringList(target.bundleIdentifiers, 'bundleIdentifiers', errors);

  validateStringList(
    target.packagingFormats,
    'packagingFormats',
    errors,
    IOS_PACKAGING_FORMATS,
    `the frozen v0.1 packaging-format vocabulary: ${PACKAGING_FORMATS_FOR_MESSAGES}`,
  );

  if (!isPositiveInteger(target.minOsMajor)) {
    errors.push(
      `minOsMajor must be a positive integer (observed: ${preview(target.minOsMajor)})`,
    );
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
