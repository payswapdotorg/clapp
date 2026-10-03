/**
 * @clapp/linux — the Linux environment descriptor (CLAPP-081, the P8
 * second platform — Worker 1, Observation and Platform Adapters, the
 * owner of the platform lanes per docs/WORKER_HANDOFFS.md).
 *
 * docs/WORK_ITEMS.md P8 (the lane's law) reads: "Each native platform
 * must implement: observation adapter, environment descriptor, evidence
 * emitter, synthesis target, verification adapter. Sequence: Android →
 * Linux → Windows → macOS → iOS. Do not fork the core Behavioral IR."
 * THIS MODULE IS THE SECOND OF THE FIVE (and the first the others lean
 * on): the descriptor every other Linux component validates against —
 * the kernel's major version, the display server, the desktop
 * accessibility bus, the pixel screen size, and the observation budget
 * (the UI hierarchy depth limit the observation adapter enforces as a
 * law).
 *
 * THE FROZEN v0.1 VOCABULARY (binding — the only shapes this descriptor
 * admits):
 *   - environmentVersion: '0.1' (LINUX_ENVIRONMENT_VERSION)
 *   - platform: 'linux' (the platform literal — frozen)
 *   - the two display servers (LINUX_DISPLAY_SERVERS): x11, wayland
 *   - the two accessibility buses (LINUX_ACCESSIBILITY_BUSES): at-spi,
 *     none — 'none' is the HONEST descriptor (a machine that discloses
 *     it has no observing bus); its observation refusal is the
 *     observation adapter's AT-SPI law (src/observation.ts), NEVER a
 *     validator error — the validator admits it here, the observation
 *     seam refuses it there.
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
 *   (the import-discipline test in test/linux.test.ts pins this).
 *
 * Honest v0.1 scope: the descriptor is the CONTRACT, not a system probe
 * — real `uname -r` / X11 / Wayland / AT-SPI discovery is deployment
 * scope (the host-seam law, see src/observation.ts).
 */

// ---- the frozen v0.1 vocabulary ---------------------------------------------------

/** The Linux environment descriptor's version (frozen at v0.1). */
export const LINUX_ENVIRONMENT_VERSION = '0.1';

/** The Linux environment descriptor (the frozen v0.1 vocabulary). */
export interface LinuxEnvironment {
  /** The descriptor's version — always LINUX_ENVIRONMENT_VERSION ('0.1'). */
  environmentVersion: string;
  /** The platform literal — frozen at 'linux'. */
  platform: 'linux';
  /** The kernel's major version (a positive integer, e.g. 6). */
  kernelMajor: number;
  /** The display server (frozen v0.1 vocabulary: 'x11' | 'wayland'). */
  displayServer: string;
  /**
   * The desktop accessibility bus in use (frozen v0.1 vocabulary:
   * 'at-spi' | 'none' — 'none' refuses observation honestly: the
   * honest no-bus descriptor, VALID here, refused by the observation
   * seam's AT-SPI law).
   */
  accessibilityBus: string;
  /** The screen's pixel size (both positive integers). */
  screenSize: { width: number; height: number };
  /**
   * The described UI hierarchy depth limit (a positive integer — the
   * observation budget the observation adapter enforces as a law).
   */
  maxHierarchyDepth: number;
}

/** The frozen v0.1 display-server vocabulary. */
export const LINUX_DISPLAY_SERVERS: readonly string[] = ['x11', 'wayland'];

/**
 * The frozen v0.1 accessibility-bus vocabulary (at-spi is the only
 * observing bus in v0.1; 'none' is the honest no-bus descriptor).
 */
export const LINUX_ACCESSIBILITY_BUSES: readonly string[] = ['at-spi', 'none'];

/** The frozen vocabularies rendered for error messages (the observed-value law). */
const DISPLAY_SERVERS_FOR_MESSAGES = LINUX_DISPLAY_SERVERS.map((server) => JSON.stringify(server)).join(' | ');
const ACCESSIBILITY_BUSES_FOR_MESSAGES = LINUX_ACCESSIBILITY_BUSES.map((bus) => JSON.stringify(bus)).join(' | ');

/** The validator's fail-closed result (the house shape). */
export type LinuxEnvironmentValidation =
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
 * Fail-closed validation of a LinuxEnvironment: platform exactly
 * 'linux'; environmentVersion exactly LINUX_ENVIRONMENT_VERSION;
 * kernelMajor a positive integer; screenSize an object with width and
 * height both positive integers; displayServer a string from the frozen
 * v0.1 display-server vocabulary (an unknown display server is named
 * with its observed value); accessibilityBus a string from the frozen
 * v0.1 accessibility-bus vocabulary (an unknown bus is named with its
 * observed value — 'none' is VALID here: the honest descriptor whose
 * observation refusal is the observation seam's AT-SPI law, not a
 * validator error); maxHierarchyDepth a positive integer. EVERY
 * malformation is collected and named (with the observed value) —
 * results, never exceptions; refusal is the DEFAULT.
 */
export function validateLinuxEnvironment(env: unknown): LinuxEnvironmentValidation {
  const errors: string[] = [];

  if (!isObject(env)) {
    return { ok: false, errors: [`environment must be an object (observed: ${preview(env)})`] };
  }

  if (env.platform !== 'linux') {
    errors.push(`platform must be exactly 'linux' (observed: ${preview(env.platform)})`);
  }

  if (env.environmentVersion !== LINUX_ENVIRONMENT_VERSION) {
    errors.push(
      `environmentVersion must be ${JSON.stringify(LINUX_ENVIRONMENT_VERSION)} (observed: ${preview(env.environmentVersion)})`,
    );
  }

  if (!isPositiveInteger(env.kernelMajor)) {
    errors.push(`kernelMajor must be a positive integer (observed: ${preview(env.kernelMajor)})`);
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
    env.displayServer,
    'displayServer',
    LINUX_DISPLAY_SERVERS,
    `the frozen v0.1 display-server vocabulary: ${DISPLAY_SERVERS_FOR_MESSAGES}`,
    errors,
  );

  validateVocabularyString(
    env.accessibilityBus,
    'accessibilityBus',
    LINUX_ACCESSIBILITY_BUSES,
    `the frozen v0.1 accessibility-bus vocabulary: ${ACCESSIBILITY_BUSES_FOR_MESSAGES} — 'none' is the honest no-bus descriptor (valid here; its observation refusal is the AT-SPI law, not a validator error)`,
    errors,
  );

  if (!isPositiveInteger(env.maxHierarchyDepth)) {
    errors.push(
      `maxHierarchyDepth must be a positive integer (observed: ${preview(env.maxHierarchyDepth)})`,
    );
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
