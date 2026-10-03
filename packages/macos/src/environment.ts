/**
 * @clapp/macos — the macOS environment descriptor (CLAPP-083, the P8
 * fourth platform — Worker 1, Observation and Platform Adapters, the
 * owner of the platform lanes per docs/WORKER_HANDOFFS.md).
 *
 * docs/WORK_ITEMS.md P8 (the lane's law) reads: "Each native platform
 * must implement: observation adapter, environment descriptor, evidence
 * emitter, synthesis target, verification adapter. Sequence: Android →
 * Linux → Windows → macOS → iOS. Do not fork the core Behavioral IR."
 * THIS MODULE IS THE FIRST OF THE FIVE: the descriptor every other
 * macOS component validates against — the OS major version, the
 * accessibility framework in use, the pixel screen size, and the
 * observation budget (the UI hierarchy depth limit the observation
 * adapter enforces as a law).
 *
 * THE FROZEN v0.1 VOCABULARY (binding — the only shapes this descriptor
 * admits):
 *   - environmentVersion: '0.1' (MACOS_ENVIRONMENT_VERSION)
 *   - platform: 'macos' (the platform literal — frozen)
 *   - the two accessibility frameworks (MACOS_ACCESSIBILITY_FRAMEWORKS):
 *     ax, none — 'none' is the HONEST descriptor (a machine that
 *     discloses it has no accessibility framework); its observation
 *     refusal is the observation adapter's AX law (src/observation.ts),
 *     NEVER a validator error — the validator admits it here, the
 *     observation seam refuses it there.
 *
 * Discipline (binding — the 070..082 house rules):
 * - Fail closed: the validator collects EVERY field error in a
 *   { ok: false, errors } result — each error names its field and the
 *   OBSERVED value — results, never exceptions; refusal is the DEFAULT.
 * - No clock, no randomness, no network, no filesystem, no global state.
 * - The module never mutates its inputs.
 * - THE NO-FORK LAW (the P8 cardinal law): this package CONSUMES the
 *   frozen contracts via TYPE-ONLY imports and produces contract-shaped
 *   DATA — it never redefines, rewrites, or forks any IR/contract type
 *   (the import-discipline test in test/macos.test.ts pins this).
 *
 * Honest v0.1 scope: the descriptor is the CONTRACT, not a system probe
 * — real `NSProcessInfo` / AX-framework discovery is deployment scope
 * (the host-seam law, see src/observation.ts).
 */

// ---- the frozen v0.1 vocabulary ---------------------------------------------------

/** The macOS environment descriptor's version (frozen at v0.1). */
export const MACOS_ENVIRONMENT_VERSION = '0.1';

/** The macOS environment descriptor (the frozen v0.1 vocabulary). */
export interface MacOSEnvironment {
  /** The descriptor's version — always MACOS_ENVIRONMENT_VERSION ('0.1'). */
  environmentVersion: string;
  /** The platform literal — frozen at 'macos'. */
  platform: 'macos';
  /** The OS major version (a positive integer, e.g. 14). */
  osMajor: number;
  /**
   * The accessibility framework in use (frozen v0.1 vocabulary:
   * 'ax' | 'none' — 'none' refuses observation honestly: the honest
   * no-framework descriptor, VALID here, refused by the observation
   * seam's AX law).
   */
  accessibilityFramework: string;
  /** The screen's pixel size (both positive integers). */
  screenSize: { width: number; height: number };
  /**
   * The described UI hierarchy depth limit (a positive integer — the
   * observation budget the observation adapter enforces as a law).
   */
  maxHierarchyDepth: number;
}

/**
 * The frozen v0.1 accessibility-framework vocabulary (ax — the macOS
 * Accessibility API — is the only observing framework in v0.1; 'none'
 * is the honest no-framework descriptor).
 */
export const MACOS_ACCESSIBILITY_FRAMEWORKS: readonly string[] = ['ax', 'none'];

/** The frozen vocabulary rendered for error messages (the observed-value law). */
const ACCESSIBILITY_FRAMEWORKS_FOR_MESSAGES = MACOS_ACCESSIBILITY_FRAMEWORKS.map((framework) => JSON.stringify(framework)).join(' | ');

/** The validator's fail-closed result (the house shape). */
export type MacOSEnvironmentValidation =
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
 * Fail-closed single-string vocabulary validation: the value must be a
 * string AND a member of the frozen vocabulary — an unknown value (or a
 * non-string) is collected and named with the OBSERVED value.
 */
function validateVocabularyString(
  value: unknown,
  field: string,
  vocabulary: readonly string[],
  vocabularyForMessages: string,
  errors: string[],
): void {
  if (typeof value !== 'string' || !vocabulary.includes(value)) {
    errors.push(`${field} must be one of ${vocabularyForMessages} (observed: ${preview(value)})`);
  }
}

// ---- the environment validator -----------------------------------------------------

/**
 * Fail-closed validation of a MacOSEnvironment: platform exactly
 * 'macos'; environmentVersion exactly MACOS_ENVIRONMENT_VERSION;
 * osMajor a positive integer; screenSize an object with width and
 * height both positive integers; accessibilityFramework a string from
 * the frozen v0.1 accessibility-framework vocabulary (an unknown
 * framework is named with its observed value — 'none' is VALID here:
 * the honest descriptor whose observation refusal is the observation
 * seam's AX law, not a validator error); maxHierarchyDepth a positive
 * integer. EVERY malformation is collected and named (with the observed
 * value) — results, never exceptions; refusal is the DEFAULT.
 */
export function validateMacOSEnvironment(env: unknown): MacOSEnvironmentValidation {
  const errors: string[] = [];

  if (!isObject(env)) {
    return { ok: false, errors: [`environment must be an object (observed: ${preview(env)})`] };
  }

  if (env.platform !== 'macos') {
    errors.push(`platform must be exactly 'macos' (observed: ${preview(env.platform)})`);
  }

  if (env.environmentVersion !== MACOS_ENVIRONMENT_VERSION) {
    errors.push(
      `environmentVersion must be ${JSON.stringify(MACOS_ENVIRONMENT_VERSION)} (observed: ${preview(env.environmentVersion)})`,
    );
  }

  if (!isPositiveInteger(env.osMajor)) {
    errors.push(`osMajor must be a positive integer (observed: ${preview(env.osMajor)})`);
  }

  if (!isObject(env.screenSize)) {
    errors.push(
      `screenSize must be an object with width and height (observed: ${preview(env.screenSize)})`,
    );
  } else {
    if (!isPositiveInteger(env.screenSize.width)) {
      errors.push(
        `screenSize.width must be a positive integer (observed: ${preview(env.screenSize.width)})`,
      );
    }
    if (!isPositiveInteger(env.screenSize.height)) {
      errors.push(
        `screenSize.height must be a positive integer (observed: ${preview(env.screenSize.height)})`,
      );
    }
  }

  validateVocabularyString(
    env.accessibilityFramework,
    'accessibilityFramework',
    MACOS_ACCESSIBILITY_FRAMEWORKS,
    `the frozen v0.1 accessibility-framework vocabulary: ${ACCESSIBILITY_FRAMEWORKS_FOR_MESSAGES} — 'none' is the honest no-framework descriptor (valid here; its observation refusal is the AX law, not a validator error)`,
    errors,
  );

  if (!isPositiveInteger(env.maxHierarchyDepth)) {
    errors.push(
      `maxHierarchyDepth must be a positive integer (observed: ${preview(env.maxHierarchyDepth)})`,
    );
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
