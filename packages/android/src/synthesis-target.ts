/**
 * @clapp/android — the Android synthesis target (CLAPP-080, the P8
 * opener — the fourth of the five platform components).
 *
 * docs/WORK_ITEMS.md P8: each platform implements a synthesis target.
 * THIS MODULE IS THE ANDROID ONE: the descriptor the codegen lane aims
 * at — the application id, the activity set, the screen-density
 * buckets, and the minimum API level the generated app supports.
 *
 * THE FROZEN v0.1 VOCABULARY (binding — the only shapes this target
 * admits):
 *   - targetVersion: '0.1' (ANDROID_TARGET_VERSION)
 *   - platform: 'android' (the platform literal — frozen)
 *   - the five density buckets (ANDROID_DENSITIES): mdpi, hdpi, xhdpi,
 *     xxhdpi, xxxhdpi (the resource buckets the codegen lane emits for)
 *
 * "Sorted" means lexicographic ascending (code-unit order — the default
 * `Array.prototype.sort()` on strings), the same law as the
 * environment's grantedPermissions.
 *
 * THE CROSS-CHECK BOUNDARY (honest scope): minApiLevel <= the
 * environment's apiLevel WHEN BOTH ARE KNOWN is a caller-owned
 * cross-check — this validator checks the target's OWN shape only (it
 * never sees the environment; the two-sided check needs both sides and
 * belongs to the caller holding both).
 *
 * Discipline (binding — the 070..075 house rules): fail closed (EVERY
 * field error collected and named with the observed value — results,
 * never exceptions; refusal is the DEFAULT); no clock, no randomness,
 * no network, no filesystem, no global state; the module never mutates
 * its inputs. THE NO-FORK LAW: the target is a local descriptor the
 * codegen lane consumes — it never redefines any IR/plan contract type.
 */

// ---- the frozen v0.1 vocabulary -----------------------------------------------------

/** The Android synthesis target's version (frozen at v0.1). */
export const ANDROID_TARGET_VERSION = '0.1';

/** The Android synthesis target — what the codegen lane aims at (v0.1: the descriptor). */
export interface AndroidSynthesisTarget {
  /** The target's version (always ANDROID_TARGET_VERSION ('0.1')). */
  targetVersion: string;
  /** The platform literal — frozen at 'android'. */
  platform: 'android';
  /** The application id (the manifest package, e.g. 'org.clapp.example' — non-empty). */
  applicationId: string;
  /** The activity names to generate (sorted, deduped, non-empty strings). */
  activities: string[];
  /**
   * The screen-density buckets to emit resources for (the frozen v0.1
   * vocabulary: 'mdpi' | 'hdpi' | 'xhdpi' | 'xxhdpi' | 'xxxhdpi' —
   * sorted, deduped).
   */
  densities: string[];
  /**
   * The minimum API level the app supports (a positive integer; when
   * the environment is known too, <= its apiLevel — the caller's
   * cross-check).
   */
  minApiLevel: number;
}

/**
 * The frozen v0.1 density buckets (the screen-density resource
 * vocabulary the codegen lane emits for — the only strings densities
 * may carry).
 */
export const ANDROID_DENSITIES: readonly string[] = [
  'mdpi',
  'hdpi',
  'xhdpi',
  'xxhdpi',
  'xxxhdpi',
];

/** The frozen vocabulary rendered for error messages (the observed-value law). */
const DENSITIES_FOR_MESSAGES = ANDROID_DENSITIES.map((density) => JSON.stringify(density)).join(' | ');

/** The validator's fail-closed result (the house shape). */
export type AndroidSynthesisTargetValidation =
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

// ---- the synthesis target validator -------------------------------------------------

/**
 * Fail-closed validation of an AndroidSynthesisTarget: platform exactly
 * 'android'; targetVersion exactly ANDROID_TARGET_VERSION;
 * applicationId a non-empty string; activities a sorted, deduped array
 * of non-empty strings; densities a sorted, deduped array from the
 * frozen v0.1 five-bucket vocabulary (an unknown density is named with
 * its observed value); minApiLevel a positive integer. EVERY
 * malformation is collected and named (with the observed value) —
 * results, never exceptions; refusal is the DEFAULT.
 */
export function validateAndroidSynthesisTarget(target: unknown): AndroidSynthesisTargetValidation {
  const errors: string[] = [];

  if (!isObject(target)) {
    return { ok: false, errors: [`synthesis target must be an object (observed: ${preview(target)})`] };
  }

  if (target.platform !== 'android') {
    errors.push(`platform must be exactly 'android' (observed: ${preview(target.platform)})`);
  }

  if (target.targetVersion !== ANDROID_TARGET_VERSION) {
    errors.push(
      `targetVersion must be ${JSON.stringify(ANDROID_TARGET_VERSION)} (observed: ${preview(target.targetVersion)})`,
    );
  }

  if (typeof target.applicationId !== 'string' || target.applicationId.length === 0) {
    errors.push(
      `applicationId must be a non-empty string (observed: ${preview(target.applicationId)})`,
    );
  }

  validateStringList(target.activities, 'activities', errors);

  validateStringList(
    target.densities,
    'densities',
    errors,
    ANDROID_DENSITIES,
    `the frozen v0.1 density vocabulary: ${DENSITIES_FOR_MESSAGES}`,
  );

  if (!isPositiveInteger(target.minApiLevel)) {
    errors.push(`minApiLevel must be a positive integer (observed: ${preview(target.minApiLevel)})`);
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
