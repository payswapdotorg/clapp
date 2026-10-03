/**
 * @clapp/android — the Android environment descriptor (CLAPP-080, the
 * P8 opener — Worker 1, Observation and Platform Adapters, the owner of
 * the platform lanes per docs/WORKER_HANDOFFS.md).
 *
 * docs/WORK_ITEMS.md P8 (the lane's law) reads: "Each native platform
 * must implement: observation adapter, environment descriptor, evidence
 * emitter, synthesis target, verification adapter. Sequence: Android →
 * Linux → Windows → macOS → iOS. Do not fork the core Behavioral IR."
 * THIS MODULE IS THE SECOND OF THE FIVE (and the first the others lean
 * on): the descriptor every other Android component validates against —
 * the API level, the logical screen size, the granted permissions, and
 * the observation budget (the UI hierarchy depth limit the observation
 * adapter enforces as a law).
 *
 * THE FROZEN v0.1 VOCABULARY (binding — the only shapes this descriptor
 * admits):
 *   - environmentVersion: '0.1' (ANDROID_ENVIRONMENT_VERSION)
 *   - platform: 'android' (the platform literal — frozen)
 *   - the five modeled permissions (ANDROID_PERMISSIONS):
 *     android.permission.INTERNET, android.permission.CAMERA,
 *     android.permission.READ_EXTERNAL_STORAGE,
 *     android.permission.WRITE_EXTERNAL_STORAGE,
 *     android.permission.ACCESS_FINE_LOCATION
 *
 * "Sorted" means lexicographic ascending (code-unit order — the default
 * `Array.prototype.sort()` on strings), the same law for every sorted
 * vocabulary in this package.
 *
 * Discipline (binding — the 070..075 house rules):
 * - Fail closed: the validator collects EVERY field error in a
 *   { ok: false, errors } result — each error names its field and the
 *   OBSERVED value — results, never exceptions; refusal is the DEFAULT.
 * - No clock, no randomness, no network, no filesystem, no global state.
 * - The module never mutates its inputs.
 * - THE NO-FORK LAW (the P8 cardinal law): this package CONSUMES the
 *   frozen contracts via TYPE-ONLY imports and produces contract-shaped
 *   DATA — it never redefines, rewrites, or forks any IR/contract type
 *   (the import-discipline test in test/android.test.ts pins this).
 *
 * Honest v0.1 scope: the descriptor is the CONTRACT, not a device probe
 * — real `adb shell dumpsys`/PackageInfo extraction is deployment scope
 * (the host-seam law, see src/observation.ts).
 */

// ---- the frozen v0.1 vocabulary ---------------------------------------------------

/** The Android environment descriptor's version (frozen at v0.1). */
export const ANDROID_ENVIRONMENT_VERSION = '0.1';

/** The Android environment descriptor (the frozen v0.1 vocabulary). */
export interface AndroidEnvironment {
  /** The descriptor's version — always ANDROID_ENVIRONMENT_VERSION ('0.1'). */
  environmentVersion: string;
  /** The platform literal — frozen at 'android'. */
  platform: 'android';
  /** The target device's API level (a positive integer, e.g. 34). */
  apiLevel: number;
  /** The screen's logical size in dp (both positive integers). */
  screenDp: { width: number; height: number };
  /**
   * The granted permissions (sorted, deduped — a subset of the frozen
   * v0.1 permission vocabulary ANDROID_PERMISSIONS).
   */
  grantedPermissions: string[];
  /**
   * The described UI hierarchy depth limit (a positive integer — the
   * observation budget the observation adapter enforces as a law).
   */
  maxHierarchyDepth: number;
}

/**
 * The frozen v0.1 permission vocabulary (the Android app permissions
 * CLAPP v0.1 models — the only strings grantedPermissions may carry).
 */
export const ANDROID_PERMISSIONS: readonly string[] = [
  'android.permission.INTERNET',
  'android.permission.CAMERA',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
  'android.permission.ACCESS_FINE_LOCATION',
];

/** The frozen vocabulary rendered for error messages (the observed-value law). */
const PERMISSIONS_FOR_MESSAGES = ANDROID_PERMISSIONS.map((permission) => JSON.stringify(permission)).join(' | ');

/** The validator's fail-closed result (the house shape). */
export type AndroidEnvironmentValidation =
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
 * observed value.
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

// ---- the environment validator -----------------------------------------------------

/**
 * Fail-closed validation of an AndroidEnvironment: platform exactly
 * 'android'; environmentVersion exactly ANDROID_ENVIRONMENT_VERSION;
 * apiLevel a positive integer; screenDp an object with width and height
 * both positive integers; grantedPermissions a sorted, deduped array of
 * non-empty strings from the frozen v0.1 permission vocabulary (an
 * unknown permission is named with its observed value); maxHierarchyDepth
 * a positive integer. EVERY malformation is collected and named (with
 * the observed value) — results, never exceptions; refusal is the
 * DEFAULT.
 */
export function validateAndroidEnvironment(env: unknown): AndroidEnvironmentValidation {
  const errors: string[] = [];

  if (!isObject(env)) {
    return { ok: false, errors: [`environment must be an object (observed: ${preview(env)})`] };
  }

  if (env.platform !== 'android') {
    errors.push(`platform must be exactly 'android' (observed: ${preview(env.platform)})`);
  }

  if (env.environmentVersion !== ANDROID_ENVIRONMENT_VERSION) {
    errors.push(
      `environmentVersion must be ${JSON.stringify(ANDROID_ENVIRONMENT_VERSION)} (observed: ${preview(env.environmentVersion)})`,
    );
  }

  if (!isPositiveInteger(env.apiLevel)) {
    errors.push(`apiLevel must be a positive integer (observed: ${preview(env.apiLevel)})`);
  }

  if (!isObject(env.screenDp)) {
    errors.push(
      `screenDp must be an object with width and height (observed: ${preview(env.screenDp)})`,
    );
  } else {
    if (!isPositiveInteger(env.screenDp.width)) {
      errors.push(
        `screenDp.width must be a positive integer (observed: ${preview(env.screenDp.width)})`,
      );
    }
    if (!isPositiveInteger(env.screenDp.height)) {
      errors.push(
        `screenDp.height must be a positive integer (observed: ${preview(env.screenDp.height)})`,
      );
    }
  }

  validateStringList(
    env.grantedPermissions,
    'grantedPermissions',
    errors,
    ANDROID_PERMISSIONS,
    `the frozen v0.1 Android permission vocabulary: ${PERMISSIONS_FOR_MESSAGES}`,
  );

  if (!isPositiveInteger(env.maxHierarchyDepth)) {
    errors.push(
      `maxHierarchyDepth must be a positive integer (observed: ${preview(env.maxHierarchyDepth)})`,
    );
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
